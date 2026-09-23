"""Punto de entrada de la API.

Monolito modular: un solo proceso, módulos con fronteras estrictas. Cada uno
expone su router y nada más; no se importan servicios entre módulos salvo por
sus interfaces públicas.
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.exceptions import DomainError
from app.core.logging_config import configurar_logging
from app.core.security_middleware import (
    RateLimitMiddleware,
    RequestIdMiddleware,
    SecurityHeadersMiddleware,
)
from app.modules.audit.router import dashboard_router
from app.modules.audit.router import router as audit_router
from app.modules.booking.router import router as booking_router
from app.modules.catalog.router import router as catalog_router
from app.modules.checkin.router import router as checkin_router
from app.modules.events.router import router as events_router
from app.modules.identity.router import router as auth_router
from app.modules.identity.router import users_router
from app.modules.inventory.router import router as inventory_router
from app.modules.treasury.router import router as treasury_router
from app.realtime.manager import manager as realtime_manager
from app.realtime.router import router as realtime_router

PRODUCCION = settings.ENVIRONMENT.lower() == "production"

configurar_logging(produccion=PRODUCCION, debug=settings.DEBUG)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Al arrancar se le entrega el bucle de eventos al gestor de WebSockets.

    Sin esto, los servicios (que corren en hilos) no tendrían a dónde enviar
    los avisos y el tiempo real quedaría mudo sin dar error.
    """
    # En el servidor no hay quien abra una terminal: el esquema se pone al
    # día solo al arrancar. Alembic es idempotente, así que reiniciar no
    # repite nada.
    if settings.MIGRAR_AL_ARRANCAR:
        from app.core.arranque import migrar, sembrar_si_esta_vacia

        migrar()
        sembrar_si_esta_vacia()

    realtime_manager.bind_loop(asyncio.get_running_loop())
    logger.info("Canal de tiempo real listo")
    yield
    logger.info("Cerrando canal de tiempo real")


app = FastAPI(
    lifespan=lifespan,
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Sistema de reservaciones y operación de campo de golf.\n\n"
        "**Principios**: el hotel solicita, el campo valida; el pago ocurre en "
        "recepción; el beneficio PGA es individual por jugador; cada operación "
        "conserva el tipo de cambio y la comisión que se usaron en su momento."
    ),
    # En producción la documentación de la API no se publica: describe cada
    # endpoint y su forma, y eso es un mapa para quien quiera tantear.
    docs_url=None if PRODUCCION else "/docs",
    redoc_url=None if PRODUCCION else "/redoc",
    openapi_url=None if PRODUCCION else "/openapi.json",
)

app.add_middleware(SecurityHeadersMiddleware, produccion=PRODUCCION)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestIdMiddleware)

if PRODUCCION and settings.HOSTS_PERMITIDOS:
    # Solo se atienden peticiones dirigidas a los dominios del club: una
    # petición con el Host falseado se rechaza antes de tocar la aplicación.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.HOSTS_PERMITIDOS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    # Solo lo que la aplicación usa de verdad.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
    expose_headers=["X-Request-Id"],
)


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    """Traduce excepciones del dominio a respuestas HTTP.

    Gracias a esto la capa de servicio no importa nada de FastAPI.
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message, "detail": exc.detail}},
    )


@app.get("/api", tags=["Sistema"])
def api_root():
    """Señal de vida de la API. En producción no dice versión ni entorno:
    eso solo le sirve a quien está buscando por dónde entrar."""
    if PRODUCCION:
        return {"name": settings.APP_NAME, "status": "ok"}
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "docs": "/docs",
    }


@app.get("/health", tags=["Sistema"])
def health():
    from sqlalchemy import text

    from app.core.database import engine

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        database = "ok"
    except Exception as exc:  # pragma: no cover
        logger.error("Health check de BD falló: %s", exc)
        database = "error"

    return {"status": "ok" if database == "ok" else "degraded", "database": database}


for router in (
    auth_router,
    users_router,
    catalog_router,
    booking_router,
    checkin_router,
    treasury_router,
    events_router,
    inventory_router,
    audit_router,
    dashboard_router,
    realtime_router,
):
    app.include_router(router, prefix=settings.API_PREFIX)


# --------------------------------------------------------------- pantallas
# El mismo contenedor entrega la aplicación compilada. Compartir origen es lo
# que hace que el tiempo real funcione sin configurar nada aparte.
ESTATICOS = Path(__file__).resolve().parent.parent / "static"

if ESTATICOS.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=ESTATICOS / "assets"),
        name="assets",
    )

    @app.get("/{ruta_completa:path}", include_in_schema=False)
    def pantallas(ruta_completa: str):
        """Cualquier dirección que no sea de la API entrega la aplicación.

        Las rutas viven en el navegador (/recepcion, /finanzas…). Si el
        servidor respondiera 404, recargar la página en cualquier pantalla
        distinta del inicio rompería el sistema.
        """
        archivo = ESTATICOS / ruta_completa
        if ruta_completa and archivo.is_file():
            return FileResponse(archivo)
        return FileResponse(ESTATICOS / "index.html")
