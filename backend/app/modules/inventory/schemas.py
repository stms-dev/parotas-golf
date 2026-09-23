from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ItemCreate(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    description: str = Field(min_length=3, max_length=255)
    category: str = Field(min_length=2, max_length=40)
    brand: Optional[str] = None
    size: Optional[str] = None
    purchase_price: Decimal = Field(ge=0)
    sale_price: Optional[Decimal] = Field(default=None, ge=0)
    min_stock: int = Field(default=0, ge=0)


class ItemUpdate(BaseModel):
    description: Optional[str] = Field(default=None, min_length=3, max_length=255)
    category: Optional[str] = None
    brand: Optional[str] = None
    size: Optional[str] = None
    purchase_price: Optional[Decimal] = Field(default=None, ge=0)
    sale_price: Optional[Decimal] = Field(default=None, ge=0)
    min_stock: Optional[int] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    has_barcode: bool
    description: str
    category: str
    brand: Optional[str]
    size: Optional[str]
    purchase_price: Decimal
    sale_price: Optional[Decimal]
    stock: int
    min_stock: int
    is_active: bool
    por_surtir: bool = False


class MovementIn(BaseModel):
    kind: Literal["ENTRADA", "SALIDA", "AJUSTE"]
    # En ENTRADA y SALIDA, cuántas piezas; en AJUSTE, cuántas se contaron.
    quantity: int = Field(ge=0, le=100000)
    reason: Optional[str] = Field(default=None, max_length=300)


class MovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    quantity: int
    stock_after: int
    reason: Optional[str]
    user_name: Optional[str] = None
    created_at: datetime


class InventorySummary(BaseModel):
    productos: int
    piezas: int
    valor_costo: Decimal
    valor_venta: Decimal
    por_surtir: int
    sin_existencia: int
    sin_codigo: int
    sin_precio_venta: int
