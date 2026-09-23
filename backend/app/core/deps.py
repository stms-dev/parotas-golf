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


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise AuthenticationError("Token inválido o expirado")

    user_id = payload.get("sub")
    if user_id is None:
        raise AuthenticationError("Token sin sujeto")

    user = db.get(User, int(user_id))
    if user is None:
        raise AuthenticationError("Usuario no encontrado")
    if not user.is_active:
        raise AuthenticationError("Usuario inactivo")
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
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "desconocido"
