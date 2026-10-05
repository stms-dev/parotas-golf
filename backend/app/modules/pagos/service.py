"""Reserva hecha desde el sitio del club, sin cuenta.

Quien reserva por internet no es un concierge ni un recepcionista: es el
huésped. Eso cambia tres cosas respecto a una reserva del mostrador:

1. **No hay quién la levante.** Se usa una cuenta del sistema, "Reservas en
   línea", que no puede iniciar sesión. Existe para que la reserva tenga autor
   en la bitácora y para que caiga en público general con cero comisión —
   exactamente como la que levanta recepción cuando llega alguien sin hotel.

2. **Se aparta la salida mientras paga.** Entre que le da a pagar y que el
   banco responde pasan minutos. Si en ese rato la salida sigue a la venta,
   dos personas pagan el mismo tee time. Así que se crea la reserva en
   PENDIENTE —que ya toma el cupo— con hora de vencimiento. Si no paga, se
   cancela sola y el horario vuelve.

3. **El cobro no pasa por la caja.** Un cobro en línea no entra al cajón del
   mostrador, así que su pago se guarda sin turno de caja. El corte del día
   sigue cuadrando contra lo que de verdad hay en el cajón.

Las reglas del negocio NO se repiten aquí: se reusa `ReservationService_`,
que es donde viven el mínimo de cuatro para grupo, el cupo de la partida
abierta, las tarifas de twilight y el caddie que no se cobra. Este módulo solo
traduce entre el mundo público y ese servicio.
"""
import secrets
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import BusinessRuleError, NotFoundError, ValidationError
from app.modules.billing.models import Payment
from app.modules.booking.models import Reservation
from app.modules.booking.schemas import PlayerIn, ReservationCreate
from app.modules.booking.service import AvailabilityService, ReservationService_
from app.modules.catalog.service import (
    AdditionalServiceService,
    ExchangeRateService,
    PricingService,
    ScheduleService,
    SettingsService,
)
from app.modules.identity.models import User
from app.modules.pagos import simulador, stripe_gateway
from app.shared.enums import (
    BookingModality,
    Currency,
    PaymentMethod,
    ReservationStatus,
    UserRole,
)
from app.shared.money import ZERO, money
from app.shared.tiempo import hoy as hoy_local, ya_paso

# Correo de la cuenta con la que quedan firmadas las reservas del sitio.
CUENTA_DEL_SITIO = "sitio@parotasgolf.com"

# Lo que se escribe en "quién levantó la reserva". No es un nombre inventado
# de persona a propósito: quien la levantó fue el huésped desde el sitio, y
# eso es lo que tiene que leer el operador en la pantalla.
QUIEN_RESERVA = "Reserva en línea"


