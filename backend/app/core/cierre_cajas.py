"""Cierre automático de cajas a la hora configurada.

Las dos cajas —la de green fees y la de la tienda— se cierran solas a la hora
de `cierre_automatico_caja` (22:00 si no se ha puesto otra). Si alguien la
cerró antes con su arqueo, no hay nada que hacer. Si se quedó abierta, el
sistema congela lo que debería haber y la marca como cerrada sin arqueo: al
día siguiente se cuenta el cajón y se registra.

También cierra lo que se haya quedado abierto de días anteriores (un servidor
apagado a esa hora, por ejemplo): la regla es "la primera hora de cierre
después de que se abrió ya pasó".
"""
import logging
from datetime import datetime, time, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.shared.tiempo import ahora, leer_hora, zona

logger = logging.getLogger(__name__)

CLAVE = "cierre_automatico_caja"
POR_DEFECTO = time(22, 0)


def hora_de_cierre(db: Session) -> time:
    from app.modules.catalog.service import SettingsService

    return leer_hora(SettingsService(db).get(CLAVE), respaldo=POR_DEFECTO)


def exigir_horario_de_caja(db: Session, momento: Optional[datetime] = None) -> None:
    """Pasada la hora de cierre ya no se abre caja ni se cobra.

    Es la MISMA regla para las dos cajas y para el cobro del check-in, y se
    mide con la hora del campo, no con la del servidor (que en la nube es UTC:
    medida así, la caja "cerraba" a las 4 de la tarde).
    """
    from app.core.exceptions import BusinessRuleError

    hora = hora_de_cierre(db)
    if (momento or ahora()).time() >= hora:
        raise BusinessRuleError(
            f"La caja cerró a las {hora.strftime('%H:%M')} y no admite cobros hasta mañana. "
            "Si hubo un movimiento después, regístrelo al abrir el siguiente turno."
        )


def en_horario_de_caja(db: Session, momento: Optional[datetime] = None) -> bool:
    return (momento or ahora()).time() < hora_de_cierre(db)


def _local(utc_ingenuo: datetime) -> datetime:
    """Las aperturas se guardan en UTC sin zona; se pasan a la hora del campo."""
    tz = zona()
    if tz is None:
        return utc_ingenuo
    return utc_ingenuo.replace(tzinfo=timezone.utc).astimezone(tz).replace(tzinfo=None)


def vence(abierta_utc: datetime, hora: time) -> datetime:
    """Primera hora de cierre después de la apertura (hora local)."""
    abierta = _local(abierta_utc)
    limite = datetime.combine(abierta.date(), hora)
    if abierta >= limite:
        limite += timedelta(days=1)
    return limite


def cerrar_vencidas(db: Session, momento: Optional[datetime] = None) -> dict:
    from app.modules.tienda.models import TiendaCorte
    from app.modules.tienda.service import CajaTienda
    from app.modules.treasury.models import CashSession
    from app.modules.treasury.service import CashSessionService
    from app.shared.enums import CashSessionStatus

    hora = hora_de_cierre(db)
    texto = hora.strftime("%H:%M")
    momento = momento or ahora()
    cerradas = {"green_fees": 0, "tienda": 0}

    sesiones = db.execute(
        select(CashSession).where(CashSession.status == CashSessionStatus.ABIERTA)
    ).scalars().all()
    for s in sesiones:
        if s.opened_at and momento >= vence(s.opened_at, hora):
            CashSessionService(db).cerrar_automatico(s, texto)
            cerradas["green_fees"] += 1

    cortes = db.execute(select(TiendaCorte).where(TiendaCorte.estado == "ABIERTO")).scalars().all()
    for c in cortes:
        if momento >= vence(c.abierto_en, hora):
            CajaTienda(db).cerrar_automatico(c, texto)
            cerradas["tienda"] += 1

    if any(cerradas.values()):
        logger.info("Cierre automático de cajas (%s): %s", texto, cerradas)
    return cerradas
