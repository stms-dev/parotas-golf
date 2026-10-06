"""Check-in: llegadas, validación PGA, servicios y cobro.

Aquí es donde el PGA se valida y se aplica. En ninguna otra pantalla del
sistema aparece: es un beneficio individual que se acredita en el mostrador.
"""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import BusinessRuleError, NotFoundError, ValidationError
from app.modules.audit.service import AuditService
from app.modules.billing.models import Payment, ReplayTicket, pagos_de_la_reserva
from app.modules.booking.models import Reservation, ReservationPlayer, ReservationService
from app.modules.booking.service import ReservationService_
from app.modules.booking.state_machine import assert_transition, estado_para_hotel
from app.modules.catalog.service import (
    AdditionalServiceService,
    ExchangeRateService,
    PGAService,
    SettingsService,
)
from app.modules.checkin.schemas import CheckInRequest, PGAApplicationResult
from app.modules.identity.models import User
from app.modules.treasury.service import CashSessionService
from app.realtime.events import EventType, RealtimeEvent
from app.realtime.manager import publish
from app.shared.enums import AuditAction, Currency, PaymentMethod, ReservationStatus
from app.shared.money import ZERO, money, to_mxn
from app.core.permissions import Permission


class CheckInService:
    MODULE = "checkin"

    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)
        self.pga = PGAService(db)
        self.exchange = ExchangeRateService(db)
        self.services = AdditionalServiceService(db)
        self.settings = SettingsService(db)
        self.reservations = ReservationService_(db)
        self.cash = CashSessionService(db)

    # ------------------------------------------------------------------ cuenta
    def account_summary(self, reservation: Reservation) -> dict:
        paid = self._total_paid(reservation)
        exchange_rate = self.exchange.current_rate()
        lines: List[str] = []

        for player in reservation.players:
            line = f"{player.full_name} · {player.category} · ${player.rate_applied} MXN"
            if player.pga_validated and player.pga_discount_applied > 0:
                line += f" · PGA -${player.pga_discount_applied} → ${player.final_rate}"
            lines.append(line)

        for item in reservation.services:
            name = item.service.name if item.service else f"Servicio {item.service_id}"
            lines.append(f"{name} x{item.quantity} · ${item.total} MXN")

        if reservation.discount_code_applied:
            lines.append(f"Convenio {reservation.discount_code_applied}: -${reservation.discount_amount} MXN")

        total = money(reservation.total)
        return {
            "folio": reservation.folio,
            "holder_name": reservation.holder_name,
            "hotel_name": reservation.hotel.name if reservation.hotel else "",
            "status": reservation.status,
            "slot_time": reservation.tee_slot.slot_time.strftime("%H:%M") if reservation.tee_slot else None,
            "holes": reservation.holes,
            "booked_by_name": reservation.booked_by_name,
            "attended_by_name": reservation.attended_by_name,
            "subtotal_green_fees": money(reservation.subtotal_green_fees),
            "subtotal_services": money(reservation.subtotal_services),
            "discount_amount": money(reservation.discount_amount),
            "pga_discount_amount": money(reservation.pga_discount_amount),
            "total": total,
            "total_paid": paid,
            "balance": money(total - paid),
            "exchange_rate": exchange_rate,
            "total_usd_equivalent": money(total / exchange_rate) if exchange_rate else ZERO,
            "lines": lines,
        }

    @staticmethod
    def _total_paid(reservation: Reservation) -> Decimal:
        return money(
            sum((p.neto_mxn for p in pagos_de_la_reserva(reservation)), start=ZERO)
        )

    # --------------------------------------------------------------------- PGA
    def apply_pga(self, reservation: Reservation, validations: list, actor: User
                  ) -> List[PGAApplicationResult]:
        """Valida credenciales y aplica el beneficio, jugador por jugador.

        El descuento se resta solo de la tarifa del portador de la credencial:
        si 2 de 4 jugadores tienen PGA válido, solo esos 2 lo reciben.
        """
        results: List[PGAApplicationResult] = []
        players = {p.id: p for p in reservation.players}

        for entry in validations:
            player: Optional[ReservationPlayer] = players.get(entry.player_id)
            if not player:
                raise NotFoundError(f"El jugador {entry.player_id} no pertenece a esta reserva")

            pga_code = entry.pga_code or player.pga_code
            credential = entry.credential_number or player.credential_number

            # La credencial se revisa a mano, fuera del sistema: quien atiende
            # la tiene enfrente. Aquí solo se guarda ese sí o ese no, con el
            # nombre de quien lo decidió por si hay que revisarlo después.
            if not entry.apply_benefit:
                # Si antes tenía beneficio y ahora se rechaza, se revierte.
                player.pga_validated = False
                player.pga_discount_applied = ZERO
                player.final_rate = money(player.rate_applied)
                results.append(
                    PGAApplicationResult(
                        player_id=player.id, player_name=player.full_name,
                        valid=False,
                        message="El mostrador no aplicó el beneficio",
                        base_rate=money(player.rate_applied), discount=ZERO,
                        final_rate=money(player.rate_applied),
                    )
                )
                continue

            discount = self.pga.compute_discount(player.rate_applied)
            player.pga_code = pga_code
            player.credential_number = credential
            player.pga_validated = True
            player.pga_validated_by_id = actor.id
            player.pga_validated_at = datetime.utcnow()
            player.pga_discount_applied = discount
            player.final_rate = money(money(player.rate_applied) - discount)

            self.audit.log(
                user=actor, action=AuditAction.VALIDAR_PGA, module=self.MODULE,
                entity="ReservationPlayer", entity_id=player.id,
                old_value=str(player.rate_applied), new_value=str(player.final_rate),
                description=(
                    f"PGA {pga_code} aceptado a mano para {player.full_name} "
                    f"por {actor.full_name} · descuento ${discount}"
                ),
            )
            results.append(
                PGAApplicationResult(
                    player_id=player.id, player_name=player.full_name,
                    valid=True,
                    message=f"Beneficio PGA aplicado por {actor.full_name}",
                    base_rate=money(player.rate_applied), discount=discount,
                    final_rate=player.final_rate,
                )
            )
        return results

    # ---------------------------------------------------------------- recálculo
    def _recalculate_totals(self, reservation: Reservation, en_mostrador: bool = False) -> None:
        """Recalcula la cuenta desde las líneas, nunca desde el total anterior.

        En el mostrador solo se cobra a quien se presentó: si un jugador de los
        cuatro no llegó, su green fee sale de la cuenta. Antes del check-in
        nadie está marcado todavía, así que ahí se cobra la partida completa
        como venía reservada; el filtro entra en cuanto el mostrador empieza a
        marcar llegadas.
        """
        cobrables = (
            [p for p in reservation.players if p.arrived]
            if en_mostrador
            else list(reservation.players)
        )

        # El acompañante sigue la misma regla: en el mostrador se cobra solo
        # a quien llegó. Su línea se ajusta a los que se presentaron.
        if en_mostrador:
            presentes = sum(1 for c in reservation.companions if c.arrived)
            for linea in reservation.services:
                if linea.service and linea.service.code == "ACOMPANANTE":
                    linea.quantity = presentes
                    linea.total = money(money(linea.unit_price_applied) * presentes)

        green_fees = money(sum((money(p.rate_applied) for p in cobrables), start=ZERO))
        pga_total = money(sum((money(p.pga_discount_applied) for p in cobrables), start=ZERO))
        services_total = money(sum((money(s.total) for s in reservation.services), start=ZERO))

        reservation.subtotal_green_fees = green_fees
        reservation.subtotal_services = services_total
        reservation.pga_discount_amount = pga_total
        reservation.total = money(
            green_fees + services_total - money(reservation.discount_amount) - pga_total
        )

    # ------------------------------------------------------------------- cobro
    def _suma_en_mxn(self, lines: list) -> Decimal:
        """Lo que se está capturando, en pesos, con el TC vigente."""
        if not lines:
            return money("0")
        exchange_rate = self.exchange.current_rate()
        total = money("0")
        for line in lines:
            total = money(total + to_mxn(line.amount, Currency(line.currency).value, exchange_rate))
        return total

    def _validar_cobro(self, lines: list, saldo: Decimal, concepto: str = "el saldo") -> Decimal:
        """Revisa el cobro antes de escribirlo y devuelve el cambio a entregar.

        - Tarjeta y transferencia se cobran exactas: nunca pueden pasar del saldo.
        - En efectivo el huésped puede entregar de más; la diferencia es el
          cambio, que sale de la caja en pesos.
        - Faltar dinero nunca se permite.
        """
        exchange_rate = self.exchange.current_rate()
        entrante = self._suma_en_mxn(lines)
        no_efectivo = money("0")
        for line in lines:
            if line.method != PaymentMethod.EFECTIVO:
                no_efectivo = money(
                    no_efectivo + to_mxn(line.amount, Currency(line.currency).value, exchange_rate)
                )

        if entrante < saldo:
            raise BusinessRuleError(
                f"El cobro está incompleto: faltan ${money(saldo - entrante)} MXN. "
                f"{concepto[0].upper() + concepto[1:]} es de ${saldo} MXN y se capturaron "
                f"${entrante} MXN."
            )
        if no_efectivo > saldo:
            raise BusinessRuleError(
                f"Con tarjeta o transferencia se cobra exacto: se capturaron ${no_efectivo} MXN "
                f"y {concepto} es de ${saldo} MXN. Solo en efectivo se puede dar cambio."
            )
        return money(entrante - saldo)

    def _register_payments(
        self, reservation: Reservation, lines: list, actor: User, replay_id: Optional[int] = None,
        cambio: Decimal = ZERO,
    ) -> List[Payment]:
        """Registra los cobros. Cada uno guarda su TC y su equivalente en MXN."""
        if not lines:
            return []

        cutoff = self.settings.get_int("cash_cutoff_hour", settings.CASH_CUTOFF_HOUR)
        if datetime.now().hour >= cutoff:
            raise BusinessRuleError(
                f"La caja no admite cobros después de las {cutoff}:00. "
                "Registre el movimiento al abrir el siguiente turno."
            )

        session = self.cash.get_or_open_today(actor)
        exchange_rate = self.exchange.current_rate()
        created: List[Payment] = []

        # El cambio se carga a las líneas en efectivo, primero a las de pesos.
        por_regresar = money(cambio)
        cambios = {}
        orden = sorted(
            [i for i, l in enumerate(lines) if l.method == PaymentMethod.EFECTIVO],
            key=lambda i: 0 if lines[i].currency == "MXN" else 1,
        )
        for i in orden:
            if por_regresar <= 0:
                break
            valor = to_mxn(lines[i].amount, Currency(lines[i].currency).value, exchange_rate)
            tomado = min(por_regresar, valor)
            cambios[i] = money(tomado)
            por_regresar = money(por_regresar - tomado)

        for indice, line in enumerate(lines):
            currency = Currency(line.currency)
            applied_rate = exchange_rate if currency == Currency.USD else Decimal("1.0000")
            amount_mxn = to_mxn(line.amount, currency.value, exchange_rate)

            payment = Payment(
                reservation_id=reservation.id,
                replay_id=replay_id,
                cash_session_id=session.id,
                currency=currency,
                amount=money(line.amount),
                exchange_rate_applied=applied_rate,
                amount_mxn=amount_mxn,
                change_mxn=cambios.get(indice, ZERO),
                method=line.method,
                reference=line.reference,
                notes=line.notes,
                received_by_id=actor.id,
            )
            self.db.add(payment)
            created.append(payment)

            self.audit.log(
                user=actor, action=AuditAction.PAGO, module="billing",
                entity="Payment", entity_id=None,
                new_value=(
                    f"{line.amount} {currency.value} = {amount_mxn} MXN"
                    + (f" · cambio ${cambios[indice]}" if cambios.get(indice) else "")
                ),
                description=(
                    f"Cobro {line.method} en {reservation.folio}"
                    + (" · replay" if replay_id else "")
                    + (f" · TC {applied_rate}" if currency == Currency.USD else "")
                ),
            )
        return created

    # --------------------------------------------------------------- check-in
    def perform(self, reservation_id: int, data: CheckInRequest, actor: User) -> dict:
        reservation = self.reservations.get(reservation_id)

        # Una solicitud del hotel que llega al mostrador se da por confirmada
        # ahí mismo: que el huésped esté enfrente es la confirmación. Antes
        # había que validarla en otra pantalla y eso solo frenaba la fila.
        if reservation.status == ReservationStatus.PENDIENTE:
            assert_transition(reservation.status, ReservationStatus.CONFIRMADA)
            reservation.status = ReservationStatus.CONFIRMADA
            reservation.confirmed_at = datetime.utcnow()
            self.audit.log(
                user=actor, action=AuditAction.CONFIRMAR, module=self.MODULE,
                entity="Reservation", entity_id=reservation.id,
                old_value=ReservationStatus.PENDIENTE.value,
                new_value=ReservationStatus.CONFIRMADA.value,
                description=(
                    f"{reservation.folio} confirmada en el mostrador al presentarse el huésped"
                ),
            )

        if reservation.status not in (ReservationStatus.CONFIRMADA, ReservationStatus.CHECK_IN):
            raise BusinessRuleError(
                f"No se puede hacer check-in de una reserva en estado {reservation.status}"
            )

        # 1. Llegadas (el QR es por partida; la llegada se marca por jugador).
        players = {p.id: p for p in reservation.players}
        for arrival in data.arrivals:
            player = players.get(arrival.player_id)
            if not player:
                raise NotFoundError(f"El jugador {arrival.player_id} no pertenece a esta reserva")
            player.arrived = arrival.arrived
            player.arrived_at = datetime.utcnow() if arrival.arrived else None

        companions = {c.id: c for c in reservation.companions}
        for arrival in data.companion_arrivals:
            companion = companions.get(arrival.companion_id)
            if not companion:
                raise NotFoundError(
                    f"El acompañante {arrival.companion_id} no pertenece a esta reserva"
                )
            companion.arrived = arrival.arrived

        # 2. PGA.
        pga_results = self.apply_pga(reservation, data.pga_validations, actor)

        # 3. Servicios agregados en mostrador.
        for entry in data.services:
            service = self.services.get(entry.service_id)
            if service.code in ("REPLAY", "ACOMPANANTE", "CADDIE"):
                # El replay tiene su propio ticket, el acompañante viene cobrado
                # desde la reserva del hotel, y el caddie no lo cobra el club:
                # el huésped le paga directo.
                raise ValidationError(
                    f"{service.name} no se agrega como servicio en el mostrador"
                )
            if not service.is_active:
                raise ValidationError(f"El servicio {service.name} está inactivo")
            dia = reservation.tee_slot.slot_date if reservation.tee_slot else None
            unit_price = money(service.price_on(dia))
            line_total = money(unit_price * entry.quantity)
            self.db.add(
                ReservationService(
                    reservation_id=reservation.id,
                    player_id=entry.player_id,
                    service_id=service.id,
                    quantity=entry.quantity,
                    unit_price_applied=unit_price,
                    total=line_total,
                    notes=entry.notes,
                    # Venta del campo: el hotel no la ve ni la cobra.
                    added_at_counter=True,
                )
            )
        self.db.flush()
        self.db.refresh(reservation)

        # 4. Recalcular y cobrar. Aquí ya estamos en el mostrador, así que la
        #    cuenta se arma solo con los jugadores que se presentaron.
        self._recalculate_totals(reservation, en_mostrador=True)

        if data.invoice_requested is not None:
            reservation.invoice_requested = data.invoice_requested
            reservation.invoice_contact_email = data.invoice_contact_email
            from app.shared.enums import InvoiceStatus
            reservation.invoice_status = (
                InvoiceStatus.SOLICITADA if data.invoice_requested else InvoiceStatus.NO_REQUERIDA
            )

        # El cobro se valida ANTES de escribir los pagos: se cobra exactamente
        # el saldo, ni un peso de más ni de menos. Cobrar de menos deja una
        # cuenta abierta que nadie persigue; cobrar de más obliga a devolver
        # en efectivo y descuadra el arqueo. Se comprueba aquí, no solo en la
        # pantalla, porque la pantalla se puede saltar.
        self.db.flush()
        self.db.refresh(reservation)

        pagado_antes = self._total_paid(reservation)
        saldo = money(money(reservation.total) - pagado_antes)

        cambio = ZERO
        if data.payments:
            cambio = self._validar_cobro(data.payments, saldo, "el saldo de la reserva")

        self._register_payments(reservation, data.payments, actor, cambio=cambio)
        self.db.flush()
        self.db.refresh(reservation)

        paid = self._total_paid(reservation)
        balance = money(money(reservation.total) - paid)

        # 5. Transición de estado.
        arrived_count = sum(1 for p in reservation.players if p.arrived)
        # Quién atendió, por su nombre. Se guarda en cada llamada porque el
        # check-in se puede retomar en otro turno: vale el último que atendió.
        reservation.attended_by_name = data.attended_by_name.strip()
        message = "Check-in registrado"
        if reservation.status == ReservationStatus.CONFIRMADA and arrived_count > 0:
            assert_transition(reservation.status, ReservationStatus.CHECK_IN)
            reservation.status = ReservationStatus.CHECK_IN
            reservation.checked_in_at = datetime.utcnow()
            reservation.checked_in_by_id = actor.id
            if arrived_count < len(reservation.players):
                message = (
                    f"Check-in parcial: {arrived_count} de {len(reservation.players)} jugadores. "
                    "La partida puede despacharse con los presentes."
                )

        # Pagada completa, la partida queda en juego. El hotel la ve como
        # confirmada desde este momento; el mostrador ya no la puede tocar.
        if (
            reservation.status == ReservationStatus.CHECK_IN
            and paid > 0
            and balance == 0
        ):
            assert_transition(reservation.status, ReservationStatus.EN_JUEGO)
            reservation.status = ReservationStatus.EN_JUEGO
            # Aquí arranca el reloj de la partida: del pago al cierre.
            reservation.round_started_at = datetime.utcnow()
            message = "Pagado. La partida quedó en juego."

        self.audit.log(
            user=actor, action=AuditAction.CHECK_IN, module=self.MODULE,
            entity="Reservation", entity_id=reservation.id,
            new_value=str(reservation.total),
            description=(
                f"Check-in de {reservation.folio}: {arrived_count}/{len(reservation.players)} "
                f"jugadores · total ${reservation.total} · saldo ${balance} · "
                f"atendió {reservation.attended_by_name}"
            ),
        )
        self.db.commit()
        self.db.refresh(reservation)

        # Pagada y cerrada la cuenta: el recibo sale solo, sin que nadie tenga
        # que apretar nada. Si el correo no pudiera salir en ese momento, queda
        # en la bandeja y el repartidor lo manda después.
        if data.payments and balance == 0:
            try:
                from app.modules.mailing.service import MailingService
                from app.shared.enums import EmailKind

                MailingService(self.db).enviar_ahora(
                    kind=EmailKind.RECIBO, reservation=reservation
                )
            except Exception:
                self.db.rollback()

        # Avisos, ya con todo guardado.
        # Lo que pasa en el mostrador es del campo. Al hotel solo le llega
        # un aviso cuando su reserva queda pagada, ya como "confirmada".
        if reservation.status == ReservationStatus.EN_JUEGO:
            slot = reservation.tee_slot
            publish(
                RealtimeEvent(
                    type=EventType.RESERVA_ACTUALIZADA,
                    hotel_id=reservation.hotel_id,
                    required_permission=Permission.RESERVATION_VIEW_OWN_HOTEL,
                    payload={
                        "reserva_id": reservation.id,
                        "folio": reservation.folio,
                        "estado": ReservationStatus.CONFIRMADA,
                        "estado_hotel": ReservationStatus.CONFIRMADA,
                        "para_hotel": True,
                        "titular": reservation.holder_name,
                        "fecha": slot.slot_date.isoformat() if slot else None,
                        "hora": slot.slot_time.strftime("%H:%M") if slot else None,
                        "jugadores": len(reservation.players),
                    },
                )
            )

        publish(
            RealtimeEvent(
                type=EventType.CHECKIN_REGISTRADO,
                hotel_id=reservation.hotel_id,
                required_permission=Permission.CHECKIN_PERFORM,
                payload={
                    "reserva_id": reservation.id,
                    "folio": reservation.folio,
                    "estado": reservation.status,
                    "estado_hotel": estado_para_hotel(reservation.status),
                    "jugadores_presentes": arrived_count,
                    "jugadores_total": len(reservation.players),
                    "total": str(money(reservation.total)),
                    "saldo": str(balance),
                },
            )
        )

        if data.payments:
            # El detalle del cobro solo va a quien tiene permiso financiero:
            # un hotel no debe ver los movimientos de caja del campo.
            publish(
                RealtimeEvent(
                    type=EventType.PAGO_REGISTRADO,
                    required_permission=Permission.CASH_SESSION_VIEW,
                    payload={
                        "folio": reservation.folio,
                        "cobrado": str(paid),
                        "saldo": str(balance),
                        "movimientos": len(data.payments),
                    },
                )
            )
            session = self.cash.current()
            if session:
                totales = self.cash.expected_totals(session)
                publish(
                    RealtimeEvent(
                        type=EventType.CAJA_ACTUALIZADA,
                        required_permission=Permission.CASH_SESSION_VIEW,
                        payload={
                            "turno_id": session.id,
                            "efectivo": str(totales["cash_mxn"]),
                            "tarjeta": str(totales["card_mxn"]),
                            "transferencias": str(totales["transfer_mxn"]),
                            "total": str(totales["total_mxn"]),
                            "pagos": totales["payment_count"],
                        },
                    )
                )

        return {
            "folio": reservation.folio,
            "status": reservation.status,
            "players_arrived": arrived_count,
            "players_total": len(reservation.players),
            "subtotal_green_fees": money(reservation.subtotal_green_fees),
            "subtotal_services": money(reservation.subtotal_services),
            "discount_amount": money(reservation.discount_amount),
            "pga_discount_amount": money(reservation.pga_discount_amount),
            "total": money(reservation.total),
            "total_paid": paid,
            "balance": balance,
            "exchange_rate_applied": self.exchange.current_rate(),
            "change_mxn": cambio,
            "pga_results": pga_results,
            "payments": [
                {
                    "id": p.id, "currency": p.currency, "amount": p.amount,
                    "exchange_rate_applied": p.exchange_rate_applied,
                    "amount_mxn": p.amount_mxn, "change_mxn": p.change_mxn, "method": p.method,
                    "reference": p.reference,
                    "received_by_name": p.received_by.full_name if p.received_by else None,
                    "paid_at": p.paid_at.isoformat() if p.paid_at else None,
                    "is_voided": p.is_voided,
                }
                for p in reservation.payments
                if p.replay_id is None
            ],
            "message": message,
        }


    # ------------------------------------------------------------------ replay
    def _avisar_caja(self, folio: str, cobrado: Decimal, movimientos: int) -> None:
        publish(
            RealtimeEvent(
                type=EventType.PAGO_REGISTRADO,
                required_permission=Permission.CASH_SESSION_VIEW,
                payload={"folio": folio, "cobrado": str(cobrado), "saldo": "0.00",
                         "movimientos": movimientos},
            )
        )
        session = self.cash.current()
        if session:
            totales = self.cash.expected_totals(session)
            publish(
                RealtimeEvent(
                    type=EventType.CAJA_ACTUALIZADA,
                    required_permission=Permission.CASH_SESSION_VIEW,
                    payload={
                        "turno_id": session.id,
                        "efectivo": str(totales["cash_mxn"]),
                        "tarjeta": str(totales["card_mxn"]),
                        "transferencias": str(totales["transfer_mxn"]),
                        "total": str(totales["total_mxn"]),
                        "pagos": totales["payment_count"],
                    },
                )
            )

    def salidas_para_replay(self, reservation: Reservation) -> list:
        """Salidas donde se puede jugar el replay: el mismo día, después de la
        salida original y completamente libres. Con RESPETAR_HORARIOS=false
        también se ofrecen las que ya pasaron (modo pruebas)."""
        from sqlalchemy import select
        from app.modules.booking.models import TeeSlot
        from app.shared.enums import SlotStatus
        from app.shared.tiempo import ya_paso

        original = reservation.tee_slot
        if not original:
            return []
        stmt = (
            select(TeeSlot)
            .where(
                TeeSlot.slot_date == original.slot_date,
                TeeSlot.slot_time > original.slot_time,
                TeeSlot.status == SlotStatus.DISPONIBLE,
                TeeSlot.occupied == 0,
            )
            .order_by(TeeSlot.slot_time)
        )
        salidas = list(self.db.execute(stmt).scalars().all())
        if not settings.horarios_libres:
            salidas = [s for s in salidas if not ya_paso(s.slot_date, s.slot_time)]
        return salidas

    def replay(
        self, reservation_id: int, tee_slot_id: int, lines: list, actor: User,
        *, attended_by_name: str,
    ) -> ReplayTicket:
        """Ronda extra: segundo ticket del mismo folio, cobrado aparte.

        Se cobra por partida, no por jugador: un solo precio fijo, sin PGA ni
        descuentos. El ticket original no se toca. Entra a la caja del día y
        no genera comisión: el hotel no participa en él.
        """
        from sqlalchemy import select
        from app.modules.catalog.models import AdditionalService

        reservation = self.reservations.get(reservation_id)
        if reservation.status != ReservationStatus.EN_JUEGO:
            raise BusinessRuleError(
                "El replay solo se cobra a una partida que ya pagó y está en juego"
            )
        presentes = sum(1 for p in reservation.players if p.arrived)

        # El replay necesita una salida libre: si ya no hay, no se puede.
        libres = {s.id: s for s in self.salidas_para_replay(reservation)}
        salida = libres.get(tee_slot_id)
        if not salida:
            raise BusinessRuleError(
                "Esa salida no está disponible para el replay. Elija otro horario libre "
                "posterior a la partida."
                if libres
                else "Ya no quedan salidas libres hoy después de esta partida: no se puede "
                "jugar el replay."
            )

        service = self.db.execute(
            select(AdditionalService).where(AdditionalService.code == "REPLAY")
        ).scalar_one_or_none()
        if not service or not service.is_active:
            raise BusinessRuleError("El replay no está dado de alta en el catálogo de servicios")

        unit = money(service.price)
        total = unit
        if not lines:
            raise ValidationError("Capture el cobro del replay")
        cambio = self._validar_cobro(lines, total, "el replay")

        ticket = ReplayTicket(
            reservation_id=reservation.id,
            players_count=presentes,
            tee_slot_id=salida.id,
            unit_price=unit,
            total=total,
            created_by_id=actor.id,
            attended_by_name=attended_by_name.strip(),
        )
        self.db.add(ticket)
        # La salida del replay queda tomada completa, como una partida más.
        from app.shared.enums import SlotStatus
        salida.occupied = max(presentes, 1)
        salida.status = SlotStatus.OCUPADO
        self.db.flush()
        self._register_payments(reservation, lines, actor, replay_id=ticket.id, cambio=cambio)
        self.audit.log(
            user=actor, action=AuditAction.PAGO, module=self.MODULE,
            entity="ReplayTicket", entity_id=ticket.id,
            new_value=str(total),
            description=(
                f"Replay de la partida {reservation.folio} · ${total} · salida "
                f"{salida.slot_time.strftime('%H:%M')}"
            ),
        )
        self.db.commit()
        self.db.refresh(ticket)
        self._avisar_caja(reservation.folio, total, len(lines))
        publish(
            RealtimeEvent(
                type=EventType.DISPONIBILIDAD_CAMBIADA,
                payload={
                    "franja_id": salida.id, "fecha": salida.slot_date.isoformat(),
                    "tee": salida.tee, "hora": salida.slot_time.strftime("%H:%M"),
                    "capacidad": salida.capacity, "ocupados": salida.occupied,
                    "disponibles": salida.available, "estado": salida.status,
                    "motivo": f"Replay de {reservation.folio}",
                },
            )
        )
        return ticket
