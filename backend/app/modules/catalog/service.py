"""Servicios del catálogo: tarifas, TC, descuentos, PGA, horarios, hoteles."""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.modules.audit.service import AuditService
from app.modules.catalog.models import (
    AdditionalService,
    CourseScheduleConfig,
    DiscountCode,
    ExchangeRate,
    Hotel,
    PGABenefitConfig,
    PGACredential,
    RatePlan,
    SystemSetting,
)
from app.modules.catalog.schemas import (
    DiscountCreate,
    HotelCreate,
    HotelUpdate,
    PGABenefitConfigCreate,
    PGACredentialCreate,
    PGAValidationResult,
    RatePlanCreate,
    ScheduleConfigCreate,
    ServiceCreate,
)
from app.modules.identity.models import User
from app.realtime.events import EventType, RealtimeEvent
from app.realtime.manager import publish
from app.shared.enums import AuditAction, DayType, DiscountType, PlayerCategory
from app.shared.money import apply_percentage, money, rate as as_rate


class ExchangeRateService:
    """Tipo de cambio. Histórico inmutable: nunca se edita, siempre se inserta."""

    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def current(self, from_currency: str = "USD", to_currency: str = "MXN") -> ExchangeRate:
        stmt = (
            select(ExchangeRate)
            .where(
                ExchangeRate.from_currency == from_currency,
                ExchangeRate.to_currency == to_currency,
                ExchangeRate.effective_from <= datetime.utcnow(),
            )
            .order_by(ExchangeRate.effective_from.desc())
            .limit(1)
        )
        found = self.db.execute(stmt).scalar_one_or_none()
        if not found:
            raise NotFoundError(
                f"No hay tipo de cambio configurado para {from_currency}/{to_currency}"
            )
        return found

    def current_rate(self) -> Decimal:
        return self.current().rate

    def history(self, limit: int = 50) -> List[ExchangeRate]:
        stmt = select(ExchangeRate).order_by(ExchangeRate.effective_from.desc()).limit(limit)
        return list(self.db.execute(stmt).scalars().all())

    def set_rate(self, value: Decimal, actor: User, *, from_currency="USD", to_currency="MXN",
                 effective_from: Optional[datetime] = None) -> ExchangeRate:
        if value <= 0:
            raise ValidationError("El tipo de cambio debe ser mayor a cero")

        previous: Optional[Decimal] = None
        try:
            previous = self.current(from_currency, to_currency).rate
        except NotFoundError:
            pass

        new_rate = ExchangeRate(
            from_currency=from_currency,
            to_currency=to_currency,
            rate=as_rate(value),
            effective_from=effective_from or datetime.utcnow(),
            created_by_id=actor.id if actor else None,
        )
        self.db.add(new_rate)
        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module="catalog",
            entity="ExchangeRate", field="rate",
            old_value=previous, new_value=new_rate.rate,
            description=f"Tipo de cambio {from_currency}/{to_currency} actualizado",
        )
        self.db.commit()
        self.db.refresh(new_rate)

        # Este aviso sí va a todos: recepción está cobrando en USD con el TC en
        # pantalla y necesita enterarse en el momento, no al recargar.
        publish(
            RealtimeEvent(
                type=EventType.TIPO_CAMBIO_ACTUALIZADO,
                payload={
                    "anterior": str(previous) if previous else None,
                    "nuevo": str(new_rate.rate),
                    "par": f"{from_currency}/{to_currency}",
                    "actualizado_por": actor.full_name if actor else None,
                },
            )
        )
        return new_rate


