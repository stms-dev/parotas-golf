"""Contratos de entrada/salida del módulo identity."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.shared.enums import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: "UserOut"
    permissions: List[str]
    home_route: str = "/"


class UserBase(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=3, max_length=180)
    role: UserRole
    hotel_id: Optional[int] = None
    phone: Optional[str] = None


class UserCreate(UserBase):
    password: str = Field(min_length=8, description="Mínimo 8 caracteres")


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[UserRole] = None
    hotel_id: Optional[int] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    role: UserRole
    hotel_id: Optional[int]
    hotel_name: Optional[str] = None
    phone: Optional[str]
    is_active: bool
    last_login_at: Optional[datetime]
    created_at: datetime


class MeResponse(BaseModel):
    user: UserOut
    permissions: List[str]
    home_route: str = "/"


TokenResponse.model_rebuild()
