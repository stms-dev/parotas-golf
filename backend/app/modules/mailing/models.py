"""Bandeja de salida de correos.

Cada correo que el sistema quiere mandar se escribe aquí antes de salir. Eso
resuelve la pregunta que siempre llega al mostrador —"¿le llegó el correo al
huésped?"— con un dato y no con una suposición: se ve a quién se mandó, si
salió, cuándo, y si falló, por qué.

También es lo que permite reintentar. Un SMTP que no contesta es lo más común
del mundo; sin esta tabla, ese correo se perdería en silencio.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.shared.enums import EmailStatus, EmailKind


class OutboxEmail(Base):
    __tablename__ = "outbox_emails"

    id: Mapped[int] = mapped_column(primary_key=True)

    kind: Mapped[EmailKind] = mapped_column(String(24), nullable=False, index=True)
    to_email: Mapped[str] = mapped_column(String(180), nullable=False)
    subject: Mapped[str] = mapped_column(String(240), nullable=False)

    reservation_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("reservations.id", ondelete="CASCADE"), nullable=True, index=True
    )

    status: Mapped[EmailStatus] = mapped_column(
        String(16), default=EmailStatus.PENDIENTE, nullable=False, index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    reservation = relationship("Reservation", lazy="joined")