class PricingService:
    """Resuelve qué tarifa aplica. Nada de precios en el código."""

    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def resolve_rate(
        self, *, modality: str, holes: int, category: PlayerCategory, on_date: Optional[date] = None
    ) -> RatePlan:
        on_date = on_date or date.today()
        stmt = (
            select(RatePlan)
            .where(
                RatePlan.modality == modality,
                RatePlan.holes == holes,
                RatePlan.category == category,
                RatePlan.is_active.is_(True),
                RatePlan.valid_from <= on_date,
            )
            .order_by(RatePlan.valid_from.desc())
        )
        vigentes = [
            plan for plan in self.db.execute(stmt).scalars().all()
            if plan.valid_to is None or plan.valid_to >= on_date
        ]

        # Manda la tarifa del día de la salida (entre semana o fin de semana);
        # si no hay una específica, vale la que aplica todos los días.
        dia = DayType.del_dia(on_date).value
        for buscado in (dia, DayType.TODOS.value):
            for plan in vigentes:
                if plan.day_type == buscado:
                    return plan

        nombre_dia = "de lunes a jueves" if dia == DayType.ENTRE_SEMANA.value else "de viernes a domingo"
        quien = "menor" if str(category).endswith("INFANTIL") else "adulto"
        raise NotFoundError(
            f"No hay tarifa para {quien} a {holes} hoyos {nombre_dia}. "
            "Dela de alta en Control del sistema › Tarifas."
        )

    def list_rates(self, *, active_only: bool = True) -> List[RatePlan]:
        stmt = select(RatePlan)
        if active_only:
            stmt = stmt.where(RatePlan.is_active.is_(True))
        stmt = stmt.order_by(RatePlan.modality, RatePlan.holes, RatePlan.category)
        return list(self.db.execute(stmt).scalars().all())

    def create_rate(self, data: RatePlanCreate, actor: User) -> RatePlan:
        plan = RatePlan(**data.model_dump())
        self.db.add(plan)
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module="catalog", entity="RatePlan",
            new_value=str(plan.price),
            description=f"Tarifa creada: {plan.name} ({plan.modality}/{plan.holes}H/{plan.category})",
        )
        self.db.commit()
        self.db.refresh(plan)
        return plan

    def update_rate(self, rate_id: int, data: dict, actor: User) -> RatePlan:
        plan = self.db.get(RatePlan, rate_id)
        if not plan:
            raise NotFoundError(f"Tarifa {rate_id} no encontrada")
        for field, value in data.items():
            if value is None:
                continue
            old = getattr(plan, field)
            if old != value:
                setattr(plan, field, value)
                self.audit.log(
                    user=actor, action=AuditAction.MODIFICAR, module="catalog",
                    entity="RatePlan", entity_id=plan.id, field=field,
                    old_value=old, new_value=value,
                )
        self.db.commit()
        self.db.refresh(plan)
        return plan


class DiscountService:
    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def list(self, *, active_only: bool = True) -> List[DiscountCode]:
        stmt = select(DiscountCode)
        if active_only:
            stmt = stmt.where(DiscountCode.is_active.is_(True))
        return list(self.db.execute(stmt.order_by(DiscountCode.code)).scalars().all())

    def get_by_code(self, code: str) -> Optional[DiscountCode]:
        stmt = select(DiscountCode).where(DiscountCode.code == code.upper().strip())
        return self.db.execute(stmt).scalar_one_or_none()

    def validate_for_reservation(
        self, code: str, *, modality: str, holes: int, hotel_id: int,
        player_count: int, on_date: Optional[date] = None,
    ) -> DiscountCode:
        """Verifica que el código exista, esté vigente y aplique a esta reserva."""
        on_date = on_date or date.today()
        discount = self.get_by_code(code)
        if not discount:
            raise NotFoundError(f"El código {code} no existe")
        if not discount.is_active:
            raise ValidationError(f"El código {code} está inactivo")
        if discount.valid_from > on_date:
            raise ValidationError(f"El código {code} aún no entra en vigencia")
        if discount.valid_to and discount.valid_to < on_date:
            raise ValidationError(f"El código {code} venció el {discount.valid_to}")
        if discount.hotel_id and discount.hotel_id != hotel_id:
            raise ValidationError(f"El código {code} no aplica para este hotel")
        if discount.applicable_holes and discount.applicable_holes != holes:
            raise ValidationError(f"El código {code} solo aplica a {discount.applicable_holes} hoyos")
        if discount.applicable_modalities:
            allowed = [m.strip().upper() for m in discount.applicable_modalities.split(",")]
            if modality.upper() not in allowed:
                raise ValidationError(f"El código {code} no aplica a la modalidad {modality}")
        if discount.min_players and player_count < discount.min_players:
            raise ValidationError(
                f"El código {code} requiere mínimo {discount.min_players} jugadores"
            )
        return discount

    def compute(self, discount: DiscountCode, base_amount: Decimal) -> Decimal:
        if discount.discount_type == DiscountType.PORCENTAJE:
            return apply_percentage(base_amount, discount.value)
        return min(money(discount.value), money(base_amount))

    def create(self, data: DiscountCreate, actor: User) -> DiscountCode:
        if self.get_by_code(data.code):
            raise ConflictError(f"Ya existe el código {data.code}")
        payload = data.model_dump()
        payload["code"] = payload["code"].upper().strip()
        discount = DiscountCode(**payload)
        self.db.add(discount)
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module="catalog", entity="DiscountCode",
            new_value=f"{discount.code} {discount.value}{'%' if discount.discount_type == DiscountType.PORCENTAJE else ' MXN'}",
            description=f"Código de descuento creado: {discount.code}",
        )
        self.db.commit()
        self.db.refresh(discount)
        return discount


