"""Inventario del Pro-Shop.

La existencia de cada producto no se escribe a mano: sale de sumar sus
movimientos. Cada entrada, salida o ajuste queda registrado con quién lo hizo
y por qué, de modo que si el conteo físico no cuadra se puede rastrear.
"""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.shared.money import DecimalMoney


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    # El código de barras, o uno interno (INT-001) si el producto no lo trae.
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    has_barcode: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    description: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    brand: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    size: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)

    purchase_price: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    # Opcional: la lista trae el costo, el precio de venta lo pone el club.
    sale_price: Mapped[Optional[Decimal]] = mapped_column(DecimalMoney, nullable=True)

    stock: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Debajo de esta cantidad el producto aparece como "por surtir".
    min_stock: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    movements: Mapped[List["InventoryMovement"]] = relationship(
        back_populates="item", order_by="InventoryMovement.id.desc()"
    )


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("inventory_items.id"), nullable=False, index=True)
    # ENTRADA suma, SALIDA resta, AJUSTE deja la existencia en un conteo físico.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    # Con signo: +5 entró, -2 salió. En un ajuste es la diferencia contra lo que había.
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    stock_after: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    item: Mapped[InventoryItem] = relationship(back_populates="movements")
    user = relationship("User")
