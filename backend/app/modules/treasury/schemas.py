"""Contratos de tesorería."""
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.shared.enums import CashSessionStatus, SettlementStatus


class CashSessionOpen(BaseModel):
    opening_balance: Decimal = Field(default=Decimal("0.00"), ge=0)


class CashSessionClose(BaseModel):
    counted_cash_mxn: Decimal = Field(default=Decimal("0.00"), ge=0)
    counted_cash_usd: Decimal = Field(default=Decimal("0.00"), ge=0)
    counted_card_mxn: Decimal = Field(default=Decimal("0.00"), ge=0)
    counted_transfer_mxn: Decimal = Field(default=Decimal("0.00"), ge=0)
    notes: Optional[str] = None


class CashSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_date: date
    opened_at: datetime
    opened_by_name: Optional[str] = None
    opening_balance: Decimal
    closed_at: Optional[datetime]
    closed_by_name: Optional[str] = None

    expected_cash_mxn: Decimal
    expected_card_mxn: Decimal
    expected_transfer_mxn: Decimal
    expected_total_mxn: Decimal

    counted_cash_mxn: Decimal
    counted_cash_usd: Decimal
    counted_card_mxn: Decimal
    counted_transfer_mxn: Decimal
    counted_total_mxn: Decimal

    exchange_rate_applied: Optional[Decimal]
    difference_mxn: Decimal
    status: CashSessionStatus
    notes: Optional[str]


class CashSessionLive(BaseModel):
    """Lo que la caja lleva acumulado en el turno abierto."""

    session_id: Optional[int] = None
    status: str
    cash_mxn: Decimal = Decimal("0.00")
    card_mxn: Decimal = Decimal("0.00")
    transfer_mxn: Decimal = Decimal("0.00")
    usd_cash_original: Decimal = Decimal("0.00")
    total_mxn: Decimal = Decimal("0.00")
    payment_count: int = 0
    opened_at: Optional[datetime] = None
    opened_by_name: Optional[str] = None


class SettlementPreview(BaseModel):
    hotel_id: int
    hotel_name: str
    period_start: date
    period_end: date
    reservations_count: int
    gross_sales: Decimal
    pga_discounts: Decimal
    commission_rate_applied: Decimal
    commission_amount: Decimal
    net_course: Decimal


class SettlementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hotel_id: int
    hotel_name: Optional[str] = None
    period_start: date
    period_end: date
    reservations_count: int
    gross_sales: Decimal
    pga_discounts: Decimal
    commission_rate_applied: Decimal
    commission_amount: Decimal
    net_course: Decimal
    status: SettlementStatus
    settled_at: Optional[datetime]


class FinanceSummary(BaseModel):
    """Tablero financiero del periodo."""

    period_start: date
    period_end: date
    reservations_count: int
    gross_sales: Decimal
    total_collected: Decimal
    pending_collection: Decimal
    services_total: Decimal
    pga_discounts: Decimal
    hotel_commissions: Decimal
    net_course: Decimal
    # Rondas extra cobradas en el mostrador. Suman a la venta del campo pero
    # no a la de ningún hotel, así que no generan comisión.
    replays_total: Decimal = Decimal("0.00")
    replays_count: int = 0
    # Duración promedio de una partida en el periodo, del pago al cierre.
    avg_round_minutes: Optional[int] = None
    rounds_measured: int = 0
    by_hotel: List[SettlementPreview] = []


class PGABenefitRow(BaseModel):
    """Una bonificación PGA concreta, para la auditoría de Finanzas."""

    reservation_id: int
    folio: str
    slot_date: Optional[date] = None
    hotel_name: Optional[str] = None
    player_name: str
    pga_code: Optional[str] = None
    credential_number: Optional[str] = None
    base_rate: Decimal
    discount: Decimal
    final_rate: Decimal
    validated_by: Optional[str] = None
    validated_at: Optional[datetime] = None
