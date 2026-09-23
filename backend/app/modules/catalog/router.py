"""Endpoints del catálogo (Administración)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel

from app.core.exceptions import ValidationError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import RequirePermission, get_current_user, get_hotel_scope
from app.core.permissions import Permission, role_has_permission
from app.modules.catalog.schemas import (
    DiscountCreate,
    DiscountOut,
    DiscountUpdate,
    ExchangeRateCreate,
    ExchangeRateOut,
    HotelCreate,
    HotelOut,
    HotelUpdate,
    PGABenefitConfigCreate,
    PGABenefitConfigOut,
    PGACredentialCreate,
    PGACredentialOut,
    PGAValidationResult,
    RatePlanCreate,
    RatePlanOut,
    RatePlanUpdate,
    ScheduleConfigCreate,
    ScheduleConfigOut,
    ScheduleConfigUpdate,
    ServiceCreate,
    ServiceOut,
    ServiceUpdate,
    SettingOut,
)
from app.modules.catalog.service import (
    AdditionalServiceService,
    DiscountService,
    ExchangeRateService,
    HotelService,
    PGAService,
    PricingService,
    ScheduleService,
    SettingsService,
)
from app.modules.identity.models import User

router = APIRouter(prefix="/catalog", tags=["Catálogo y Configuración"])


# ---------------------------------------------------------------------- hoteles
@router.get("/hotels", response_model=List[HotelOut])
def list_hotels(
    active_only: bool = True,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    """Listado de hoteles con convenio.

    Un usuario de hotel solo recibe el suyo: el listado completo incluye la
    participación negociada con cada entidad, que es información comercial
    entre el campo y cada hotel, no entre hoteles.
    """
    hotels = HotelService(db).list(active_only=active_only)
    if scope is not None:
        hotels = [hotel for hotel in hotels if hotel.id == scope]
    return hotels


@router.post("/hotels", response_model=HotelOut, status_code=status.HTTP_201_CREATED)
def create_hotel(payload: HotelCreate, db: Session = Depends(get_db),
                 actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_HOTELS))):
    return HotelService(db).create(payload, actor)


@router.patch("/hotels/{hotel_id}", response_model=HotelOut)
def update_hotel(hotel_id: int, payload: HotelUpdate, db: Session = Depends(get_db),
                 actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_HOTELS))):
    return HotelService(db).update(hotel_id, payload, actor)


# ---------------------------------------------------------------------- tarifas
@router.get("/rates", response_model=List[RatePlanOut])
def list_rates(active_only: bool = True, db: Session = Depends(get_db),
               _: User = Depends(get_current_user)):
    return PricingService(db).list_rates(active_only=active_only)


@router.post("/rates", response_model=RatePlanOut, status_code=status.HTTP_201_CREATED)
def create_rate(payload: RatePlanCreate, db: Session = Depends(get_db),
                actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_RATES))):
    return PricingService(db).create_rate(payload, actor)


@router.patch("/rates/{rate_id}", response_model=RatePlanOut)
def update_rate(rate_id: int, payload: RatePlanUpdate, db: Session = Depends(get_db),
                actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_RATES))):
    return PricingService(db).update_rate(rate_id, payload.model_dump(exclude_unset=True), actor)


# -------------------------------------------------------------------- servicios
@router.get("/services", response_model=List[ServiceOut])
def list_services(active_only: bool = True, db: Session = Depends(get_db),
                  _: User = Depends(get_current_user)):
    return AdditionalServiceService(db).list(active_only=active_only)


@router.post("/services", response_model=ServiceOut, status_code=status.HTTP_201_CREATED)
def create_service(payload: ServiceCreate, db: Session = Depends(get_db),
                   actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_SERVICES))):
    return AdditionalServiceService(db).create(payload, actor)


@router.patch("/services/{service_id}", response_model=ServiceOut)
def update_service(service_id: int, payload: ServiceUpdate, db: Session = Depends(get_db),
                   actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_SERVICES))):
    return AdditionalServiceService(db).update(service_id, payload.model_dump(exclude_unset=True), actor)


# ------------------------------------------------------------------- descuentos
@router.get("/discounts", response_model=List[DiscountOut])
def list_discounts(
    active_only: bool = True,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    """Convenios vigentes.

    Los convenios exclusivos de un hotel (`hotel_id`) solo los ve ese hotel;
    los generales los ve cualquiera. Un hotel no debe conocer las condiciones
    negociadas con otro.
    """
    discounts = DiscountService(db).list(active_only=active_only)
    if scope is not None:
        discounts = [d for d in discounts if d.hotel_id is None or d.hotel_id == scope]
    return discounts


@router.post("/discounts", response_model=DiscountOut, status_code=status.HTTP_201_CREATED)
def create_discount(payload: DiscountCreate, db: Session = Depends(get_db),
                    actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_DISCOUNTS))):
    return DiscountService(db).create(payload, actor)


# -------------------------------------------------------------------------- PGA
@router.get("/pga/config", response_model=PGABenefitConfigOut)
def get_pga_config(
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.PGA_VALIDATE, Permission.CATALOG_MANAGE_PGA, require_all=False)),
):
    """Configuración del beneficio.

    Restringida a quien valida credenciales o administra el beneficio: un
    hotel no necesita —ni debe— conocer el porcentaje antes del mostrador.
    """
    return PGAService(db).active_config()


@router.put("/pga/config", response_model=PGABenefitConfigOut)
def set_pga_config(payload: PGABenefitConfigCreate, db: Session = Depends(get_db),
                   actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_PGA))):
    return PGAService(db).set_config(payload, actor)


@router.get("/pga/credentials", response_model=List[PGACredentialOut])
def list_credentials(
    active_only: bool = True,
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.PGA_VALIDATE, Permission.CATALOG_MANAGE_PGA, require_all=False)),
):
    """Padrón de profesionales acreditados. Es un listado de personas
    identificables: solo lo consulta quien valida en mostrador o lo administra."""
    return PGAService(db).list_credentials(active_only=active_only)


@router.post("/pga/credentials", response_model=PGACredentialOut, status_code=status.HTTP_201_CREATED)
def create_credential(payload: PGACredentialCreate, db: Session = Depends(get_db),
                      actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_PGA))):
    return PGAService(db).create_credential(payload, actor)


@router.get("/pga/validate", response_model=PGAValidationResult)
def validate_credential(
    pga_code: Optional[str] = Query(default=None),
    credential_number: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.PGA_VALIDATE)),
):
    """Consulta de mostrador: ¿esta credencial es válida y cuánto descuenta?"""
    return PGAService(db).validate(pga_code=pga_code, credential_number=credential_number)


# ---------------------------------------------------------------- tipo de cambio
@router.get("/exchange-rate", response_model=ExchangeRateOut)
def current_exchange_rate(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    found = ExchangeRateService(db).current()
    out = ExchangeRateOut.model_validate(found)
    if found.created_by:
        out.created_by_name = found.created_by.full_name
    return out


@router.get("/exchange-rate/history", response_model=List[ExchangeRateOut])
def exchange_rate_history(limit: int = 50, db: Session = Depends(get_db),
                          _: User = Depends(get_current_user)):
    result = []
    for item in ExchangeRateService(db).history(limit):
        out = ExchangeRateOut.model_validate(item)
        if item.created_by:
            out.created_by_name = item.created_by.full_name
        result.append(out)
    return result


@router.post("/exchange-rate", response_model=ExchangeRateOut, status_code=status.HTTP_201_CREATED)
def set_exchange_rate(payload: ExchangeRateCreate, db: Session = Depends(get_db),
                      actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_EXCHANGE))):
    created = ExchangeRateService(db).set_rate(
        payload.rate, actor,
        from_currency=payload.from_currency,
        to_currency=payload.to_currency,
        effective_from=payload.effective_from,
    )
    out = ExchangeRateOut.model_validate(created)
    out.created_by_name = actor.full_name
    return out


# --------------------------------------------------------------------- horarios
@router.get("/schedule", response_model=List[ScheduleConfigOut])
def list_schedule(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    service = ScheduleService(db)
    result = []
    for config in service.list_configs():
        out = ScheduleConfigOut.model_validate(config)
        out.generated_times = [t.strftime("%H:%M") for t in service.generate_times(config)]
        result.append(out)
    return result


@router.post("/schedule", response_model=ScheduleConfigOut, status_code=status.HTTP_201_CREATED)
def create_schedule(payload: ScheduleConfigCreate, db: Session = Depends(get_db),
                    actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_SCHEDULE))):
    service = ScheduleService(db)
    config = service.create_config(payload, actor)
    out = ScheduleConfigOut.model_validate(config)
    out.generated_times = [t.strftime("%H:%M") for t in service.generate_times(config)]
    return out


@router.patch("/schedule/{config_id}", response_model=ScheduleConfigOut)
def update_schedule(config_id: int, payload: ScheduleConfigUpdate, db: Session = Depends(get_db),
                    actor: User = Depends(RequirePermission(Permission.CATALOG_MANAGE_SCHEDULE))):
    service = ScheduleService(db)
    config = service.update_config(config_id, payload.model_dump(exclude_unset=True), actor)
    out = ScheduleConfigOut.model_validate(config)
    out.generated_times = [t.strftime("%H:%M") for t in service.generate_times(config)]
    return out


# ------------------------------------------------------------------ parámetros
@router.get("/settings", response_model=List[SettingOut])
def list_settings(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return SettingsService(db).list()


class SettingUpdate(BaseModel):
    value: str


# Solo estos parámetros se pueden tocar desde la pantalla. Abrir la escritura
# a cualquier clave dejaría que un error de captura creara basura en la tabla.
AJUSTES_EDITABLES = {
    "same_day_cutoff": "Hora límite para reservar el mismo día (HH:MM)",
    "carritos_totales": "Carritos de golf del club",
    "personas_por_carrito": "Personas que caben en cada carrito",
    "caddies_totales": "Caddies disponibles en el campo",
}

NUMERICOS = {"carritos_totales", "personas_por_carrito", "caddies_totales"}


@router.put("/settings/{key}", response_model=SettingOut)
def update_setting(
    key: str,
    payload: SettingUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.USER_MANAGE)),
):
    if key not in AJUSTES_EDITABLES:
        raise ValidationError(f"El parámetro «{key}» no se puede cambiar desde aquí")
    valor = payload.value.strip()
    if key == "same_day_cutoff":
        from app.shared.tiempo import leer_hora

        # Se valida leyéndola con un respaldo imposible: si vuelve el
        # respaldo, lo que escribieron no era una hora.
        from datetime import time as _time
        centinela = _time(0, 0, 1)
        if leer_hora(valor, centinela) == centinela:
            raise ValidationError("Escriba la hora como HH:MM, por ejemplo 15:00")
        valor = leer_hora(valor).strftime("%H:%M")
    if key in NUMERICOS:
        if not valor.isdigit() or int(valor) < 1:
            raise ValidationError("Escriba un número entero mayor que cero")
        valor = str(int(valor))
    return SettingsService(db).set(key, valor, actor, description=AJUSTES_EDITABLES[key])
