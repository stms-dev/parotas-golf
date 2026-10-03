"""Reservas, franjas, jugadores y acompañantes."""
from datetime import date, datetime, time
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.shared.enums import (
    BookingModality,
    InvoiceStatus,
    PlayerCategory,
    ReservationStatus,
    SlotStatus,
)
from app.shared.money import DecimalMoney, DecimalRate


class TeeSlot(Base):
    """Franja de salida.

    El UNIQUE sobre (fecha, tee, hora) más la resta de cupo dentro de la
    transacción es lo que impide sobrevender: dos hoteles pidiendo el último
    lugar de las 10:30 al mismo tiempo es un escenario real, no teórico.
    Validar solo en la capa de aplicación no basta.
    """

    __tablename__ = "tee_slots"
    __table_args__ = (
        UniqueConstraint("slot_date", "tee", "slot_time", name="uq_tee_slot_unico"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    slot_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    tee: Mapped[str] = mapped_column(String(24), default="CAMPO", nullable=False, index=True)
    slot_time: Mapped[time] = mapped_column(Time, nullable=False, index=True)

    capacity: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    occupied: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[SlotStatus] = mapped_column(
        String(24), default=SlotStatus.DISPONIBLE, nullable=False, index=True
    )

    event_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("course_events.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # El operador cerró la partida abierta antes de que se llenara: ya va a
    # salir y no quiere que entre nadie más. Va en su propia columna y no en
    # `status` porque el estado se recalcula desde las reservas, y un recálculo
    # borraría la decisión.
    open_closed: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    open_closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    reservations = relationship("Reservation", back_populates="tee_slot")
    # Replays que se juegan en esta salida (toman la salida completa).
    replays = relationship("ReplayTicket", lazy="selectin", viewonly=True)
    event = relationship("CourseEvent", back_populates="slots")

    @property
    def available(self) -> int:
        """Lugares que todavía se pueden vender en esta salida.

        Una salida ya asignada devuelve 0 aunque sobren asientos: solo la
        partida abierta sigue admitiendo jugadores.
        """
        if self.status in (SlotStatus.BLOQUEADO, SlotStatus.OCUPADO):
            return 0
        return max(self.capacity - self.occupied, 0)

    @property
    def is_free(self) -> bool:
        return self.status == SlotStatus.DISPONIBLE


class Reservation(Base):
    """Reserva.

    Copia el tipo de cambio y la comisión vigentes al momento de crearse.
    Esos dos campos nunca se recalculan: son la trazabilidad financiera.
    """

    __tablename__ = "reservations"

    id: Mapped[int] = mapped_column(primary_key=True)
    folio: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)

    hotel_id: Mapped[int] = mapped_column(
        ForeignKey("hotels.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # La cuenta es del hotel o del puesto, no de la persona: varios turnos usan
    # la misma. Estos dos guardan el nombre de quien estuvo frente a la
    # pantalla, que es lo que sirve cuando hay que aclarar algo.
    booked_by_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    attended_by_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    tee_slot_id: Mapped[int] = mapped_column(
        ForeignKey("tee_slots.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    modality: Mapped[BookingModality] = mapped_column(String(32), nullable=False, index=True)
    holes: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[ReservationStatus] = mapped_column(
        String(24), default=ReservationStatus.PENDIENTE, nullable=False, index=True
    )

    # --- Titular ---
    holder_name: Mapped[str] = mapped_column(String(180), nullable=False, index=True)
    holder_email: Mapped[str] = mapped_column(String(180), nullable=False)
    holder_phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, index=True)
    holder_room: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    # Carritos que ocupa la partida. No se elige: sale de cuánta gente va.
    carts_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Caddies asignados: uno por carrito, hasta donde alcancen los que hay. No
    # se cobra aquí — el huésped le paga directo al caddie — así que este número
    # es de operación, no de dinero.
    caddies_used: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --- Valores congelados al momento de la operación ---
    discount_code_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("discount_codes.id", ondelete="SET NULL"), nullable=True
    )
    discount_code_applied: Mapped[Optional[str]] = mapped_column(String(48), nullable=True)
    exchange_rate_applied: Mapped[Decimal] = mapped_column(DecimalRate, nullable=False)
    commission_rate_applied: Mapped[Decimal] = mapped_column(DecimalRate, nullable=False)

    # --- Totales (todos en MXN) ---
    subtotal_green_fees: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    subtotal_services: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    pga_discount_amount: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    total: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)

    # --- Pase QR (por reserva; adentro va la lista de jugadores) ---
    qr_token: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True, nullable=True)
    qr_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # --- Facturación (bandera simple; CFDI queda preparado, no implementado) ---
    invoice_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    invoice_contact_email: Mapped[Optional[str]] = mapped_column(String(180), nullable=True)
    invoice_status: Mapped[InvoiceStatus] = mapped_column(
        String(24), default=InvoiceStatus.NO_REQUERIDA, nullable=False
    )

    # --- Trazabilidad de transiciones: qué, cuándo y quién ---
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    confirmed_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Momento en que la partida salió al campo (al quedar pagada). Con esto y
    # completed_at se mide cuánto dura una partida.
    round_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    checked_in_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    cancelled_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    cancellation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --- Campo suspendido: la partida salió pero no se pudo terminar ---
    # En qué hoyo se quedaron. De ahí reanudan cuando vuelven.
    interrupted_at_hole: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    interrupted_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    interrupted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Si esta reserva es la ronda de cortesía, apunta a la que se interrumpió.
    rescheduled_from_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("reservations.id", ondelete="RESTRICT"), nullable=True, index=True
    )

    # --- Reserva hecha desde el sitio, sin cuenta ---
    # Hasta cuándo se le aparta la salida a quien está pagando. Pasada esa
    # hora sin pago, la reserva se cancela sola y el horario vuelve a la venta.
    # Solo lo traen las reservas del sitio: las del mostrador y las de los
    # hoteles las sostiene una persona, no un reloj.
    hold_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True, index=True
    )
    # La sesión de pago de Stripe. Se guarda para poder rastrear un cobro hasta
    # su reserva cuando algo sale raro y hay que mirarlo en el panel de Stripe.
    stripe_session_id: Mapped[Optional[str]] = mapped_column(
        String(120), nullable=True, index=True
    )

    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, onupdate=func.now(), nullable=True)

    hotel = relationship("Hotel", back_populates="reservations", lazy="joined")
    tee_slot = relationship("TeeSlot", back_populates="reservations", lazy="joined")
    # La partida que se interrumpió, si esta es su reposición. remote_side la
    # necesita porque las dos puntas de la relación son la misma tabla.
    rescheduled_from = relationship(
        "Reservation", remote_side=[id], foreign_keys=[rescheduled_from_id],
        backref="reposiciones", lazy="joined",
    )
    players: Mapped[List["ReservationPlayer"]] = relationship(
        back_populates="reservation", cascade="all, delete-orphan", lazy="selectin"
    )
    companions: Mapped[List["ReservationCompanion"]] = relationship(
        back_populates="reservation", cascade="all, delete-orphan", lazy="selectin"
    )
    services: Mapped[List["ReservationService"]] = relationship(
        back_populates="reservation", cascade="all, delete-orphan", lazy="selectin"
    )
    payments = relationship("Payment", back_populates="reservation", lazy="selectin")
    replays = relationship(
        "ReplayTicket", back_populates="reservation", lazy="selectin", order_by="ReplayTicket.id"
    )

    @property
    def player_count(self) -> int:
        return len(self.players)


