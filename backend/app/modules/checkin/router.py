"""Endpoints de recepción y check-in."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import RequirePermission
from app.core.permissions import Permission
from app.modules.booking.service import ReservationService_
from app.modules.booking.schemas import PaymentOut, ReplayOut
from typing import List

from app.modules.checkin.schemas import (
    AccountSummary, CheckInRequest, CheckInResult, ReplayRequest, ReplaySlot,
)
from app.modules.checkin.service import CheckInService
from app.modules.identity.models import User

router = APIRouter(prefix="/checkin", tags=["Recepción y Check-In"])


@router.get("/lookup", response_model=AccountSummary)
def lookup(
    folio: Optional[str] = Query(default=None),
    qr_token: Optional[str] = Query(default=None),
    reservation_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.CHECKIN_PERFORM)),
):
    """Identificación en mostrador: por folio, por QR o por id.

    El pase QR es por partida: un solo escaneo trae la lista completa de
    jugadores para palomear quién llegó.
    """
    service = ReservationService_(db)
    if qr_token:
        reservation = service.get_by_qr(qr_token)
    elif folio:
        reservation = service.get_by_folio(folio)
    elif reservation_id:
        reservation = service.get(reservation_id)
    else:
        from app.core.exceptions import ValidationError
        raise ValidationError("Indique folio, qr_token o reservation_id")

    return AccountSummary(**CheckInService(db).account_summary(reservation))


@router.post("/{reservation_id}", response_model=CheckInResult)
def perform_checkin(
    reservation_id: int,
    payload: CheckInRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.CHECKIN_PERFORM)),
):
    """Cierra el check-in: llegadas, PGA, servicios y cobro en una transacción."""
    return CheckInResult(**CheckInService(db).perform(reservation_id, payload, actor))


@router.post("/{reservation_id}/replay", response_model=ReplayOut)
def replay(
    reservation_id: int,
    payload: ReplayRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.CHECKIN_PERFORM)),
):
    """Ronda extra: un segundo ticket del mismo folio, cobrado aparte."""
    ticket = CheckInService(db).replay(
        reservation_id, payload.tee_slot_id, payload.payments, actor,
        attended_by_name=payload.attended_by_name,
    )
    return ReplayOut(
        id=ticket.id, players_count=ticket.players_count, unit_price=ticket.unit_price,
        total=ticket.total, created_at=ticket.created_at, tee_slot_id=ticket.tee_slot_id,
        slot_time=ticket.tee_slot.slot_time if ticket.tee_slot else None,
        created_by_name=actor.full_name,
        payments=[PaymentOut.model_validate(p, from_attributes=True) for p in ticket.payments],
    )


@router.get("/{reservation_id}/replay-slots", response_model=List[ReplaySlot])
def replay_slots(
    reservation_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.CHECKIN_PERFORM)),
):
    """Salidas libres del mismo día, después de la partida, para el replay."""
    service = CheckInService(db)
    reservation = ReservationService_(db).get(reservation_id)
    return [
        ReplaySlot(id=s.id, slot_time=s.slot_time.strftime("%H:%M"), tee=s.tee)
        for s in service.salidas_para_replay(reservation)
    ]
