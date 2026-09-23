"""Acceso a datos de reservas y franjas.

El filtro por hotel se aplica AQUÍ, no en el router: así ningún endpoint nuevo
se puede olvidar de restringir el alcance de un usuario de hotel.
"""
from datetime import date, time
from typing import List, Optional

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.modules.booking.models import Reservation, TeeSlot
from app.shared.enums import ReservationStatus, SlotStatus


class TeeSlotRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, slot_id: int) -> Optional[TeeSlot]:
        return self.db.get(TeeSlot, slot_id)

    def get_for_update(self, slot_id: int) -> Optional[TeeSlot]:
        """Bloquea la fila hasta el commit.

        En PostgreSQL emite SELECT ... FOR UPDATE. En SQLite no hay bloqueo de
        fila, pero la escritura es serializada por el lock de base, así que el
        resultado es equivalente para el volumen de este sistema. La defensa
        real es el UNIQUE de la tabla más esta transacción.
        """
        stmt = select(TeeSlot).where(TeeSlot.id == slot_id)
        if self.db.bind and self.db.bind.dialect.name != "sqlite":
            stmt = stmt.with_for_update()
        return self.db.execute(stmt).scalar_one_or_none()

    def find(self, slot_date: date, tee: str, slot_time: time) -> Optional[TeeSlot]:
        stmt = select(TeeSlot).where(
            TeeSlot.slot_date == slot_date,
            TeeSlot.tee == tee,
            TeeSlot.slot_time == slot_time,
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def list_by_date(self, slot_date: date, tee: Optional[str] = None) -> List[TeeSlot]:
        stmt = select(TeeSlot).where(TeeSlot.slot_date == slot_date)
        if tee:
            stmt = stmt.where(TeeSlot.tee == tee)
        return list(self.db.execute(stmt.order_by(TeeSlot.tee, TeeSlot.slot_time)).scalars().all())

    def list_range(self, start: date, end: date, tee: Optional[str] = None) -> List[TeeSlot]:
        stmt = select(TeeSlot).where(and_(TeeSlot.slot_date >= start, TeeSlot.slot_date <= end))
        if tee:
            stmt = stmt.where(TeeSlot.tee == tee)
        return list(
            self.db.execute(stmt.order_by(TeeSlot.slot_date, TeeSlot.tee, TeeSlot.slot_time)).scalars().all()
        )

    def add(self, slot: TeeSlot) -> TeeSlot:
        self.db.add(slot)
        self.db.flush()
        return slot


class ReservationRepository:
    def __init__(self, db: Session, hotel_scope: Optional[int] = None):
        self.db = db
        self.hotel_scope = hotel_scope

    def _scoped(self, stmt):
        if self.hotel_scope is not None:
            stmt = stmt.where(Reservation.hotel_id == self.hotel_scope)
        return stmt

    def get(self, reservation_id: int) -> Optional[Reservation]:
        stmt = self._scoped(select(Reservation).where(Reservation.id == reservation_id))
        return self.db.execute(stmt).scalar_one_or_none()

    def get_by_folio(self, folio: str) -> Optional[Reservation]:
        stmt = self._scoped(select(Reservation).where(Reservation.folio == folio.upper().strip()))
        return self.db.execute(stmt).scalar_one_or_none()

    def get_by_qr(self, token: str) -> Optional[Reservation]:
        stmt = self._scoped(select(Reservation).where(Reservation.qr_token == token))
        return self.db.execute(stmt).scalar_one_or_none()

    def search(
        self,
        *,
        term: Optional[str] = None,
        status: Optional[ReservationStatus] = None,
        hotel_id: Optional[int] = None,
        slot_date: Optional[date] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Reservation]:
        stmt = self._scoped(select(Reservation).join(TeeSlot, Reservation.tee_slot_id == TeeSlot.id))

        if term:
            like = f"%{term.strip()}%"
            stmt = stmt.where(
                (Reservation.folio.ilike(like))
                | (Reservation.holder_name.ilike(like))
                | (Reservation.holder_phone.ilike(like))
                | (Reservation.holder_email.ilike(like))
            )
        if isinstance(status, (list, tuple, set)):
            stmt = stmt.where(Reservation.status.in_(list(status)))
        elif status:
            stmt = stmt.where(Reservation.status == status)
        if hotel_id is not None and self.hotel_scope is None:
            stmt = stmt.where(Reservation.hotel_id == hotel_id)
        if slot_date:
            stmt = stmt.where(TeeSlot.slot_date == slot_date)
        if date_from:
            stmt = stmt.where(TeeSlot.slot_date >= date_from)
        if date_to:
            stmt = stmt.where(TeeSlot.slot_date <= date_to)

        stmt = stmt.order_by(TeeSlot.slot_date.desc(), TeeSlot.slot_time).limit(limit).offset(offset)
        return list(self.db.execute(stmt).scalars().unique().all())

    def active_reservations_in_slot(self, slot_id: int) -> List[Reservation]:
        """Reservas vivas de una salida.

        Se consulta SIN el filtro por hotel a propósito: para saber si una
        salida está libre hay que ver todas las reservas, no solo las del hotel
        que pregunta. El alcance por hotel aplica a lo que se muestra, no a la
        regla de ocupación.
        """
        stmt = select(Reservation).where(
            Reservation.tee_slot_id == slot_id,
            Reservation.status.notin_([ReservationStatus.CANCELADA, ReservationStatus.NO_SHOW]),
        )
        return list(self.db.execute(stmt).scalars().unique().all())

    def count_active_in_slot(self, slot_id: int) -> int:
        """Jugadores comprometidos en una salida."""
        return sum(len(r.players) for r in self.active_reservations_in_slot(slot_id))

    def add(self, reservation: Reservation) -> Reservation:
        self.db.add(reservation)
        self.db.flush()
        return reservation

    def folio_exists(self, folio: str) -> bool:
        stmt = select(Reservation.id).where(Reservation.folio == folio)
        return self.db.execute(stmt).scalar_one_or_none() is not None
