"""Cuponeras: paquetes de Green Fees pagados por adelantado.

El cliente compra, por ejemplo, 50 Green Fees de una vez (por transferencia) y
los usa cuando quiera mientras la cuponera siga vigente. Cada visita **canjea**
tantos pases como jugadores lleguen; el saldo baja y queda el historial.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.shared.money import DecimalMoney


class Cuponera(Base):
    __tablename__ = "cuponeras"

    id: Mapped[int] = mapped_column(primary_key=True)
    # CUP-0007: es lo que lleva el código de barras.
    folio: Mapped[str] = mapped_column(String(16), unique=True, index=True, nullable=False)

    titular_nombre: Mapped[str] = mapped_column(String(180), nullable=False, index=True)
    empresa: Mapped[Optional[str]] = mapped_column(String(180), nullable=True)
    telefono: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    correo: Mapped[Optional[str]] = mapped_column(String(180), nullable=True)

    pases_total: Mapped[int] = mapped_column(Integer, nullable=False)
    pases_usados: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Qué rondas vale cada pase. Cada jugador gasta un pase sea de 9 o de 18.
    hoyos_18: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    hoyos_9: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")

    precio_total: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    # Lo que costarían los mismos pases a tarifa normal, para enseñar el descuento.
    precio_lista: Mapped[Optional[Decimal]] = mapped_column(DecimalMoney, nullable=True)

    vence_el: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # JSON: [{"desde": "2026-12-24", "hasta": "2026-12-26", "motivo": "Navidad"}]
    fechas_bloqueadas: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Se paga por transferencia: PENDIENTE hasta que se confirma.
    pago_estado: Mapped[str] = mapped_column(String(12), nullable=False, default="PENDIENTE", server_default="PENDIENTE")
    pago_referencia: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    pagada_en: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    pago_confirmo_nombre: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    pago_confirmo_usuario_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    cancelada: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    cancelada_en: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    cancelada_por: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    cancelada_nota: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    notas: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    creada_por_nombre: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    creada_por_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    usos: Mapped[List["CuponeraUso"]] = relationship(
        back_populates="cuponera", order_by="CuponeraUso.id.desc()", cascade="all, delete-orphan"
    )

    @property
    def saldo(self) -> int:
        return max(0, self.pases_total - self.pases_usados)


class CuponeraUso(Base):
    """Una visita: cuántos jugadores entraron con la cuponera ese día."""

    __tablename__ = "cuponera_usos"

    id: Mapped[int] = mapped_column(primary_key=True)
    cuponera_id: Mapped[int] = mapped_column(ForeignKey("cuponeras.id", ondelete="CASCADE"), index=True, nullable=False)
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    jugadores: Mapped[int] = mapped_column(Integer, nullable=False)
    hoyos: Mapped[int] = mapped_column(Integer, nullable=False)
    # Folio de la reserva con la que llegaron, si la hay. Solo de referencia.
    reserva_folio: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    nota: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    validado_por_nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    validado_por_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    # Si el canje cubrió una reserva, el cobro "CUPONERA" que dejó en su cuenta.
    payment_id: Mapped[Optional[int]] = mapped_column(ForeignKey("payments.id"), nullable=True)

    anulado: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    anulado_en: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    anulado_por: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    anulado_nota: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)

    cuponera: Mapped["Cuponera"] = relationship(back_populates="usos")
