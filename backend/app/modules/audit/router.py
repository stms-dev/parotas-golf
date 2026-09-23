"""Endpoints de auditoría y tablero operativo."""
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import RequirePermission, get_current_user, get_hotel_scope
from app.core.permissions import Permission
from app.modules.audit.service import AuditService
from app.modules.billing.models import pagos_de_la_reserva
from app.modules.booking.models import Reservation, ReservationPlayer, TeeSlot
from app.modules.booking.service import AvailabilityService
from app.modules.catalog.service import ExchangeRateService
from app.modules.identity.models import User
from app.shared.enums import AuditAction, ReservationStatus, SlotStatus
from app.shared.money import ZERO, money

router = APIRouter(prefix="/audit", tags=["Auditoría"])
dashboard_router = APIRouter(prefix="/dashboard", tags=["Tablero"])


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_name: Optional[str]
    action: AuditAction
    module: str
    entity: str
    entity_id: Optional[int]
    field: Optional[str]
    old_value: Optional[str]
    new_value: Optional[str]
    description: Optional[str]
    created_at: datetime


@router.get("", response_model=List[AuditLogOut])
def list_audit(
    module: Optional[str] = None,
    action: Optional[AuditAction] = None,
    entity_id: Optional[int] = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.AUDIT_VIEW)),
):
    return AuditService(db).list(
        module=module, action=action, entity_id=entity_id, limit=limit, offset=offset
    )


# ------------------------------------------------------------------- tablero
class PGAMetrics(BaseModel):
    players_with_benefit: int = 0
    reservations_with_pga: int = 0
    total_pga_discounts: Decimal = Decimal("0.00")


class DashboardOut(BaseModel):
    target_date: date
    exchange_rate: Decimal

    reservations_today: int = 0
    players_scheduled: int = 0
    players_on_course: int = 0

    pending: int = 0
    confirmed: int = 0
    checked_in: int = 0
    in_progress: int = 0
    completed: int = 0
    cancelled: int = 0
    no_show: int = 0

    slots_total: int = 0
    slots_available: int = 0
    slots_occupied: int = 0
    slots_blocked: int = 0
    occupancy_percent: float = 0.0
    # Minutos que dura una partida en promedio, del pago al cierre.
    avg_round_minutes: Optional[int] = None
    rounds_measured: int = 0

    gross_sales_today: Decimal = Decimal("0.00")
    collected_today: Decimal = Decimal("0.00")
    pending_collection: Decimal = Decimal("0.00")

    pga: PGAMetrics = PGAMetrics()


@dashboard_router.get("", response_model=DashboardOut)
def dashboard(
    target: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    target = target or date.today()

    slots = AvailabilityService(db).day(target)
    slots_available = sum(1 for s in slots if s.status == SlotStatus.DISPONIBLE)
    slots_occupied = sum(1 for s in slots if s.status == SlotStatus.OCUPADO)
    slots_blocked = sum(1 for s in slots if s.status == SlotStatus.BLOQUEADO)

    capacity = sum(s.capacity for s in slots) or 1
    committed = sum(s.occupied for s in slots)

    stmt = (
        select(Reservation)
        .join(TeeSlot, Reservation.tee_slot_id == TeeSlot.id)
        .where(TeeSlot.slot_date == target)
    )
    if scope is not None:
        stmt = stmt.where(Reservation.hotel_id == scope)
    reservations = list(db.execute(stmt).scalars().unique().all())

    counts = {status: 0 for status in ReservationStatus}
    gross = collected = ZERO
    players_scheduled = players_on_course = 0
    pga_players = pga_reservations = 0
    pga_total = ZERO

    for reservation in reservations:
        counts[reservation.status] += 1
        if reservation.status in (ReservationStatus.CANCELADA, ReservationStatus.NO_SHOW):
            continue

        gross += money(reservation.total)
        collected += money(
            sum((p.neto_mxn for p in pagos_de_la_reserva(reservation)), start=ZERO)
        )
        players_scheduled += len(reservation.players)
        if reservation.status == ReservationStatus.EN_JUEGO:
            players_on_course += sum(1 for p in reservation.players if p.arrived)

        with_pga = [p for p in reservation.players if p.pga_validated]
        if with_pga:
            pga_reservations += 1
            pga_players += len(with_pga)
            pga_total += money(sum((money(p.pga_discount_applied) for p in with_pga), start=ZERO))

    # Cuánto dura una partida: del pago (cuando sale al campo) al cierre.
    duraciones = [
        (r.completed_at - r.round_started_at).total_seconds() / 60
        for r in reservations
        if r.round_started_at and r.completed_at and r.completed_at > r.round_started_at
    ]
    minutos_promedio = round(sum(duraciones) / len(duraciones)) if duraciones else None

    try:
        exchange_rate = ExchangeRateService(db).current_rate()
    except Exception:
        exchange_rate = Decimal("0.0000")

    if scope is not None:
        # El hotel cuenta con sus cuatro estados, igual que en su lista.
        S = ReservationStatus
        counts = {
            **{k: 0 for k in counts},
            S.PENDIENTE: counts[S.PENDIENTE] + counts[S.CONFIRMADA] + counts[S.CHECK_IN],
            S.CONFIRMADA: counts[S.EN_JUEGO] + counts[S.COMPLETADA],
            S.CANCELADA: counts[S.CANCELADA],
            S.NO_SHOW: counts[S.NO_SHOW],
        }
        players_on_course = 0

    return DashboardOut(
        target_date=target,
        exchange_rate=exchange_rate,
        reservations_today=len(reservations),
        players_scheduled=players_scheduled,
        players_on_course=players_on_course,
        pending=counts[ReservationStatus.PENDIENTE],
        confirmed=counts[ReservationStatus.CONFIRMADA],
        checked_in=counts[ReservationStatus.CHECK_IN],
        in_progress=counts[ReservationStatus.EN_JUEGO],
        completed=counts[ReservationStatus.COMPLETADA],
        cancelled=counts[ReservationStatus.CANCELADA],
        no_show=counts[ReservationStatus.NO_SHOW],
        slots_total=len(slots),
        slots_available=slots_available,
        slots_occupied=slots_occupied,
        slots_blocked=slots_blocked,
        occupancy_percent=round(committed / capacity * 100, 1),
        avg_round_minutes=minutos_promedio,
        rounds_measured=len(duraciones),
        gross_sales_today=money(gross),
        collected_today=money(collected),
        pending_collection=money(gross - collected),
        pga=PGAMetrics(
            players_with_benefit=pga_players,
            reservations_with_pga=pga_reservations,
            total_pga_discounts=money(pga_total),
        ),
    )
