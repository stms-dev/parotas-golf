"""Catálogo de eventos de tiempo real y reglas de quién puede recibir cada uno.

Un evento que sale por el socket llega a varias pantallas a la vez, así que el
filtrado por alcance vive aquí y no en cada lugar que publica: si un evento
trae información de un hotel, un usuario de otro hotel no debe recibirlo,
igual que no puede consultarlo por la API.
"""
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from app.core.permissions import role_has_permission
from app.shared.enums import UserRole


class EventType(str, Enum):
    # Reservas
    RESERVA_CREADA = "reserva.creada"
    RESERVA_ACTUALIZADA = "reserva.actualizada"
    RESERVA_CANCELADA = "reserva.cancelada"

    # Disponibilidad: lo que hace que el tee sheet se mueva solo
    DISPONIBILIDAD_CAMBIADA = "disponibilidad.cambiada"

    # Mostrador
    CHECKIN_REGISTRADO = "checkin.registrado"
    PAGO_REGISTRADO = "pago.registrado"

    # Caja y configuración
    CAJA_ACTUALIZADA = "caja.actualizada"
    CAJA_CERRADA = "caja.cerrada"
    TIPO_CAMBIO_ACTUALIZADO = "tipo_cambio.actualizado"

    # Agenda
    EVENTO_CREADO = "evento.creado"
    EVENTO_LIBERADO = "evento.liberado"

    # Servicio
    CONEXION_ESTABLECIDA = "conexion.establecida"
    PONG = "pong"


@dataclass
class RealtimeEvent:
    """Un aviso de que algo cambió.

    El payload es deliberadamente delgado: identificadores y lo mínimo para
    pintar un aviso. El cliente decide si necesita recargar el detalle por la
    API, que es la que aplica los permisos de verdad.
    """

    type: EventType
    payload: dict[str, Any] = field(default_factory=dict)

    # Alcance. hotel_id != None ⇒ solo ese hotel y los roles del campo.
    hotel_id: Optional[int] = None
    # Permiso mínimo para recibirlo; None ⇒ cualquier usuario autenticado.
    required_permission: Optional[str] = None

    created_at: datetime = field(default_factory=datetime.utcnow)

    def to_message(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "payload": self.payload,
            "at": self.created_at.isoformat(),
        }

    def is_visible_to(self, role: UserRole, hotel_id: Optional[int]) -> bool:
        """¿Este suscriptor debe recibir el evento?

        Misma regla que la API: un usuario de hotel solo ve lo suyo. La
        disponibilidad es la excepción y se publica sin hotel_id, porque que
        una franja se libere le importa a todos.
        """
        if self.required_permission and not role_has_permission(role, self.required_permission):
            return False

        if self.hotel_id is not None and role == UserRole.HOTEL and hotel_id != self.hotel_id:
            return False

        return True
