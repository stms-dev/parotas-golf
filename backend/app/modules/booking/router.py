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
    QuotePreview,
    ReplayOut,
    ReservationCancel,
    ReservationCreate,
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
from app.shared.tiempo import fuera_de_venta, ya_paso
from app.shared.enums import BookingModality, ReservationStatus, SlotStatus
from app.shared.money import ZERO, money

router = APIRouter(prefix="/booking", tags=["Reservas y Disponibilidad"])


# ------------------------------------------------------------------ mapeadores
def _paid_and_balance(reservation: Reservation) -> tuple[Decimal, Decimal]:
    paid = sum((p.neto_mxn for p in pagos_de_la_reserva(reservation)), start=ZERO)
    return money(paid), money(money(reservation.total) - paid)


def _limite(db):
    """Hora límite para reservar el mismo día, leída una vez por consulta."""
    from app.modules.catalog.service import SettingsService

    return SettingsService(db).hora_limite_del_dia()


def _turno_por_dia(slots) -> dict:
    """Qué salida está en turno cada día: la primera con lugar que no pasó."""
    turnos: dict = {}
    for slot in sorted(slots, key=lambda s: (s.slot_date, s.tee, s.slot_time)):
        clave = (slot.slot_date, slot.tee)
        if clave in turnos:
            continue
        if slot.status == SlotStatus.BLOQUEADO or slot.available <= 0:
            continue
        if not settings.horarios_libres and ya_paso(slot.slot_date, slot.slot_time):
            continue
        turnos[clave] = slot.id
    return turnos


def _carritos_por_dia(db, slots) -> dict:
    """Carritos libres de cada día que aparece en la consulta."""
    servicio = RecursosService(db)
    return {fecha: servicio.situacion(fecha) for fecha in {s.slot_date for s in slots}}


def _slot_out(slot, scope: Optional[int] = None, limite=None, turnos=None, recursos=None) -> SlotOut:
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
    out.en_turno = bool(turnos and turnos.get((slot.slot_date, slot.tee)) == slot.id)
    if slot.status == SlotStatus.BLOQUEADO:
        out.cerrada_por = "bloqueada"
    elif out.expirada:
        out.cerrada_por = "vencida"
    elif slot.available <= 0:
        out.cerrada_por = "ocupada"
    elif situacion and situacion["carritos_libres"] <= 0:
        out.cerrada_por = "carritos"
    elif turnos and not out.en_turno:
        out.cerrada_por = "orden"

    if scope is None and slot.replays:
        t = slot.replays[0]
        out.replay_folio = t.reservation.folio if t.reservation else None

    vivas = [
        r for r in slot.reservations
        if r.status not in (ReservationStatus.CANCELADA, ReservationStatus.NO_SHOW)
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
    out.services = [
        ServiceLineOut(
            id=s.id, service_id=s.service_id,
            service_name=s.service.name if s.service else None,
            quantity=s.quantity, unit_price_applied=s.unit_price_applied,
            total=s.total, notes=s.notes,
            service_code=s.service.code if s.service else None,
        )
        for s in reservation.services
    ]
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
    turnos = _turno_por_dia(slots)
    recursos = _carritos_por_dia(db, slots)
    return AvailabilityDay(
        slot_date=slot_date, tee=tee or "TODOS",
        slots=[_slot_out(s, scope, limite, turnos, recursos) for s in slots]
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
    turnos = _turno_por_dia(slots)
    recursos = _carritos_por_dia(db, slots)
    return [_slot_out(s, scope, limite, turnos, recursos) for s in slots]


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


@router.get("/recursos")
def recursos(
    slot_date: date = Query(default_factory=date.today),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Carritos y caddies de ese día: cuántos hay, cuántos se están usando y
    en qué partidas. Un recurso se libera cuando su partida se finaliza."""
    return RecursosService(db).situacion(slot_date)
