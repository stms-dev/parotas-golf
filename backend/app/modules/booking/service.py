"""Lógica de disponibilidad y reservas."""
import logging
import secrets
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.permissions import Permission
from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError, ValidationError
from app.modules.audit.service import AuditService
from app.modules.booking.models import (
    CourseDayRule,
    Reservation,
    ReservationCompanion,
    ReservationPlayer,
    ReservationService,
    TeeSlot,
)
from app.modules.booking.repository import ReservationRepository, TeeSlotRepository
from app.modules.booking.schemas import ReservationCreate, ServiceIn
from app.modules.booking.state_machine import assert_transition, estado_para_hotel, releases_slot
from app.modules.catalog.service import (
    AdditionalServiceService,
    DiscountService,
    ExchangeRateService,
    HotelService,
    PricingService,
    ScheduleService,
    SettingsService,
)
from app.modules.identity.models import User
from app.realtime.events import EventType, RealtimeEvent
from app.realtime.manager import publish
from app.core.config import settings
from app.shared.tiempo import dia_cerrado, hoy as hoy_local, ya_paso
from app.shared.enums import (
    AuditAction,
    BookingModality,
    PlayerCategory,
    ReservationStatus,
    SlotStatus,
    UserRole,
)
from app.shared.money import ZERO, money, to_mxn

logger = logging.getLogger(__name__)