class ReservationPlayer(Base):
    """Jugador. Aquí vive el PGA: el beneficio es del jugador, no de la reserva.

    `arrived` a nivel jugador es lo que permite el QR por paquete: se escanea
    uno, se despliegan todos, y recepción palomea quién llegó.
    """

    __tablename__ = "reservation_players"

    id: Mapped[int] = mapped_column(primary_key=True)
    reservation_id: Mapped[int] = mapped_column(
        ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False, index=True
    )

    full_name: Mapped[str] = mapped_column(String(180), nullable=False)
    age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    category: Mapped[PlayerCategory] = mapped_column(
        String(24), default=PlayerCategory.ADULTO, nullable=False
    )
    handicap: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    # El identificador con el que ese hándicap se verifica en el padrón. Va
    # aparte porque es otro dato: el hándicap es el número, el GHIN es la
    # credencial que lo respalda.
    ghin: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    # Mano con la que juega: define qué juego de bastones se le prepara.
    # DIESTRO | ZURDO, o nulo si trae los suyos.
    club_hand: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    is_holder: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # --- PGA, individual ---
    pga_code: Mapped[Optional[str]] = mapped_column(String(48), nullable=True, index=True)
    credential_number: Mapped[Optional[str]] = mapped_column(String(48), nullable=True)
    pga_validated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    pga_validated_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    pga_validated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    pga_discount_applied: Mapped[Decimal] = mapped_column(
        DecimalMoney, default=Decimal("0.00"), nullable=False
    )

    # --- Tarifa congelada ---
    rate_applied: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)
    final_rate: Mapped[Decimal] = mapped_column(DecimalMoney, default=Decimal("0.00"), nullable=False)

    arrived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    arrived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    reservation = relationship("Reservation", back_populates="players")
    pga_validated_by = relationship("User", foreign_keys=[pga_validated_by_id], lazy="joined")


class ReservationCompanion(Base):
    """Acompañante. No consume cupo ni paga green fee, pero sí paga su lugar.

    Su llegada se marca en el mostrador igual que la de un jugador: si no se
    presenta, su cargo sale de la cuenta.
    """

    __tablename__ = "reservation_companions"

    id: Mapped[int] = mapped_column(primary_key=True)
    reservation_id: Mapped[int] = mapped_column(
        ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    full_name: Mapped[str] = mapped_column(String(180), nullable=False)
    age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    arrived: Mapped[bool] = mapped_column(default=False, nullable=False)

    reservation = relationship("Reservation", back_populates="companions")


class ReservationService(Base):
    """Servicio contratado. El precio se copia al momento de contratar."""

    __tablename__ = "reservation_services"

    id: Mapped[int] = mapped_column(primary_key=True)
    reservation_id: Mapped[int] = mapped_column(
        ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    player_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("reservation_players.id", ondelete="SET NULL"), nullable=True
    )
    service_id: Mapped[int] = mapped_column(
        ForeignKey("additional_services.id", ondelete="RESTRICT"), nullable=False
    )

    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price_applied: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    total: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Lo que se agregó en el mostrador es venta del campo y no pasa por el
    # convenio: el hotel no la ve ni entra en el total que se le muestra.
    added_at_counter: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    reservation = relationship("Reservation", back_populates="services")
    service = relationship("AdditionalService", lazy="joined")


class CourseDayRule(Base):
    """Reglas de un día concreto del campo.

    Hoy solo lleva una: si ese día acepta partidas abiertas. En días pesados el
    campo prefiere no andar armando grupos de hoteles distintos, y eso se decide
    por día, no de una vez para siempre.

    No hay fila para cada día del año: sin fila, el día se comporta como normal.
    """

    __tablename__ = "course_day_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date, nullable=False, unique=True, index=True)
    open_partidas_allowed: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="1", nullable=False
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
