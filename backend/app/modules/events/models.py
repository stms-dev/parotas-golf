"""Eventos y bloqueos. Afectan la disponibilidad del calendario."""
from datetime import date, datetime, time
from typing import List, Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.shared.enums import EventType


class CourseEvent(Base):
    __tablename__ = "course_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    event_type: Mapped[EventType] = mapped_column(String(32), nullable=False, index=True)

    event_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    tee: Mapped[str] = mapped_column(String(24), default="CAMPO", nullable=False)

    estimated_players: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    blocks_availability: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False,
        comment="Si es True, las franjas del rango quedan BLOQUEADAS",
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    slots: Mapped[List["TeeSlot"]] = relationship(back_populates="event")
    created_by = relationship("User", lazy="joined")
