"""Endpoints de autenticación y usuarios. El router no sabe de SQLAlchemy."""
from typing import List, Optional

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import RequirePermission, get_client_ip, get_current_user
from app.core.permissions import Permission, home_route_for, permissions_for
from app.modules.identity.models import User
from app.modules.identity.schemas import (
    LoginRequest,
    MeResponse,
    TokenResponse,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.modules.identity.service import IdentityService
from app.shared.enums import UserRole

router = APIRouter(prefix="/auth", tags=["Autenticación"])
users_router = APIRouter(prefix="/users", tags=["Usuarios"])


def _to_out(user: User) -> UserOut:
    data = UserOut.model_validate(user)
    if user.hotel:
        data.hotel_name = user.hotel.name
    return data


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    result = IdentityService(db).authenticate(payload.email, payload.password, ip=get_client_ip(request))
    return TokenResponse(
        access_token=result["access_token"],
        refresh_token=result["refresh_token"],
        user=_to_out(result["user"]),
        permissions=result["permissions"],
        home_route=home_route_for(result["user"].role),
    )


@router.get("/me", response_model=MeResponse)
def me(current: User = Depends(get_current_user)):
    return MeResponse(
        user=_to_out(current),
        permissions=permissions_for(current.role),
        home_route=home_route_for(current.role),
    )


@users_router.get("", response_model=List[UserOut])
def list_users(
    role: Optional[UserRole] = None,
    hotel_id: Optional[int] = None,
    is_active: Optional[bool] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.USER_MANAGE)),
):
    users = IdentityService(db).list_users(
        role=role, hotel_id=hotel_id, is_active=is_active, limit=limit, offset=offset
    )
    return [_to_out(u) for u in users]


@users_router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.USER_MANAGE)),
):
    return _to_out(IdentityService(db).create_user(payload, actor=actor))


@users_router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.USER_MANAGE)),
):
    return _to_out(IdentityService(db).get_user(user_id))


@users_router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(RequirePermission(Permission.USER_MANAGE)),
):
    return _to_out(IdentityService(db).update_user(user_id, payload, actor=actor))
