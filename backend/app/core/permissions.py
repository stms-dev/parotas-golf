"""Matriz de permisos por rol.

Dos familias de permisos:

- **De pantalla** (`screen:…`) — qué ve cada rol en el menú. Sirven también
  para bloquear la ruta en el frontend, pero no son la seguridad real.
- **De operación** — qué puede hacer. Estos son los que valida el backend en
  cada endpoint, y son los que importan: ocultar un botón en React no protege
  nada si el endpoint sigue abierto.

Alcance acordado:

| Rol                | Pantallas                                             |
|--------------------|-------------------------------------------------------|
| SUPER_ADMIN        | Control del sistema (una sola pantalla)               |
| ADMIN_OPERACIONES  | Operación del día (tarifas en modo consulta)          |
| RECEPCION          | Recepción & Check-In · Liquidaciones                  |
| HOTEL              | Su panel · Nueva reserva                              |
"""
from typing import Dict, Set

from app.shared.enums import UserRole


class Permission:
    # ------------------------------------------------------------ pantallas
    SCREEN_PANEL = "screen:panel"
    SCREEN_TEE_SHEET = "screen:tee_sheet"
    SCREEN_RESERVATIONS = "screen:reservations"
    SCREEN_NEW_RESERVATION = "screen:new_reservation"
    SCREEN_CHECKIN = "screen:checkin"
    SCREEN_FINANCE = "screen:finance"
    SCREEN_SETTINGS = "screen:settings"
    SCREEN_AUDIT = "screen:audit"
    SCREEN_INVENTORY = "screen:inventory"
    SCREEN_REQUESTS = "screen:requests"

    # ------------------------------------------------------------- reservas
    RESERVATION_VIEW_ALL = "reservation:view_all"
    RESERVATION_VIEW_OWN_HOTEL = "reservation:view_own_hotel"
    RESERVATION_CREATE = "reservation:create"
    RESERVATION_CONFIRM = "reservation:confirm"
    RESERVATION_CANCEL = "reservation:cancel"

    # ------------------------------------------------------ check-in y cobro
    CHECKIN_PERFORM = "checkin:perform"
    PGA_VALIDATE = "pga:validate"
    PAYMENT_REGISTER = "payment:register"
    PAYMENT_VOID = "payment:void"

    # ------------------------------------------------------------- catálogo
    CATALOG_VIEW = "catalog:view"
    CATALOG_VIEW_HOTELS = "catalog:view_hotels"
    CATALOG_MANAGE_RATES = "catalog:manage_rates"
    CATALOG_MANAGE_EXCHANGE = "catalog:manage_exchange"
    CATALOG_MANAGE_DISCOUNTS = "catalog:manage_discounts"
    CATALOG_MANAGE_PGA = "catalog:manage_pga"
    CATALOG_MANAGE_SCHEDULE = "catalog:manage_schedule"
    CATALOG_MANAGE_SERVICES = "catalog:manage_services"
    CATALOG_MANAGE_HOTELS = "catalog:manage_hotels"

    # --------------------------------------------------------------- agenda
    EVENT_MANAGE = "event:manage"

    # ------------------------------------------------------------- finanzas
    FINANCE_VIEW_GLOBAL = "finance:view_global"
    FINANCE_VIEW_OWN_HOTEL = "finance:view_own_hotel"
    # Ver la caja y cobrar contra ella es una cosa; abrir y cerrar el turno es
    # otra, y la hace operaciones. Recepción cobra dentro de un turno que ya
    # alguien más abrió, así que solo necesita verlo.
    CASH_SESSION_VIEW = "cash_session:view"
    CASH_SESSION_MANAGE = "cash_session:manage"
    SETTLEMENT_MANAGE = "settlement:manage"

    # ----------------------------------------------------------- inventario
    INVENTORY_VIEW = "inventory:view"
    INVENTORY_MANAGE = "inventory:manage"

    # --------------------------------------------------------------- sistema
    USER_MANAGE = "user:manage"
    AUDIT_VIEW = "audit:view"


# ---------------------------------------------------------------------------
# HOTEL
# Solo su panel y el alta de reservas. No ve el tee sheet completo, ni la lista
# global de reservas, ni finanzas, ni el padrón PGA, ni los demás hoteles.
# ---------------------------------------------------------------------------
_HOTEL: Set[str] = {
    Permission.SCREEN_PANEL,
    Permission.SCREEN_NEW_RESERVATION,
    Permission.RESERVATION_VIEW_OWN_HOTEL,
    Permission.RESERVATION_CREATE,
    Permission.CATALOG_VIEW,
}


