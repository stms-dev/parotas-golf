"""Contratos del módulo de reservas."""
from datetime import date, datetime, time
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.shared.enums import BookingModality, InvoiceStatus, PlayerCategory, ReservationStatus, SlotStatus


# ----------------------------------------------------------------- disponibilidad
class SlotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slot_date: date
    tee: str
    slot_time: time
    capacity: int
    occupied: int
    available: int
    status: SlotStatus
    event_name: Optional[str] = None
    # Las salidas se abren en orden: solo una está "en turno" por día.
    en_turno: bool = False
    # Por qué no se puede reservar: orden, vencida, carritos, bloqueada u ocupada.
    cerrada_por: Optional[str] = None
    # Solo para el campo: el folio cuyo replay se juega en esta salida.
    replay_folio: Optional[str] = None
    # Quien bloqueó la salida necesita poder liberarla: sin el id habría que
    # buscar a mano cuál de los eventos del día le corresponde.
    event_id: Optional[int] = None

    # Una salida cuya hora ya pasó: sigue existiendo, pero no se puede vender.
    expirada: bool = False

    # Para la rejilla del hotel: distinguir "ocupado" de "es mío".
    es_de_mi_hotel: bool = False
    modalidad: Optional[BookingModality] = None
    titular: Optional[str] = None


class AvailabilityDay(BaseModel):
    slot_date: date
    tee: str
    slots: List[SlotOut]


# ---------------------------------------------------------------------- jugadores
class PlayerIn(BaseModel):
    full_name: str = Field(min_length=3, max_length=180)
    age: Optional[int] = Field(default=None, ge=1, le=120)
    category: PlayerCategory = PlayerCategory.ADULTO
    handicap: Optional[str] = None
    club_hand: Optional[str] = None
    is_holder: bool = False
    pga_code: Optional[str] = None
    credential_number: Optional[str] = None

    @field_validator("category", mode="before")
    @classmethod
    def _infer_category(cls, v, info):
        """Menor de 16 se marca como INFANTIL aunque el hotel mande ADULTO."""
        age = info.data.get("age") if info.data else None
        if age is not None and age < 16:
            return PlayerCategory.INFANTIL
        return v


class PlayerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    age: Optional[int]
    category: PlayerCategory
    handicap: Optional[str]
    club_hand: Optional[str] = None
    is_holder: bool
    pga_code: Optional[str]
    credential_number: Optional[str]
    pga_validated: bool
    pga_discount_applied: Decimal
    rate_applied: Decimal
    final_rate: Decimal
    arrived: bool
    arrived_at: Optional[datetime]


class CompanionIn(BaseModel):
    full_name: str = Field(min_length=3, max_length=180)
    age: Optional[int] = Field(default=None, ge=1, le=120)
    notes: Optional[str] = None


