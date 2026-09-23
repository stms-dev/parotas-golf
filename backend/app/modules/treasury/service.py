"""Tesorería: turnos de caja, arqueo y liquidación a hoteles."""
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, NotFoundError
from app.modules.audit.service import AuditService
from app.modules.billing.models import Payment
from app.modules.booking.models import Reservation, TeeSlot
from app.modules.catalog.models import Hotel
from app.core.permissions import Permission
from app.modules.identity.models import User
from app.modules.treasury.models import CashSession, HotelSettlement
from app.realtime.events import EventType, RealtimeEvent
from app.realtime.manager import publish
from app.shared.enums import (
    AuditAction,
    CashSessionStatus,
    Currency,
    PaymentMethod,
    ReservationStatus,
    SettlementStatus,
)
from app.shared.money import ZERO, apply_percentage, money



def base_de_comision(reservation) -> Decimal:
    """Lo que genera comisión para el hotel: el total sin los servicios."""
    return money(money(reservation.total) - money(reservation.subtotal_services))


class CashSessionService:
    """Turno de caja.

    Un pago pertenece al turno abierto en ese momento. Sin ese concepto, el
    arqueo no cuadra y una diferencia no tiene a quién responsabilizar.
    """

    MODULE = "treasury"

    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def current(self) -> Optional[CashSession]:
        stmt = (
            select(CashSession)
            .where(CashSession.status == CashSessionStatus.ABIERTA)
            .order_by(CashSession.opened_at.desc())
            .limit(1)
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def get_or_open_today(self, actor: User, opening_balance: Decimal = ZERO) -> CashSession:
        existing = self.current()
        if existing:
            return existing
        return self.open(actor, opening_balance)

    def open(self, actor: User, opening_balance: Decimal = ZERO) -> CashSession:
        if self.current():
            raise BusinessRuleError("Ya hay un turno de caja abierto. Ciérrelo antes de abrir otro.")

        session = CashSession(
            session_date=date.today(),
            opened_by_id=actor.id,
            opening_balance=money(opening_balance),
            status=CashSessionStatus.ABIERTA,
        )
        self.db.add(session)
        self.db.flush()
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module=self.MODULE,
            entity="CashSession", entity_id=session.id,
            new_value=str(session.opening_balance),
            description=f"Turno de caja abierto por {actor.full_name}",
        )
        self.db.commit()
        self.db.refresh(session)
        return session

    def expected_totals(self, session: CashSession) -> dict:
        """Lo que la caja debería tener, según los pagos del turno."""
        stmt = select(Payment).where(
            Payment.cash_session_id == session.id, Payment.is_voided.is_(False)
        )
        payments = list(self.db.execute(stmt).scalars().all())

        cash = card = transfer = usd_cash = ZERO
        for payment in payments:
            amount = money(payment.amount_mxn)
            if payment.method == PaymentMethod.EFECTIVO:
                # El cambio sale de la misma caja en pesos.
                cash += amount - money(payment.change_mxn or 0)
                if payment.currency == Currency.USD:
                    usd_cash += money(payment.amount)
            elif payment.method == PaymentMethod.TARJETA:
                card += amount
            else:
                transfer += amount

        return {
            "cash_mxn": money(cash),
            "card_mxn": money(card),
            "transfer_mxn": money(transfer),
            "usd_cash_original": money(usd_cash),
            "total_mxn": money(cash + card + transfer),
            "payment_count": len(payments),
        }

    def close(
        self, session_id: int, actor: User, *,
        counted_cash_mxn: Decimal = ZERO, counted_cash_usd: Decimal = ZERO,
        counted_card_mxn: Decimal = ZERO, counted_transfer_mxn: Decimal = ZERO,
        exchange_rate: Optional[Decimal] = None, notes: Optional[str] = None,
    ) -> CashSession:
        session = self.db.get(CashSession, session_id)
        if not session:
            raise NotFoundError(f"Turno de caja {session_id} no encontrado")
        if session.status != CashSessionStatus.ABIERTA:
            raise BusinessRuleError("Este turno de caja ya fue cerrado")

        expected = self.expected_totals(session)

        if exchange_rate is None:
            from app.modules.catalog.service import ExchangeRateService
            exchange_rate = ExchangeRateService(self.db).current_rate()

        usd_in_mxn = money(money(counted_cash_usd) * exchange_rate)
        counted_total = money(
            money(counted_cash_mxn) + usd_in_mxn + money(counted_card_mxn) + money(counted_transfer_mxn)
        )

        session.expected_cash_mxn = expected["cash_mxn"]
        session.expected_card_mxn = expected["card_mxn"]
        session.expected_transfer_mxn = expected["transfer_mxn"]
        session.expected_total_mxn = expected["total_mxn"]

        session.counted_cash_mxn = money(counted_cash_mxn)
        session.counted_cash_usd = money(counted_cash_usd)
        session.counted_card_mxn = money(counted_card_mxn)
        session.counted_transfer_mxn = money(counted_transfer_mxn)
        session.counted_total_mxn = counted_total

        session.exchange_rate_applied = exchange_rate
        session.difference_mxn = money(counted_total - expected["total_mxn"])
        session.closed_at = datetime.utcnow()
        session.closed_by_id = actor.id
        session.notes = notes
        session.status = (
            CashSessionStatus.CERRADA
            if session.difference_mxn == ZERO
            else CashSessionStatus.CON_DIFERENCIA
        )

        self.audit.log(
            user=actor, action=AuditAction.CIERRE_CAJA, module=self.MODULE,
            entity="CashSession", entity_id=session.id,
            old_value=str(expected["total_mxn"]), new_value=str(counted_total),
            description=(
                f"Cierre de caja · esperado ${expected['total_mxn']} · "
                f"contado ${counted_total} · diferencia ${session.difference_mxn}"
            ),
        )
        self.db.commit()
        self.db.refresh(session)

        publish(
            RealtimeEvent(
                type=EventType.CAJA_CERRADA,
                required_permission=Permission.CASH_SESSION_VIEW,
                payload={
                    "turno_id": session.id,
                    "esperado": str(session.expected_total_mxn),
                    "contado": str(session.counted_total_mxn),
                    "diferencia": str(session.difference_mxn),
                    "estado": session.status,
                    "responsable": actor.full_name,
                },
            )
        )
        return session

    def list(self, *, limit: int = 30) -> List[CashSession]:
        stmt = select(CashSession).order_by(CashSession.opened_at.desc()).limit(limit)
        return list(self.db.execute(stmt).scalars().all())

    def get(self, session_id: int) -> CashSession:
        session = self.db.get(CashSession, session_id)
        if not session:
            raise NotFoundError(f"Turno de caja {session_id} no encontrado")
        return session


