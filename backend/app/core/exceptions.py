"""Excepciones del dominio.

Las lanza la capa de servicio sin saber nada de HTTP; un manejador global en
main.py las traduce a respuestas. Así el servicio se puede probar sin FastAPI.
"""
from typing import Any, Optional


class DomainError(Exception):
    status_code: int = 400
    code: str = "ERROR_DOMINIO"

    def __init__(self, message: str, detail: Optional[Any] = None):
        self.message = message
        self.detail = detail
        super().__init__(message)


class NotFoundError(DomainError):
    status_code = 404
    code = "NO_ENCONTRADO"


class ValidationError(DomainError):
    status_code = 422
    code = "VALIDACION"


class ConflictError(DomainError):
    status_code = 409
    code = "CONFLICTO"


class PermissionDeniedError(DomainError):
    status_code = 403
    code = "SIN_PERMISO"


class AuthenticationError(DomainError):
    status_code = 401
    code = "NO_AUTENTICADO"


class BusinessRuleError(DomainError):
    """Una regla de negocio impidió la operación (cupo lleno, caja cerrada...)."""

    status_code = 409
    code = "REGLA_NEGOCIO"
