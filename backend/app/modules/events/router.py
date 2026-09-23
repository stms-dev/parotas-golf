"""Endpoints de eventos y bloqueos."""
from datetime import date, datetime, time
from typing import List, Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import RequirePermission, get_current_user
from app.core.permissions import Permission
from app.modules.events.service import EventService
from app.modules.identity.models import User
from app.shared.enums import EventType

router = APIRouter(prefix="/events", tags=["Eventos y Bloqueos"])


class EventCreate(BaseModel):
    name: str = Field(min_length=3, max_length=180)
    description: Optional[str] = None
    event_type: EventType
    event_date: date
    start_time: time
    end_time: time
    tee: str = "CAMPO"
    estimated_players: Optional[int] = Field(default=None, ge=1)
    blocks_availability: bool = True


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    event_type: EventType
    event_date: date
    start_time: time
    end_time: time
    tee: str
    estimated_players: Optional[int]
    blocks_availability: bool
    is_active: bool
    created_at: datetime


@router.get("", response_model=List[EventOut])
def list_events(
    start: Optional[date] = None,
    end: Optional[date] = None,
    active_only: bool = True,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return EventService(db).list(start=start, end=end, active_only=active_only)


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.EVENT_MANAGE)),
):
    return EventService(db).create(payload.model_dump(), actor)


@router.post("/{event_id}/release", response_model=EventOut)
def release_event(
    event_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.EVENT_MANAGE)),
):
    return EventService(db).release(event_id, actor)
