"""Acceso a datos de usuarios. Única capa que toca la BD en este módulo."""
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.identity.models import User
from app.shared.enums import UserRole


class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, user_id: int) -> Optional[User]:
        return self.db.get(User, user_id)

    def get_by_email(self, email: str) -> Optional[User]:
        stmt = select(User).where(User.email == email.lower().strip())
        return self.db.execute(stmt).scalar_one_or_none()

    def list(
        self,
        *,
        role: Optional[UserRole] = None,
        hotel_id: Optional[int] = None,
        is_active: Optional[bool] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[User]:
        stmt = select(User)
        if role:
            stmt = stmt.where(User.role == role)
        if hotel_id is not None:
            stmt = stmt.where(User.hotel_id == hotel_id)
        if is_active is not None:
            stmt = stmt.where(User.is_active == is_active)
        stmt = stmt.order_by(User.full_name).limit(limit).offset(offset)
        return list(self.db.execute(stmt).scalars().all())

    def add(self, user: User) -> User:
        self.db.add(user)
        self.db.flush()
        return user

    def exists_email(self, email: str) -> bool:
        return self.get_by_email(email) is not None