class PGAService:
    """PGA: acreditación individual del jugador, no un código de la reserva.

    Vive fuera de discount_codes a propósito. En la interfaz solo aparece en
    la pantalla de check-in.
    """

    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def active_config(self) -> PGABenefitConfig:
        today = date.today()
        stmt = (
            select(PGABenefitConfig)
            .where(PGABenefitConfig.is_active.is_(True), PGABenefitConfig.valid_from <= today)
            .order_by(PGABenefitConfig.valid_from.desc())
            .limit(1)
        )
        config = self.db.execute(stmt).scalar_one_or_none()
        if not config:
            raise NotFoundError("No hay configuración de beneficio PGA activa")
        return config

    def set_config(self, data: PGABenefitConfigCreate, actor: User) -> PGABenefitConfig:
        previous = None
        try:
            previous = self.active_config()
            previous.is_active = False
        except NotFoundError:
            pass

        config = PGABenefitConfig(**data.model_dump(), is_active=True)
        self.db.add(config)
        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module="catalog",
            entity="PGABenefitConfig", field="value",
            old_value=previous.value if previous else None, new_value=config.value,
            description="Configuración de beneficio PGA actualizada",
        )
        self.db.commit()
        self.db.refresh(config)
        return config

    def find_credential(self, *, pga_code: Optional[str] = None,
                        credential_number: Optional[str] = None) -> Optional[PGACredential]:
        if not pga_code and not credential_number:
            return None
        stmt = select(PGACredential)
        if pga_code:
            stmt = stmt.where(PGACredential.pga_code == pga_code.upper().strip())
        if credential_number:
            stmt = stmt.where(PGACredential.credential_number == credential_number.strip())
        return self.db.execute(stmt).scalar_one_or_none()

    def validate(self, *, pga_code: Optional[str] = None,
                 credential_number: Optional[str] = None) -> PGAValidationResult:
        """Lo que consulta recepción en el mostrador."""
        credential = self.find_credential(pga_code=pga_code, credential_number=credential_number)
        if not credential:
            return PGAValidationResult(valid=False, message="Credencial no encontrada en el padrón")
        if not credential.is_valid_today():
            return PGAValidationResult(
                valid=False,
                message="Credencial vencida o inactiva",
                professional_name=credential.professional_name,
            )
        try:
            config = self.active_config()
        except NotFoundError:
            return PGAValidationResult(
                valid=False, message="No hay beneficio PGA configurado",
                professional_name=credential.professional_name,
            )
        return PGAValidationResult(
            valid=True,
            message="Credencial válida. Beneficio aplicable al titular.",
            professional_name=credential.professional_name,
            accreditation=credential.accreditation,
            discount_type=config.discount_type,
            discount_value=config.value,
        )

    def compute_discount(self, base_rate: Decimal) -> Decimal:
        config = self.active_config()
        if config.discount_type == DiscountType.PORCENTAJE:
            return apply_percentage(base_rate, config.value)
        return min(money(config.value), money(base_rate))

    def list_credentials(self, *, active_only: bool = True) -> List[PGACredential]:
        stmt = select(PGACredential)
        if active_only:
            stmt = stmt.where(PGACredential.is_active.is_(True))
        return list(self.db.execute(stmt.order_by(PGACredential.professional_name)).scalars().all())

    def create_credential(self, data: PGACredentialCreate, actor: User) -> PGACredential:
        if self.find_credential(pga_code=data.pga_code):
            raise ConflictError(f"Ya existe la credencial {data.pga_code}")
        payload = data.model_dump()
        payload["pga_code"] = payload["pga_code"].upper().strip()
        credential = PGACredential(**payload)
        self.db.add(credential)
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module="catalog", entity="PGACredential",
            new_value=credential.pga_code,
            description=f"Profesional acreditado: {credential.professional_name}",
        )
        self.db.commit()
        self.db.refresh(credential)
        return credential