class CompanionOut(CompanionIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    arrived: bool = False


class ServiceIn(BaseModel):
    service_id: int
    quantity: int = Field(default=1, ge=1, le=20)
    player_id: Optional[int] = None
    notes: Optional[str] = None


class ServiceLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    service_id: int
    service_name: Optional[str] = None
    quantity: int
    unit_price_applied: Decimal
    total: Decimal
    notes: Optional[str]
    service_code: Optional[str] = None


# ----------------------------------------------------------------------- reservas
class ReservationCreate(BaseModel):
    tee_slot_id: int
    modality: BookingModality
    holes: int = Field(default=18)

    holder_name: str = Field(min_length=3, max_length=180)
    holder_email: EmailStr
    holder_phone: Optional[str] = None
    holder_room: Optional[str] = None

    players: List[PlayerIn] = Field(min_length=1)
    companions: List[CompanionIn] = Field(default_factory=list)
    services: List[ServiceIn] = Field(default_factory=list)

    discount_code: Optional[str] = None
    invoice_requested: bool = False
    invoice_contact_email: Optional[EmailStr] = None
    notes: Optional[str] = None

    # Solo lo usan roles del campo; el usuario HOTEL toma su propio hotel del token.
    hotel_id: Optional[int] = None

    @field_validator("holes")
    @classmethod
    def _valid_holes(cls, v: int) -> int:
        if v not in (9, 18):
            raise ValueError("Los hoyos deben ser 9 o 18")
        return v


class ReservationUpdate(BaseModel):
    holder_name: Optional[str] = None
    holder_email: Optional[EmailStr] = None
    holder_phone: Optional[str] = None
    holder_room: Optional[str] = None
    notes: Optional[str] = None
    invoice_requested: Optional[bool] = None
    invoice_contact_email: Optional[EmailStr] = None


class ReservationCancel(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class PaymentOut(BaseModel):
    """Un cobro, como sale impreso en el recibo."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    currency: str
    amount: Decimal
    exchange_rate_applied: Decimal
    amount_mxn: Decimal
    change_mxn: Decimal = Decimal("0.00")
    method: str
    reference: Optional[str] = None
    paid_at: datetime


class ReplayOut(BaseModel):
    """Segundo ticket del mismo folio. El hotel nunca lo recibe."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    players_count: int
    unit_price: Decimal
    total: Decimal
    tee_slot_id: Optional[int] = None
    slot_time: Optional[time] = None
    created_at: datetime
    created_by_name: Optional[str] = None
    payments: List[PaymentOut] = []


class ReservationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    folio: str
    hotel_id: int
    hotel_name: Optional[str] = None
    modality: BookingModality
    holes: int
    status: ReservationStatus

    tee_slot_id: Optional[int] = None
    slot_date: Optional[date] = None
    slot_time: Optional[time] = None
    tee: Optional[str] = None

    holder_name: str
    holder_email: EmailStr
    holder_phone: Optional[str]
    holder_room: Optional[str]

    discount_code_applied: Optional[str]
    exchange_rate_applied: Decimal
    commission_rate_applied: Decimal

    carts_used: int = 0

    subtotal_green_fees: Decimal
    subtotal_services: Decimal
    discount_amount: Decimal
    pga_discount_amount: Decimal
    total: Decimal

    total_paid: Decimal = Decimal("0.00")
    balance: Decimal = Decimal("0.00")

    qr_token: Optional[str]
    invoice_requested: bool
    # Solo viene lleno cuando la factura va a un correo distinto al del titular.
    invoice_contact_email: Optional[EmailStr] = None
    invoice_status: InvoiceStatus
    notes: Optional[str]

    players: List[PlayerOut] = []
    companions: List[CompanionOut] = []
    services: List[ServiceLineOut] = []
    payments: List[PaymentOut] = []
    replays: List[ReplayOut] = []

    created_at: datetime
    confirmed_at: Optional[datetime]
    checked_in_at: Optional[datetime]
    completed_at: Optional[datetime]
    cancelled_at: Optional[datetime]
    cancellation_reason: Optional[str]


class ReservationListItem(BaseModel):
    """Versión ligera para tablas y listados."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    folio: str
    # El id además del nombre: el resumen por hotel de la pantalla de partidas
    # filtra por hotel, y filtrar por un nombre escrito es frágil.
    hotel_id: Optional[int] = None
    hotel_name: Optional[str] = None
    holder_name: str
    modality: BookingModality
    holes: int
    status: ReservationStatus
    slot_date: Optional[date] = None
    slot_time: Optional[time] = None
    tee: Optional[str] = None
    player_count: int = 0
    total: Decimal
    balance: Decimal = Decimal("0.00")
    created_at: datetime


class QuotePreview(BaseModel):
    """Cotización antes de guardar: el hotel ve el total sin comprometer cupo."""

    subtotal_green_fees: Decimal
    subtotal_services: Decimal
    discount_amount: Decimal
    total: Decimal
    exchange_rate: Decimal
    total_usd_equivalent: Decimal
    detail: List[str] = []
