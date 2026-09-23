"""Lógica de autenticación y gestión de usuarios.

Esta capa no sabe nada de HTTP: recibe datos, aplica reglas y lanza
excepciones de dominio.
"""
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.core.exceptions import AuthenticationError, ConflictError, NotFoundError, ValidationError
from app.core.permissions import permissions_for
from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.modules.audit.service import AuditService
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.schemas import UserCreate, UserUpdate
from app.shared.enums import AuditAction, UserRole


class IdentityService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = UserRepository(db)
        self.audit = AuditService(db)

    # ------------------------------------------------------------------ auth
    def authenticate(self, email: str, password: str, ip: Optional[str] = None) -> dict:
        user = self.repo.get_by_email(email)
        # Mismo mensaje en ambos casos: no se le dice a un atacante si el correo existe.
        if not user or not verify_password(password, user.hashed_password):
            raise AuthenticationError("Correo o contraseña incorrectos")
        if not user.is_active:
            raise AuthenticationError("Usuario inactivo. Contacte al administrador.")

        user.last_login_at = datetime.utcnow()
        self.audit.log(
            user=user, action=AuditAction.LOGIN, module="identity",
            entity="User", entity_id=user.id, description="Inicio de sesión", ip_address=ip,
        )
        self.db.commit()

        return {
            "access_token": create_access_token(user.id, {"role": user.role, "hotel_id": user.hotel_id}),
            "refresh_token": create_refresh_token(user.id),
            "token_type": "bearer",
            "user": user,
            "permissions": permissions_for(user.role),
        }

    # ----------------------------------------------------------------- users
    def create_user(self, data: UserCreate, actor: Optional[User] = None) -> User:
        if self.repo.exists_email(data.email):
            raise ConflictError(f"Ya existe un usuario con el correo {data.email}")

        if data.role == UserRole.HOTEL and data.hotel_id is None:
            raise ValidationError("Un usuario con rol HOTEL requiere hotel_id")
        if data.role != UserRole.HOTEL and data.hotel_id is not None:
            raise ValidationError("Solo el rol HOTEL puede tener hotel_id asignado")

        user = User(
            email=data.email.lower().strip(),
            full_name=data.full_name.strip(),
            hashed_password=hash_password(data.password),
            role=data.role,
            hotel_id=data.hotel_id,
            phone=data.phone,
        )
        self.repo.add(user)
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module="identity",
            entity="User", entity_id=user.id,
            description=f"Usuario creado: {user.email} ({user.role})",
        )
        self.db.commit()
        self.db.refresh(user)
        return user

    def update_user(self, user_id: int, data: UserUpdate, actor: Optional[User] = None) -> User:
        user = self.repo.get(user_id)
        if not user:
            raise NotFoundError(f"Usuario {user_id} no encontrado")

        changes: list[str] = []
        payload = data.model_dump(exclude_unset=True)

        if "password" in payload and payload["password"]:
            user.hashed_password = hash_password(payload.pop("password"))
            changes.append("password")
        payload.pop("password", None)

        for field, value in payload.items():
            old = getattr(user, field)
            if old != value:
                setattr(user, field, value)
                changes.append(f"{field}: {old} → {value}")

        role = payload.get("role", user.role)
        hotel_id = payload.get("hotel_id", user.hotel_id)
        if role == UserRole.HOTEL and hotel_id is None:
            raise ValidationError("Un usuario con rol HOTEL requiere hotel_id")

        if changes:
            self.audit.log(
                user=actor, action=AuditAction.MODIFICAR, module="identity",
                entity="User", entity_id=user.id, description="; ".join(changes),
            )
        self.db.commit()
        self.db.refresh(user)
        return user

    def list_users(self, **filters) -> List[User]:
        return self.repo.list(**filters)

    def get_user(self, user_id: int) -> User:
        user = self.repo.get(user_id)
        if not user:
            raise NotFoundError(f"Usuario {user_id} no encontrado")
        return user
