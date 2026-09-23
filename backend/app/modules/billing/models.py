"""Pagos. Reserva y pago son conceptos independientes."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.shared.enums import Currency, PaymentMethod
from app.shared.money import DecimalMoney, DecimalRate


class Payment(Base):
    """Un movimiento de cobro.

    Un pago mixto son varias filas contra la misma reserva. El saldo de la
    reserva es su total menos la suma de amount_mxn de sus pagos.

    exchange_rate_applied se guarda por pago: si el TC cambia mañana, este
    cobro sigue valiendo lo que valió hoy.
    """

    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    reservation_id: Mapped[int] = mapped_column(
        ForeignKey("reservations.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    cash_session_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("cash_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Un cobro de replay va contra el mismo folio pero en su propio ticket:
    # no toca el total ni el saldo de la reserva original.
    replay_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("replay_tickets.id", ondelete="RESTRICT"), nullable=True, index=True
    )

    currency: Mapped[Currency] = mapped_column(String(3), nullable=False)
    amount: Mapped[Decimal] = mapped_column(
        DecimalMoney, nullable=False, comment="Monto en la moneda original"
    )
    exchange_rate_applied: Mapped[Decimal] = mapped_column(DecimalRate, nullable=False)
    amount_mxn: Mapped[Decimal] = mapped_column(
        DecimalMoney, nullable=False, comment="Equivalente en MXN al TC aplicado"
    )
    # En efectivo el huésped puede entregar de más: amount es lo que entregó
    # y change_mxn lo que se le regresó en pesos. Lo que cubre la cuenta es
    # la diferencia (neto_mxn). En tarjeta y transferencia siempre es cero.
    change_mxn: Mapped[Decimal] = mapped_column(
        DecimalMoney, nullable=False, default=Decimal("0.00"), server_default="0"
    )

    method: Mapped[PaymentMethod] = mapped_column(String(24), nullable=False, index=True)
    reference: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    received_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    paid_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)

    is_voided: Mapped[bool] = mapped_column(default=False, nullable=False)
    voided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    voided_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    reservation = relationship("Reservation", back_populates="payments")
    replay = relationship("ReplayTicket", back_populates="payments")

    @property
    def neto_mxn(self) -> Decimal:
        """Lo que este cobro aplicó a la cuenta: lo entregado menos el cambio."""
        from app.shared.money import money

        return money(money(self.amount_mxn) - money(self.change_mxn or 0))
    received_by = relationship("User", foreign_keys=[received_by_id], lazy="joined")



class ReplayTicket(Base):
    """Segundo ticket del mismo folio: la ronda extra que se cobra al volver.

    Vive aparte de la reserva a propósito. El ticket original ya se pagó y se
    entregó al hotel tal cual; el replay es un cobro nuevo del campo, no le
    suma comisión al hotel y el hotel no lo ve.
    """

    __tablename__ = "replay_tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    reservation_id: Mapped[int] = mapped_column(
        ForeignKey("reservations.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    players_count: Mapped[int] = mapped_column(nullable=False)
    # La salida en la que juegan el replay. Toma esa salida completa.
    tee_slot_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tee_slots.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    unit_price: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    total: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    reservation = relationship("Reservation", back_populates="replays")
    tee_slot = relationship("TeeSlot", lazy="joined")
    payments = relationship("Payment", back_populates="replay", lazy="selectin")
    created_by = relationship("User", foreign_keys=[created_by_id], lazy="joined")


def pagos_de_la_reserva(reservation) -> list:
    """Cobros vigentes del ticket original, sin los de replay."""
    return [p for p in reservation.payments if not p.is_voided and p.replay_id is None]