class ScheduleService:
    """Configuración maestra de horarios: de aquí salen las franjas."""

    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def list_configs(self, *, active_only: bool = True) -> List[CourseScheduleConfig]:
        stmt = select(CourseScheduleConfig)
        if active_only:
            stmt = stmt.where(CourseScheduleConfig.is_active.is_(True))
        return list(self.db.execute(stmt.order_by(CourseScheduleConfig.tee)).scalars().all())

    def get_config(self, config_id: int) -> CourseScheduleConfig:
        config = self.db.get(CourseScheduleConfig, config_id)
        if not config:
            raise NotFoundError(f"Configuración de horario {config_id} no encontrada")
        return config

    @staticmethod
    def generate_times(config: CourseScheduleConfig) -> List[time]:
        """Expande la configuración a la lista de horas de salida."""
        times: List[time] = []
        cursor = datetime.combine(date.today(), config.start_time)
        end = datetime.combine(date.today(), config.end_time)
        while cursor <= end:
            times.append(cursor.time())
            cursor += timedelta(minutes=config.interval_minutes)
        return times

    def create_config(self, data: ScheduleConfigCreate, actor: User) -> CourseScheduleConfig:
        if data.start_time >= data.end_time:
            raise ValidationError("La hora inicial debe ser anterior a la hora final")
        config = CourseScheduleConfig(**data.model_dump())
        self.db.add(config)
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module="catalog", entity="CourseScheduleConfig",
            new_value=f"{data.start_time}–{data.end_time} cada {data.interval_minutes} min",
            description=f"Horario maestro creado para {data.tee}",
        )
        self.db.commit()
        self.db.refresh(config)
        return config

    def update_config(self, config_id: int, data: dict, actor: User) -> CourseScheduleConfig:
        config = self.get_config(config_id)
        for field, value in data.items():
            if value is None:
                continue
            old = getattr(config, field)
            if old != value:
                setattr(config, field, value)
                self.audit.log(
                    user=actor, action=AuditAction.MODIFICAR, module="catalog",
                    entity="CourseScheduleConfig", entity_id=config.id, field=field,
                    old_value=old, new_value=value,
                )
        if config.start_time >= config.end_time:
            raise ValidationError("La hora inicial debe ser anterior a la hora final")
        self.db.commit()
        self.db.refresh(config)
        return config


