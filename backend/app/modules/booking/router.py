"""Endpoints de disponibilidad y reservas."""
from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import RequirePermission, get_current_user, get_hotel_scope
from app.core.permissions import Permission
from app.modules.billing.models import pagos_de_la_reserva
from app.modules.booking.models import Reservation
from app.modules.booking.schemas import (
    PaymentOut,
    AvailabilityDay,
    PartidaAbiertaCierre,
    PartidaAbiertaMover,
    PartidasAbiertasDay,
    QuotePreview,
    ReglaDelDiaIn,
    ReglaDelDiaOut,
    ReplayOut,
    ReservationCancel,
    ReservationCreate,
    ReservationInterrupt,
    ReservationReschedule,
    ReservationListItem,
    ReservationOut,
    ReservationUpdate,
    ServiceLineOut,
    SlotOut,
)
from app.modules.booking.service import AvailabilityService, RecursosService, ReservationService_
from app.modules.booking.state_machine import estado_para_hotel, estados_internos_para_hotel
from app.modules.identity.models import User
from app.core.config import settings
from app.realtime.events import EventType, RealtimeEvent
from app.realtime.manager import publish
from app.shared.tiempo import fuera_de_venta, ya_paso
from app.shared.enums import BookingModality, ReservationStatus, SlotStatus
from app.shared.money import ZERO, money

router = APIRouter(prefix="/booking", tags=["Reservas y Disponibilidad"])


@router.get("/public/scan/{token}", tags=["Pase QR"])
def scan_public_pass(token: str, db: Session = Depends(get_db)):
    """Registra un escaneo desde el celular sin exponer los datos de la reserva.

    El celular es de quien lo traiga: un huésped, un caddie, quien sea. Por eso
    esta ruta no devuelve nada de la partida — solo avisa al mostrador, que sí
    está autenticado, y ahí se abre la reserva. Si alguien fotografía un pase
    ajeno y lo abre, no se lleva ni un nombre.
    """
    from app.core.exceptions import BusinessRuleError

    reservation = ReservationService_(db).get_by_qr(token)
    if reservation.status in (ReservationStatus.CANCELADA, ReservationStatus.NO_SHOW):
        raise BusinessRuleError("Este pase ya no es válido")

    publish(
        RealtimeEvent(
            type=EventType.PASE_ESCANEADO,
            required_permission=Permission.CHECKIN_PERFORM,
            payload={"reservation_id": reservation.id, "folio": reservation.folio},
        )
    )
    return {"ok": True, "message": "Pase identificado. Puede pasar a recepción."}


# ------------------------------------------------------------------ mapeadores
def _paid_and_balance(reservation: Reservation) -> tuple[Decimal, Decimal]:
    paid = sum((p.neto_mxn for p in pagos_de_la_reserva(reservation)), start=ZERO)
    return money(paid), money(money(reservation.total) - paid)


def _cuenta_del_hotel(reservation: Reservation) -> tuple[Decimal, Decimal]:
    """Lo que el hotel ve de su reserva: (servicios propios, total).

    El hotel tiene derecho a ver su reserva **al día**. Si en el mostrador se
    validó una credencial PGA, o alguien de la partida no llegó, su total baja
    — y eso le importa porque su comisión sale de ahí. Ocultárselo solo
    provocaría que reclame comisión sobre un monto que nadie pagó.

    Lo que no le toca es la venta que el huésped hizo en el mostrador después:
    eso es del campo, no pasa por el convenio, y por eso no entra en el total
    que se le muestra.
    """
    servicios = money(
        sum(
            (money(s.total) for s in reservation.services if not s.added_at_counter),
            start=ZERO,
        )
    )
    total = money(
        money(reservation.subtotal_green_fees)
        + servicios
        - money(reservation.discount_amount)
        - money(reservation.pga_discount_amount)
    )
    return servicios, total


def _ajustes(db):
    from app.modules.catalog.service import SettingsService

    return SettingsService(db)


def _limite(db):
    """Hora límite para reservar el mismo día, leída una vez por consulta."""
    from app.modules.catalog.service import SettingsService

    return SettingsService(db).hora_limite_del_dia()


