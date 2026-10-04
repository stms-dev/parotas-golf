"""Lo que el sistema hace solo al encender, en el servidor.

En un servidor administrado no hay quién abra una terminal para correr las
migraciones después de cada despliegue. Así que el proceso se pone al día a
sí mismo: aplica lo que falte del esquema y, si la base está en blanco,
siembra los catálogos y la cuenta de administración.

Las dos operaciones son seguras de repetir: Alembic solo aplica lo que falta,
y la siembra no corre si ya hay hoteles con convenio.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine

logger = logging.getLogger(__name__)

RAIZ = Path(__file__).resolve().parent.parent.parent


def migrar() -> None:
    """Aplica las migraciones pendientes."""
    try:
        from alembic import command
        from alembic.config import Config

        config = Config(str(RAIZ / "alembic.ini"))
        config.set_main_option("script_location", str(RAIZ / "alembic"))
        config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
        # Aquí migra la aplicación, no una terminal: la bitácora ya está
        # armada y Alembic no debe rehacerla. Ver el comentario largo en
        # alembic/env.py — sin esta bandera, el servidor se queda mudo.
        config.attributes["app_configuro_log"] = True
        command.upgrade(config, "head")
        logger.info("Esquema al día")
    except Exception as exc:  # pragma: no cover
        # Si el esquema no se pudo actualizar, la aplicación no debe fingir
        # que todo está bien: /health lo va a reportar y el despliegue falla.
        logger.exception("No se pudieron aplicar las migraciones: %s", exc)
        raise


def sembrar_si_esta_vacia() -> None:
    """Siembra catálogos y administrador la primera vez, y solo esa vez."""
    if not settings.SEED_ADMIN_PASSWORD:
        return

    try:
        with engine.connect() as conexion:
            hoteles = conexion.execute(
                text("SELECT COUNT(*) FROM hotels WHERE is_direct = false")
            ).scalar_one()
    except Exception as exc:  # pragma: no cover
        logger.warning("No se pudo revisar si la base ya tiene datos: %s", exc)
        return

    if hoteles:
        return

    logger.info("Base en blanco: sembrando catálogos y cuenta de administración")
    os.environ.setdefault("SEED_ADMIN_EMAIL", settings.SEED_ADMIN_EMAIL)
    os.environ.setdefault("SEED_ADMIN_PASSWORD", settings.SEED_ADMIN_PASSWORD)

    import sys

    if str(RAIZ) not in sys.path:
        sys.path.insert(0, str(RAIZ))

    from seed import sembrar

    sembrar(produccion=True)
    logger.info("Catálogos sembrados")
