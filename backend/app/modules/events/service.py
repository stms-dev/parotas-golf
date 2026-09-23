"""Eventos y bloqueos. Al crearse marcan las franjas del rango."""
from datetime import date
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, NotFoundError, ValidationError
from app.modules.audit.service import AuditService
from app.modules.booking.models import Reservation, TeeSlot
from app.modules.booking.repository import TeeSlotRepository
from app.modules.booking.service import AvailabilityService
from app.modules.events.models import CourseEvent
from app.modules.identity.models import User
from app.realtime.events import EventType as RTEventType
from app.realtime.events import RealtimeEvent
from app.realtime.manager import publish
from app.shared.enums import AuditAction, ReservationStatus, SlotStatus


class EventService:
    MODULE = "events"

    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)
        self.slots = TeeSlotRepository(db)
        self.availability = AvailabilityService(db)

    def list(self, *, start: Optional[date] = None, end: Optional[date] = None,
             active_only: bool = True) -> List[CourseEvent]:
        stmt = select(CourseEvent)
        if active_only:
            stmt = stmt.where(CourseEvent.is_active.is_(True))
        if start:
            stmt = stmt.where(CourseEvent.event_date >= start)
        if end:
            stmt = stmt.where(CourseEvent.event_date <= end)
        return list(self.db.execute(stmt.order_by(CourseEvent.event_date, CourseEvent.start_time)).scalars().all())

    def get(self, event_id: int) -> CourseEvent:
        event = self.db.get(CourseEvent, event_id)
        if not event:
            raise NotFoundError(f"Evento {event_id} no encontrado")
        return event

    def create(self, data: dict, actor: User) -> CourseEvent:
        if data["start_time"] >= data["end_time"]:
            raise ValidationError("La hora inicial debe ser anterior a la hora final")

        event = CourseEvent(**data, created_by_id=actor.id)
        self.db.add(event)
        self.db.flush()

        affected = 0
        if event.blocks_availability:
            affected = self._block_slots(event)

        self.audit.log(
            user=actor, action=AuditAction.CREAR, module=self.MODULE,
            entity="CourseEvent", entity_id=event.id,
            new_value=f"{event.event_date} {event.start_time}–{event.end_time}",
            description=f"Evento creado: {event.name} · {affected} franjas bloqueadas",
        )
        self.db.commit()
        self.db.refresh(event)

        # Sin hotel_id: si se bloquean franjas, todos los hoteles tienen que ver
        # desaparecer esos horarios de su pantalla al instante.
        publish(
            RealtimeEvent(
                type=RTEventType.EVENTO_CREADO,
                payload={
                    "evento_id": event.id,
                    "nombre": event.name,
                    "tipo": event.event_type,
                    "fecha": event.event_date.isoformat(),
                    "tee": event.tee,
                    "desde": event.start_time.strftime("%H:%M"),
                    "hasta": event.end_time.strftime("%H:%M"),
                    "franjas_bloqueadas": affected,
                },
            )
        )
        return event

    def _block_slots(self, event: CourseEvent) -> int:
        """Bloquea las franjas del rango. Se niega si ya hay reservas vivas."""
        self.availability.ensure_day(event.event_date)
        slots = [
            s for s in self.slots.list_by_date(event.event_date, event.tee)
            if event.start_time <= s.slot_time <= event.end_time
        ]

        conflicting: List[str] = []
        for slot in slots:
            stmt = select(Reservation).where(
                Reservation.tee_slot_id == slot.id,
                Reservation.status.notin_([ReservationStatus.CANCELADA, ReservationStatus.NO_SHOW]),
            )
            if self.db.execute(stmt).scalars().first():
                conflicting.append(slot.slot_time.strftime("%H:%M"))

        if conflicting:
            raise BusinessRuleError(
                "No se puede bloquear: ya hay reservas activas en "
                f"{', '.join(conflicting)}. Cancélelas primero o ajuste el horario."
            )

        for slot in slots:
            slot.status = SlotStatus.BLOQUEADO
            slot.event_id = event.id
        return len(slots)

    def release(self, event_id: int, actor: User) -> CourseEvent:
        """Desactiva el evento y libera sus franjas."""
        event = self.get(event_id)
        released = 0
        for slot in self.slots.list_by_date(event.event_date, event.tee):
            if slot.event_id == event.id:
                slot.event_id = None
                slot.status = SlotStatus.OCUPADO if slot.occupied >= slot.capacity else SlotStatus.DISPONIBLE
                released += 1

        event.is_active = False
        self.audit.log(
            user=actor, action=AuditAction.ELIMINAR, module=self.MODULE,
            entity="CourseEvent", entity_id=event.id,
            description=f"Evento liberado: {event.name} · {released} franjas devueltas a disponibilidad",
        )
        self.db.commit()
        self.db.refresh(event)

        publish(
            RealtimeEvent(
                type=RTEventType.EVENTO_LIBERADO,
                payload={
                    "evento_id": event.id,
                    "nombre": event.name,
                    "fecha": event.event_date.isoformat(),
                    "tee": event.tee,
                    "franjas_liberadas": released,
                },
            )
        )
        return event