def _proxima_del_dia(slots) -> dict:
    """La primera salida con lugar de cada día, solo para señalarla.

    Antes esta era la única que se podía reservar. Ya no: el huésped elige el
    horario que quiera de los libres. Se sigue calculando porque la pantalla la
    resalta como sugerencia — es la que deja el campo ocupado de corrido.
    """
    proximas: dict = {}
    for slot in sorted(slots, key=lambda s: (s.slot_date, s.tee, s.slot_time)):
        clave = (slot.slot_date, slot.tee)
        if clave in proximas:
            continue
        if slot.status == SlotStatus.BLOQUEADO or slot.available <= 0:
            continue
        if not settings.horarios_libres and ya_paso(slot.slot_date, slot.slot_time):
            continue
        proximas[clave] = slot.id
    return proximas


def _carritos_por_dia(db, slots) -> dict:
    """Carritos libres de cada día que aparece en la consulta."""
    servicio = RecursosService(db)
    return {fecha: servicio.situacion(fecha) for fecha in {s.slot_date for s in slots}}


def _slot_out(slot, scope: Optional[int] = None, limite=None, proximas=None, recursos=None) -> SlotOut:
    """Convierte una salida a su representación.

    Cuando quien consulta es un hotel, se marca cuáles salidas son suyas para
    que la rejilla las pinte distinto; del resto solo se sabe que están
    ocupadas, nunca de quién son.
    """
    out = SlotOut.model_validate(slot, from_attributes=True)
    out.available = slot.available
    # Vencida si ya pasó su hora, o si es de hoy y el día ya cerró. Así la
    # rejilla la pinta cerrada y nadie llena una solicitud que va a rebotar.
    if settings.horarios_libres:
        out.expirada = False
    elif limite is not None:
        out.expirada = fuera_de_venta(slot.slot_date, slot.slot_time, limite)
    else:
        out.expirada = ya_paso(slot.slot_date, slot.slot_time)
    if slot.event:
        out.event_name = slot.event.name
    # Por qué no se puede tomar esta salida, en orden de importancia.
    situacion = (recursos or {}).get(slot.slot_date)
    # Ya no cierra nada: solo marca cuál es la siguiente sugerida.
    out.en_turno = bool(proximas and proximas.get((slot.slot_date, slot.tee)) == slot.id)
    out.cerrada_manual = bool(slot.open_closed)
    if slot.status == SlotStatus.BLOQUEADO:
        out.cerrada_por = "bloqueada"
    elif out.expirada:
        out.cerrada_por = "vencida"
    # Una partida abierta cerrada a mano sí tiene lugares libres: si dijera
    # "ocupada", el que vende buscaría un cupo que la pantalla le está negando
    # por una decisión, no por falta de espacio. Va antes de "ocupada" porque
    # cerrarla es justo lo que dejó el cupo en cero.
    elif slot.open_closed and slot.occupied < slot.capacity:
        out.cerrada_por = "cerrada"
    elif slot.available <= 0:
        out.cerrada_por = "ocupada"
    elif situacion and situacion["carritos_libres"] <= 0:
        out.cerrada_por = "carritos"

    if scope is None and slot.replays:
        t = slot.replays[0]
        out.replay_folio = t.reservation.folio if t.reservation else None

    vivas = [
        r for r in slot.reservations
        if r.status not in (ReservationStatus.CANCELADA, ReservationStatus.NO_SHOW)
        # La práctica no toma la salida de golf: no se pinta en la rejilla.
        and r.modality != BookingModality.PRACTICA
    ]
    if vivas:
        # SQLAlchemy devuelve la columna como texto; se normaliza al enum.
        out.modalidad = BookingModality(vivas[0].modality)
        propias = [r for r in vivas if scope is not None and r.hotel_id == scope]
        out.es_de_mi_hotel = bool(propias)
        if scope is None:
            out.titular = vivas[0].holder_name
        elif propias:
            out.titular = propias[0].holder_name
    return out


