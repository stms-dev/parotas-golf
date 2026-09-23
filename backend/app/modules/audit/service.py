"""Servicio de auditoría. Lo usan todos los demás módulos."""
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.identity.models import User
from app.shared.enums import AuditAction


class AuditService:
    def __init__(self, db: Session):
        self.db = db

    def log(
        self,
        *,
        user: Optional[User],
        action: AuditAction,
        module: str,
        entity: str,
        entity_id: Optional[int] = None,
        field: Optional[str] = None,
        old_value: Optional[Any] = None,
        new_value: Optional[Any] = None,
        description: Optional[str] = None,
        ip_address: Optional[str] = None,
        commit: bool = False,
    ) -> AuditLog:
        """Registra un cambio.

        Por defecto NO hace commit: la bitácora viaja en la misma transacción
        que la operación auditada. Si la operación falla, no queda un registro
        de auditoría de algo que nunca pasó.
        """
        entry = AuditLog(
            user_id=user.id if user else None,
            user_name=user.full_name if user else None,
            action=action,
            module=module,
            entity=entity,
            entity_id=entity_id,
            field=field,
            old_value=str(old_value) if old_value is not None else None,
            new_value=str(new_value) if new_value is not None else None,
            description=description,
            ip_address=ip_address,
        )
        self.db.add(entry)
        if commit:
            self.db.commit()
        else:
            self.db.flush()
        return entry

    def list(
        self,
        *,
        module: Optional[str] = None,
        action: Optional[AuditAction] = None,
        user_id: Optional[int] = None,
        entity_id: Optional[int] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AuditLog]:
        stmt = select(AuditLog)
        if module:
            stmt = stmt.where(AuditLog.module == module)
        if action:
            stmt = stmt.where(AuditLog.action == action)
        if user_id:
            stmt = stmt.where(AuditLog.user_id == user_id)
        if entity_id:
            stmt = stmt.where(AuditLog.entity_id == entity_id)
        stmt = stmt.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
        return list(self.db.execute(stmt).scalars().all())
