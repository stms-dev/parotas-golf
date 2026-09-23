"""Reglas del inventario."""
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.modules.audit.service import AuditService
from app.modules.identity.models import User
from app.modules.inventory.models import InventoryItem, InventoryMovement
from app.shared.enums import AuditAction
from app.shared.money import ZERO, money


def por_surtir(item: InventoryItem) -> bool:
    """Hay que pedir más: se llegó al mínimo, o se acabó teniendo mínimo."""
    return item.min_stock > 0 and item.stock <= item.min_stock


class InventoryService:
    MODULE = "inventory"

    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    # ---------------------------------------------------------------- consulta
    def list(
        self,
        *,
        term: Optional[str] = None,
        category: Optional[str] = None,
        solo_por_surtir: bool = False,
        incluir_inactivos: bool = False,
    ) -> List[InventoryItem]:
        stmt = select(InventoryItem)
        if not incluir_inactivos:
            stmt = stmt.where(InventoryItem.is_active.is_(True))
        if category:
            stmt = stmt.where(InventoryItem.category == category)
        if term and term.strip():
            patron = f"%{term.strip()}%"
            stmt = stmt.where(
                or_(
                    InventoryItem.code.ilike(patron),
                    InventoryItem.description.ilike(patron),
                    InventoryItem.brand.ilike(patron),
                )
            )
        items = list(
            self.db.execute(stmt.order_by(InventoryItem.category, InventoryItem.description))
            .scalars()
            .all()
        )
        if solo_por_surtir:
            items = [i for i in items if por_surtir(i)]
        return items

    def get(self, item_id: int) -> InventoryItem:
        item = self.db.get(InventoryItem, item_id)
        if not item:
            raise NotFoundError(f"Producto {item_id} no encontrado")
        return item

    def by_code(self, code: str) -> Optional[InventoryItem]:
        return self.db.execute(
            select(InventoryItem).where(InventoryItem.code == code.strip())
        ).scalar_one_or_none()

    def summary(self) -> dict:
        items = self.list()
        return {
            "productos": len(items),
            "piezas": sum(i.stock for i in items),
            "valor_costo": money(sum((money(i.purchase_price) * i.stock for i in items), start=ZERO)),
            "valor_venta": money(
                sum((money(i.sale_price or 0) * i.stock for i in items), start=ZERO)
            ),
            "por_surtir": sum(1 for i in items if por_surtir(i)),
            "sin_existencia": sum(1 for i in items if i.stock == 0),
            "sin_codigo": sum(1 for i in items if not i.has_barcode),
            "sin_precio_venta": sum(1 for i in items if i.sale_price is None),
        }

    # ------------------------------------------------------------- catálogo
    def create(self, data: dict, actor: User) -> InventoryItem:
        code = data["code"].strip()
        if self.by_code(code):
            raise ConflictError(f"Ya existe un producto con el código {code}")
        item = InventoryItem(
            code=code,
            has_barcode=not code.upper().startswith("INT-"),
            description=" ".join(data["description"].split()),
            category=data["category"].strip(),
            brand=(data.get("brand") or None),
            size=(data.get("size") or None),
            purchase_price=money(data["purchase_price"]),
            sale_price=money(data["sale_price"]) if data.get("sale_price") is not None else None,
            min_stock=data.get("min_stock") or 0,
            stock=0,
        )
        self.db.add(item)
        self.db.flush()
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module=self.MODULE,
            entity="InventoryItem", entity_id=item.id,
            description=f"Alta de producto {item.code} · {item.description}",
        )
        self.db.commit()
        self.db.refresh(item)
        return item

    def update(self, item_id: int, data: dict, actor: User) -> InventoryItem:
        item = self.get(item_id)
        for field, value in data.items():
            old = getattr(item, field)
            if field in ("purchase_price", "sale_price") and value is not None:
                value = money(value)
            if old == value:
                continue
            setattr(item, field, value)
            # Los precios se auditan: con ellos se calcula cuánto vale la tienda.
            self.audit.log(
                user=actor, action=AuditAction.MODIFICAR, module=self.MODULE,
                entity="InventoryItem", entity_id=item.id, field=field,
                old_value=None if old is None else str(old),
                new_value=None if value is None else str(value),
            )
        self.db.commit()
        self.db.refresh(item)
        return item

    # ----------------------------------------------------------- movimientos
    def move(self, item_id: int, kind: str, quantity: int, reason: Optional[str],
             actor: User) -> InventoryItem:
        item = self.get(item_id)
        antes = item.stock

        if kind == "ENTRADA":
            if quantity <= 0:
                raise BusinessRuleError("Indique cuántas piezas entraron")
            despues, delta = antes + quantity, quantity
        elif kind == "SALIDA":
            if quantity <= 0:
                raise BusinessRuleError("Indique cuántas piezas salieron")
            # No se vende lo que no hay: una existencia negativa esconde un
            # error de captura o una entrada que nadie registró.
            if quantity > antes:
                raise BusinessRuleError(
                    f"Solo hay {antes} pieza{'s' if antes != 1 else ''} de {item.code}. "
                    "Registre primero la entrada o haga un ajuste por conteo."
                )
            despues, delta = antes - quantity, -quantity
        else:  # AJUSTE: la cantidad es lo que se contó en el anaquel
            despues, delta = quantity, quantity - antes
            if delta == 0:
                raise BusinessRuleError("El conteo coincide con lo registrado; no hay nada que ajustar")
            if not (reason or "").strip():
                raise BusinessRuleError("Un ajuste por conteo necesita el motivo")

        item.stock = despues
        self.db.add(
            InventoryMovement(
                item_id=item.id, kind=kind, quantity=delta, stock_after=despues,
                reason=(reason or "").strip() or None, user_id=actor.id,
            )
        )
        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=self.MODULE,
            entity="InventoryItem", entity_id=item.id, field="stock",
            old_value=str(antes), new_value=str(despues),
            description=f"{kind.title()} de {abs(delta)} · {item.code}"
                        + (f" · {reason.strip()}" if reason and reason.strip() else ""),
        )
        self.db.commit()
        self.db.refresh(item)
        return item

    def movements(self, item_id: int, limit: int = 50) -> List[InventoryMovement]:
        self.get(item_id)
        stmt = (
            select(InventoryMovement)
            .where(InventoryMovement.item_id == item_id)
            .order_by(InventoryMovement.id.desc())
            .limit(limit)
        )
        return list(self.db.execute(stmt).scalars().all())