def _reservation_out(reservation: Reservation, scope: Optional[int] = None) -> ReservationOut:
    out = ReservationOut.model_validate(reservation)
    if scope is not None:
        # El hotel ve solo sus cuatro estados; lo del mostrador no le toca.
        out.status = estado_para_hotel(reservation.status)
        out.replays = []
    else:
        out.replays = [
            ReplayOut(
                id=t.id, players_count=t.players_count, unit_price=t.unit_price,
                total=t.total, created_at=t.created_at, tee_slot_id=t.tee_slot_id,
                slot_time=t.tee_slot.slot_time if t.tee_slot else None,
                created_by_name=t.created_by.full_name if t.created_by else None,
                attended_by_name=t.attended_by_name,
                payments=[
                    PaymentOut.model_validate(p, from_attributes=True)
                    for p in sorted(t.payments, key=lambda x: x.id)
                ],
            )
            for t in reservation.replays
        ]
    out.hotel_name = reservation.hotel.name if reservation.hotel else None
    if reservation.tee_slot:
        out.slot_date = reservation.tee_slot.slot_date
        out.slot_time = reservation.tee_slot.slot_time
        out.tee = reservation.tee_slot.tee
    # La cadena de la cortesía, por folio: de qué partida viene esta reposición
    # y, al revés, qué reposición se le dio a esta partida.
    out.rescheduled_from_folio = (
        reservation.rescheduled_from.folio if reservation.rescheduled_from else None
    )
    reposiciones = getattr(reservation, "reposiciones", None) or []
    out.reposicion_folio = reposiciones[0].folio if reposiciones else None
    lineas = reservation.services
    if scope is not None:
        lineas = [s for s in lineas if not s.added_at_counter]
    out.services = [
        ServiceLineOut(
            id=s.id, service_id=s.service_id,
            service_name=s.service.name if s.service else None,
            quantity=s.quantity, unit_price_applied=s.unit_price_applied,
            total=s.total, notes=s.notes,
            service_code=s.service.code if s.service else None,
            added_at_counter=s.added_at_counter,
        )
        for s in lineas
    ]

    if scope is not None:
        # El hotel ve su cuenta, no la caja del campo: ni los cobros ni el
        # saldo, que además incluirían la venta de mostrador y no cuadrarían
        # contra el total que sí le corresponde.
        out.subtotal_services, out.total = _cuenta_del_hotel(reservation)
        out.payments = []
        out.total_paid = out.balance = ZERO
        return out

    # Los cobros van en el detalle porque el recibo los imprime: quién pagó
    # con qué y a qué tipo de cambio.
    out.payments = [
        PaymentOut.model_validate(pago, from_attributes=True)
        for pago in sorted(reservation.payments, key=lambda x: x.id)
        if pago.replay_id is None
    ]
    paid, balance = _paid_and_balance(reservation)
    out.total_paid, out.balance = paid, balance
    return out


def _list_item(reservation: Reservation, scope: Optional[int] = None) -> ReservationListItem:
    out = ReservationListItem.model_validate(reservation)
    if scope is not None:
        out.status = estado_para_hotel(reservation.status)
    out.hotel_name = reservation.hotel.name if reservation.hotel else None
    if reservation.tee_slot:
        out.slot_date = reservation.tee_slot.slot_date
        out.slot_time = reservation.tee_slot.slot_time
        out.tee = reservation.tee_slot.tee
    out.player_count = len(reservation.players)
    if scope is not None:
        # Mismo criterio que en el detalle: el total del hotel es el suyo.
        _, out.total = _cuenta_del_hotel(reservation)
        out.balance = ZERO
        return out
    _, out.balance = _paid_and_balance(reservation)
    return out


# --------------------------------------------------------------- disponibilidad
@router.get("/availability", response_model=AvailabilityDay)
def availability(
    slot_date: date = Query(default_factory=date.today),
    tee: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    slots = AvailabilityService(db).day(slot_date, tee)
    limite = _limite(db)
    proximas = _proxima_del_dia(slots)
    recursos = _carritos_por_dia(db, slots)
    return AvailabilityDay(
        slot_date=slot_date, tee=tee or "TODOS",
        slots=[_slot_out(s, scope, limite, proximas, recursos) for s in slots],
        cierre_de_campo=_ajustes(db).cierre_de_campo(),
        twilight_desde=_ajustes(db).twilight_desde(),
        # Si ese día se están armando partidas abiertas. Va aquí para que la
        # pantalla de venta apague la modalidad en lugar de dejar al concierge
        # llenar toda la reserva y rebotarla al guardar.
        admite_abiertas=ReservationService_(db).dia_admite_abiertas(slot_date),
    )


@router.get("/availability/range", response_model=List[SlotOut])
def availability_range(
    start: date,
    end: date,
    tee: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    limite = _limite(db)
    slots = AvailabilityService(db).range(start, end, tee)
    proximas = _proxima_del_dia(slots)
    recursos = _carritos_por_dia(db, slots)
    return [_slot_out(s, scope, limite, proximas, recursos) for s in slots]


# -------------------------------------------------------------------- reservas
@router.post("/reservations/quote", response_model=QuotePreview)
def quote(
    payload: ReservationCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.RESERVATION_CREATE)),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    return QuotePreview(**ReservationService_(db, hotel_scope=scope).quote(payload, actor))


@router.post("/reservations", response_model=ReservationOut, status_code=status.HTTP_201_CREATED)
def create_reservation(
    payload: ReservationCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.RESERVATION_CREATE)),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    reservation = ReservationService_(db, hotel_scope=scope).create(payload, actor)
    return _reservation_out(reservation, scope)


