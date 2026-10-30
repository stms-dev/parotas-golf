"""Tienda (Pro-Shop): productos, inventario, ventas y su propia caja.

Es un mundo aparte del campo. No toca reservas, partidas, renta de bastones
ni hoteles: sus tablas llevan el prefijo `tienda_` y no se cruzan con las
demás. Si algún día se quiere llevar a otra base, se lleva tal cual.

Tres reglas mandan aquí:

1. **La existencia nunca se escribe a mano.** Cada entrada, venta, ajuste o
   cancelación deja un movimiento con quién lo hizo, y la existencia es la
   suma de esos movimientos.
2. **Una venta congela lo que costó.** El renglón guarda la descripción, el
   precio y el costo del momento: si mañana sube el precio, el ticket de hoy
   sigue diciendo lo que se cobró.
3. **La tienda tiene su caja.** Su corte se abre con un fondo y se cierra
   contando el efectivo; no se mezcla con la caja de green fees.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.shared.money import DecimalMoney, DecimalRate, money


class TiendaProducto(Base):
    __tablename__ = "tienda_productos"

    id: Mapped[int] = mapped_column(primary_key=True)
    # El código de barras, o uno interno (INT-001) si el producto no lo trae.
    codigo: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    tiene_codigo_barras: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    descripcion: Mapped[str] = mapped_column(String(255), nullable=False)
    categoria: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    marca: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    talla: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)

    costo: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    # Sin precio de venta no se puede vender: la lista inicial trae solo costo.
    precio: Mapped[Optional[Decimal]] = mapped_column(DecimalMoney, nullable=True)

    # Dos lugares: lo que está en el piso de venta (de ahí sale lo que se
    # vende) y lo que está guardado en bodega. Se pasa de uno a otro con un
    # TRASPASO, que queda en el kardex como cualquier otro movimiento.
    existencia: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # en tienda
    existencia_bodega: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # Mínimo y máximo sobre el total (tienda + bodega). Con el mínimo o menos
    # hay que comprar; la compra sugerida es lo que falta para el máximo.
    minimo: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    maximo: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    @property
    def existencia_total(self) -> int:
        return (self.existencia or 0) + (self.existencia_bodega or 0)

    @property
    def por_surtir(self) -> bool:
        """Toca comprar: el total llegó al mínimo."""
        return self.minimo > 0 and self.existencia_total <= self.minimo

    @property
    def sobre_maximo(self) -> bool:
        return self.maximo > 0 and self.existencia_total > self.maximo

    @property
    def compra_sugerida(self) -> int:
        """Piezas para volver al máximo (al mínimo + 1 si no hay máximo)."""
        if not self.por_surtir:
            return 0
        meta = self.maximo if self.maximo > self.minimo else self.minimo + 1
        return max(meta - self.existencia_total, 0)

    @property
    def pasar_a_tienda(self) -> bool:
        """El anaquel está vacío pero en bodega hay: hay que sacarlo."""
        return self.existencia <= 0 and (self.existencia_bodega or 0) > 0


class TiendaMovimiento(Base):
    """Cada cambio de existencia, con signo, en un lugar (TIENDA o BODEGA).

    ENTRADA, AJUSTE, TRASPASO, VENTA o CANCELACION. Un traspaso deja dos
    renglones: lo que sale de un lugar y lo que entra al otro.
    """

    __tablename__ = "tienda_movimientos"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("tienda_productos.id"), nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    ubicacion: Mapped[str] = mapped_column(String(8), default="TIENDA", server_default="TIENDA", nullable=False)
    cantidad: Mapped[int] = mapped_column(Integer, nullable=False)
    existencia_despues: Mapped[int] = mapped_column(Integer, nullable=False)
    motivo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Costo unitario de una entrada: sirve para saber a cuánto llegó el lote.
    costo_unitario: Mapped[Optional[Decimal]] = mapped_column(DecimalMoney, nullable=True)
    venta_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tienda_ventas.id"), nullable=True, index=True)
    usuario_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    atendio: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    producto: Mapped[TiendaProducto] = relationship()
    usuario = relationship("User")


class TiendaCorte(Base):
    """Turno de la caja de la tienda: se abre con un fondo y se cierra contando."""

    __tablename__ = "tienda_cortes"

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    estado: Mapped[str] = mapped_column(String(12), default="ABIERTO", nullable=False, index=True)

    abierto_en: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    abierto_por_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    abierto_por_nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    fondo_inicial: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)

    cerrado_en: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    cerrado_por_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    cerrado_por_nombre: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    # Lo que el sistema esperaba al cerrar, y lo que se contó.
    ventas_total: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    ventas_cuenta: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    efectivo_esperado: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    tarjeta_total: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    transferencia_total: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    efectivo_contado: Mapped[Optional[Decimal]] = mapped_column(DecimalMoney, nullable=True)
    diferencia: Mapped[Optional[Decimal]] = mapped_column(DecimalMoney, nullable=True)
    notas: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    ventas: Mapped[List["TiendaVenta"]] = relationship(back_populates="corte")


class TiendaVenta(Base):
    __tablename__ = "tienda_ventas"

    id: Mapped[int] = mapped_column(primary_key=True)
    folio: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    corte_id: Mapped[int] = mapped_column(ForeignKey("tienda_cortes.id"), nullable=False, index=True)
    # Día de la venta en la hora del campo: los reportes se cortan por aquí.
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    estado: Mapped[str] = mapped_column(String(12), default="PAGADA", nullable=False, index=True)

    subtotal: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    descuento: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    descuento_motivo: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    total: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    costo_total: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    piezas: Mapped[int] = mapped_column(Integer, nullable=False)
    cambio_mxn: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    tipo_cambio: Mapped[Decimal] = mapped_column(DecimalRate, nullable=False)
    # El precio de lista es el bruto (con IVA). Aquí queda el IVA que trae el
    # total de esta venta y la tasa con la que se sacó, para que un cambio de
    # tasa no mueva las ventas anteriores.
    iva_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"), nullable=False)
    iva_monto: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)

    @property
    def total_neto(self) -> Decimal:
        """Lo vendido sin el IVA."""
        return money(self.total - (self.iva_monto or 0))

    cliente: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    notas: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    atendio: Mapped[str] = mapped_column(String(120), nullable=False)
    usuario_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    cancelada_en: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    cancelada_por: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    motivo_cancelacion: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    corte: Mapped[TiendaCorte] = relationship(back_populates="ventas")
    lineas: Mapped[List["TiendaVentaLinea"]] = relationship(
        back_populates="venta", cascade="all, delete-orphan", order_by="TiendaVentaLinea.id"
    )
    pagos: Mapped[List["TiendaPago"]] = relationship(
        back_populates="venta", cascade="all, delete-orphan", order_by="TiendaPago.id"
    )


class TiendaVentaLinea(Base):
    __tablename__ = "tienda_venta_lineas"

    id: Mapped[int] = mapped_column(primary_key=True)
    venta_id: Mapped[int] = mapped_column(ForeignKey("tienda_ventas.id"), nullable=False, index=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("tienda_productos.id"), nullable=False, index=True)
    # Copia de cómo era el producto al venderse.
    codigo: Mapped[str] = mapped_column(String(40), nullable=False)
    descripcion: Mapped[str] = mapped_column(String(255), nullable=False)
    categoria: Mapped[str] = mapped_column(String(40), nullable=False)
    cantidad: Mapped[int] = mapped_column(Integer, nullable=False)
    precio_unitario: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    costo_unitario: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    total: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)

    venta: Mapped[TiendaVenta] = relationship(back_populates="lineas")


class TiendaPago(Base):
    __tablename__ = "tienda_pagos"

    id: Mapped[int] = mapped_column(primary_key=True)
    venta_id: Mapped[int] = mapped_column(ForeignKey("tienda_ventas.id"), nullable=False, index=True)
    metodo: Mapped[str] = mapped_column(String(16), nullable=False)
    moneda: Mapped[str] = mapped_column(String(3), nullable=False)
    monto: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    tipo_cambio: Mapped[Decimal] = mapped_column(DecimalRate, nullable=False)
    monto_mxn: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    referencia: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)

    venta: Mapped[TiendaVenta] = relationship(back_populates="pagos")
