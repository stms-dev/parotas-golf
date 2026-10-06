"""Catálogo: todo lo configurable desde Administración.

Regla de oro del sistema: nada de esto está en el código. Si el administrador
cambia una tarifa, el tipo de cambio o la comisión, las operaciones ya
registradas conservan los valores que usaron en su momento.
"""
from datetime import date, datetime, time
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.shared.enums import DayType, DiscountType, PlayerCategory, ServiceUnit, TimeBand
from app.shared.money import DecimalMoney, DecimalRate


class Hotel(Base):
    """Hotel con convenio. La comisión es por hotel, no global:
    si mañana se negocia distinto con uno, no se toca código."""

    __tablename__ = "hotels"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    contact_name: Mapped[Optional[str]] = mapped_column(String(180), nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(180), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)

    commission_rate: Mapped[Decimal] = mapped_column(
        DecimalRate, default=Decimal("5.0000"), nullable=False,
        comment="Porcentaje de participación del hotel sobre venta bruta",
    )

    # El mostrador también vende a quien llega sin hotel. Ese "hotel" es el
    # club mismo: no paga comisión y no tiene concierge que entre al sistema.
    is_direct: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, onupdate=func.now(), nullable=True)

    users = relationship("User", back_populates="hotel")
    reservations = relationship("Reservation", back_populates="hotel")


class RatePlan(Base):
    """Tarifa vigente por modalidad, hoyos y categoría.

    Se maneja con vigencia (no un precio único) para poder subir tarifas sin
    romper el histórico ni perder la tarifa anterior.
    """

    __tablename__ = "rate_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    modality: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    holes: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    category: Mapped[PlayerCategory] = mapped_column(
        String(24), default=PlayerCategory.ADULTO, nullable=False, index=True
    )
    # Lunes a jueves, viernes a domingo, o cualquier día.
    day_type: Mapped[str] = mapped_column(
        String(16), default=DayType.TODOS.value, server_default=DayType.TODOS.value,
        nullable=False, index=True,
    )
    # A qué hora del día aplica. TWILIGHT es para las últimas salidas, que no
    # alcanzan a terminar 18 hoyos; TODAS vale a cualquier hora y es el respaldo.
    time_band: Mapped[str] = mapped_column(
        String(16), default=TimeBand.TODAS.value, server_default=TimeBand.TODAS.value,
        nullable=False, index=True,
    )

    price: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="MXN", nullable=False)

    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class AdditionalService(Base):
    """Caddie, buggy, bastones, locker, transporte, etc."""

    __tablename__ = "additional_services"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    price: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    # Si el servicio cuesta distinto de viernes a domingo (la zona de
    # práctica, por ejemplo). Vacío: vale `price` cualquier día.
    weekend_price: Mapped[Optional[Decimal]] = mapped_column(DecimalMoney, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="MXN", nullable=False)
    unit: Mapped[ServiceUnit] = mapped_column(String(24), default=ServiceUnit.POR_RONDA, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    def price_on(self, dia: Optional[date]) -> Decimal:
        """El precio que vale ese día: el de fin de semana si lo tiene."""
        if dia is not None and self.weekend_price is not None:
            if DayType.del_dia(dia) == DayType.FIN_DE_SEMANA:
                return self.weekend_price
        return self.price


class DiscountCode(Base):
    """Códigos de descuento y convenios comerciales.

    PGA NO vive aquí: es una acreditación del jugador, no un código de la
    reserva. Ver PGACredential / PGABenefitConfig.
    """

    __tablename__ = "discount_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(48), unique=True, index=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    discount_type: Mapped[DiscountType] = mapped_column(String(24), nullable=False)
    value: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)

    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Restricciones de aplicabilidad. NULL = aplica a todo.
    applicable_modalities: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, comment="Lista separada por comas"
    )
    applicable_holes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    hotel_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("hotels.id", ondelete="CASCADE"), nullable=True, index=True
    )
    min_players: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    hotel = relationship("Hotel")


class PGABenefitConfig(Base):
    """Configuración del beneficio PGA. Una sola fila activa a la vez.

    Separada de discount_codes porque PGA no es promoción: es acreditación
    profesional y se aplica al jugador, no a la reserva.
    """

    __tablename__ = "pga_benefit_config"

    id: Mapped[int] = mapped_column(primary_key=True)
    discount_type: Mapped[DiscountType] = mapped_column(String(24), nullable=False)
    value: Mapped[Decimal] = mapped_column(DecimalMoney, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class PGACredential(Base):
    """Credenciales acreditadas. Recepción valida contra esta tabla."""

    __tablename__ = "pga_credentials"

    id: Mapped[int] = mapped_column(primary_key=True)
    pga_code: Mapped[str] = mapped_column(String(48), unique=True, index=True, nullable=False)
    credential_number: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    professional_name: Mapped[str] = mapped_column(String(180), nullable=False)
    accreditation: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    valid_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    def is_valid_today(self, today: Optional[date] = None) -> bool:
        today = today or date.today()
        if not self.is_active:
            return False
        if self.valid_until and self.valid_until < today:
            return False
        return True


class CourseScheduleConfig(Base):
    """Generador maestro de franjas: de aquí salen los tee times."""

    __tablename__ = "course_schedule_config"

    id: Mapped[int] = mapped_column(primary_key=True)
    tee: Mapped[str] = mapped_column(String(24), default="CAMPO", nullable=False)
    label: Mapped[str] = mapped_column(String(120), default="Horarios de salida", nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    interval_minutes: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    slot_capacity: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    holes: Mapped[int] = mapped_column(Integer, default=18, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, onupdate=func.now(), nullable=True)


class ExchangeRate(Base):
    """Tipo de cambio operativo. Histórico inmutable.

    Nunca se edita una fila: se inserta una nueva. Eso es lo que hace que una
    operación de hace tres meses siga diciendo 17.20 aunque hoy vaya en 18.40.
    """

    __tablename__ = "exchange_rates"

    id: Mapped[int] = mapped_column(primary_key=True)
    from_currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    to_currency: Mapped[str] = mapped_column(String(3), default="MXN", nullable=False)
    rate: Mapped[Decimal] = mapped_column(DecimalRate, nullable=False)

    effective_from: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    created_by = relationship("User", lazy="joined")


class SystemSetting(Base):
    """Parámetros sueltos con llave/valor (hora de corte, nombre del campo, etc.)."""

    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, onupdate=func.now(), nullable=True)
