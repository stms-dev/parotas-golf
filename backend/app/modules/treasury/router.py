"""Endpoints de tesorería: caja, liquidaciones y resumen financiero."""
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import RequirePermission, get_current_user, get_hotel_scope
from app.core.permissions import Permission
from app.modules.billing.models import Payment
from app.modules.booking.models import Reservation, ReservationPlayer, TeeSlot
from app.modules.catalog.service import HotelService
from app.modules.identity.models import User
from app.modules.treasury.schemas import (
    CashSessionClose,
    CashSessionLive,
    CashSessionOpen,
    CashSessionOut,
    FinanceSummary,
    PGABenefitRow,
    SettlementOut,
    SettlementPreview,
)
from app.modules.treasury.service import CashSessionService, SettlementService
from app.shared.enums import ReservationStatus
from app.shared.money import ZERO, money

router = APIRouter(prefix="/treasury", tags=["Finanzas y Cierre"])


def _session_out(session) -> CashSessionOut:
    out = CashSessionOut.model_validate(session)
    out.opened_by_name = session.opened_by.full_name if session.opened_by else None
    out.closed_by_name = session.closed_by.full_name if session.closed_by else None
    return out


# ------------------------------------------------------------------------ caja
@router.get("/cash/current", response_model=CashSessionLive)
def current_cash(
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.CASH_SESSION_VIEW)),
):
    service = CashSessionService(db)
    session = service.current()
    if not session:
        return CashSessionLive(status="SIN_TURNO_ABIERTO")
    totals = service.expected_totals(session)
    return CashSessionLive(
        session_id=session.id,
        status=session.status,
        opened_at=session.opened_at,
        opened_by_name=session.opened_by.full_name if session.opened_by else None,
        **totals,
    )


@router.post("/cash/open", response_model=CashSessionOut, status_code=status.HTTP_201_CREATED)
def open_cash(
    payload: CashSessionOpen,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.CASH_SESSION_MANAGE)),
):
    return _session_out(CashSessionService(db).open(actor, payload.opening_balance))


@router.post("/cash/{session_id}/close", response_model=CashSessionOut)
def close_cash(
    session_id: int,
    payload: CashSessionClose,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.CASH_SESSION_MANAGE)),
):
    closed = CashSessionService(db).close(
        session_id, actor,
        counted_cash_mxn=payload.counted_cash_mxn,
        counted_cash_usd=payload.counted_cash_usd,
        counted_card_mxn=payload.counted_card_mxn,
        counted_transfer_mxn=payload.counted_transfer_mxn,
        notes=payload.notes,
    )
    return _session_out(closed)


@router.get("/cash", response_model=List[CashSessionOut])
def list_cash_sessions(
    limit: int = 30,
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.FINANCE_VIEW_GLOBAL)),
):
    return [_session_out(s) for s in CashSessionService(db).list(limit=limit)]


# --------------------------------------------------------------- liquidaciones
@router.get("/settlements/preview", response_model=SettlementPreview)
def preview_settlement(
    hotel_id: int,
    start: date,
    end: date,
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.SETTLEMENT_MANAGE)),
):
    return SettlementPreview(**SettlementService(db).preview(hotel_id, start, end))


@router.post("/settlements", response_model=SettlementOut, status_code=status.HTTP_201_CREATED)
def generate_settlement(
    hotel_id: int,
    start: date,
    end: date,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.SETTLEMENT_MANAGE)),
):
    settlement = SettlementService(db).generate(hotel_id, start, end, actor)
    out = SettlementOut.model_validate(settlement)
    out.hotel_name = settlement.hotel.name if settlement.hotel else None
    return out


@router.get("/settlements", response_model=List[SettlementOut])
def list_settlements(
    hotel_id: Optional[int] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(
        RequirePermission(
            Permission.FINANCE_VIEW_GLOBAL, Permission.FINANCE_VIEW_OWN_HOTEL, require_all=False
        )
    ),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    effective_hotel = scope if scope is not None else hotel_id
    result = []
    for item in SettlementService(db).list(hotel_id=effective_hotel, limit=limit):
        out = SettlementOut.model_validate(item)
        out.hotel_name = item.hotel.name if item.hotel else None
        result.append(out)
    return result


@router.post("/settlements/{settlement_id}/settle", response_model=SettlementOut)
def settle(
    settlement_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.SETTLEMENT_MANAGE)),
):
    settlement = SettlementService(db).mark_settled(settlement_id, actor)
    out = SettlementOut.model_validate(settlement)
    out.hotel_name = settlement.hotel.name if settlement.hotel else None
    return out


# -------------------------------------------------------------------- finanzas
@router.get("/summary", response_model=FinanceSummary)
def finance_summary(
    start: Optional[date] = Query(default=None),
    end: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.FINANCE_VIEW_GLOBAL)),
):
    end = end or date.today()
    start = start or (end - timedelta(days=30))

    stmt = (
        select(Reservation)
        .join(TeeSlot, Reservation.tee_slot_id == TeeSlot.id)
        .where(
            TeeSlot.slot_date >= start,
            TeeSlot.slot_date <= end,
            Reservation.status.notin_([ReservationStatus.CANCELADA, ReservationStatus.NO_SHOW]),
        )
    )
    reservations = list(db.execute(stmt).scalars().unique().all())

    replays = [t for r in reservations for t in r.replays]
    replays_total = money(sum((money(t.total) for t in replays), start=ZERO))
    gross = money(sum((money(r.total) for r in reservations), start=ZERO) + replays_total)
    services = money(sum((money(r.subtotal_services) for r in reservations), start=ZERO))
    pga = money(sum((money(r.pga_discount_amount) for r in reservations), start=ZERO))

    # Aquí sí entran los cobros de replay: son dinero del campo en el periodo.
    collected = ZERO
    for reservation in reservations:
        collected += money(
            sum((p.neto_mxn for p in reservation.payments if not p.is_voided), start=ZERO)
        )
    collected = money(collected)

    duraciones = [
        (r.completed_at - r.round_started_at).total_seconds() / 60
        for r in reservations
        if r.round_started_at and r.completed_at and r.completed_at > r.round_started_at
    ]

    settlement_service = SettlementService(db)
    by_hotel: List[SettlementPreview] = []
    commissions = ZERO
    for hotel in HotelService(db).list():
        data = settlement_service.preview(hotel.id, start, end)
        if data["reservations_count"] == 0:
            continue
        by_hotel.append(SettlementPreview(**data))
        commissions += money(data["commission_amount"])
    commissions = money(commissions)

    return FinanceSummary(
        period_start=start,
        period_end=end,
        reservations_count=len(reservations),
        gross_sales=gross,
        total_collected=collected,
        pending_collection=money(gross - collected),
        services_total=services,
        pga_discounts=pga,
        hotel_commissions=commissions,
        net_course=money(gross - commissions),
        replays_total=replays_total,
        replays_count=len(replays),
        avg_round_minutes=round(sum(duraciones) / len(duraciones)) if duraciones else None,
        rounds_measured=len(duraciones),
        by_hotel=by_hotel,
    )


# --------------------------------------------------------------- auditoría PGA
@router.get("/pga-benefits", response_model=List[PGABenefitRow])
def pga_benefits(
    start: Optional[date] = Query(default=None),
    end: Optional[date] = Query(default=None),
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.FINANCE_VIEW_GLOBAL)),
):
    """Bonificaciones PGA aplicadas en el periodo, jugador por jugador.

    Finanzas necesita poder justificar cada peso descontado: quién presentó
    credencial, cuál, quién la validó y cuánto se bonificó. El beneficio es
    individual, así que el registro también lo es: una fila por jugador, no
    por reserva.
    """
    end = end or date.today()
    start = start or (end - timedelta(days=30))

    stmt = (
        select(ReservationPlayer)
        .join(Reservation, ReservationPlayer.reservation_id == Reservation.id)
        .join(TeeSlot, Reservation.tee_slot_id == TeeSlot.id)
        .where(
            TeeSlot.slot_date >= start,
            TeeSlot.slot_date <= end,
            ReservationPlayer.pga_validated.is_(True),
            ReservationPlayer.pga_discount_applied > 0,
            Reservation.status.notin_(
                [ReservationStatus.CANCELADA, ReservationStatus.NO_SHOW]
            ),
        )
        .order_by(TeeSlot.slot_date.desc(), ReservationPlayer.id.desc())
        .limit(limit)
    )

    filas: List[PGABenefitRow] = []
    for player in db.execute(stmt).scalars().unique().all():
        reserva = player.reservation
        filas.append(
            PGABenefitRow(
                reservation_id=reserva.id,
                folio=reserva.folio,
                slot_date=reserva.tee_slot.slot_date if reserva.tee_slot else None,
                hotel_name=reserva.hotel.name if reserva.hotel else None,
                player_name=player.full_name,
                pga_code=player.pga_code,
                credential_number=player.credential_number,
                base_rate=player.rate_applied,
                discount=player.pga_discount_applied,
                final_rate=player.final_rate,
                validated_by=(
                    player.pga_validated_by.full_name if player.pga_validated_by else None
                ),
                validated_at=player.pga_validated_at,
            )
        )
    return filas
