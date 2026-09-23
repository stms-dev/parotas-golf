from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import RequirePermission
from app.core.permissions import Permission
from app.modules.identity.models import User
from app.modules.inventory.schemas import (
    InventorySummary,
    ItemCreate,
    ItemOut,
    ItemUpdate,
    MovementIn,
    MovementOut,
)
from app.modules.inventory.service import InventoryService, por_surtir

router = APIRouter(prefix="/inventory", tags=["Inventario"])


def _out(item) -> ItemOut:
    out = ItemOut.model_validate(item)
    out.por_surtir = por_surtir(item)
    return out


@router.get("/items", response_model=List[ItemOut])
def list_items(
    term: Optional[str] = None,
    category: Optional[str] = None,
    por_surtir_solo: bool = Query(default=False, alias="por_surtir"),
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.INVENTORY_VIEW)),
):
    return [
        _out(i)
        for i in InventoryService(db).list(term=term, category=category, solo_por_surtir=por_surtir_solo)
    ]


@router.get("/summary", response_model=InventorySummary)
def summary(
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.INVENTORY_VIEW)),
):
    return InventorySummary(**InventoryService(db).summary())


@router.post("/items", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
def create_item(
    payload: ItemCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.INVENTORY_MANAGE)),
):
    return _out(InventoryService(db).create(payload.model_dump(), actor))


@router.patch("/items/{item_id}", response_model=ItemOut)
def update_item(
    item_id: int,
    payload: ItemUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.INVENTORY_MANAGE)),
):
    return _out(InventoryService(db).update(item_id, payload.model_dump(exclude_unset=True), actor))


@router.post("/items/{item_id}/movements", response_model=ItemOut)
def move(
    item_id: int,
    payload: MovementIn,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.INVENTORY_MANAGE)),
):
    return _out(InventoryService(db).move(item_id, payload.kind, payload.quantity, payload.reason, actor))


@router.get("/items/{item_id}/movements", response_model=List[MovementOut])
def movements(
    item_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.INVENTORY_VIEW)),
):
    salida = []
    for m in InventoryService(db).movements(item_id):
        o = MovementOut.model_validate(m)
        o.user_name = m.user.full_name if m.user else None
        salida.append(o)
    return salida
