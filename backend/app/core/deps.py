"""Dependencias compartidas de FastAPI: usuario actual y verificación de permisos."""
from typing import Optional

from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.exceptions import AuthenticationError, PermissionDeniedError
from app.core.permissions import role_has_permission
from app.core.security import decode_token
from app.modules.identity.models import User
from app.shared.enums import UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_PREFIX}/auth/login")


# Lo único que puede tocar una cuenta de solo resumen ejecutivo, además de su
# propia sesión. Es una lista corta de rutas permitidas y TODO lo demás se
# niega: así un endpoint nuevo, o uno viejo que solo pide estar firmado, no se
# vuelve una puerta para esa cuenta.
RUTAS_DEL_RESUMEN = (
    "/auth/me", "/auth/refresh", "/auth/logout-all",
    "/treasury/executive-summary",
)


def _ruta_permitida_al_resumen(path: str) -> bool:
    ruta = path[len(settings.API_PREFIX):] if path.startswith(settings.API_PREFIX) else path
    return ruta.rstrip("/") in RUTAS_DEL_RESUMEN


def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise AuthenticationError("Token inválido o expirado")

    user_id = payload.get("sub")
    if user_id is None:
        raise AuthenticationError("Token sin sujeto")

    try:
        user = db.get(User, int(user_id))
    except (TypeError, ValueError):
        raise AuthenticationError("Token inválido o expirado") from None
    if user is None:
        raise AuthenticationError("Usuario no encontrado")
    if not user.is_active:
        raise AuthenticationError("Usuario inactivo")
    # Los tokens emitidos antes de que existiera el contador no lo traen: se
    # leen como 0, igual que el valor inicial de todos los usuarios.
    if int(payload.get("tv", 0) or 0) != (user.token_version or 0):
        raise AuthenticationError("La sesión se cerró. Vuelva a iniciar sesión.")
    if user.role == UserRole.RESUMEN_EJECUTIVO and not _ruta_permitida_al_resumen(request.url.path):
        raise PermissionDeniedError("Esta cuenta solo ve el resumen ejecutivo")
    return user


def get_current_active_user(user: User = Depends(get_current_user)) -> User:
    return user


class RequirePermission:
    """Dependencia parametrizable: `Depends(RequirePermission(Permission.X))`."""

    def __init__(self, *permissions: str, require_all: bool = True):
        self.permissions = permissions
        self.require_all = require_all

    def __call__(self, user: User = Depends(get_current_user)) -> User:
        checks = [role_has_permission(user.role, p) for p in self.permissions]
        ok = all(checks) if self.require_all else any(checks)
        if not ok:
            raise PermissionDeniedError(
                f"El rol {user.role} no tiene permiso para esta operación",
                detail={"required": list(self.permissions)},
            )
        return user


class RequireRole:
    def __init__(self, *roles: UserRole):
        self.roles = roles

    def __call__(self, user: User = Depends(get_current_user)) -> User:
        if user.role not in self.roles:
            raise PermissionDeniedError(f"Operación restringida a: {', '.join(self.roles)}")
        return user


def get_hotel_scope(user: User = Depends(get_current_user)) -> Optional[int]:
    """Devuelve el hotel al que está limitado el usuario, o None si ve todo.

    El repositorio aplica este filtro, no el router: así ningún endpoint nuevo
    se puede olvidar de filtrar por hotel.
    """
    if user.role == UserRole.HOTEL:
        if user.hotel_id is None:
            raise PermissionDeniedError("Usuario de hotel sin hotel asignado")
        return user.hotel_id
    return None


def get_client_ip(request: Request) -> str:
    from app.core.ip import ip_del_cliente

    return ip_del_cliente(request)
