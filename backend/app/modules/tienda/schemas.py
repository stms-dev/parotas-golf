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
    maximo: int = Field(default=0, ge=0)
    existencia_inicial: int = Field(default=0, ge=0)   # en tienda
    bodega_inicial: int = Field(default=0, ge=0)


class ProductoUpdate(BaseModel):
    codigo: Optional[str] = Field(default=None, max_length=40)
    descripcion: Optional[str] = Field(default=None, min_length=2, max_length=255)
    categoria: Optional[str] = Field(default=None, min_length=2, max_length=40)
    marca: Optional[str] = Field(default=None, max_length=80)
    talla: Optional[str] = Field(default=None, max_length=60)
    costo: Optional[Decimal] = Field(default=None, ge=0)
    precio: Optional[Decimal] = Field(default=None, ge=0)
    minimo: Optional[int] = Field(default=None, ge=0)
    maximo: Optional[int] = Field(default=None, ge=0)
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
    existencia_bodega: int
    existencia_total: int
    existencia_fisica: int = 0
    merma_total: int = 0
    minimo: int
    maximo: int
    activo: bool
    por_surtir: bool
    sobre_maximo: bool
    compra_sugerida: int
    pasar_a_tienda: bool
    updated_at: Optional[datetime] = None


class PrecioMasivoIn(BaseModel):
    """Poner precio a muchos productos de un jalón: costo × (1 + margen)."""

    margen_pct: Decimal = Field(gt=0, le=1000)
    redondear_a: int = Field(default=10, ge=1, le=100)
    solo_sin_precio: bool = True
    categoria: Optional[str] = None


class MovimientoIn(BaseModel):
    tipo: Literal["ENTRADA", "AJUSTE", "TRASPASO"]
    # ENTRADA: piezas que llegaron. AJUSTE: lo que se contó ahí.
    # TRASPASO: piezas que se mueven HACIA `ubicacion` desde el otro lugar.
    ubicacion: Literal["TIENDA", "BODEGA"] = "TIENDA"
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
    ubicacion: str = "TIENDA"
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
    ubicacion: Literal["TIENDA", "BODEGA"] = "TIENDA"


class ConteoIn(BaseModel):
    filas: List[FilaConteo] = Field(min_length=1, max_length=5000)
    motivo: Optional[str] = Field(default=None, max_length=200)
    atendio: str = Field(min_length=3, max_length=120)


class AbrirCorteIn(BaseModel):
    fondo_inicial: Decimal = Field(ge=0, le=1000000)
    atendio: str = Field(min_length=3, max_length=120)


class FondoIn(BaseModel):
    fondo_inicial: Decimal = Field(ge=0, le=1000000)


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
    pendiente_arqueo: bool = False


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


class ArqueoIn(BaseModel):
    """Contar el efectivo de un corte que se cerró solo a la hora de cierre."""

    efectivo_contado: Decimal = Field(ge=0, le=10000000)
    atendio: str = Field(min_length=3, max_length=120)
    notas: Optional[str] = Field(default=None, max_length=500)


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
    iva_pct: Decimal = Decimal("0")
    iva_monto: Decimal = Decimal("0")
    total_neto: Optional[Decimal] = None
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
    piezas_tienda: int = 0
    piezas_bodega: int = 0
    piezas_merma: int = 0
    pasar_a_tienda: int = 0
    sobre_maximo: int = 0
    valor_costo: Decimal
    valor_venta: Decimal
    por_surtir: int
    sin_existencia: int
    sin_precio: int
    sin_codigo: int
    iva_pct: Decimal = Decimal("16")
    categorias: List[str] = []


# ---------------------------------------------------------------------- merma
class MermaIn(BaseModel):
    producto_id: int
    cantidad: int = Field(ge=1, le=100000)
    # Opcional: sin lugar sale primero de tienda y luego de bodega.
    ubicacion: Optional[Literal["TIENDA", "BODEGA"]] = None
    motivo_tipo: Literal["DANADO", "CADUCADO", "ROBO", "MUESTRA", "OTRO"]
    justificacion: str = Field(min_length=5, max_length=500)
    atendio: str = Field(min_length=3, max_length=120)
    # Foto o PDF en base64 (con o sin el encabezado data:...). Máximo 3 MB.
    evidencia_base64: Optional[str] = Field(default=None, max_length=5_000_000)
    evidencia_nombre: Optional[str] = Field(default=None, max_length=120)


class MermaNotaIn(BaseModel):
    nota: Optional[str] = Field(default=None, max_length=300)


class MermaMotivoIn(BaseModel):
    nota: str = Field(min_length=3, max_length=300)


class MermaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    folio: str
    producto_id: int
    producto_codigo: Optional[str] = None
    producto_descripcion: Optional[str] = None
    cantidad: int
    ubicacion: Optional[str]
    motivo_tipo: str
    motivo_nombre: Optional[str] = None
    justificacion: str
    estado: str
    solicito_nombre: str
    created_at: datetime
    resolvio_nombre: Optional[str]
    resuelta_en: Optional[datetime]
    nota_resolucion: Optional[str]
    de_tienda: int = 0
    de_bodega: int = 0
    costo_unitario: Optional[Decimal] = None
    costo_total: Optional[Decimal] = None
    tiene_evidencia: bool = False