# ---------------------------------------------------------------------------
# RECEPCIÓN
# Mostrador y caja. No necesita el panel de agenda ni la lista global: su
# entrada al sistema es el folio o el pase QR del huésped que tiene enfrente.
# ---------------------------------------------------------------------------
_RECEPCION: Set[str] = {
    Permission.SCREEN_CHECKIN,
    # El mostrador también levanta reservas: llega gente sin hotel y hay que
    # poder registrarla ahí mismo. Y ve la lista de partidas del día.
    Permission.SCREEN_NEW_RESERVATION,
    Permission.SCREEN_RESERVATIONS,
    Permission.RESERVATION_CREATE,
    Permission.CATALOG_VIEW_HOTELS,
    # Pantalla de solicitudes del día: lo que va llegando de los hoteles.
    Permission.SCREEN_REQUESTS,
    # Pasada su hora, el mostrador marca la partida como no presentada para
    # que el hotel deje de verla pendiente.
    Permission.RESERVATION_CONFIRM,
    Permission.RESERVATION_CANCEL,
    Permission.SCREEN_FINANCE,
    Permission.RESERVATION_VIEW_ALL,
    Permission.CHECKIN_PERFORM,
    Permission.PGA_VALIDATE,
    Permission.PAYMENT_REGISTER,
    Permission.CATALOG_VIEW,
    # Ve la caja y cobra contra ella, pero no abre ni cierra el turno.
    Permission.CASH_SESSION_VIEW,
    # Finanzas se ve igual que en operaciones: el mostrador consulta la venta,
    # las comisiones y el detalle PGA del periodo. Lo que sigue sin poder es
    # abrir o cerrar el turno de caja.
    Permission.FINANCE_VIEW_GLOBAL,
}


# ---------------------------------------------------------------------------
# DIRECCIÓN DE OPERACIONES
# Ve todas las pantallas. La configuración financiera (tarifas, tipo de cambio,
# convenios y beneficio PGA) le aparece en modo consulta: puede revisarla pero
# no modificarla, como indica el documento de roles del sistema.
# ---------------------------------------------------------------------------
_ADMIN_OPERACIONES: Set[str] = {
    Permission.SCREEN_PANEL,
    Permission.SCREEN_TEE_SHEET,
    Permission.SCREEN_RESERVATIONS,
    Permission.SCREEN_REQUESTS,
    Permission.SCREEN_NEW_RESERVATION,
    Permission.SCREEN_CHECKIN,
    Permission.SCREEN_FINANCE,
    Permission.SCREEN_SETTINGS,

    Permission.RESERVATION_VIEW_ALL,
    Permission.RESERVATION_CREATE,
    Permission.RESERVATION_CONFIRM,
    Permission.RESERVATION_CANCEL,

    Permission.CHECKIN_PERFORM,
    Permission.PGA_VALIDATE,
    Permission.PAYMENT_REGISTER,

    Permission.CATALOG_VIEW,
    Permission.CATALOG_VIEW_HOTELS,
    # Precios y configuración es de solo consulta para Operaciones: horarios,
    # servicios, hoteles y comisiones los cambia la Administración.

    Permission.EVENT_MANAGE,

    Permission.FINANCE_VIEW_GLOBAL,
    # Operaciones es quien abre y cierra el turno de caja.
    Permission.CASH_SESSION_VIEW,
    Permission.CASH_SESSION_MANAGE,
    Permission.SETTLEMENT_MANAGE,
    # La bitácora es de la Administración: operaciones trabaja el día, no
    # audita lo que hicieron los demás.

    # El Pro-Shop lo lleva operaciones: da de alta mercancía y la mueve.
    Permission.SCREEN_INVENTORY,
    Permission.INVENTORY_VIEW,
    Permission.INVENTORY_MANAGE,
}


# ---------------------------------------------------------------------------
# SUPER ADMIN — todo, incluida la configuración financiera y los usuarios.
# ---------------------------------------------------------------------------
_SUPER_ADMIN: Set[str] = {
    value
    for key, value in vars(Permission).items()
    if not key.startswith("_") and isinstance(value, str)
}


ROLE_PERMISSIONS: Dict[UserRole, Set[str]] = {
    UserRole.SUPER_ADMIN: _SUPER_ADMIN,
    UserRole.ADMIN_OPERACIONES: _ADMIN_OPERACIONES,
    UserRole.RECEPCION: _RECEPCION,
    UserRole.HOTEL: _HOTEL,
}


def role_has_permission(role: UserRole, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())


def permissions_for(role: UserRole) -> list[str]:
    return sorted(ROLE_PERMISSIONS.get(role, set()))


def home_route_for(role: UserRole) -> str:
    """Pantalla inicial de cada rol.

    Sin esto, recepción entraría a `/` (panel de agenda) y vería un rebote al
    no tener permiso. Cada quien aterriza donde trabaja.
    """
    return {
        # La Administración entra directo a su tablero de control.
        UserRole.SUPER_ADMIN: "/control",
        UserRole.ADMIN_OPERACIONES: "/",
        UserRole.RECEPCION: "/recepcion",
        UserRole.HOTEL: "/",
    }.get(role, "/")
