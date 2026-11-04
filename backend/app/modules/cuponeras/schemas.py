from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Bloqueo(BaseModel):
    desde: date
    hasta: date
    motivo: Optional[str] = Field(default=None, max_length=80)


class CuponeraIn(BaseModel):
    titular_nombre: str = Field(min_length=3, max_length=180)
    empresa: Optional[str] = Field(default=None, max_length=180)
    telefono: Optional[str] = Field(default=None, max_length=40)
    correo: Optional[str] = Field(default=None, max_length=180)
    pases_total: int = Field(ge=1, le=5000)
    hoyos_18: bool = True
    hoyos_9: bool = False
    precio_total: Decimal = Field(ge=0, le=100_000_000)
    precio_lista: Optional[Decimal] = Field(default=None, ge=0, le=100_000_000)
    vence_el: date
    fechas_bloqueadas: List[Bloqueo] = []
    notas: Optional[str] = Field(default=None, max_length=500)
    # Si ya llegó la transferencia al registrarla.
    pagada: bool = False
    pago_referencia: Optional[str] = Field(default=None, max_length=120)


class CuponeraUpdate(BaseModel):
    """Lo que solo cambia la Administración."""

    titular_nombre: Optional[str] = Field(default=None, min_length=3, max_length=180)
    empresa: Optional[str] = Field(default=None, max_length=180)
    telefono: Optional[str] = Field(default=None, max_length=40)
    correo: Optional[str] = Field(default=None, max_length=180)
    pases_total: Optional[int] = Field(default=None, ge=1, le=5000)
    hoyos_18: Optional[bool] = None
    hoyos_9: Optional[bool] = None
    precio_total: Optional[Decimal] = Field(default=None, ge=0, le=100_000_000)
    precio_lista: Optional[Decimal] = Field(default=None, ge=0, le=100_000_000)
    vence_el: Optional[date] = None
    fechas_bloqueadas: Optional[List[Bloqueo]] = None
    notas: Optional[str] = Field(default=None, max_length=500)
    nota_cambio: str = Field(min_length=3, max_length=300)


class PagoIn(BaseModel):
    referencia: str = Field(min_length=3, max_length=120)


class NotaIn(BaseModel):
    nota: str = Field(min_length=3, max_length=300)


class CanjeIn(BaseModel):
    jugadores: int = Field(ge=1, le=100)
    hoyos: Literal[9, 18]
    atendio: str = Field(min_length=3, max_length=120)
    reserva_folio: Optional[str] = Field(default=None, max_length=32)
    nota: Optional[str] = Field(default=None, max_length=300)


class UsoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    fecha: date
    jugadores: int
    hoyos: int
    reserva_folio: Optional[str]
    nota: Optional[str]
    validado_por_nombre: str
    created_at: datetime
    anulado: bool
    anulado_en: Optional[datetime]
    anulado_por: Optional[str]
    anulado_nota: Optional[str]


class CuponeraOut(BaseModel):
    """Vista completa (Administración y Operaciones): con precio y pago."""

    id: int
    folio: str
    titular_nombre: str
    empresa: Optional[str]
    telefono: Optional[str]
    correo: Optional[str]
    pases_total: int
    pases_usados: int
    saldo: int
    hoyos_18: bool
    hoyos_9: bool
    precio_total: Decimal
    precio_lista: Optional[Decimal]
    descuento_pct: Optional[Decimal]
    precio_por_pase: Decimal
    vence_el: date
    fechas_bloqueadas: List[Bloqueo]
    pago_estado: str
    pago_referencia: Optional[str]
    pagada_en: Optional[datetime]
    pago_confirmo_nombre: Optional[str]
    cancelada: bool
    cancelada_en: Optional[datetime]
    cancelada_por: Optional[str]
    cancelada_nota: Optional[str]
    notas: Optional[str]
    creada_por_nombre: Optional[str]
    created_at: datetime
    estado: str
    usos: List[UsoOut] = []


class CuponeraMostrador(BaseModel):
    """Vista del mostrador: lo necesario para dejar pasar, sin precios ni pago."""

    id: int
    folio: str
    titular_nombre: str
    empresa: Optional[str]
    pases_total: int
    pases_usados: int
    saldo: int
    hoyos_18: bool
    hoyos_9: bool
    vence_el: date
    fechas_bloqueadas: List[Bloqueo]
    estado: str
    # Por qué no se puede canjear hoy (vacío si sí se puede).
    motivo_bloqueo: Optional[str]
    usos: List[UsoOut] = []