class ReservaPublicaService:
    def __init__(self, db: Session):
        self.db = db
        self.reservas = ReservationService_(db)
        self.disponibilidad = AvailabilityService(db)
        self.ajustes = SettingsService(db)
        self.horarios = ScheduleService(db)
        self.precios = PricingService(db)
        self.servicios = AdditionalServiceService(db)
        self.cambio = ExchangeRateService(db)

    # ------------------------------------------------------------ la cuenta
    def cuenta_del_sitio(self) -> User:
        """La cuenta a cuyo nombre quedan las reservas del sitio.

        Tiene perfil de recepción porque hace lo mismo que recepción: levantar
        a quien llega sin hotel. Y está desactivada, así que nadie puede
        iniciar sesión con ella aunque adivinara la contraseña.

        Se da de alta sola la primera vez que alguien reserva. El sembrado
        también la crea, pero el sembrado solo corre con la base en blanco: en
        una base que ya estaba trabajando antes de que existiera el sitio, esa
        cuenta nunca aparecería, y la primera reserva del primer huésped
        moriría pidiendo que alguien entre al servidor a correr un script. La
        contraseña es basura aleatoria que nadie conoce ni necesita.
        """
        cuenta = self.db.execute(
            select(User).where(User.email == CUENTA_DEL_SITIO)
        ).scalars().first()
        if cuenta is not None:
            return cuenta

        from app.core.security import hash_password

        cuenta = User(
            email=CUENTA_DEL_SITIO,
            full_name="Reservas en línea",
            hashed_password=hash_password(secrets.token_urlsafe(32)),
            role=UserRole.RECEPCION,
            is_active=False,
        )
        self.db.add(cuenta)
        self.db.flush()
        return cuenta

    # ------------------------------------------- apartados que ya vencieron
    def liberar_apartados_vencidos(self) -> int:
        """Devuelve a la venta las salidas de quien nunca terminó de pagar.

        Se llama antes de consultar disponibilidad y antes de apartar: así no
        hace falta un proceso aparte corriendo en segundo plano, y el horario
        se libera justo cuando alguien lo está buscando, que es cuando importa.
        """
        vencidas = self.db.execute(
            select(Reservation).where(
                Reservation.hold_expires_at.is_not(None),
                Reservation.hold_expires_at < datetime.utcnow(),
                Reservation.status == ReservationStatus.PENDIENTE,
            )
        ).scalars().all()

        cuenta = self.cuenta_del_sitio() if vencidas else None
        for reserva in vencidas:
            self.reservas.cancel(
                reserva.id,
                "Apartado vencido: no se completó el pago en línea",
                cuenta,
            )
        return len(vencidas)

    # ---------------------------------------------------------- el catálogo
    def campo(self) -> dict:
        """Todo lo que el sitio necesita para pintar sus pantallas, de un jalón.

        Va en una sola llamada porque el sitio lo pide todo al abrir: partirlo
        en cinco endpoints solo haría cinco viajes para lo mismo.
        """
        configs = self.horarios.list_configs()
        config = configs[0] if configs else None

        tarifas = []
        for plan in self.precios.list_rates(active_only=True):
            # Individual ya no se vende; si queda alguna tarifa vieja, no se
            # publica para no ofrecer algo que el sistema va a rechazar.
            if plan.modality == BookingModality.INDIVIDUAL.value:
                continue
            tarifas.append({
                "modalidad": plan.modality,
                "hoyos": plan.holes,
                "categoria": plan.category,
                "dia": plan.day_type,
                "franja": plan.time_band,
                "precio": money(plan.price),
            })

        extras = []
        for s in self.servicios.list(active_only=True):
            if s.code == "REPLAY":
                continue  # el replay se vende en el mostrador, no por internet
            extras.append({
                "code": s.code,
                "nombre": s.name,
                "descripcion": s.description,
                "precio": money(s.price),
                # El caddie no lo cobra el club: se le paga directo a él. El
                # precio se publica para que nadie llegue sin saber cuánto traer.
                "pago_directo": s.code == "CADDIE",
            })

        return {
            "primera_salida": config.start_time if config else None,
            "ultima_salida": config.end_time if config else None,
            "intervalo_minutos": config.interval_minutes if config else None,
            "cupo_por_salida": config.slot_capacity if config else 4,
            "cierre_de_campo": self.ajustes.cierre_de_campo(),
            "twilight_desde": self.ajustes.twilight_desde(),
            "tipo_de_cambio": self.cambio.current_rate(),
            "tarifas": tarifas,
            "extras": extras,
            "paquetes": self.paquetes(),
            "minimo_grupo": self.PAQUETES[BookingModality.GRUPO]["minimo"],
            "cupo_partida_abierta": self.PAQUETES[BookingModality.PARTIDA_ABIERTA]["maximo"],
            "apartado_minutos": settings.APARTADO_MINUTOS,
            # Stripe le gana al simulador: si las dos están configuradas, se
            # cobra de verdad. Tener el simulador activo en un servidor con
            # Stripe sería la forma más fácil de confirmar reservas con
            # tarjetas inventadas.
            "cobro_disponible": stripe_gateway.disponible() or settings.PAGOS_SIMULADOS,
            "pasarela": (
                "stripe" if stripe_gateway.disponible()
                else "simulado" if settings.PAGOS_SIMULADOS
                else None
            ),
        }

    # ------------------------------------------------------ disponibilidad
    def salidas(self, dia: date) -> dict:
        """Las salidas de un día, con lo mínimo que el público puede saber.

        De una salida ocupada solo se dice que está ocupada. Ni quién reservó,
        ni de qué hotel, ni cuánta gente va: eso es de la operación del campo,
        y esta respuesta la puede pedir cualquiera.
        """
        self.liberar_apartados_vencidos()

        if dia < hoy_local():
            raise BusinessRuleError("Esa fecha ya pasó")

        admite_abiertas = self.reservas.dia_admite_abiertas(dia)
        twilight = self.ajustes.twilight_desde()
        limite = self.ajustes.hora_limite_del_dia()

        from app.shared.tiempo import dia_cerrado

        cerrado = (not settings.horarios_libres) and dia_cerrado(dia, limite)

        salidas = []
        for slot in self.disponibilidad.day(dia):
            vencida = (not settings.horarios_libres) and ya_paso(slot.slot_date, slot.slot_time)
            libres = max(slot.capacity - slot.occupied, 0)
            # Una partida abierta cerrada a mano ya no admite a nadie aunque
            # le sobren lugares.
            if slot.open_closed:
                libres = 0
            salidas.append({
                "id": slot.id,
                "hora": slot.slot_time,
                "libres": 0 if (vencida or cerrado) else libres,
                "twilight": bool(twilight and slot.slot_time >= twilight),
            })

        return {
            "fecha": dia,
            "dia_cerrado": cerrado,
            "admite_partida_abierta": admite_abiertas,
            "cierre_de_campo": self.ajustes.cierre_de_campo(),
            "twilight_desde": twilight,
            "salidas": salidas,
        }

    # --------------------------------------------- el paquete y los límites
    # Lo mismo que ofrece el mostrador. Se escribe aquí y el sitio lo lee de
    # /campo en lugar de traerlo repetido en su propio código: el día que el
    # club cambie el mínimo de un grupo, cambia en los dos lados a la vez.
    PAQUETES = {
        BookingModality.GRUPO: {"minimo": 4, "maximo": 8},
        # La partida abierta se comparte: nunca puede pedir más que el cupo de
        # la franja, porque los demás lugares son de quien se junte.
        BookingModality.PARTIDA_ABIERTA: {"minimo": 1, "maximo": 4},
    }

    def paquetes(self) -> list:
        return [
            {
                "modalidad": m.value,
                "minimo": t["minimo"],
                "maximo": t["maximo"],
            }
            for m, t in self.PAQUETES.items()
        ]

    def _modalidad(self, valor) -> BookingModality:
        try:
            return BookingModality(str(valor))
        except ValueError:
            raise ValidationError("Ese paquete no existe")

    def _revisar_paquete(self, modalidad: BookingModality, cuantos: int, dia: date) -> None:
        """Las dos reglas del paquete, antes de cotizar o de apartar.

        Se revisan aquí además de en `ReservationService_` para que el aviso
        salga mientras se llena el formulario, y no después de que el huésped
        ya le dio a pagar.
        """
        topes = self.PAQUETES[modalidad]
        if cuantos < topes["minimo"]:
            raise BusinessRuleError(
                f"Ese paquete necesita al menos {topes['minimo']} "
                f"jugador{'es' if topes['minimo'] > 1 else ''}."
            )
        if cuantos > topes["maximo"]:
            raise BusinessRuleError(
                f"Ese paquete admite hasta {topes['maximo']} jugadores."
            )
        if modalidad == BookingModality.PARTIDA_ABIERTA and not self.reservas.dia_admite_abiertas(dia):
            raise BusinessRuleError(
                "Ese día el campo no está armando partidas abiertas. Reserve "
                "con cuatro jugadores o elija otra fecha."
            )

    # ------------------------------------------------------- la cotización
    def cotizar(self, datos) -> dict:
        """Lo que va a costar, calculado por el servidor.

        El sitio **no** saca este número por su cuenta. La tarifa que aplica
        sale de una cascada de cuatro niveles —franja, día, modalidad, edad—
        que vive en `PricingService`; una copia de esa cascada en JavaScript
        se desincroniza el día que el club mueva un precio, y entonces el
        huésped vería un total y Stripe le cobraría otro. Así que la pantalla
        pregunta y pinta la respuesta.
        """
        slot = self.disponibilidad.slots.get(datos.tee_slot_id)
        if slot is None:
            raise NotFoundError("Esa salida no existe")
        modalidad = self._modalidad(datos.modalidad)
        self._revisar_paquete(modalidad, len(datos.jugadores), slot.slot_date)

        renglones = []
        green_fees = ZERO
        for i, j in enumerate(datos.jugadores):
            categoria = self._categoria(j.edad)
            plan = self._tarifa(
                modalidad=modalidad,
                hoyos=datos.hoyos,
                categoria=categoria,
                slot=slot,
            )
            renglones.append({
                "nombre": (j.nombre or "").strip() or f"Jugador {i + 1}",
                "categoria": categoria.value,
                "green_fee": money(plan.price),
            })
            green_fees += money(plan.price)

        sets = sum(1 for j in datos.jugadores if j.bastones)
        bastones = self._servicio("BASTONES")
        precio_sets = money(bastones.price) * sets if bastones else ZERO

        caddie = self._servicio("CADDIE")

        return {
            "modalidad": modalidad.value,
            "hoyos": datos.hoyos,
            "fecha": slot.slot_date,
            "hora": slot.slot_time,
            "twilight": bool(
                self.ajustes.twilight_desde()
                and slot.slot_time >= self.ajustes.twilight_desde()
            ),
            "jugadores": renglones,
            "green_fees": green_fees,
            "sets_bastones": sets,
            "precio_bastones": money(bastones.price) if bastones else ZERO,
            "subtotal_bastones": precio_sets,
            "total": green_fees + precio_sets,
            # Aparte del total a propósito: el club no cobra el caddie, se le
            # paga directo a él. Va en la respuesta solo para que el sitio
            # pueda decir cuánto traer.
            "caddie_por_persona": money(caddie.price) if caddie else None,
        }

    def _tarifa(self, *, modalidad: BookingModality, hoyos: int, categoria, slot):
        """La tarifa que aplica, con un aviso que un huésped pueda leer.

        Si falta la combinación en el tarifario, `PricingService` contesta
        "dela de alta en Control del sistema › Tarifas", que es la frase
        correcta para quien administra el campo y una grosería para un turista
        que solo quiere jugar. Pasa de verdad: hoy no hay precio de menor a 9
        hoyos. Así que aquí se traduce.
        """
        try:
            return self.precios.resolve_rate(
                modality=modalidad.value,
                holes=hoyos,
                category=categoria,
                on_date=slot.slot_date,
                at_time=slot.slot_time,
            )
        except NotFoundError:
            quien = "los menores" if str(categoria).endswith("INFANTIL") else "esa categoría"
            raise BusinessRuleError(
                f"Todavía no vendemos {hoyos} hoyos para {quien} por internet. "
                f"Elija el recorrido completo o llámenos y lo acomodamos."
            )

    def _categoria(self, edad: Optional[int]):
        """La misma regla que usa el mostrador: menor de 16 es infantil."""
        from app.shared.enums import PlayerCategory

        return (
            PlayerCategory.INFANTIL
            if edad is not None and edad < 16
            else PlayerCategory.ADULTO
        )

    def _servicio(self, code: str):
        return next(
            (s for s in self.servicios.list(active_only=True) if s.code == code),
            None,
        )

    # ------------------------------------------------------- apartar salida
    def apartar(self, datos, ip: Optional[str] = None) -> Reservation:
        """Crea la reserva en PENDIENTE y le pone hora de vencimiento.

        A partir de aquí la salida ya es suya, pero solo por unos minutos.
        """
        self.liberar_apartados_vencidos()

        cuenta = self.cuenta_del_sitio()
        modalidad = self._modalidad(datos.modalidad)
        self._revisar_paquete(modalidad, len(datos.jugadores), datos.fecha)

        # Se revisa el tarifario antes de crear nada. `ReservationService_`
        # lo vuelve a resolver, pero si falta una combinación contesta con la
        # frase del administrador; aquí se adelanta para que el huésped lea
        # algo que le sirva.
        slot = self.disponibilidad.slots.get(datos.tee_slot_id)
        if slot is None:
            raise NotFoundError("Esa salida no existe")
        for j in datos.jugadores:
            self._tarifa(
                modalidad=modalidad,
                hoyos=datos.hoyos,
                categoria=self._categoria(j.edad),
                slot=slot,
            )

        # El primero de la lista es el titular: es quien pone el correo y a
        # quien le llega el pase. El sitio lo manda siempre en primer lugar.
        players = []
        for i, j in enumerate(datos.jugadores):
            players.append(
                PlayerIn(
                    full_name=j.nombre.strip(),
                    age=j.edad,
                    is_holder=(i == 0),
                    pga_code=(j.pga or None),
                    # Un solo dato: el jugador da su hándicap o su GHIN, y lo
                    # que el club necesita es tenerlo anotado.
                    handicap=(j.handicap or None),
                    club_hand=(j.bastones or None),
                )
            )

        sets = sum(1 for j in datos.jugadores if j.bastones)
        servicios = []
        if sets:
            bastones = self._servicio("BASTONES")
            if bastones:
                servicios.append({"service_id": bastones.id, "quantity": sets})

        titular = datos.jugadores[0]
        cuerpo = ReservationCreate(
            tee_slot_id=datos.tee_slot_id,
            modality=modalidad,
            holes=datos.hoyos,
            holder_name=titular.nombre.strip(),
            holder_email=datos.correo,
            holder_phone=datos.telefono,
            booked_by_name=QUIEN_RESERVA,
            players=players,
            services=servicios,
            notes=f"Reserva desde el sitio del club{f' · {ip}' if ip else ''}",
        )

        # Sin pase todavía: esto es un apartado, no una reserva. El QR sale
        # cuando el dinero entra.
        reserva = self.reservas.create(cuerpo, cuenta, mandar_pase=False)

        # El apartado. Se escribe después de crear porque hasta aquí ya se sabe
        # que la salida estaba libre y que el cupo se tomó.
        reserva.hold_expires_at = datetime.utcnow() + timedelta(
            minutes=settings.APARTADO_MINUTOS
        )
        self.db.commit()
        self.db.refresh(reserva)
        return reserva

    # --------------------------------------------------------------- cobro
    # --------------------------------------------------------------- cobro
    def _reserva(self, folio: str) -> Reservation:
        reserva = self.db.execute(
            select(Reservation).where(Reservation.folio == folio.upper().strip())
        ).scalars().first()
        if reserva is None:
            raise NotFoundError("No encontramos esa reserva")
        return reserva

    def _apartado_vigente(self, reserva: Reservation) -> None:
        """Revisa que la salida siga siendo suya antes de dejarlo pagar."""
        estado = ReservationStatus(str(reserva.status))
        if estado == ReservationStatus.CANCELADA:
            raise BusinessRuleError(
                "El apartado de esa salida venció y el horario volvió a la "
                "venta. Elija otra salida."
            )
        if estado != ReservationStatus.PENDIENTE:
            raise BusinessRuleError("Esa reserva ya está confirmada")
        if reserva.hold_expires_at and reserva.hold_expires_at < datetime.utcnow():
            # Se cancela en el momento, para que el horario no se quede trabado
            # esperando al barrido de la siguiente consulta.
            self.reservas.cancel(
                reserva.id,
                "Apartado vencido: no se completó el pago en línea",
                self.cuenta_del_sitio(),
            )
            raise BusinessRuleError(
                "Se acabó el tiempo para pagar y la salida volvió a la venta. "
                "Vuelva a elegir un horario."
            )

    def soltar(self, folio: str) -> dict:
        """Deshace un apartado que nunca se pagó.

        Es lo que pasa cuando el huésped le da para atrás en la página de
        Stripe. Antes la salida se quedaba apartada hasta que venciera el
        plazo, y el sitio le decía «su salida quedó apartada, le llamamos» —
        una promesa que nadie pidió y que además dejaba el horario muerto
        media hora.

        Solo suelta apartados: una reserva ya confirmada o una del mostrador
        no se tocan desde aquí, aunque alguien teclee su folio. Y es seguro
        llamarla dos veces, porque la segunda ya la encuentra cancelada.
        """
        reserva = self._reserva(folio)
        estado = ReservationStatus(str(reserva.status))

        if estado == ReservationStatus.CANCELADA:
            return {"estado": "CANCELADA", "folio": reserva.folio}

        if estado != ReservationStatus.PENDIENTE or reserva.hold_expires_at is None:
            raise BusinessRuleError(
                "Esa reserva ya no se puede soltar desde el sitio. "
                "Comuníquese con el club."
            )

        self.reservas.cancel(
            reserva.id,
            "El huésped no completó el pago en línea",
            self.cuenta_del_sitio(),
        )
        return {"estado": "CANCELADA", "folio": reserva.folio}

    def iniciar_cobro(self, folio: str) -> dict:
        """Abre la página de pago de Stripe para una reserva apartada.

        Devuelve la dirección a la que hay que mandar al huésped. El monto sale
        de la reserva, nunca de lo que mande el navegador.
        """
        reserva = self._reserva(folio)
        self._apartado_vigente(reserva)

        if not stripe_gateway.disponible():
            raise BusinessRuleError(
                "El cobro en línea todavía no está configurado. Comuníquese "
                "con el club para confirmar su salida."
            )

        slot = reserva.tee_slot
        cuando = (
            f"{slot.slot_date.strftime('%d/%m/%Y')} a las "
            f"{slot.slot_time.strftime('%H:%M')}"
            if slot else ""
        )
        jugadores = len(reserva.players)

        sesion = stripe_gateway.crear_sesion(
            folio=reserva.folio,
            total=money(reserva.total),
            descripcion=(
                f"{jugadores} jugador{'es' if jugadores > 1 else ''} · {cuando} "
                "· Las Parotas, Club de Golf Huatulco"
            ),
            correo=reserva.holder_email,
            # La sesión de pago caduca junto con el apartado de la salida.
            vence_en=int(reserva.hold_expires_at.replace(tzinfo=timezone.utc).timestamp()),
        )
        reserva.stripe_session_id = sesion["id"]
        self.db.commit()
        return {"url": sesion["url"], "folio": reserva.folio}

    # ------------------------------------------------- lo que avisa Stripe
    def confirmar_pago(self, *, folio: str, referencia: str, monto_centavos: int,
                       marca: Optional[str] = None, ultimos4: Optional[str] = None,
                       payment_intent: Optional[str] = None) -> dict:
        """Registra el cobro y confirma la reserva. Lo llama el webhook.

        Tiene que aguantar que lo llamen dos veces con lo mismo: Stripe reintenta
        sus avisos si no contestamos rápido, y cobrar dos veces la misma partida
        sería peor que perder el aviso.
        """
        reserva = self._reserva(folio)

        ya_registrado = self.db.execute(
            select(Payment).where(
                Payment.reservation_id == reserva.id,
                Payment.reference == referencia,
            )
        ).scalars().first()
        if ya_registrado:
            return {"estado": "ya_estaba", "folio": reserva.folio}

        estado = ReservationStatus(str(reserva.status))

        # El caso feo: el pago entró justo cuando el apartado ya había vencido y
        # la salida volvió a la venta. Quedarse con el dinero de una partida que
        # el huésped no va a poder jugar no es una opción, así que se devuelve.
        if estado == ReservationStatus.CANCELADA:
            devolucion = None
            if payment_intent:
                try:
                    devolucion = stripe_gateway.devolver(payment_intent)
                except Exception:   # noqa: BLE001 — se registra y sigue
                    devolucion = None
            self.db.add(Payment(
                reservation_id=reserva.id,
                cash_session_id=None,
                currency=Currency.MXN,
                amount=money(Decimal(monto_centavos) / Decimal(100)),
                exchange_rate_applied=reserva.exchange_rate_applied,
                amount_mxn=money(Decimal(monto_centavos) / Decimal(100)),
                change_mxn=ZERO,
                method=PaymentMethod.TARJETA,
                reference=referencia,
                notes=(
                    "Pago recibido con el apartado ya vencido. "
                    + (f"Devuelto: {devolucion}" if devolucion
                       else "NO SE PUDO DEVOLVER AUTOMÁTICAMENTE — revisar en Stripe")
                ),
                received_by_id=self.cuenta_del_sitio().id,
            ))
            self.db.commit()
            return {"estado": "devuelto", "folio": reserva.folio}

        monto = money(Decimal(monto_centavos) / Decimal(100))
        self.db.add(Payment(
            reservation_id=reserva.id,
            # Sin turno de caja: un cobro por internet no entra al cajón del
            # mostrador, y mezclarlo descuadraría el corte del día.
            cash_session_id=None,
            currency=Currency.MXN,
            amount=monto,
            exchange_rate_applied=reserva.exchange_rate_applied,
            amount_mxn=monto,
            change_mxn=ZERO,
            method=PaymentMethod.TARJETA,
            reference=referencia,
            notes=f"Pago en línea · {marca or 'tarjeta'} ····{ultimos4 or '----'}",
            received_by_id=self.cuenta_del_sitio().id,
        ))
        reserva.hold_expires_at = None
        self.db.commit()

        if estado == ReservationStatus.PENDIENTE:
            # Confirmar pasa por la máquina de estados y avisa a las pantallas
            # del campo, que es como se entera el operador de que entró una
            # reserva mientras no había nadie en el mostrador.
            self.reservas.confirm(reserva.id, self.cuenta_del_sitio())
            # Y aquí sale el pase con el QR: hasta ahora hay algo que prometer.
            self.db.refresh(reserva)
            self.reservas._mandar_pase(reserva)

        self.db.refresh(reserva)
        return {"estado": "confirmada", "folio": reserva.folio}

    def cobrar_simulado(self, folio: str, tarjeta) -> dict:
        """El cobro de mentiras, para desarrollar sin tocar Stripe.

        Solo corre si Stripe NO está configurado y el simulador está prendido a
        mano. Stripe le gana siempre: tener los dos activos y que mandara este
        sería la forma más fácil de confirmar reservas con tarjetas inventadas.
        """
        if stripe_gateway.disponible() or not settings.PAGOS_SIMULADOS:
            raise BusinessRuleError(
                "El cobro simulado no está disponible."
            )

        reserva = self._reserva(folio)
        self._apartado_vigente(reserva)

        resultado = simulador.cobrar(
            numero=tarjeta.numero,
            mes=tarjeta.mes,
            anio=tarjeta.anio,
            cvv=tarjeta.cvv,
            nombre=tarjeta.nombre,
        )
        if not resultado.aprobado:
            # Un rechazo no suelta la salida: el huésped puede reintentar con
            # otra tarjeta mientras le dure el apartado.
            return {
                "aprobado": False,
                "motivo": resultado.motivo,
                "folio": reserva.folio,
                "vence": reserva.hold_expires_at,
            }

        self.confirmar_pago(
            folio=reserva.folio,
            referencia=resultado.referencia,
            monto_centavos=int(money(reserva.total) * 100),
            marca=resultado.marca,
            ultimos4=resultado.ultimos4,
        )
        return {
            "aprobado": True,
            "folio": reserva.folio,
            "referencia": resultado.referencia,
            "marca": resultado.marca,
            "ultimos4": resultado.ultimos4,
            "total": money(reserva.total),
        }

    # ------------------------------------------------------- consulta final
    def estado(self, folio: str) -> dict:
        """Lo que el huésped puede ver de su propia reserva.

        Deliberadamente corto: folio, día, hora, cuántos y cuánto. Ni el QR ni
        los datos de los demás, porque un folio se adivina más fácil que un
        token y esta ruta no pide sesión.
        """
        reserva = self.db.execute(
            select(Reservation).where(Reservation.folio == folio.upper().strip())
        ).scalars().first()
        if reserva is None:
            raise NotFoundError("No encontramos esa reserva")

        slot = reserva.tee_slot
        # SQLAlchemy devuelve la columna como texto, no como el enum.
        estado = ReservationStatus(str(reserva.status))
        return {
            "folio": reserva.folio,
            # Al huésped le basta saber si ya quedó. Los estados de la
            # operación —en mostrador, en juego, finalizada— son del campo.
            "estado": (
                estado.value
                if estado in (ReservationStatus.PENDIENTE, ReservationStatus.CANCELADA)
                else "CONFIRMADA"
            ),
            "fecha": slot.slot_date if slot else None,
            "hora": slot.slot_time if slot else None,
            "jugadores": len(reserva.players),
            "titular": reserva.holder_name,
            "total": money(reserva.total),
            "vence": reserva.hold_expires_at,
        }
