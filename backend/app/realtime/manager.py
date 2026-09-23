"""Gestor de conexiones WebSocket.

Dos detalles que definen este archivo:

1. **Los servicios son síncronos.** FastAPI corre los endpoints `def` en un
   pool de hilos, pero los WebSocket viven en el bucle de eventos. Publicar
   desde un servicio significa cruzar de un hilo al bucle, y eso se hace con
   `run_coroutine_threadsafe`. Por eso `publish()` guarda una referencia al
   bucle principal al arrancar.

2. **Se publica después del commit, nunca antes.** Si se avisa dentro de la
   transacción y esta hace rollback, se difundió un cambio que no ocurrió: las
   pantallas mostrarían una reserva que no existe.

Sobre escalar: este gestor vive en memoria del proceso. Con un solo proceso
(`uvicorn` sin `--workers`) funciona tal cual. Con varios trabajadores, cada
uno tendría sus propias conexiones y un aviso no cruzaría entre ellos; ahí hay
que sustituir `_broadcast` por un canal de Redis. El resto del código no se
entera porque todos publican a través de `publish()`.
"""
import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from fastapi import WebSocket

from app.realtime.events import EventType, RealtimeEvent
from app.shared.enums import UserRole

logger = logging.getLogger(__name__)


@dataclass
class Subscriber:
    websocket: WebSocket
    user_id: int
    full_name: str
    role: UserRole
    hotel_id: Optional[int]


class ConnectionManager:
    def __init__(self) -> None:
        self._subscribers: dict[WebSocket, Subscriber] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ------------------------------------------------------------- arranque
    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Guarda el bucle principal para poder publicar desde otros hilos."""
        self._loop = loop

    # ------------------------------------------------------------ conexiones
    async def connect(self, subscriber: Subscriber) -> None:
        await subscriber.websocket.accept()
        self._subscribers[subscriber.websocket] = subscriber
        logger.info(
            "WS conectado: %s (%s) · %d conexiones activas",
            subscriber.full_name, subscriber.role, len(self._subscribers),
        )
        await self._send(
            subscriber,
            RealtimeEvent(
                type=EventType.CONEXION_ESTABLECIDA,
                payload={
                    "usuario": subscriber.full_name,
                    "rol": subscriber.role,
                    "conexiones_activas": len(self._subscribers),
                },
            ),
        )

    def disconnect(self, websocket: WebSocket) -> None:
        subscriber = self._subscribers.pop(websocket, None)
        if subscriber:
            logger.info(
                "WS desconectado: %s · %d conexiones activas",
                subscriber.full_name, len(self._subscribers),
            )

    @property
    def active_count(self) -> int:
        return len(self._subscribers)

    # ------------------------------------------------------------- difusión
    async def _send(self, subscriber: Subscriber, event: RealtimeEvent) -> bool:
        try:
            await subscriber.websocket.send_json(event.to_message())
            return True
        except Exception:
            # Conexión muerta (pestaña cerrada, red caída). Se limpia y ya;
            # nunca debe tumbar la difusión hacia los demás.
            return False

    async def broadcast(self, event: RealtimeEvent) -> int:
        """Envía el evento a todos los suscriptores con derecho a recibirlo."""
        destinatarios = [
            subscriber
            for subscriber in list(self._subscribers.values())
            if event.is_visible_to(subscriber.role, subscriber.hotel_id)
        ]
        if not destinatarios:
            return 0

        resultados = await asyncio.gather(
            *(self._send(subscriber, event) for subscriber in destinatarios),
            return_exceptions=True,
        )

        entregados = 0
        for subscriber, resultado in zip(destinatarios, resultados):
            if resultado is True:
                entregados += 1
            else:
                self.disconnect(subscriber.websocket)

        return entregados

    # -------------------------------------------------- publicación externa
    def publish(self, event: RealtimeEvent) -> None:
        """Publica desde código síncrono. No bloquea ni lanza excepciones.

        El tiempo real es un extra: si la difusión falla, la operación de
        negocio ya se guardó y no se debe deshacer por eso.
        """
        if self._loop is None or self._loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast(event), self._loop)
        except Exception as exc:  # pragma: no cover
            logger.warning("No se pudo publicar el evento %s: %s", event.type, exc)


manager = ConnectionManager()


def publish(event: RealtimeEvent) -> None:
    """Punto único de publicación. Llamar siempre DESPUÉS del commit."""
    manager.publish(event)