class RecursosService:
    """Carritos y caddies del campo.

    Ninguno de los dos se elige. El carrito sale de cuánta gente va (dos
    personas por carrito) y el caddie va uno por carrito, hasta donde alcancen
    los que hay: cuando se acaban, la partida sale sin caddie y no se rechaza
    nada — perder una venta por eso no tendría sentido.

    Un recurso queda tomado mientras la partida no termine: al marcarse como
    finalizada, vuelve a estar disponible para el resto del día.
    """

    EN_USO = (
        ReservationStatus.PENDIENTE,
        ReservationStatus.CONFIRMADA,
        ReservationStatus.CHECK_IN,
        ReservationStatus.EN_JUEGO,
    )

    def __init__(self, db: Session):
        self.db = db
        from app.modules.catalog.service import SettingsService

        self.settings = SettingsService(db)

    def config(self) -> dict:
        return {
            "carritos_totales": self.settings.get_int("carritos_totales", 20),
            "personas_por_carrito": max(self.settings.get_int("personas_por_carrito", 2), 1),
            "caddies_totales": self.settings.get_int("caddies_totales", 2),
        }

    def carritos_para(self, personas: int, asientos: Optional[int] = None) -> int:
        """Carritos que ocupa un grupo. Dos personas por carrito, redondeando
        hacia arriba: tres personas usan dos carritos."""
        if personas <= 0:
            return 0
        asientos = asientos or self.config()["personas_por_carrito"]
        return -(-personas // asientos)

    def caddies_para(self, personas: int, asientos: Optional[int] = None) -> int:
        """Caddies que pide un grupo: uno por carrito."""
        return self.carritos_para(personas, asientos)

    def caddies_asignables(self, personas: int, libres: int, asientos: Optional[int] = None) -> int:
        """Los que de verdad se le pueden dar hoy: lo que pide, o lo que queda."""
        return max(min(self.caddies_para(personas, asientos), libres), 0)

    def _partidas_del_dia(self, target: date) -> List[Reservation]:
        stmt = (
            select(Reservation)
            .join(TeeSlot, Reservation.tee_slot_id == TeeSlot.id)
            .where(TeeSlot.slot_date == target, Reservation.status.in_(self.EN_USO))
        )
        return list(self.db.execute(stmt).scalars().unique().all())

    @staticmethod
    def _caddies_de(reservation: Reservation) -> int:
        """Caddies que tiene tomados la partida.

        Se lee de la columna. Las reservas de antes del cambio no la traen
        llena, así que para esas se cae a la línea de servicio que se les cobró
        en su momento; si no, dejarían de contar y el campo creería tener
        caddies libres que están en el campo.
        """
        if reservation.caddies_used:
            return reservation.caddies_used
        return sum(
            linea.quantity
            for linea in reservation.services
            if linea.service and linea.service.code == "CADDIE"
        )

    def situacion(self, target: date) -> dict:
        """Qué hay ocupado y qué queda libre ese día."""
        config = self.config()
        partidas = self._partidas_del_dia(target)

        carritos_usados = sum(
            r.carts_used or self.carritos_para(
                len(r.players) + len(r.companions), config["personas_por_carrito"]
            )
            for r in partidas
        )
        caddies_usados = sum(self._caddies_de(r) for r in partidas)

        detalle = [
            {
                "folio": r.folio,
                "hora": r.tee_slot.slot_time.strftime("%H:%M") if r.tee_slot else None,
                "estado": r.status,
                "carritos": r.carts_used,
                "caddies": self._caddies_de(r),
            }
            for r in sorted(
                partidas,
                key=lambda x: x.tee_slot.slot_time if x.tee_slot else time(0, 0),
            )
        ]

        return {
            "fecha": target,
            "carritos_totales": config["carritos_totales"],
            "carritos_usados": carritos_usados,
            "carritos_libres": max(config["carritos_totales"] - carritos_usados, 0),
            "personas_por_carrito": config["personas_por_carrito"],
            "caddies_totales": config["caddies_totales"],
            "caddies_usados": caddies_usados,
            "caddies_libres": max(config["caddies_totales"] - caddies_usados, 0),
            "partidas": detalle,
        }


class AvailabilityService:
    """Genera y consulta franjas. La disponibilidad se calcula, no se inventa."""

    def __init__(self, db: Session):
        self.db = db
        self.slots = TeeSlotRepository(db)
        self.schedule = ScheduleService(db)

    def ensure_day(self, target: date) -> List[TeeSlot]:
        """Materializa las franjas de un día a partir de la configuración maestra.

        Es idempotente: si ya existen, las devuelve sin duplicar. El UNIQUE de
        la tabla respalda esto aunque dos requests entren a la vez.

        Al abrir el panel salen varias consultas de disponibilidad casi al
        mismo tiempo. Todas ven el día vacío y todas intentan crearlo; el
        UNIQUE deja pasar a una sola y las demás chocan. Ese choque no es un
        error: significa que otra ya hizo el trabajo, así que se descarta lo
        propio y se lee lo que quedó en la base.
        """
        try:
            creadas = False
            for config in self.schedule.list_configs():
                for slot_time in self.schedule.generate_times(config):
                    if self.slots.find(target, config.tee, slot_time):
                        continue
                    self.slots.add(
                        TeeSlot(
                            slot_date=target,
                            tee=config.tee,
                            slot_time=slot_time,
                            capacity=config.slot_capacity,
                            occupied=0,
                            status=SlotStatus.DISPONIBLE,
                        )
                    )
                    creadas = True
            if creadas:
                self.db.commit()
        except IntegrityError:
            # El add() hace flush, así que el choque aparece aquí dentro y no
            # al confirmar: por eso el try envuelve toda la generación.
            self.db.rollback()
        return self.slots.list_by_date(target)

    def day(self, target: date, tee: Optional[str] = None) -> List[TeeSlot]:
        slots = self.slots.list_by_date(target, tee)
        # No basta con generar cuando el día está vacío: si el club amplía su
        # horario, los días ya materializados se quedarían con las salidas
        # viejas y nadie entendería por qué no aparecen las nuevas. Así que se
        # compara contra lo que la configuración espera y se completa si falta.
        if len(slots) < self._salidas_esperadas(tee):
            self.ensure_day(target)
            slots = self.slots.list_by_date(target, tee)
        return slots

    def _salidas_esperadas(self, tee: Optional[str] = None) -> int:
        """Cuántas franjas debería tener un día según la configuración vigente."""
        return sum(
            len(self.schedule.generate_times(config))
            for config in self.schedule.list_configs()
            if tee is None or config.tee == tee
        )

    def range(self, start: date, end: date, tee: Optional[str] = None) -> List[TeeSlot]:
        if (end - start).days > 90:
            raise ValidationError("El rango máximo de consulta es de 90 días")
        cursor = start
        while cursor <= end:
            if not self.slots.list_by_date(cursor):
                self.ensure_day(cursor)
            cursor += timedelta(days=1)
        return self.slots.list_range(start, end, tee)


class ReservationService_:
    """Creación y ciclo de vida de reservas.

    El cálculo del total, la toma del cupo y la escritura de la auditoría
    ocurren en una sola transacción: o pasa todo, o no pasa nada.
    """

    MODULE = "booking"

    def __init__(self, db: Session, hotel_scope: Optional[int] = None):
        self.db = db
        self.hotel_scope = hotel_scope
        self.repo = ReservationRepository(db, hotel_scope=hotel_scope)
        self.slots = TeeSlotRepository(db)
        self.audit = AuditService(db)
        self.pricing = PricingService(db)
        self.discounts = DiscountService(db)
        self.services = AdditionalServiceService(db)
        self.exchange = ExchangeRateService(db)
        self.hotels = HotelService(db)
        self.availability = AvailabilityService(db)
        self.recursos = RecursosService(db)

    # -------------------------------------------------------------- avisos
    def _avisar_reserva(
        self, reservation: Reservation, tipo: EventType, al_hotel: bool = True
    ) -> None:
        """Difunde un cambio de reserva. Solo se llama después del commit.

        al_hotel=False deja el aviso dentro del campo: el hotel no se entera
        de la salida al campo ni del cierre, para él sigue "confirmada".
        """
        slot = reservation.tee_slot
        publish(
            RealtimeEvent(
                type=tipo,
                hotel_id=reservation.hotel_id,
                required_permission=None if al_hotel else Permission.RESERVATION_VIEW_ALL,
                payload={
                    "reserva_id": reservation.id,
                    "folio": reservation.folio,
                    "estado": reservation.status,
                    "estado_hotel": estado_para_hotel(reservation.status),
                    "hotel": reservation.hotel.name if reservation.hotel else None,
                    "titular": reservation.holder_name,
                    "fecha": slot.slot_date.isoformat() if slot else None,
                    "hora": slot.slot_time.strftime("%H:%M") if slot else None,
                    "tee": slot.tee if slot else None,
                    "jugadores": len(reservation.players),
                },
            )
        )

    def _avisar_disponibilidad(self, slot: TeeSlot, motivo: str) -> None:
        """La disponibilidad se difunde sin hotel: que una franja se libere o
        se ocupe le importa a todos los hoteles por igual."""
        publish(
            RealtimeEvent(
                type=EventType.DISPONIBILIDAD_CAMBIADA,
                payload={
                    "franja_id": slot.id,
                    "fecha": slot.slot_date.isoformat(),
                    "tee": slot.tee,
                    "hora": slot.slot_time.strftime("%H:%M"),
                    "capacidad": slot.capacity,
                    "ocupados": slot.occupied,
                    "disponibles": slot.available,
                    "estado": slot.status,
                    "motivo": motivo,
                },
            )
        )

    # ------------------------------------------------------------------ folios
    def _generate_folio(self) -> str:
        """Folio legible tipo LP-8921. Reintenta si hay colisión."""
        for _ in range(20):
            candidate = f"LP-{secrets.randbelow(9000) + 1000}"
            if not self.repo.folio_exists(candidate):
                return candidate
        return f"LP-{datetime.utcnow().strftime('%y%m%d%H%M%S')}"

    # ------------------------------------------------------------ validaciones
    @staticmethod
    def _validate_modality(modality: BookingModality, player_count: int) -> None:
        """Cuántos jugadores admite cada paquete.

        El grupo arranca en 4: es el cuarteto que toma la salida completa, y por
        eso no tiene techo — es el campo quien decide a cuántos deja salir
        juntos. La partida abierta no tiene mínimo: sale con los que se junten,
        y su techo es el cupo de la salida que comparten.

        Individual ya no se vende. Se queda en el catálogo porque hay reservas
        viejas que la usaron y tienen que seguir leyéndose.
        """
        reglas = {
            BookingModality.INDIVIDUAL: (1, 1),
            BookingModality.GRUPO: (4, None),
            BookingModality.PARTIDA_ABIERTA: (1, 4),
        }
        if modality == BookingModality.INDIVIDUAL:
            raise ValidationError(
                "El paquete Individual ya no se ofrece. Una salida se vende como "
                "grupo (desde 4 jugadores) o como partida abierta."
            )
        minimo, maximo = reglas[modality]
        if player_count < minimo or (maximo is not None and player_count > maximo):
            limite = f"entre {minimo} y {maximo}" if maximo is not None else f"desde {minimo}"
            raise ValidationError(
                f"El paquete {modality} admite {limite} jugadores "
                f"(se enviaron {player_count})"
            )

    def _assert_slot_available(
        self, slot: TeeSlot, players: int, modality: BookingModality
    ) -> None:
        """Verifica que la salida se pueda tomar. Se llama ANTES de crear nada.

        Es importante que sea antes: al guardar la reserva se hace flush, y si
        se validara después, la reserva nueva aparecería como ocupante de la
        salida y se rechazaría a sí misma.

        Regla: **una salida la toma una sola partida**. Si un hotel reserva las
        10:30, ese horario deja de ofrecerse a los demás, aunque vayan dos
        jugadores y el campo admita cuatro: no se juntan grupos que no se
        conocen. La única excepción es la partida abierta, que comparte salida
        solo con otras partidas abiertas hasta completar los cuatro jugadores.
        """
        if slot.status == SlotStatus.BLOQUEADO:
            raise BusinessRuleError(
                f"La salida de las {slot.slot_time.strftime('%H:%M')} está bloqueada"
                + (f": {slot.event.name}" if slot.event else "")
            )

        # Los horarios ya no se abren en orden: el huésped elige el que quiera
        # de los que estén libres. Lo único que cierra una salida es que esté
        # llena, bloqueada por un evento, o que su hora ya pasó.

        if modality == BookingModality.PARTIDA_ABIERTA and not self.dia_admite_abiertas(
            slot.slot_date
        ):
            raise BusinessRuleError(
                f"El {slot.slot_date.strftime('%d/%m')} no se están armando partidas "
                "abiertas. Reserve como grupo o elija otro día."
            )

        vivas = self.repo.active_reservations_in_slot(slot.id)
        if vivas:
            solo_abiertas = all(r.modality == BookingModality.PARTIDA_ABIERTA for r in vivas)
            if solo_abiertas and slot.open_closed:
                raise BusinessRuleError(
                    f"La partida abierta de las {slot.slot_time.strftime('%H:%M')} ya se "
                    "cerró: el campo la va a despachar como está."
                )
            if modality != BookingModality.PARTIDA_ABIERTA or not solo_abiertas:
                raise BusinessRuleError(
                    f"La salida de las {slot.slot_time.strftime('%H:%M')} ya está asignada. "
                    "Elija otro horario."
                )

            comprometidos = sum(len(r.players) for r in vivas)
            if comprometidos + players > slot.capacity:
                raise BusinessRuleError(
                    f"La partida abierta de las {slot.slot_time.strftime('%H:%M')} solo admite "
                    f"{max(slot.capacity - comprometidos, 0)} jugador(es) más y se piden {players}"
                )
        elif modality != BookingModality.GRUPO and players > slot.capacity:
            # El grupo se queda con la salida entera, así que su tamaño no lo
            # limita el cupo de la franja: nadie más va a entrar ahí.
            raise BusinessRuleError(
                f"La salida admite {slot.capacity} jugadores y se piden {players}"
            )

    def _recalculate_slot(self, slot: TeeSlot) -> None:
        """Recalcula el estado de la salida desde sus reservas vivas.

        Se usa tanto al crear (ya con la reserva guardada) como al cancelar.
        Siempre se deriva de los datos, nunca se ajusta a mano.
        """
        if slot.status == SlotStatus.BLOQUEADO:
            return

        # Una salida que tomó un replay sigue ocupada por él.
        if slot.replays:
            slot.occupied = sum(max(t.players_count, 1) for t in slot.replays)
            slot.status = SlotStatus.OCUPADO
            return

        vivas = self.repo.active_reservations_in_slot(slot.id)
        if not vivas:
            slot.occupied = 0
            slot.status = SlotStatus.DISPONIBLE
            return

        slot.occupied = sum(len(r.players) for r in vivas)
        solo_abiertas = all(r.modality == BookingModality.PARTIDA_ABIERTA for r in vivas)
        slot.status = (
            SlotStatus.ABIERTA
            # Si el operador la cerró a mano, deja de admitir gente aunque le
            # queden lugares: ya va a salir.
            if solo_abiertas and slot.occupied < slot.capacity and not slot.open_closed
            else SlotStatus.OCUPADO
        )

    # --------------------------------------------------------------- creación
    def create(self, data: ReservationCreate, actor: User) -> Reservation:
        # 1. Hotel: un usuario HOTEL solo puede reservar para el suyo, y
        # recepción solo para el público general.
        if actor.role == UserRole.HOTEL:
            hotel_id = actor.hotel_id
        elif actor.role == UserRole.RECEPCION:
            # Recepción atiende al que llega sin hotel. Colgarle una reserva a
            # un hotel con convenio le genera comisión a ese hotel, y eso lo
            # decide operaciones, no el mostrador.
            directo = self.hotels.venta_directa()
            if data.hotel_id is not None and data.hotel_id != directo.id:
                raise BusinessRuleError(
                    "Recepción solo puede levantar reservas de público general. "
                    "Para asignarla a un hotel con convenio la registra operaciones."
                )
            hotel_id = directo.id
        else:
            hotel_id = data.hotel_id
            if hotel_id is None:
                raise ValidationError("Debe indicar el hotel de la reserva")
        hotel = self.hotels.get(hotel_id)

        # 2. Quién la está levantando. Se exige aquí y no en el esquema porque
        # el mismo cuerpo sirve para cotizar, y cotizar no guarda nada.
        quien_reserva = (data.booked_by_name or "").strip()
        if len(quien_reserva) < 3:
            raise ValidationError(
                "Indique el nombre de quien está levantando la reserva"
            )

        # 3. Reglas de modalidad y cupo.
        self._validate_modality(data.modality, len(data.players))

        slot = self.slots.get_for_update(data.tee_slot_id)
        if not slot:
            raise NotFoundError(f"Franja {data.tee_slot_id} no encontrada")
        if slot.slot_date < hoy_local():
            raise BusinessRuleError("No se pueden crear reservas en fechas pasadas")
        # Un horario de hoy que ya pasó tampoco se vende: el jugador no llega.
        # Se valida aquí, no solo en la pantalla, porque la pantalla se puede
        # saltar escribiendo la URL de la salida.
        if not settings.horarios_libres:
            if ya_paso(slot.slot_date, slot.slot_time):
                raise BusinessRuleError(
                    f"La salida de las {slot.slot_time.strftime('%H:%M')} ya pasó. "
                    "Elija un horario posterior."
                )
            # Pasada la hora límite, el día de hoy ya no recibe reservas aunque
            # le queden salidas libres: el campo cierra la agenda del día.
            limite = SettingsService(self.db).hora_limite_del_dia()
            if dia_cerrado(slot.slot_date, limite):
                raise BusinessRuleError(
                    f"Las reservas para hoy cierran a las {limite.strftime('%H:%M')}. "
                    "Elija una fecha a partir de mañana."
                )

        # 4. Carritos y caddies: son limitados y se reparten por día. El
        #    carrito no se elige, sale de cuánta gente va.
        situacion = self.recursos.situacion(slot.slot_date)
        personas = len(data.players) + len(data.companions)
        carritos = self.recursos.carritos_para(personas, situacion["personas_por_carrito"])
        if carritos > situacion["carritos_libres"]:
            raise BusinessRuleError(
                f"No hay carritos suficientes para el {slot.slot_date.strftime('%d/%m')}: "
                f"esta partida necesita {carritos} y quedan {situacion['carritos_libres']} "
                f"de {situacion['carritos_totales']}."
            )

        # El caddie no se pide ni se rechaza: se asigna uno por carrito hasta
        # donde alcancen los que hay libres ese día. Si ya no quedan, la partida
        # sale sin caddie — el club tiene dos y no va a dejar de vender por eso.
        caddies = self.recursos.caddies_asignables(
            personas, situacion["caddies_libres"], situacion["personas_por_carrito"]
        )

        holders = [p for p in data.players if p.is_holder]
        if len(holders) > 1:
            raise ValidationError("Solo puede haber un titular en la reserva")

        # La salida se valida ANTES de escribir nada.
        self._assert_slot_available(slot, len(data.players), data.modality)

        # 5. Valores congelados: TC y comisión del momento.
        exchange_rate = self.exchange.current_rate()
        commission_rate = hotel.commission_rate

        reservation = Reservation(
            folio=self._generate_folio(),
            hotel_id=hotel.id,
            created_by_id=actor.id,
            tee_slot_id=slot.id,
            modality=data.modality,
            holes=data.holes,
            status=ReservationStatus.PENDIENTE,
            holder_name=data.holder_name.strip(),
            holder_email=str(data.holder_email).lower().strip(),
            holder_phone=data.holder_phone,
            holder_room=data.holder_room,
            booked_by_name=quien_reserva,
            caddies_used=caddies,
            notes=data.notes,
            exchange_rate_applied=exchange_rate,
            commission_rate_applied=commission_rate,
            invoice_requested=data.invoice_requested,
            invoice_contact_email=str(data.invoice_contact_email) if data.invoice_contact_email else None,
            qr_token=secrets.token_urlsafe(24),
        )
        self.repo.add(reservation)

        # 6. Jugadores y su tarifa congelada.
        #    El descuento PGA NO se aplica aquí: se valida en recepción.
        subtotal_green_fees = ZERO
        for entry in data.players:
            category = entry.category
            if entry.age is not None and entry.age < 16:
                category = PlayerCategory.INFANTIL

            plan = self.pricing.resolve_rate(
                modality=data.modality.value, holes=data.holes,
                category=category, on_date=slot.slot_date,
                # La hora manda: las últimas salidas del día van a tarifa de
                # twilight si el club la tiene dada de alta.
                at_time=slot.slot_time,
            )
            player = ReservationPlayer(
                reservation_id=reservation.id,
                full_name=entry.full_name.strip(),
                age=entry.age,
                category=category,
                handicap=entry.handicap,
                ghin=(entry.ghin or None),
                club_hand=(entry.club_hand or None),
                is_holder=entry.is_holder,
                pga_code=entry.pga_code.upper().strip() if entry.pga_code else None,
                credential_number=entry.credential_number,
                rate_applied=plan.price,
                final_rate=plan.price,
            )
            self.db.add(player)
            subtotal_green_fees += money(plan.price)

        for companion in data.companions:
            self.db.add(
                ReservationCompanion(
                    reservation_id=reservation.id,
                    full_name=companion.full_name.strip(),
                    age=companion.age,
                    notes=companion.notes,
                )
            )

        subtotal_services = self._add_services(reservation, data.services)
        subtotal_services += self._cargo_acompanantes(reservation, len(data.companions))
        reservation.carts_used = carritos

        # 7. Descuento de la reserva (convenio, no PGA).
        discount_amount = ZERO
        if data.discount_code:
            discount = self.discounts.validate_for_reservation(
                data.discount_code,
                modality=data.modality.value, holes=data.holes,
                hotel_id=hotel.id, player_count=len(data.players),
                on_date=slot.slot_date,
            )
            discount_amount = self.discounts.compute(discount, subtotal_green_fees)
            reservation.discount_code_id = discount.id
            reservation.discount_code_applied = discount.code

        reservation.subtotal_green_fees = money(subtotal_green_fees)
        reservation.subtotal_services = money(subtotal_services)
        reservation.discount_amount = money(discount_amount)
        reservation.pga_discount_amount = ZERO
        reservation.total = money(subtotal_green_fees + subtotal_services - discount_amount)

        # 8. Estado de la salida y auditoría, misma transacción.
        self.db.flush()
        self._recalculate_slot(slot)
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module=self.MODULE,
            entity="Reservation", entity_id=reservation.id,
            new_value=str(reservation.total),
            description=(
                f"Reserva {reservation.folio} creada para {hotel.name} · "
                f"{len(data.players)} jugadores · {slot.slot_date} "
                f"{slot.slot_time.strftime('%H:%M')} · la levantó "
                f"{reservation.booked_by_name}"
            ),
        )

        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ConflictError("No se pudo guardar la reserva: conflicto de concurrencia") from exc

        self.db.refresh(reservation)

        # El pase con el QR sale aquí mismo, en cuanto la reserva queda
        # guardada. Si el correo no pudiera salir en ese momento, queda en la
        # bandeja y el repartidor lo manda después: la reserva ya está hecha y
        # no se pierde por culpa de un correo.
        try:
            from app.modules.mailing.service import MailingService
            from app.shared.enums import EmailKind

            MailingService(self.db).enviar_ahora(
                kind=EmailKind.PASE, reservation=reservation
            )
        except Exception:
            self.db.rollback()
            logger.exception("No se pudo mandar el pase de %s", reservation.folio)

        # Ya está guardado: ahora sí se avisa. Antes del commit se correría el
        # riesgo de anunciar una reserva que terminó en rollback.
        self._avisar_reserva(reservation, EventType.RESERVA_CREADA)
        self._avisar_disponibilidad(slot, f"Reserva {reservation.folio} creada")

        return reservation

    def _servicio_acompanante(self):
        from sqlalchemy import select
        from app.modules.catalog.models import AdditionalService

        return self.db.execute(
            select(AdditionalService).where(AdditionalService.code == "ACOMPANANTE")
        ).scalar_one_or_none()

    def _cargo_acompanantes(self, reservation: Reservation, cuantos: int) -> Decimal:
        """Quien acompaña no juega, pero sí paga su lugar: $800 por persona.

        Se carga desde la reserva del hotel, no en el mostrador, porque no es
        un servicio que se pida allá: viene con la partida.
        """
        if cuantos <= 0:
            return ZERO
        service = self._servicio_acompanante()
        if not service or not service.is_active:
            return ZERO
        line_total = money(money(service.price) * cuantos)
        self.db.add(
            ReservationService(
                reservation_id=reservation.id,
                service_id=service.id,
                quantity=cuantos,
                unit_price_applied=service.price,
                total=line_total,
                notes="Acompañante (no juega)",
            )
        )
        return line_total

    def _add_services(self, reservation: Reservation, entries: List[ServiceIn]) -> Decimal:
        total = ZERO
        for entry in entries:
            service = self.services.get(entry.service_id)
            if service.code == "ACOMPANANTE":
                # Se cobra solo por la lista de acompañantes; así no se duplica.
                continue
            if service.code == "CADDIE":
                # El caddie no lo cobra el club: el huésped le paga directo. Se
                # asigna como recurso (uno por carrito) y su precio se muestra
                # solo para que la conserjería se lo informe al huésped.
                continue
            if not service.is_active:
                raise ValidationError(f"El servicio {service.name} está inactivo")
            line_total = money(money(service.price) * entry.quantity)
            self.db.add(
                ReservationService(
                    reservation_id=reservation.id,
                    player_id=entry.player_id,
                    service_id=service.id,
                    quantity=entry.quantity,
                    unit_price_applied=service.price,
                    total=line_total,
                    notes=entry.notes,
                )
            )
            total += line_total
        return total

    # --------------------------------------------------------------- consulta
    def get(self, reservation_id: int) -> Reservation:
        reservation = self.repo.get(reservation_id)
        if not reservation:
            raise NotFoundError(f"Reserva {reservation_id} no encontrada")
        return reservation

    def get_by_folio(self, folio: str) -> Reservation:
        reservation = self.repo.get_by_folio(folio)
        if not reservation:
            raise NotFoundError(f"No existe la reserva con folio {folio}")
        return reservation

    def get_by_qr(self, token: str) -> Reservation:
        # El QR guarda la dirección completa del pase (…/pase/<token>). Un
        # lector de mano la teclea entera en el buscador del mostrador, así que
        # aquí se queda solo con el token y el recepcionista no tiene que
        # recortar nada a mano.
        token = token.strip().split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]
        reservation = self.repo.get_by_qr(token)
        if not reservation:
            raise NotFoundError("Pase QR no válido")
        return reservation

    def search(self, **filters) -> List[Reservation]:
        return self.repo.search(**filters)

    # ------------------------------------------------------------ transiciones
    def confirm(self, reservation_id: int, actor: User) -> Reservation:
        reservation = self.get(reservation_id)
        assert_transition(reservation.status, ReservationStatus.CONFIRMADA)

        reservation.status = ReservationStatus.CONFIRMADA
        reservation.confirmed_at = datetime.utcnow()
        reservation.confirmed_by_id = actor.id

        self.audit.log(
            user=actor, action=AuditAction.CONFIRMAR, module=self.MODULE,
            entity="Reservation", entity_id=reservation.id,
            old_value=ReservationStatus.PENDIENTE, new_value=ReservationStatus.CONFIRMADA,
            description=f"Reserva {reservation.folio} confirmada",
        )
        self.db.commit()
        self.db.refresh(reservation)
        self._avisar_reserva(reservation, EventType.RESERVA_ACTUALIZADA)
        return reservation

    def cancel(self, reservation_id: int, reason: str, actor: User) -> Reservation:
        reservation = self.get(reservation_id)
        if self.hotel_scope is not None and reservation.status == ReservationStatus.CHECK_IN:
            raise BusinessRuleError(
                "Los jugadores ya están en el mostrador del campo. Para cancelar, "
                "comuníquese con recepción."
            )
        assert_transition(reservation.status, ReservationStatus.CANCELADA)

        previous = reservation.status
        reservation.status = ReservationStatus.CANCELADA
        reservation.cancelled_at = datetime.utcnow()
        reservation.cancelled_by_id = actor.id
        reservation.cancellation_reason = reason

        # Liberar el cupo para que otro hotel lo pueda tomar.
        self.db.flush()
        slot = self.slots.get(reservation.tee_slot_id)
        if slot and releases_slot(ReservationStatus.CANCELADA):
            self._recalculate_slot(slot)

        self.audit.log(
            user=actor, action=AuditAction.CANCELAR, module=self.MODULE,
            entity="Reservation", entity_id=reservation.id,
            old_value=previous, new_value=ReservationStatus.CANCELADA,
            description=f"Reserva {reservation.folio} cancelada: {reason}",
        )
        self.db.commit()
        self.db.refresh(reservation)

        self._avisar_reserva(reservation, EventType.RESERVA_CANCELADA)
        if slot:
            self.db.refresh(slot)
            self._avisar_disponibilidad(slot, f"Reserva {reservation.folio} cancelada")

        return reservation

    def mark_no_show(self, reservation_id: int, actor: User) -> Reservation:
        reservation = self.get(reservation_id)
        assert_transition(reservation.status, ReservationStatus.NO_SHOW)

        # No se marca a nadie como ausente antes de tiempo: primero tiene que
        # pasar su hora de salida. Así el hotel ve "no se presentó" solo
        # cuando de verdad ya no llegaron.
        slot = reservation.tee_slot
        if slot and not settings.horarios_libres and not ya_paso(slot.slot_date, slot.slot_time):
            raise BusinessRuleError(
                f"La salida de las {slot.slot_time.strftime('%H:%M')} todavía no pasa. "
                "Espere su hora antes de marcarla como no presentada."
            )

        reservation.status = ReservationStatus.NO_SHOW
        self.db.flush()
        slot = self.slots.get(reservation.tee_slot_id)
        if slot:
            self._recalculate_slot(slot)

        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=self.MODULE,
            entity="Reservation", entity_id=reservation.id,
            new_value=ReservationStatus.NO_SHOW,
            description=f"Reserva {reservation.folio} marcada como no-show",
        )
        self.db.commit()
        self.db.refresh(reservation)

        self._avisar_reserva(reservation, EventType.RESERVA_ACTUALIZADA)
        if slot:
            self.db.refresh(slot)
            self._avisar_disponibilidad(slot, f"No-show de {reservation.folio}")

        return reservation

    def start_round(self, reservation_id: int, actor: User) -> Reservation:
        reservation = self.get(reservation_id)
        assert_transition(reservation.status, ReservationStatus.EN_JUEGO)
        reservation.status = ReservationStatus.EN_JUEGO
        reservation.round_started_at = datetime.utcnow()
        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=self.MODULE,
            entity="Reservation", entity_id=reservation.id,
            new_value=ReservationStatus.EN_JUEGO,
            description=f"Salida a campo: {reservation.folio}",
        )
        self.db.commit()
        self.db.refresh(reservation)
        self._avisar_reserva(reservation, EventType.RESERVA_ACTUALIZADA, al_hotel=False)
        return reservation

    def complete(self, reservation_id: int, actor: User) -> Reservation:
        reservation = self.get(reservation_id)
        assert_transition(reservation.status, ReservationStatus.COMPLETADA)
        reservation.status = ReservationStatus.COMPLETADA
        reservation.completed_at = datetime.utcnow()
        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=self.MODULE,
            entity="Reservation", entity_id=reservation.id,
            new_value=ReservationStatus.COMPLETADA,
            description=f"Ronda completada: {reservation.folio}",
        )
        self.db.commit()
        self.db.refresh(reservation)
        self._avisar_reserva(reservation, EventType.RESERVA_ACTUALIZADA, al_hotel=False)
        return reservation

    # ------------------------------------------------- campo suspendido
    def interrumpir(
        self, reservation_id: int, *, hoyo: int, motivo: str, actor: User
    ) -> Reservation:
        """La partida salió pero no se pudo terminar: llovió y se suspendió.

        No es una cancelación: el huésped llegó, jugó y pagó. Queda en su propio
        estado con el hoyo en el que se quedaron, y de ahí el operador le repone
        la ronda cuando el huésped diga qué día vuelve.

        Los carritos y los caddies se liberan, porque la partida ya no está en
        el campo y el resto del día los necesita.
        """
        reservation = self.get(reservation_id)
        assert_transition(reservation.status, ReservationStatus.INTERRUMPIDA)

        if not 1 <= hoyo <= reservation.holes:
            raise ValidationError(
                f"El hoyo tiene que estar entre 1 y {reservation.holes}"
            )

        reservation.status = ReservationStatus.INTERRUMPIDA
        reservation.interrupted_at_hole = hoyo
        reservation.interrupted_reason = motivo.strip()
        reservation.interrupted_at = datetime.utcnow()

        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=self.MODULE,
            entity="Reservation", entity_id=reservation.id,
            new_value=ReservationStatus.INTERRUMPIDA,
            description=(
                f"Campo suspendido en {reservation.folio}: se quedaron en el hoyo "
                f"{hoyo} de {reservation.holes} · {motivo.strip()}"
            ),
        )
        self.db.commit()
        self.db.refresh(reservation)
        self._avisar_reserva(reservation, EventType.RESERVA_ACTUALIZADA, al_hotel=False)
        self._avisar_disponibilidad(
            reservation.tee_slot, f"Partida {reservation.folio} interrumpida"
        )
        return reservation

    def reagendar_por_cortesia(
        self, reservation_id: int, *, tee_slot_id: int, actor: User,
        quien_reserva: Optional[str] = None,
    ) -> Reservation:
        """Le repone la ronda al huésped, sin volver a cobrarle.

        La reposición es otra reserva, con su propio folio y su propia salida:
        así puede ser cualquier día y, en partida abierta, el huésped no tiene
        que volver con la misma gente. Va en cero y sin comisión — el hotel ya
        cobró la suya en la reserva original, y volver a pagarle por la misma
        venta sería cobrarle dos veces al club.
        """
        original = self.get(reservation_id)
        if original.status != ReservationStatus.INTERRUMPIDA:
            raise BusinessRuleError(
                "Solo se le repone la ronda a una partida que quedó interrumpida. "
                "Márquela primero como campo suspendido, con el hoyo en el que se "
                "quedaron."
            )
        if original.reposiciones:
            otras = ", ".join(r.folio for r in original.reposiciones)
            raise BusinessRuleError(
                f"A esta partida ya se le repuso la ronda ({otras}). "
                "Una sola cortesía por partida interrumpida."
            )

        slot = self.slots.get_for_update(tee_slot_id)
        if not slot:
            raise NotFoundError(f"Franja {tee_slot_id} no encontrada")
        if slot.slot_date < hoy_local():
            raise BusinessRuleError("La reposición no puede ser en una fecha pasada")

        presentes = [p for p in original.players if p.arrived] or list(original.players)
        self._assert_slot_available(slot, len(presentes), original.modality)

        situacion = self.recursos.situacion(slot.slot_date)
        carritos = self.recursos.carritos_para(
            len(presentes), situacion["personas_por_carrito"]
        )
        if carritos > situacion["carritos_libres"]:
            raise BusinessRuleError(
                f"No hay carritos suficientes para el {slot.slot_date.strftime('%d/%m')}: "
                f"la reposición necesita {carritos} y quedan {situacion['carritos_libres']}."
            )
        caddies = self.recursos.caddies_asignables(
            len(presentes), situacion["caddies_libres"], situacion["personas_por_carrito"]
        )

        reposicion = Reservation(
            folio=self._generate_folio(),
            hotel_id=original.hotel_id,
            created_by_id=actor.id,
            tee_slot_id=slot.id,
            modality=original.modality,
            holes=original.holes,
            status=ReservationStatus.CONFIRMADA,
            holder_name=original.holder_name,
            holder_email=original.holder_email,
            holder_phone=original.holder_phone,
            holder_room=original.holder_room,
            booked_by_name=(quien_reserva or "").strip() or original.booked_by_name,
            carts_used=carritos,
            caddies_used=caddies,
            exchange_rate_applied=original.exchange_rate_applied,
            # Sin comisión: la de esta venta ya se le pagó al hotel en la
            # partida original.
            commission_rate_applied=ZERO,
            rescheduled_from_id=original.id,
            qr_token=secrets.token_urlsafe(24),
            notes=(
                f"Cortesía por campo suspendido en {original.folio}. "
                f"Reanudan en el hoyo {original.interrupted_at_hole} de {original.holes}."
            ),
            confirmed_at=datetime.utcnow(),
            confirmed_by_id=actor.id,
        )
        self.repo.add(reposicion)
        self.db.flush()

        for entry in presentes:
            self.db.add(
                ReservationPlayer(
                    reservation_id=reposicion.id,
                    full_name=entry.full_name,
                    age=entry.age,
                    category=entry.category,
                    handicap=entry.handicap,
                    ghin=entry.ghin,
                    club_hand=entry.club_hand,
                    is_holder=entry.is_holder,
                    # La cortesía va en cero: no se le cobra nada al huésped.
                    rate_applied=ZERO,
                    final_rate=ZERO,
                )
            )

        reposicion.subtotal_green_fees = ZERO
        reposicion.subtotal_services = ZERO
        reposicion.discount_amount = ZERO
        reposicion.pga_discount_amount = ZERO
        reposicion.total = ZERO

        self.db.flush()
        self._recalculate_slot(slot)

        self.audit.log(
            user=actor, action=AuditAction.CREAR, module=self.MODULE,
            entity="Reservation", entity_id=reposicion.id,
            new_value=reposicion.folio,
            description=(
                f"Ronda de cortesía {reposicion.folio} por el campo suspendido en "
                f"{original.folio} · {slot.slot_date} "
                f"{slot.slot_time.strftime('%H:%M')} · reanudan en el hoyo "
                f"{original.interrupted_at_hole} · sin cargo y sin comisión"
            ),
        )
        self.db.commit()
        self.db.refresh(reposicion)

        self._avisar_reserva(reposicion, EventType.RESERVA_CREADA)
        self._avisar_disponibilidad(slot, f"Cortesía {reposicion.folio} agendada")
        return reposicion

    # ------------------------------------------- control de partidas abiertas
    def dia_admite_abiertas(self, dia: date) -> bool:
        """¿Ese día se están armando partidas abiertas?

        Sin regla escrita, sí: es lo normal, y no tiene sentido dar de alta una
        fila por cada día del año para decir que todo sigue igual.
        """
        regla = self.db.execute(
            select(CourseDayRule).where(CourseDayRule.day == dia)
        ).scalars().first()
        return True if regla is None else regla.open_partidas_allowed

    def fijar_regla_del_dia(
        self, dia: date, *, admite: bool, nota: Optional[str], actor: User
    ) -> CourseDayRule:
        """Abre o cierra las partidas abiertas de un día."""
        regla = self.db.execute(
            select(CourseDayRule).where(CourseDayRule.day == dia)
        ).scalars().first()
        anterior = regla.open_partidas_allowed if regla else True

        if regla is None:
            regla = CourseDayRule(day=dia)
            self.db.add(regla)
        regla.open_partidas_allowed = admite
        regla.note = (nota or "").strip() or None
        regla.updated_by_id = actor.id
        regla.updated_at = datetime.utcnow()

        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=self.MODULE,
            entity="CourseDayRule", entity_id=regla.id,
            old_value=str(anterior), new_value=str(admite),
            description=(
                f"Partidas abiertas del {dia}: "
                f"{'permitidas' if admite else 'no se aceptan'}"
                + (f" · {regla.note}" if regla.note else "")
            ),
        )
        self.db.commit()
        self.db.refresh(regla)
        # Va como aviso de disponibilidad porque es justo eso: las pantallas que
        # están vendiendo tienen que dejar de ofrecer la modalidad. No se cuelga
        # de una franja —la regla es del día completo— así que el payload lleva
        # la fecha y nada más.
        publish(
            RealtimeEvent(
                type=EventType.DISPONIBILIDAD_CAMBIADA,
                payload={
                    "fecha": dia.isoformat(),
                    "admite_abiertas": admite,
                    "motivo": (
                        f"Partidas abiertas del {dia}: "
                        f"{'permitidas' if admite else 'no se aceptan'}"
                    ),
                },
            )
        )
        return regla

    def cerrar_partida_abierta(self, slot_id: int, *, cerrar: bool, actor: User) -> TeeSlot:
        """Cierra (o vuelve a abrir) una partida abierta antes de que se llene."""
        slot = self.slots.get(slot_id)
        if not slot:
            raise NotFoundError(f"Franja {slot_id} no encontrada")

        vivas = self.repo.active_reservations_in_slot(slot.id)
        if not vivas or not all(
            r.modality == BookingModality.PARTIDA_ABIERTA for r in vivas
        ):
            raise BusinessRuleError(
                "Esa salida no es una partida abierta. Solo se cierran las que están "
                "juntando jugadores de hoteles distintos."
            )

        slot.open_closed = cerrar
        slot.open_closed_at = datetime.utcnow() if cerrar else None
        self.db.flush()
        self._recalculate_slot(slot)

        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=self.MODULE,
            entity="TeeSlot", entity_id=slot.id,
            new_value="cerrada" if cerrar else "abierta",
            description=(
                f"Partida abierta de las {slot.slot_time.strftime('%H:%M')} del "
                f"{slot.slot_date}: {'cerrada' if cerrar else 'reabierta'} a mano con "
                f"{slot.occupied} de {slot.capacity} lugares"
            ),
        )
        self.db.commit()
        self.db.refresh(slot)
        self._avisar_disponibilidad(
            slot,
            f"Partida abierta de las {slot.slot_time.strftime('%H:%M')} "
            f"{'cerrada' if cerrar else 'reabierta'}",
        )
        return slot

    def mover_a_otra_salida(self, reservation_id: int, *, tee_slot_id: int, actor: User) -> Reservation:
        """Pasa una reserva de partida abierta a otra salida del mismo tipo.

        Se mueve la reserva completa, no jugadores sueltos: una reserva es lo que
        pidió un hotel, con su cobro y su comisión. Partir eso a la mitad dejaría
        dos medias cuentas que nadie sabría cobrar.
        """
        reservation = self.get(reservation_id)
        if reservation.modality != BookingModality.PARTIDA_ABIERTA:
            raise BusinessRuleError(
                "Solo se mueven reservas de partida abierta. Un grupo tiene su salida "
                "completa: para cambiarlo de horario, cancele y vuelva a reservar."
            )
        if reservation.status not in (
            ReservationStatus.PENDIENTE, ReservationStatus.CONFIRMADA,
        ):
            raise BusinessRuleError(
                "Esta partida ya pasó por el mostrador. Mover su horario ahora dejaría "
                "el cobro colgado de una salida que no jugó."
            )

        origen = self.slots.get(reservation.tee_slot_id)
        destino = self.slots.get_for_update(tee_slot_id)
        if not destino:
            raise NotFoundError(f"Franja {tee_slot_id} no encontrada")
        if destino.id == reservation.tee_slot_id:
            raise ValidationError("Esa reserva ya está en esa salida")
        if destino.slot_date < hoy_local():
            raise BusinessRuleError("No se puede mover a una fecha pasada")

        self._assert_slot_available(
            destino, len(reservation.players), BookingModality.PARTIDA_ABIERTA
        )

        reservation.tee_slot_id = destino.id
        self.db.flush()
        if origen:
            self._recalculate_slot(origen)
        self._recalculate_slot(destino)

        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=self.MODULE,
            entity="Reservation", entity_id=reservation.id,
            old_value=(
                f"{origen.slot_date} {origen.slot_time.strftime('%H:%M')}" if origen else None
            ),
            new_value=f"{destino.slot_date} {destino.slot_time.strftime('%H:%M')}",
            description=(
                f"{reservation.folio} movida de partida abierta: "
                f"{origen.slot_time.strftime('%H:%M') if origen else '—'} → "
                f"{destino.slot_time.strftime('%H:%M')} del {destino.slot_date}"
            ),
        )
        self.db.commit()
        self.db.refresh(reservation)

        self._avisar_reserva(reservation, EventType.RESERVA_ACTUALIZADA)
        if origen:
            self._avisar_disponibilidad(origen, f"{reservation.folio} salió de esa salida")
        self._avisar_disponibilidad(destino, f"{reservation.folio} entró a esa salida")
        return reservation

    def partidas_abiertas(self, dia: date) -> dict:
        """Las partidas abiertas del día, con quién se juntó en cada una."""
        salidas = []
        for slot in self.availability.day(dia):
            vivas = self.repo.active_reservations_in_slot(slot.id)
            if not vivas or not all(
                r.modality == BookingModality.PARTIDA_ABIERTA for r in vivas
            ):
                continue
            salidas.append({
                "tee_slot_id": slot.id,
                "slot_time": slot.slot_time,
                "tee": slot.tee,
                "capacity": slot.capacity,
                "occupied": slot.occupied,
                "libres": max(slot.capacity - slot.occupied, 0),
                "cerrada": slot.open_closed,
                "reservas": [
                    {
                        "id": r.id,
                        "folio": r.folio,
                        "hotel_id": r.hotel_id,
                        "hotel_name": r.hotel.name if r.hotel else None,
                        "holder_name": r.holder_name,
                        "status": r.status,
                        "booked_by_name": r.booked_by_name,
                        "jugadores": [p.full_name for p in r.players],
                    }
                    for r in sorted(vivas, key=lambda x: x.id)
                ],
            })
        return {
            "fecha": dia,
            "admite_abiertas": self.dia_admite_abiertas(dia),
            "salidas": salidas,
        }

    def update(self, reservation_id: int, data: dict, actor: User) -> Reservation:
        reservation = self.get(reservation_id)
        if reservation.status in (ReservationStatus.COMPLETADA, ReservationStatus.CANCELADA):
            raise BusinessRuleError("No se puede modificar una reserva completada o cancelada")

        for field, value in data.items():
            if value is None:
                continue
            old = getattr(reservation, field)
            if old != value:
                setattr(reservation, field, value)
                self.audit.log(
                    user=actor, action=AuditAction.MODIFICAR, module=self.MODULE,
                    entity="Reservation", entity_id=reservation.id,
                    field=field, old_value=old, new_value=value,
                )
        self.db.commit()
        self.db.refresh(reservation)
        return reservation

    # ------------------------------------------------------------- cotización
    def quote(self, data: ReservationCreate, actor: User) -> dict:
        """Calcula el total sin guardar nada ni comprometer cupo."""
        # La cotización sigue las mismas reglas de quién reserva para quién:
        # si no, recepción vería el precio con la comisión de un hotel al que
        # de todos modos no le puede colgar la reserva.
        if actor.role == UserRole.HOTEL:
            hotel_id = actor.hotel_id
        elif actor.role == UserRole.RECEPCION:
            hotel_id = self.hotels.venta_directa().id
        else:
            hotel_id = data.hotel_id
        if hotel_id is None:
            raise ValidationError("Debe indicar el hotel")
        hotel = self.hotels.get(hotel_id)

        self._validate_modality(data.modality, len(data.players))
        slot = self.slots.get(data.tee_slot_id)
        on_date = slot.slot_date if slot else date.today()
        # La cotización tiene que dar el mismo número que la reserva, así que
        # también mira la hora para decidir si es twilight.
        on_time = slot.slot_time if slot else None

        detail: List[str] = []
        subtotal_green_fees = ZERO
        for entry in data.players:
            category = entry.category
            if entry.age is not None and entry.age < 16:
                category = PlayerCategory.INFANTIL
            plan = self.pricing.resolve_rate(
                modality=data.modality.value, holes=data.holes,
                category=category, on_date=on_date, at_time=on_time,
            )
            subtotal_green_fees += money(plan.price)
            detail.append(f"{entry.full_name}: {category} · ${plan.price} MXN")

        subtotal_services = ZERO
        for entry in data.services:
            service = self.services.get(entry.service_id)
            if service.code == "ACOMPANANTE":
                continue
            line = money(money(service.price) * entry.quantity)
            subtotal_services += line
            detail.append(f"{service.name} x{entry.quantity}: ${line} MXN")

        if data.companions:
            acompanante = self._servicio_acompanante()
            if acompanante and acompanante.is_active:
                line = money(money(acompanante.price) * len(data.companions))
                subtotal_services += line
                detail.append(f"Acompañantes x{len(data.companions)}: ${line} MXN")

        discount_amount = ZERO
        if data.discount_code:
            discount = self.discounts.validate_for_reservation(
                data.discount_code, modality=data.modality.value, holes=data.holes,
                hotel_id=hotel.id, player_count=len(data.players), on_date=on_date,
            )
            discount_amount = self.discounts.compute(discount, subtotal_green_fees)
            detail.append(f"Descuento {discount.code}: -${discount_amount} MXN")

        total = money(subtotal_green_fees + subtotal_services - discount_amount)
        exchange_rate = self.exchange.current_rate()

        return {
            "subtotal_green_fees": money(subtotal_green_fees),
            "subtotal_services": money(subtotal_services),
            "discount_amount": money(discount_amount),
            "total": total,
            "exchange_rate": exchange_rate,
            "total_usd_equivalent": money(total / exchange_rate) if exchange_rate else ZERO,
            "detail": detail,
        }