@router.get("/reservations", response_model=List[ReservationListItem])
def list_reservations(
    term: Optional[str] = None,
    status_filter: Optional[ReservationStatus] = Query(default=None, alias="status"),
    hotel_id: Optional[int] = None,
    slot_date: Optional[date] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    estados = status_filter
    if scope is not None and status_filter is not None:
        estados = estados_internos_para_hotel(status_filter)
    items = ReservationService_(db, hotel_scope=scope).search(
        term=term, status=estados, hotel_id=hotel_id, slot_date=slot_date,
        date_from=date_from, date_to=date_to, limit=limit, offset=offset,
    )
    return [_list_item(r, scope) for r in items]


@router.get("/reservations/folio/{folio}", response_model=ReservationOut)
def get_by_folio(
    folio: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    return _reservation_out(ReservationService_(db, hotel_scope=scope).get_by_folio(folio), scope)


@router.get("/reservations/qr/{token}", response_model=ReservationOut)
def get_by_qr(
    token: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    """Escaneo del pase. Un solo QR trae toda la partida con su lista de jugadores."""
    return _reservation_out(ReservationService_(db, hotel_scope=scope).get_by_qr(token), scope)


@router.get("/reservations/{reservation_id}/pase", tags=["Pase QR"])
def reservation_pass(
    reservation_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    """Pase de la partida: folio y QR para entregárselo al huésped.

    El hotel también lo puede sacar, pero solo de sus reservas: es la
    conserjería quien se lo imprime al huésped.
    """
    from app.core.exceptions import NotFoundError
    from app.workers.notifications import generar_qr_base64

    reservation = ReservationService_(db, hotel_scope=scope).get(reservation_id)
    if not reservation.qr_token:
        raise NotFoundError("Esta reserva no tiene pase QR")
    return {
        "folio": reservation.folio,
        "url": f"{settings.QR_BASE_URL}/{reservation.qr_token}",
        "qr_png_base64": generar_qr_base64(reservation.qr_token),
    }


@router.get("/reservations/{reservation_id}", response_model=ReservationOut)
def get_reservation(
    reservation_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    return _reservation_out(ReservationService_(db, hotel_scope=scope).get(reservation_id), scope)


@router.patch("/reservations/{reservation_id}", response_model=ReservationOut)
def update_reservation(
    reservation_id: int,
    payload: ReservationUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    service = ReservationService_(db, hotel_scope=scope)
    updated = service.update(reservation_id, payload.model_dump(exclude_unset=True), actor)
    return _reservation_out(updated, scope)


@router.post("/reservations/{reservation_id}/confirm", response_model=ReservationOut)
def confirm_reservation(
    reservation_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.RESERVATION_CONFIRM)),
):
    return _reservation_out(ReservationService_(db).confirm(reservation_id, actor))


@router.post("/reservations/{reservation_id}/cancel", response_model=ReservationOut)
def cancel_reservation(
    reservation_id: int,
    payload: ReservationCancel,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.RESERVATION_CANCEL)),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    service = ReservationService_(db, hotel_scope=scope)
    return _reservation_out(service.cancel(reservation_id, payload.reason, actor), scope)


@router.post("/reservations/{reservation_id}/no-show", response_model=ReservationOut)
def no_show(
    reservation_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.RESERVATION_CONFIRM)),
):
    return _reservation_out(ReservationService_(db).mark_no_show(reservation_id, actor))


@router.post("/reservations/{reservation_id}/start", response_model=ReservationOut)
def start_round(
    reservation_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.CHECKIN_PERFORM)),
):
    return _reservation_out(ReservationService_(db).start_round(reservation_id, actor))


