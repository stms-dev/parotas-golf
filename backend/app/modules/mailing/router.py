"""Endpoints de la bandeja de salida: consultar, reenviar y ver el pase."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import RequirePermission, get_current_user, get_hotel_scope
from app.core.permissions import Permission
from app.modules.booking.service import ReservationService_
from app.modules.identity.models import User
from app.modules.mailing.service import MailingService
from app.shared.enums import EmailKind
from app.workers.notifications import generar_qr_png

router = APIRouter(prefix="/correos", tags=["Correos"])


class CorreoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    to_email: str
    subject: str
    status: str
    attempts: int
    last_error: Optional[str] = None
    created_at: datetime
    sent_at: Optional[datetime] = None
    folio: Optional[str] = None


def _salida(correo) -> CorreoOut:
    out = CorreoOut.model_validate(correo)
    out.folio = correo.reservation.folio if correo.reservation else None
    return out


@router.get("", response_model=List[CorreoOut])
def bandeja(
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.AUDIT_VIEW)),
):
    """Últimos correos con su estado. Es lo que responde "¿ya le llegó?"."""
    return [_salida(c) for c in MailingService(db).ultimos(limit)]


@router.get("/reserva/{reservation_id}", response_model=List[CorreoOut])
def de_la_reserva(
    reservation_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    # Pasar por el servicio aplica el alcance: un hotel solo ve lo suyo.
    ReservationService_(db, hotel_scope=scope).get(reservation_id)
    return [_salida(c) for c in MailingService(db).de_la_reserva(reservation_id)]


@router.post("/reserva/{reservation_id}/pase", response_model=CorreoOut)
def reenviar_pase(
    reservation_id: int,
    destino: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    """Vuelve a mandar el pase, al titular o a otro correo."""
    reservation = ReservationService_(db, hotel_scope=scope).get(reservation_id)
    servicio = MailingService(db)
    correo = servicio.encolar(kind=EmailKind.PASE, reservation=reservation, destino=destino)
    db.commit()
    servicio.procesar_pendientes(limite=3)
    db.refresh(correo)
    return _salida(correo)


@router.post("/reserva/{reservation_id}/recibo", response_model=CorreoOut)
def reenviar_recibo(
    reservation_id: int,
    destino: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.CHECKIN_PERFORM)),
):
    reservation = ReservationService_(db).get(reservation_id)
    servicio = MailingService(db)
    correo = servicio.encolar(kind=EmailKind.RECIBO, reservation=reservation, destino=destino)
    db.commit()
    servicio.procesar_pendientes(limite=3)
    db.refresh(correo)
    return _salida(correo)


@router.post("/{correo_id}/reintentar", response_model=CorreoOut)
def reintentar(
    correo_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(RequirePermission(Permission.AUDIT_VIEW)),
):
    servicio = MailingService(db)
    correo = servicio.reintentar(correo_id)
    servicio.procesar_pendientes(limite=3)
    db.refresh(correo)
    return _salida(correo)


@router.get("/reserva/{reservation_id}/qr.png")
def pase_qr(
    reservation_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    scope: Optional[int] = Depends(get_hotel_scope),
):
    """La imagen del pase, para imprimirlo o enseñarlo en pantalla."""
    from app.core.exceptions import BusinessRuleError

    reservation = ReservationService_(db, hotel_scope=scope).get(reservation_id)
    if not reservation.qr_token:
        raise BusinessRuleError("Esta reserva no tiene pase generado")
    return Response(
        content=generar_qr_png(reservation.qr_token),
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )
