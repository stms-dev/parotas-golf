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

    Los dos son limitados y no se eligen: el carrito sale de cuánta gente va
    (dos personas por carrito) y el caddie se pide, pero solo hasta donde
    alcancen. Un recurso queda tomado mientras la partida no termine: al
    marcarse como finalizada, vuelve a estar disponible para el resto del día.
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

    def _partidas_del_dia(self, target: date) -> List[Reservation]:
        stmt = (
            select(Reservation)
            .join(TeeSlot, Reservation.tee_slot_id == TeeSlot.id)
            .where(TeeSlot.slot_date == target, Reservation.status.in_(self.EN_USO))
        )
        return list(self.db.execute(stmt).scalars().unique().all())

    @staticmethod
    def _caddies_de(reservation: Reservation) -> int:
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

    def salida_en_turno(self, target: date, tee: Optional[str] = None) -> Optional[TeeSlot]:
        """La única salida que se puede reservar ahora mismo.

        Las salidas se abren en orden: mientras las 09:00 tengan lugar, no se
        vende la de las 09:30. Cuando la primera se llena —o cuando su hora ya
        pasó— se abre la siguiente. Así el campo se ocupa de corrido y no
        quedan huecos que nadie juega.
        """
        for slot in self.day(target, tee):
            if slot.status == SlotStatus.BLOQUEADO or slot.available <= 0:
                continue
            if not settings.horarios_libres and ya_paso(slot.slot_date, slot.slot_time):
                continue
            return slot
        return None

    def day(self, target: date, tee: Optional[str] = None) -> List[TeeSlot]:
        slots = self.slots.list_by_date(target, tee)
        if not slots:
            self.ensure_day(target)
            slots = self.slots.list_by_date(target, tee)
        return slots

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

        El grupo no tiene techo: toma la salida completa y es el campo quien
        decide a cuántos deja salir juntos. La partida abierta sí lo tiene,
        porque comparte la salida con huéspedes de otros hoteles.
        """
        reglas = {
            BookingModality.INDIVIDUAL: (1, 1),
            BookingModality.GRUPO: (2, None),
            BookingModality.PARTIDA_ABIERTA: (1, 4),
        }
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

        # Las salidas se abren en orden: solo se vende la más próxima con
        # lugar. Las de más tarde esperan su turno.
        en_turno = self.availability.salida_en_turno(slot.slot_date, slot.tee)
        if en_turno and en_turno.id != slot.id:
            raise BusinessRuleError(
                f"Los horarios se abren en orden: ahora corresponde la salida de las "
                f"{en_turno.slot_time.strftime('%H:%M')}. "
                f"Las {slot.slot_time.strftime('%H:%M')} se abren cuando esa se llene "
                "o pase su hora."
            )
        if en_turno is None:
            raise BusinessRuleError(
                "Ya no hay salidas por abrir este día. Elija otra fecha."
            )

        vivas = self.repo.active_reservations_in_slot(slot.id)
        if vivas:
            solo_abiertas = all(r.modality == BookingModality.PARTIDA_ABIERTA for r in vivas)
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
            if solo_abiertas and slot.occupied < slot.capacity
            else SlotStatus.OCUPADO
        )

    # --------------------------------------------------------------- creación
    def create(self, data: ReservationCreate, actor: User) -> Reservation:
        # 1. Hotel: un usuario HOTEL solo puede reservar para el suyo.
        if actor.role == UserRole.HOTEL:
            hotel_id = actor.hotel_id
        else:
            hotel_id = data.hotel_id
            if hotel_id is None:
                raise ValidationError("Debe indicar el hotel de la reserva")
        hotel = self.hotels.get(hotel_id)

        # 2. Reglas de modalidad y cupo.
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

        # 3. Carritos y caddies: son limitados y se reparten por día. El
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

        caddies_pedidos = 0
        for entrada in data.services:
            servicio = self.services.get(entrada.service_id)
            if servicio.code == "CADDIE":
                caddies_pedidos += entrada.quantity
        if caddies_pedidos > situacion["caddies_libres"]:
            raise BusinessRuleError(
                f"Solo quedan {situacion['caddies_libres']} caddie(s) libres de "
                f"{situacion['caddies_totales']} para ese día y se piden {caddies_pedidos}. "
                "Los caddies se liberan cuando la partida que los tiene se finaliza."
            )

        holders = [p for p in data.players if p.is_holder]
        if len(holders) > 1:
            raise ValidationError("Solo puede haber un titular en la reserva")

        # La salida se valida ANTES de escribir nada.
        self._assert_slot_available(slot, len(data.players), data.modality)

        # 3. Valores congelados: TC y comisión del momento.
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
            notes=data.notes,
            exchange_rate_applied=exchange_rate,
            commission_rate_applied=commission_rate,
            invoice_requested=data.invoice_requested,
            invoice_contact_email=str(data.invoice_contact_email) if data.invoice_contact_email else None,
            qr_token=secrets.token_urlsafe(24),
        )
        self.repo.add(reservation)

        # 4. Jugadores y su tarifa congelada.
        #    El descuento PGA NO se aplica aquí: se valida en recepción.
        subtotal_green_fees = ZERO
        for entry in data.players:
            category = entry.category
            if entry.age is not None and entry.age < 16:
                category = PlayerCategory.INFANTIL

            plan = self.pricing.resolve_rate(
                modality=data.modality.value, holes=data.holes,
                category=category, on_date=slot.slot_date,
            )
            player = ReservationPlayer(
                reservation_id=reservation.id,
                full_name=entry.full_name.strip(),
                age=entry.age,
                category=category,
                handicap=entry.handicap,
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

        # 5. Descuento de la reserva (convenio, no PGA).
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

        # 6. Estado de la salida y auditoría, misma transacción.
        self.db.flush()
        self._recalculate_slot(slot)
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module=self.MODULE,
            entity="Reservation", entity_id=reservation.id,
            new_value=str(reservation.total),
            description=(
                f"Reserva {reservation.folio} creada para {hotel.name} · "
                f"{len(data.players)} jugadores · {slot.slot_date} {slot.slot_time.strftime('%H:%M')}"
            ),
        )

        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ConflictError("No se pudo guardar la reserva: conflicto de concurrencia") from exc

        self.db.refresh(reservation)

        # El pase con el QR se encola aquí y sale en segundo plano: si el
        # correo tarda o el servidor no contesta, la reserva ya está hecha.
        try:
            from app.modules.mailing.service import MailingService
            from app.shared.enums import EmailKind

            MailingService(self.db).encolar(kind=EmailKind.PASE, reservation=reservation)
            self.db.commit()
        except Exception:
            self.db.rollback()
            logger.exception("No se pudo encolar el pase de %s", reservation.folio)

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
        hotel_id = actor.hotel_id if actor.role == UserRole.HOTEL else data.hotel_id
        if hotel_id is None:
            raise ValidationError("Debe indicar el hotel")
        hotel = self.hotels.get(hotel_id)

        self._validate_modality(data.modality, len(data.players))
        slot = self.slots.get(data.tee_slot_id)
        on_date = slot.slot_date if slot else date.today()

        detail: List[str] = []
        subtotal_green_fees = ZERO
        for entry in data.players:
            category = entry.category
            if entry.age is not None and entry.age < 16:
                category = PlayerCategory.INFANTIL
            plan = self.pricing.resolve_rate(
                modality=data.modality.value, holes=data.holes,
                category=category, on_date=on_date,
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
