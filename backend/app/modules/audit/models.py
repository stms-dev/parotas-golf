"""Bitácora de auditoría. Transversal a todos los módulos."""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.shared.enums import AuditAction


class AuditLog(Base):
    """Se escribe desde la capa de servicio, nunca desde el router.

    Así ningún endpoint nuevo puede saltarse la auditoría por olvido.
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    user_name: Mapped[Optional[str]] = mapped_column(
        String(180), nullable=True,
        comment="Nombre copiado: si el usuario se borra, la bitácora sigue diciendo quién fue",
    )

    action: Mapped[AuditAction] = mapped_column(String(32), nullable=False, index=True)
    module: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    entity: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)

    field: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    old_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    new_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )

    user = relationship("User", lazy="joined")