@router.post("/reservations/{reservation_id}/complete", response_model=ReservationOut)
def complete_round(
    reservation_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.CHECKIN_PERFORM)),
):
    return _reservation_out(ReservationService_(db).complete(reservation_id, actor))


@router.post("/reservations/{reservation_id}/interrumpir", response_model=ReservationOut)
def interrumpir(
    reservation_id: int,
    payload: ReservationInterrupt,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.RESERVATION_RESCHEDULE)),
):
    """El campo se suspendió: la partida queda marcada en el hoyo donde se quedó.

    Libera los carritos y los caddies, que el resto del día necesita.
    """
    return _reservation_out(
        ReservationService_(db).interrumpir(
            reservation_id, hoyo=payload.hoyo, motivo=payload.motivo, actor=actor
        )
    )


@router.post(
    "/reservations/{reservation_id}/reagendar",
    response_model=ReservationOut,
    status_code=status.HTTP_201_CREATED,
)
def reagendar(
    reservation_id: int,
    payload: ReservationReschedule,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.RESERVATION_RESCHEDULE)),
):
    """Le repone la ronda al huésped como cortesía, en la salida que elija.

    Devuelve la reserva **nueva**: la cortesía tiene su propio folio, puede ser
    cualquier día, y en partida abierta el huésped no tiene que volver con la
    misma gente.
    """
    return _reservation_out(
        ReservationService_(db).reagendar_por_cortesia(
            reservation_id, tee_slot_id=payload.tee_slot_id, actor=actor,
            quien_reserva=payload.booked_by_name,
        )
    )


# --------------------------------------------------- control de partidas abiertas
@router.get("/partidas-abiertas", response_model=PartidasAbiertasDay)
def partidas_abiertas(
    slot_date: date = Query(default_factory=date.today),
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.OPEN_PARTIDA_MANAGE)),
):
    """Las partidas abiertas del día y quién se juntó en cada una.

    Es la pantalla con la que operaciones arma los grupos: de qué hotel viene
    cada quien, cuántos lugares quedan y cuáles ya se cerraron a mano.
    """
    return ReservationService_(db).partidas_abiertas(slot_date)


@router.post(
    "/slots/{slot_id}/partida-abierta/cerrar",
    response_model=SlotOut,
)
def cerrar_partida_abierta(
    slot_id: int,
    payload: PartidaAbiertaCierre,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.OPEN_PARTIDA_MANAGE)),
):
    """Cierra una partida abierta antes de que se llene, o la vuelve a abrir.

    Con `cerrar: false` se reabre, mientras queden lugares.
    """
    slot = ReservationService_(db).cerrar_partida_abierta(
        slot_id, cerrar=payload.cerrar, actor=actor
    )
    return _slot_out(slot)


@router.post("/reservations/{reservation_id}/mover", response_model=ReservationOut)
def mover_a_otra_salida(
    reservation_id: int,
    payload: PartidaAbiertaMover,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.OPEN_PARTIDA_MANAGE)),
):
    """Pasa una reserva de partida abierta a otra salida.

    Se mueve la reserva completa: una reserva es lo que pidió un hotel, con su
    cobro y su comisión, y partirla dejaría dos medias cuentas.
    """
    return _reservation_out(
        ReservationService_(db).mover_a_otra_salida(
            reservation_id, tee_slot_id=payload.tee_slot_id, actor=actor
        )
    )


@router.post("/partidas-abiertas/regla-del-dia", response_model=ReglaDelDiaOut)
def fijar_regla_del_dia(
    payload: ReglaDelDiaIn,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.OPEN_PARTIDA_MANAGE)),
):
    """Abre o cierra la modalidad de partida abierta para un día.

    Sin regla escrita el día las acepta, que es lo normal. Cerrarlo no toca las
    partidas abiertas que ya estaban vendidas: solo impide armar nuevas.
    """
    return ReservationService_(db).fijar_regla_del_dia(
        payload.dia, admite=payload.admite, nota=payload.nota, actor=actor
    )


@router.get("/recursos")
def recursos(
    slot_date: date = Query(default_factory=date.today),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Carritos y caddies de ese día: cuántos hay, cuántos se están usando y
    en qué partidas. Un recurso se libera cuando su partida se finaliza."""
    return RecursosService(db).situacion(slot_date)
