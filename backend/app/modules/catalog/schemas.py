"""Contratos del catálogo."""
from datetime import date, datetime, time
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.shared.enums import DayType, DiscountType, PlayerCategory, ServiceUnit, TimeBand


# --------------------------------------------------------------------- hoteles
class HotelBase(BaseModel):
    code: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=3, max_length=180)
    contact_name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    commission_rate: Decimal = Field(default=Decimal("5.00"), ge=0, le=100)


class HotelCreate(HotelBase):
    pass


class HotelUpdate(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    commission_rate: Optional[Decimal] = Field(default=None, ge=0, le=100)
    is_active: Optional[bool] = None


class HotelOut(HotelBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    is_direct: bool = False
    created_at: datetime


# --------------------------------------------------------------------- tarifas
class RatePlanBase(BaseModel):
    name: str
    modality: str
    holes: int = Field(ge=9, le=18)
    category: PlayerCategory = PlayerCategory.ADULTO
    # Lunes a jueves, viernes a domingo, o todos los días.
    day_type: DayType = DayType.TODOS
    # A qué hora aplica: TWILIGHT para las últimas salidas, TODAS para el resto.
    time_band: TimeBand = TimeBand.TODAS
    price: Decimal = Field(ge=0)
    currency: str = "MXN"
    valid_from: date
    valid_to: Optional[date] = None


class RatePlanCreate(RatePlanBase):
    pass


class RatePlanUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[Decimal] = Field(default=None, ge=0)
    valid_to: Optional[date] = None
    is_active: Optional[bool] = None


class RatePlanOut(RatePlanBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


# -------------------------------------------------------------------- servicios
class ServiceBase(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    price: Decimal = Field(ge=0)
    currency: str = "MXN"
    unit: ServiceUnit = ServiceUnit.POR_RONDA


class ServiceCreate(ServiceBase):
    pass


class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[Decimal] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class ServiceOut(ServiceBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


# ------------------------------------------------------------------- descuentos
class DiscountBase(BaseModel):
    code: str = Field(min_length=2, max_length=48)
    description: Optional[str] = None
    discount_type: DiscountType
    value: Decimal = Field(ge=0)
    valid_from: date
    valid_to: Optional[date] = None
    applicable_modalities: Optional[str] = None
    applicable_holes: Optional[int] = None
    hotel_id: Optional[int] = None
    min_players: Optional[int] = None


class DiscountCreate(DiscountBase):
    pass


class DiscountUpdate(BaseModel):
    description: Optional[str] = None
    value: Optional[Decimal] = Field(default=None, ge=0)
    valid_to: Optional[date] = None
    is_active: Optional[bool] = None


class DiscountOut(DiscountBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


# -------------------------------------------------------------------------- PGA
class PGABenefitConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    discount_type: DiscountType
    value: Decimal
    description: Optional[str]
    is_active: bool
    valid_from: date
    valid_to: Optional[date]


class PGABenefitConfigCreate(BaseModel):
    discount_type: DiscountType
    value: Decimal = Field(ge=0)
    description: Optional[str] = None
    valid_from: date


class PGACredentialBase(BaseModel):
    pga_code: str
    credential_number: str
    professional_name: str
    accreditation: Optional[str] = None
    valid_until: Optional[date] = None


class PGACredentialCreate(PGACredentialBase):
    pass


class PGACredentialUpdate(BaseModel):
    professional_name: Optional[str] = None
    accreditation: Optional[str] = None
    valid_until: Optional[date] = None
    is_active: Optional[bool] = None


class PGACredentialOut(PGACredentialBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class PGAValidationResult(BaseModel):
    """Respuesta de la consulta de una credencial en el mostrador."""

    valid: bool
    message: str
    professional_name: Optional[str] = None
    accreditation: Optional[str] = None
    discount_type: Optional[DiscountType] = None
    discount_value: Optional[Decimal] = None


# ---------------------------------------------------------------- tipo de cambio
class ExchangeRateCreate(BaseModel):
    rate: Decimal = Field(gt=0, description="1 USD = X MXN")
    from_currency: str = "USD"
    to_currency: str = "MXN"
    effective_from: Optional[datetime] = None


class ExchangeRateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    from_currency: str
    to_currency: str
    rate: Decimal
    effective_from: datetime
    created_at: datetime
    created_by_name: Optional[str] = None


# --------------------------------------------------------------------- horarios
class ScheduleConfigBase(BaseModel):
    tee: str = "CAMPO"
    label: str = "Horarios de salida"
    start_time: time
    end_time: time
    interval_minutes: int = Field(default=30, ge=5, le=120)
    slot_capacity: int = Field(default=4, ge=1, le=8)
    holes: int = 18


class ScheduleConfigCreate(ScheduleConfigBase):
    pass


class ScheduleConfigUpdate(BaseModel):
    label: Optional[str] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    interval_minutes: Optional[int] = Field(default=None, ge=5, le=120)
    slot_capacity: Optional[int] = Field(default=None, ge=1, le=8)
    is_active: Optional[bool] = None


class ScheduleConfigOut(ScheduleConfigBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    generated_times: List[str] = []


class SettingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    key: str
    value: str
    description: Optional[str]