class HotelService:
    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def list(self, *, active_only: bool = True) -> List[Hotel]:
        stmt = select(Hotel)
        if active_only:
            stmt = stmt.where(Hotel.is_active.is_(True))
        return list(self.db.execute(stmt.order_by(Hotel.name)).scalars().all())

    def get(self, hotel_id: int) -> Hotel:
        hotel = self.db.get(Hotel, hotel_id)
        if not hotel:
            raise NotFoundError(f"Hotel {hotel_id} no encontrado")
        return hotel

    def create(self, data: HotelCreate, actor: User) -> Hotel:
        existing = self.db.execute(
            select(Hotel).where(Hotel.code == data.code.upper().strip())
        ).scalar_one_or_none()
        if existing:
            raise ConflictError(f"Ya existe un hotel con código {data.code}")
        payload = data.model_dump()
        payload["code"] = payload["code"].upper().strip()
        hotel = Hotel(**payload)
        self.db.add(hotel)
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module="catalog", entity="Hotel",
            new_value=hotel.name, description=f"Hotel dado de alta: {hotel.name}",
        )
        self.db.commit()
        self.db.refresh(hotel)
        return hotel

    def update(self, hotel_id: int, data: HotelUpdate, actor: User) -> Hotel:
        hotel = self.get(hotel_id)
        for field, value in data.model_dump(exclude_unset=True).items():
            if value is None:
                continue
            old = getattr(hotel, field)
            if old != value:
                setattr(hotel, field, value)
                self.audit.log(
                    user=actor, action=AuditAction.MODIFICAR, module="catalog",
                    entity="Hotel", entity_id=hotel.id, field=field,
                    old_value=old, new_value=value,
                )
        self.db.commit()
        self.db.refresh(hotel)
        return hotel


class AdditionalServiceService:
    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def list(self, *, active_only: bool = True) -> List[AdditionalService]:
        stmt = select(AdditionalService)
        if active_only:
            stmt = stmt.where(AdditionalService.is_active.is_(True))
        return list(self.db.execute(stmt.order_by(AdditionalService.name)).scalars().all())

    def get(self, service_id: int) -> AdditionalService:
        service = self.db.get(AdditionalService, service_id)
        if not service:
            raise NotFoundError(f"Servicio {service_id} no encontrado")
        return service

    def create(self, data: ServiceCreate, actor: User) -> AdditionalService:
        payload = data.model_dump()
        payload["code"] = payload["code"].upper().strip()
        service = AdditionalService(**payload)
        self.db.add(service)
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module="catalog", entity="AdditionalService",
            new_value=f"{service.code} {service.price}",
            description=f"Servicio creado: {service.name}",
        )
        self.db.commit()
        self.db.refresh(service)
        return service

    def update(self, service_id: int, data: dict, actor: User) -> AdditionalService:
        service = self.get(service_id)
        for field, value in data.items():
            if value is None:
                continue
            old = getattr(service, field)
            if old != value:
                setattr(service, field, value)
                self.audit.log(
                    user=actor, action=AuditAction.MODIFICAR, module="catalog",
                    entity="AdditionalService", entity_id=service.id, field=field,
                    old_value=old, new_value=value,
                )
        self.db.commit()
        self.db.refresh(service)
        return service


class SettingsService:
    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        stmt = select(SystemSetting).where(SystemSetting.key == key)
        found = self.db.execute(stmt).scalar_one_or_none()
        return found.value if found else default

    def get_int(self, key: str, default: int) -> int:
        value = self.get(key)
        try:
            return int(value) if value is not None else default
        except (TypeError, ValueError):
            return default

    def hora_limite_del_dia(self):
        """Hora a partir de la cual ya no se reserva para hoy (15:00 si no hay)."""
        from app.shared.tiempo import leer_hora

        return leer_hora(self.get("same_day_cutoff"))

    def list(self) -> List[SystemSetting]:
        return list(self.db.execute(select(SystemSetting).order_by(SystemSetting.key)).scalars().all())

    def set(self, key: str, value: str, actor: Optional[User] = None,
            description: Optional[str] = None) -> SystemSetting:
        stmt = select(SystemSetting).where(SystemSetting.key == key)
        setting = self.db.execute(stmt).scalar_one_or_none()
        old = setting.value if setting else None
        if setting:
            setting.value = value
        else:
            setting = SystemSetting(key=key, value=value, description=description)
            self.db.add(setting)
        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module="catalog",
            entity="SystemSetting", field=key, old_value=old, new_value=value,
        )
        self.db.commit()
        self.db.refresh(setting)
        return setting
