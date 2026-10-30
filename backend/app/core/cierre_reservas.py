"""Cierre automático de reservas a las que nadie llegó y que nadie validó.

Pasada la hora de la salida (más una tolerancia), una reserva que sigue
"por confirmar" o "confirmada" sin haber llegado a check-in se marca sola como
NO_SHOW. Así no se queda colgada en el tablero ni ocupando el cupo.

- Una reserva pagada en línea ya pagó: se cierra igual y el pago se conserva
  (no se devuelve ni se mueve).
- Una apartada que sigue esperando su pago en línea (con `hold_expires_at`)
  no se toca aquí: su propio vencimiento la libera.
- La tolerancia sale del ajuste `no_show_automatico_min` (120 minutos por
  defecto; 0 lo apaga).
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.shared.enums import ReservationStatus
from app.shared.tiempo import ahora

logger = logging.getLogger(__name__)

CLAVE = "no_show_automatico_min"
POR_DEFECTO = 120


def tolerancia_minutos(db: Session) -> int:
    from app.modules.catalog.service import SettingsService

    try:
        valor = int(str(SettingsService(db).get(CLAVE, str(POR_DEFECTO))).strip())
    except (TypeError, ValueError):
        return POR_DEFECTO
    return valor if 0 <= valor <= 1440 else POR_DEFECTO


def cerrar_sin_presentarse(db: Session, momento: datetime | None = None) -> dict:
    """Marca como no presentadas las reservas vencidas. Devuelve cuántas cerró."""
    from app.modules.booking.models import Reservation, TeeSlot
    from app.modules.booking.service import ReservationService_

    from app.core.config import settings

    # Con los horarios libres (pruebas y demostraciones) se puede reservar en
    # el pasado a propósito: ahí no se cierra nada solo.
    if settings.horarios_libres:
        return {"cerradas": 0, "apagado": True}
    minutos = tolerancia_minutos(db)
    if minutos == 0:
        return {"cerradas": 0, "apagado": True}
    ahora_local = momento or ahora()
    limite = ahora_local - timedelta(minutes=minutos)

    candidatas = db.execute(
        select(Reservation.id, TeeSlot.slot_date, TeeSlot.slot_time)
        .join(TeeSlot, Reservation.tee_slot_id == TeeSlot.id)
        .where(
            Reservation.status.in_([ReservationStatus.PENDIENTE, ReservationStatus.CONFIRMADA]),
            Reservation.hold_expires_at.is_(None),
            TeeSlot.slot_date <= limite.date(),
        )
    ).all()

    cerradas = 0
    for rid, dia, hora in candidatas:
        if datetime.combine(dia, hora) > limite:
            continue
        try:
            r = ReservationService_(db).cerrar_sin_presentarse(
                rid,
                f"No se presentó y nadie la validó pasados {minutos} min de su salida de las {hora.strftime('%H:%M')}.",
            )
            if r:
                cerradas += 1
        except Exception:  # noqa: BLE001 — una reserva rara no frena a las demás
            db.rollback()
            logger.exception("No se pudo cerrar sola la reserva %s", rid)
    if cerradas:
        logger.info("Reservas cerradas solas como no presentadas: %s", cerradas)
    return {"cerradas": cerradas, "apagado": False}
