"""Registro único de modelos.

SQLAlchemy necesita que todas las clases estén importadas antes de resolver
las relaciones entre módulos. Este archivo es el único lugar donde eso pasa.
"""
from app.core.database import Base  # noqa: F401
from app.modules.audit.models import AuditLog  # noqa: F401
from app.modules.billing.models import Payment  # noqa: F401
from app.modules.booking.models import (  # noqa: F401
    Reservation,
    ReservationCompanion,
    ReservationPlayer,
    ReservationService,
    TeeSlot,
)
from app.modules.catalog.models import (  # noqa: F401
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
from app.modules.events.models import CourseEvent  # noqa: F401
from app.modules.identity.models import User  # noqa: F401
from app.modules.inventory.models import InventoryItem, InventoryMovement  # noqa: F401
from app.modules.mailing.models import OutboxEmail  # noqa: F401
from app.modules.treasury.models import CashSession, HotelSettlement  # noqa: F401

__all__ = [
    "Base",
    "User",
    "Hotel",
    "RatePlan",
    "AdditionalService",
    "DiscountCode",
    "PGABenefitConfig",
    "PGACredential",
    "CourseScheduleConfig",
    "ExchangeRate",
    "SystemSetting",
    "TeeSlot",
    "Reservation",
    "ReservationPlayer",
    "ReservationCompanion",
    "ReservationService",
    "Payment",
    "CashSession",
    "HotelSettlement",
    "CourseEvent",
    "AuditLog",
    "InventoryItem",
    "InventoryMovement",
]
