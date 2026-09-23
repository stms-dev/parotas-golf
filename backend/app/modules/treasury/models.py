"""Tesorería: sesiones de caja y liquidación a hoteles."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.shared.enums import CashSessionStatus, SettlementStatus
from app.shared.money import DecimalMoney, DecimalRate


class CashSession(Base):
    """Turno de caja: apertura, fondo, responsable, cierre.

    Aunque la regla operativa es que a las 22:00 se cierra la puerta a nuevos
    cobros, el turno existe igual: es lo que hace que una diferencia en el
    arqueo tenga a quién responsabilizar y a qué corte pertenece cada pago.
    """

    __tablename__ = "cash_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    opened_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    opened_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    opening_balance: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)

    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    closed_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # --- Arqueo ---
    expected_cash_mxn: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    expected_card_mxn: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    expected_transfer_mxn: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    expected_total_mxn: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)

    counted_cash_mxn: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    counted_cash_usd: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    counted_card_mxn: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    counted_transfer_mxn: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    counted_total_mxn: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)

    exchange_rate_applied: Mapped[Optional[Decimal]] = mapped_column(DecimalRate, nullable=True)
    difference_mxn: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)

    status: Mapped[CashSessionStatus] = mapped_column(
        String(24), default=CashSessionStatus.ABIERTA, nullable=False, index=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    opened_by = relationship("User", foreign_keys=[opened_by_id], lazy="joined")
    closed_by = relationship("User", foreign_keys=[closed_by_id], lazy="joined")


class HotelSettlement(Base):
    """Liquidación por hotel y periodo.

    La comisión se guarda congelada: si mañana se renegocia el 5%, las
    liquidaciones pasadas no se mueven.
    """

    __tablename__ = "hotel_settlements"

    id: Mapped[int] = mapped_column(primary_key=True)
    hotel_id: Mapped[int] = mapped_column(ForeignKey("hotels.id", ondelete="RESTRICT"), nullable=False, index=True)

    period_start: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    period_end: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    reservations_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    gross_sales: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    pga_discounts: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    commission_rate_applied: Mapped[Decimal] = mapped_column(DecimalRate, nullable=False)
    commission_amount: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    net_course: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)

    status: Mapped[SettlementStatus] = mapped_column(
        String(24), default=SettlementStatus.PENDIENTE, nullable=False, index=True
    )
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    settled_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    hotel = relationship("Hotel", lazy="joined")
