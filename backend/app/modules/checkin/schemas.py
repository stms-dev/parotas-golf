"""Contratos del check-in."""
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.shared.enums import PaymentMethod


class PlayerPGAValidation(BaseModel):
    """Validación de credencial de un jugador en el mostrador."""

    player_id: int
    pga_code: Optional[str] = None
    credential_number: Optional[str] = None
    apply_benefit: bool = True


class PlayerArrival(BaseModel):
    """Marca de llegada individual: el QR es por partida, la llegada por jugador."""

    player_id: int
    arrived: bool = True


class CompanionArrival(BaseModel):
    """Llegada de un acompañante: si no se presenta, no se le cobra."""

    companion_id: int
    arrived: bool = True


class ServiceAddition(BaseModel):
    service_id: int
    quantity: int = Field(default=1, ge=1, le=20)
    player_id: Optional[int] = None
    notes: Optional[str] = None


class PaymentLine(BaseModel):
    currency: str = Field(default="MXN", pattern="^(MXN|USD)$")
    amount: Decimal = Field(gt=0)
    method: PaymentMethod
    reference: Optional[str] = None
    notes: Optional[str] = None


class CheckInRequest(BaseModel):
    """Cierre del check-in: llegadas, PGA, servicios y cobro, en una operación."""

    arrivals: List[PlayerArrival] = Field(default_factory=list)
    companion_arrivals: List[CompanionArrival] = Field(default_factory=list)
    pga_validations: List[PlayerPGAValidation] = Field(default_factory=list)
    services: List[ServiceAddition] = Field(default_factory=list)
    payments: List[PaymentLine] = Field(default_factory=list)
    invoice_requested: Optional[bool] = None
    invoice_contact_email: Optional[str] = None
    allow_partial_payment: bool = False


class PGAApplicationResult(BaseModel):
    player_id: int
    player_name: str
    valid: bool
    message: str
    base_rate: Decimal
    discount: Decimal
    final_rate: Decimal


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    currency: str
    amount: Decimal
    exchange_rate_applied: Decimal
    amount_mxn: Decimal
    change_mxn: Decimal = Decimal("0.00")
    method: PaymentMethod
    reference: Optional[str]
    received_by_name: Optional[str] = None
    paid_at: Optional[str] = None
    is_voided: bool


class CheckInResult(BaseModel):
    folio: str
    status: str
    players_arrived: int
    players_total: int

    subtotal_green_fees: Decimal
    subtotal_services: Decimal
    discount_amount: Decimal
    pga_discount_amount: Decimal
    total: Decimal
    total_paid: Decimal
    balance: Decimal

    exchange_rate_applied: Decimal
    change_mxn: Decimal = Decimal("0.00")
    pga_results: List[PGAApplicationResult] = []
    payments: List[PaymentOut] = []
    message: str


class AccountSummary(BaseModel):
    """Lo que recepción ve antes de cobrar."""

    folio: str
    holder_name: str
    hotel_name: str
    status: str
    slot_time: Optional[str] = None
    holes: int

    subtotal_green_fees: Decimal
    subtotal_services: Decimal
    discount_amount: Decimal
    pga_discount_amount: Decimal
    total: Decimal
    total_paid: Decimal
    balance: Decimal

    exchange_rate: Decimal
    total_usd_equivalent: Decimal
    lines: List[str] = []


class ReplayRequest(BaseModel):
    """Cobro del replay. Es por partida: se elige la salida y con qué se paga."""

    tee_slot_id: int
    payments: List[PaymentLine] = Field(default_factory=list)


class ReplaySlot(BaseModel):
    """Una salida libre donde se puede jugar el replay."""

    id: int
    slot_time: str
    tee: str
