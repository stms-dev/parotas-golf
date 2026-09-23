"""Hora local del campo.

El servidor puede estar en UTC —lo normal en un despliegue— pero el campo
opera en su propia zona horaria. Preguntar `date.today()` a secas produce
errores de un día en los extremos de la jornada, así que todo lo que compara
contra "ahora" pasa por aquí.

Windows no trae la base de zonas horarias del sistema, así que `zoneinfo` la
toma del paquete `tzdata` (está en requirements.txt). Si aun así faltara, no
se tumba la aplicación: se sigue con la hora local del equipo y se avisa una
vez en la bitácora, porque quedarse sin reservas es peor que quedarse sin
conversión horaria.
"""
import logging
from datetime import date, datetime, time, tzinfo
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.config import settings

logger = logging.getLogger(__name__)

_zona: Optional[tzinfo] = None
_avisado = False


def zona() -> Optional[tzinfo]:
    """La zona configurada, o None si este equipo no la tiene instalada."""
    global _zona, _avisado
    if _zona is None and not _avisado:
        try:
            _zona = ZoneInfo(settings.TIMEZONE)
        except (ZoneInfoNotFoundError, ValueError):
            _avisado = True
            logger.warning(
                "No se encontró la zona horaria '%s'. Se usará la hora local "
                "del equipo. Instale el paquete tzdata para corregirlo: "
                "pip install tzdata",
                settings.TIMEZONE,
            )
    return _zona


def ahora() -> datetime:
    """Fecha y hora actuales en la zona del campo, sin tzinfo.

    Se devuelve ingenuo a propósito: las fechas y horas de las salidas se
    guardan así, y comparar un valor con zona contra uno sin ella revienta.
    """
    tz = zona()
    if tz is None:
        return datetime.now()
    return datetime.now(tz).replace(tzinfo=None)


def hoy() -> date:
    return ahora().date()


def ya_paso(dia: date, hora_salida: time) -> bool:
    """¿La salida quedó en el pasado?

    Se usa tanto para impedir que se reserve un horario vencido como para
    pintarlo como cerrado en la rejilla. Una salida que arranca justo ahora
    ya no se puede vender: el jugador no alcanzaría a llegar.
    """
    return datetime.combine(dia, hora_salida) <= ahora()


# Si la hora límite no está configurada o viene mal escrita, se usa esta.
HORA_LIMITE_POR_DEFECTO = time(15, 0)


def leer_hora(valor: Optional[str], respaldo: time = HORA_LIMITE_POR_DEFECTO) -> time:
    """"15:00" → time(15, 0). Un valor ilegible no debe tumbar las reservas."""
    try:
        horas, minutos = str(valor).strip().split(":")[:2]
        return time(int(horas), int(minutos))
    except (AttributeError, ValueError):
        return respaldo


def dia_cerrado(dia: date, hora_limite: time) -> bool:
    """¿Ya no se puede reservar para ese día?

    Pasada la hora límite, el día de hoy queda cerrado aunque le queden
    salidas por delante: el campo necesita preparar la jornada y no recibir
    una partida con media hora de aviso. Los días siguientes no se tocan.
    """
    return dia == hoy() and ahora().time() >= hora_limite


def fuera_de_venta(dia: date, hora_salida: time, hora_limite: time) -> bool:
    """Una salida no se vende si ya pasó o si su día ya cerró."""
    return ya_paso(dia, hora_salida) or dia_cerrado(dia, hora_limite)
