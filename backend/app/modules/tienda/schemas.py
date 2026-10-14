from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ------------------------------------------------------------------ productos
class ProductoIn(BaseModel):
    codigo: Optional[str] = Field(default=None, max_length=40)
    descripcion: str = Field(min_length=2, max_length=255)
    categoria: str = Field(min_length=2, max_length=40)
    marca: Optional[str] = Field(default=None, max_length=80)
    talla: Optional[str] = Field(default=None, max_length=60)
    costo: Decimal = Field(ge=0)
    precio: Optional[Decimal] = Field(default=None, ge=0)
    minimo: int = Field(default=0, ge=0)
    existencia_inicial: int = Field(default=0, ge=0)


class ProductoUpdate(BaseModel):
    codigo: Optional[str] = Field(default=None, max_length=40)
    descripcion: Optional[str] = Field(default=None, min_length=2, max_length=255)
    categoria: Optional[str] = Field(default=None, min_length=2, max_length=40)
    marca: Optional[str] = Field(default=None, max_length=80)
    talla: Optional[str] = Field(default=None, max_length=60)
    costo: Optional[Decimal] = Field(default=None, ge=0)
    precio: Optional[Decimal] = Field(default=None, ge=0)
    minimo: Optional[int] = Field(default=None, ge=0)
    activo: Optional[bool] = None


class ProductoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    codigo: str
    tiene_codigo_barras: bool
    descripcion: str
    categoria: str
    marca: Optional[str]
    talla: Optional[str]
    costo: Decimal
    precio: Optional[Decimal]
    existencia: int
    minimo: int
    activo: bool
    por_surtir: bool
    updated_at: Optional[datetime] = None


class PrecioMasivoIn(BaseModel):
    """Poner precio a muchos productos de un jalón: costo × (1 + margen)."""

    margen_pct: Decimal = Field(gt=0, le=1000)
    redondear_a: int = Field(default=10, ge=1, le=100)
    solo_sin_precio: bool = True
    categoria: Optional[str] = None


class MovimientoIn(BaseModel):
    tipo: Literal["ENTRADA", "AJUSTE"]
    # ENTRADA: piezas que llegaron. AJUSTE: lo que se contó en el anaquel.
    cantidad: int = Field(ge=0, le=100000)
    motivo: Optional[str] = Field(default=None, max_length=300)
    costo_unitario: Optional[Decimal] = Field(default=None, ge=0)
    atendio: str = Field(min_length=3, max_length=120)


class MovimientoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    producto_codigo: Optional[str] = None
    producto_descripcion: Optional[str] = None
    tipo: str
    cantidad: int
    existencia_despues: int
    motivo: Optional[str]
    costo_unitario: Optional[Decimal]
    venta_id: Optional[int]
    venta_folio: Optional[str] = None
    atendio: Optional[str]
    usuario_nombre: Optional[str] = None
    created_at: datetime


# ---------------------------------------------------------------------- corte
class FilaConteo(BaseModel):
    producto_id: int
    contado: int = Field(ge=0, le=100000)


class ConteoIn(BaseModel):
    filas: List[FilaConteo] = Field(min_length=1, max_length=5000)
    motivo: Optional[str] = Field(default=None, max_length=200)
    atendio: str = Field(min_length=3, max_length=120)


class AbrirCorteIn(BaseModel):
    fondo_inicial: Decimal = Field(ge=0, le=1000000)
    atendio: str = Field(min_length=3, max_length=120)


class CerrarCorteIn(BaseModel):
    efectivo_contado: Decimal = Field(ge=0, le=10000000)
    atendio: str = Field(min_length=3, max_length=120)
    notas: Optional[str] = Field(default=None, max_length=500)


class CorteOut(BaseModel):
    id: int
    fecha: date
    estado: str
    abierto_en: datetime
    abierto_por_nombre: str
    fondo_inicial: Decimal
    cerrado_en: Optional[datetime]
    cerrado_por_nombre: Optional[str]
    ventas_total: Decimal
    ventas_cuenta: int
    canceladas: int = 0
    efectivo_ventas: Decimal = Decimal("0")
    efectivo_esperado: Decimal
    tarjeta_total: Decimal
    transferencia_total: Decimal
    efectivo_contado: Optional[Decimal]
    diferencia: Optional[Decimal]
    utilidad: Decimal = Decimal("0")
    notas: Optional[str]


# --------------------------------------------------------------------- ventas
class LineaIn(BaseModel):
    producto_id: int
    cantidad: int = Field(ge=1, le=999)


class PagoIn(BaseModel):
    metodo: Literal["EFECTIVO", "TARJETA", "TRANSFERENCIA"]
    moneda: Literal["MXN", "USD"] = "MXN"
    monto: Decimal = Field(gt=0)
    referencia: Optional[str] = Field(default=None, max_length=80)


class VentaIn(BaseModel):
    lineas: List[LineaIn] = Field(min_length=1, max_length=100)
    pagos: List[PagoIn] = Field(min_length=1, max_length=6)
    descuento: Decimal = Field(default=Decimal("0"), ge=0)
    descuento_motivo: Optional[str] = Field(default=None, max_length=200)
    cliente: Optional[str] = Field(default=None, max_length=120)
    notas: Optional[str] = Field(default=None, max_length=300)
    atendio: str = Field(min_length=3, max_length=120)


class CancelarVentaIn(BaseModel):
    motivo: str = Field(min_length=3, max_length=300)
    atendio: str = Field(min_length=3, max_length=120)


class LineaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    codigo: str
    descripcion: str
    categoria: str
    cantidad: int
    precio_unitario: Decimal
    costo_unitario: Decimal
    total: Decimal


class PagoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    metodo: str
    moneda: str
    monto: Decimal
    tipo_cambio: Decimal
    monto_mxn: Decimal
    referencia: Optional[str]


class VentaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    folio: str
    corte_id: int
    fecha: date
    estado: str
    subtotal: Decimal
    descuento: Decimal
    descuento_motivo: Optional[str]
    total: Decimal
    costo_total: Decimal
    piezas: int
    cambio_mxn: Decimal
    tipo_cambio: Decimal
    cliente: Optional[str]
    notas: Optional[str]
    atendio: str
    created_at: datetime
    cancelada_en: Optional[datetime]
    cancelada_por: Optional[str]
    motivo_cancelacion: Optional[str]
    lineas: List[LineaOut] = []
    pagos: List[PagoOut] = []


# ------------------------------------------------------------------- reportes
class ResumenInventario(BaseModel):
    productos: int
    piezas: int
    valor_costo: Decimal
    valor_venta: Decimal
    por_surtir: int
    sin_existencia: int
    sin_precio: int
    sin_codigo: int
    categorias: List[str] = []
