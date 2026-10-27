"""Endpoint WebSocket.

La autenticación va por query string y no por cabecera porque el WebSocket del
navegador no permite mandar cabeceras personalizadas. El token es el mismo JWT
de la API y se valida igual; si no es válido, se cierra antes de aceptar.
"""
import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.deps import RequirePermission
from app.core.permissions import Permission
from app.core.security import decode_token
from app.modules.identity.models import User
from app.realtime.events import EventType, RealtimeEvent
from app.realtime.manager import Subscriber, manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Tiempo real"])

CODIGO_NO_AUTENTICADO = 4001


def _resolver_identidad(token: str) -> Optional[dict]:
    """Valida el token y devuelve los datos del usuario.

    Usa su propia sesión de base de datos y la cierra de inmediato: un
    WebSocket vive minutos u horas y no debe retener una conexión abierta todo
    ese tiempo. Por eso se copian los datos a un diccionario simple.
    """
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        return None

    user_id = payload.get("sub")
    if user_id is None:
        return None
    vence = payload.get("exp")

    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return None

    db: Session = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user or not user.is_active:
            return None
        # Una sesión cerrada (cambio de contraseña, "cerrar sesiones") no entra.
        if int(payload.get("tv", 0) or 0) != (user.token_version or 0):
            return None
        return {
            "_vence": float(vence) if vence else 0.0,
            "user_id": user.id,
            "full_name": user.full_name,
            "role": user.role,
            "hotel_id": user.hotel_id,
        }
    finally:
        db.close()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    """Canal de avisos.

    El servidor empuja cambios; el cliente solo manda `ping` para mantener viva
    la conexión. Las escrituras siguen yendo por REST, que es lo que devuelve
    éxito o error de forma confiable.
    """
    identidad = _resolver_identidad(token)
    if identidad is None:
        await websocket.close(code=CODIGO_NO_AUTENTICADO, reason="Token inválido o expirado")
        return

    # La conexión vale mientras vale el token con el que se abrió. El panel
    # manda un token nuevo (`token:<jwt>`) cada vez que renueva la sesión; si
    # nadie lo renueva, el canal se cierra solo al vencer.
    vence = identidad.pop("_vence")
    subscriber = Subscriber(websocket=websocket, **identidad)
    await manager.connect(subscriber)

    try:
        while True:
            restante = vence - time.time()
            if restante <= 0:
                await websocket.close(code=CODIGO_NO_AUTENTICADO, reason="Sesión vencida")
                manager.disconnect(websocket)
                return
            try:
                mensaje = await asyncio.wait_for(websocket.receive_text(), timeout=restante)
            except asyncio.TimeoutError:
                continue          # llegó la hora de vencer: el ciclo la cierra

            if mensaje == "ping":
                await websocket.send_json(
                    RealtimeEvent(type=EventType.PONG, payload={}).to_message()
                )
            elif mensaje.startswith("token:"):
                nueva = _resolver_identidad(mensaje[len("token:"):])
                # Solo vale renovar con un token de la misma persona.
                if nueva and nueva["user_id"] == identidad["user_id"]:
                    vence = nueva["_vence"]
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as exc:  # pragma: no cover
        logger.warning("WS terminó con error: %s", exc)
        manager.disconnect(websocket)


@router.get("/realtime/status", tags=["Tiempo real"])
def realtime_status(
    _: User = Depends(RequirePermission(Permission.AUDIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Diagnóstico: cuántas terminales están escuchando en este proceso."""
    return {
        "conexiones_activas": manager.active_count,
        "eventos_disponibles": [event.value for event in EventType],
    }