class SettlementService:
    """Liquidación de la participación de hoteles.

    Usa la comisión que quedó congelada en cada reserva, no la vigente hoy.
    """

    MODULE = "treasury"

    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def _reservations_in_period(
        self, hotel_id: int, start: date, end: date
    ) -> List[Reservation]:
        stmt = (
            select(Reservation)
            .join(TeeSlot, Reservation.tee_slot_id == TeeSlot.id)
            .where(
                Reservation.hotel_id == hotel_id,
                TeeSlot.slot_date >= start,
                TeeSlot.slot_date <= end,
                Reservation.status.notin_([ReservationStatus.CANCELADA, ReservationStatus.NO_SHOW]),
            )
        )
        return list(self.db.execute(stmt).scalars().unique().all())

    def preview(self, hotel_id: int, start: date, end: date) -> dict:
        hotel = self.db.get(Hotel, hotel_id)
        if not hotel:
            raise NotFoundError(f"Hotel {hotel_id} no encontrado")

        reservations = self._reservations_in_period(hotel_id, start, end)
        gross = money(sum((money(r.total) for r in reservations), start=ZERO))
        pga = money(sum((money(r.pga_discount_amount) for r in reservations), start=ZERO))

        # Cada reserva aporta su propia comisión congelada. La comisión va
        # solo sobre el green fee (ya con PGA y convenio): caddies, bastones y
        # acompañantes pasan al campo completos, como marca la hoja de costeo.
        commission = money(
            sum(
                (
                    apply_percentage(base_de_comision(r), r.commission_rate_applied)
                    for r in reservations
                ),
                start=ZERO,
            )
        )

        return {
            "hotel_id": hotel.id,
            "hotel_name": hotel.name,
            "period_start": start,
            "period_end": end,
            "reservations_count": len(reservations),
            "gross_sales": gross,
            "pga_discounts": pga,
            "commission_rate_applied": hotel.commission_rate,
            "commission_amount": commission,
            "net_course": money(gross - commission),
        }

    def generate(self, hotel_id: int, start: date, end: date, actor: User) -> HotelSettlement:
        data = self.preview(hotel_id, start, end)
        settlement = HotelSettlement(
            hotel_id=hotel_id,
            period_start=start,
            period_end=end,
            reservations_count=data["reservations_count"],
            gross_sales=data["gross_sales"],
            pga_discounts=data["pga_discounts"],
            commission_rate_applied=data["commission_rate_applied"],
            commission_amount=data["commission_amount"],
            net_course=data["net_course"],
            status=SettlementStatus.PENDIENTE,
        )
        self.db.add(settlement)
        self.db.flush()
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module=self.MODULE,
            entity="HotelSettlement", entity_id=settlement.id,
            new_value=str(settlement.net_course),
            description=(
                f"Liquidación generada para {data['hotel_name']} "
                f"({start} a {end}) · comisión ${settlement.commission_amount}"
            ),
        )
        self.db.commit()
        self.db.refresh(settlement)
        return settlement

    def mark_settled(self, settlement_id: int, actor: User) -> HotelSettlement:
        settlement = self.db.get(HotelSettlement, settlement_id)
        if not settlement:
            raise NotFoundError(f"Liquidación {settlement_id} no encontrada")
        if settlement.status == SettlementStatus.LIQUIDADO:
            raise BusinessRuleError("Esta liquidación ya está marcada como liquidada")

        settlement.status = SettlementStatus.LIQUIDADO
        settlement.settled_at = datetime.utcnow()
        settlement.settled_by_id = actor.id
        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=self.MODULE,
            entity="HotelSettlement", entity_id=settlement.id,
            new_value=SettlementStatus.LIQUIDADO,
            description=f"Liquidación {settlement_id} marcada como liquidada",
        )
        self.db.commit()
        self.db.refresh(settlement)
        return settlement

    def list(self, *, hotel_id: Optional[int] = None, limit: int = 50) -> List[HotelSettlement]:
        stmt = select(HotelSettlement)
        if hotel_id:
            stmt = stmt.where(HotelSettlement.hotel_id == hotel_id)
        return list(
            self.db.execute(stmt.order_by(HotelSettlement.period_end.desc()).limit(limit)).scalars().all()
        )
