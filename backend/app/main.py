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
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
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
from app.modules.mailing.router import router as mailing_router
from app.modules.pagos.router import router as publico_router
from app.modules.treasury.router import router as treasury_router
from app.realtime.manager import manager as realtime_manager
from app.realtime.router import router as realtime_router

PRODUCCION = settings.ENVIRONMENT.lower() == "production"

configurar_logging(produccion=PRODUCCION, debug=settings.DEBUG)
logger = logging.getLogger(__name__)


async def _repartir_correos() -> None:
    """Manda lo pendiente cada minuto, sin estorbarle a nadie.

    El envío es bloqueante (habla con un SMTP), así que corre en un hilo
    aparte: mientras ese correo sale, la API sigue atendiendo el mostrador.
    """
    from app.core.database import SessionLocal
    from app.modules.mailing.service import MailingService

    def _tanda() -> dict:
        db = SessionLocal()
        try:
            return MailingService(db).procesar_pendientes()
        finally:
            db.close()

    while True:
        try:
            await asyncio.sleep(60)
            resumen = await asyncio.to_thread(_tanda)
            if resumen.get("enviados") or resumen.get("fallidos"):
                logger.info(
                    "Correos: %s enviados, %s con error",
                    resumen.get("enviados"), resumen.get("fallidos"),
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Falló la tanda de correos")


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

    # El cartero: cada minuto revisa la bandeja de salida y manda lo que
    # quedó pendiente. Sin servidor de correo configurado, ni arranca.
    tarea_correos = None
    from app.modules.mailing.service import MailingService

    if MailingService.configurado():
        tarea_correos = asyncio.create_task(_repartir_correos())
        logger.info("Reparto de correos activo")
    else:
        logger.info("Sin servidor de correo: los correos quedan en la bandeja")

    yield

    if tarea_correos:
        tarea_correos.cancel()
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
    mailing_router,
    # Las rutas que el sitio del club llama sin cuenta.
    publico_router,
    audit_router,
    dashboard_router,
    realtime_router,
):
    app.include_router(router, prefix=settings.API_PREFIX)


# --------------------------------------------------------------- pantallas
# El mismo contenedor entrega las dos aplicaciones compiladas:
#
#   parotasgolf.com/          → el sitio del club, para el público
#   parotasgolf.com/sistema   → el sistema de operación, para hoteles y campo
#   parotasgolf.com/api       → la API, para los dos
#
# Son compilaciones distintas, no una sola partida en dos: quien entra a ver
# el campo baja el sitio y nada más — el sistema pesa tres veces más y no lo
# necesita hasta que le pica a Acceder. Y al compartir dominio no hay CORS que
# configurar ni tiempo real que apuntar a otro lado.
RAIZ = Path(__file__).resolve().parent.parent
ESTATICOS = RAIZ / "static"          # el sistema de operación
SITIO = RAIZ / "sitio"               # el sitio público

BASE_SISTEMA = "/sistema"

if ESTATICOS.is_dir():
    app.mount(
        f"{BASE_SISTEMA}/assets",
        StaticFiles(directory=ESTATICOS / "assets"),
        name="assets-sistema",
    )

if SITIO.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=SITIO / "assets"),
        name="assets-sitio",
    )


def _entregar(carpeta: Path, ruta: str) -> FileResponse:
    """Un archivo si existe; si no, el index de esa aplicación.

    Las rutas de las dos viven en el navegador. Si el servidor respondiera 404,
    recargar la página en cualquier pantalla distinta del inicio rompería todo.
    """
    archivo = carpeta / ruta if ruta else None
    if archivo and archivo.is_file():
        return FileResponse(archivo)
    return FileResponse(carpeta / "index.html")


if ESTATICOS.is_dir():

    @app.get("/pase/{token:path}", include_in_schema=False)
    def pase_antiguo(token: str):
        """Los pases con QR que se enviaron cuando el sistema vivía en la raíz.

        Esos códigos ya están impresos y en los correos de los huéspedes: no se
        pueden cambiar. Se reenvían a su dirección nueva y siguen sirviendo.
        """
        return RedirectResponse(f"{BASE_SISTEMA}/pase/{token}", status_code=301)

    @app.get(BASE_SISTEMA, include_in_schema=False)
    @app.get(BASE_SISTEMA + "/{ruta_completa:path}", include_in_schema=False)
    def sistema(ruta_completa: str = ""):
        return _entregar(ESTATICOS, ruta_completa)


if SITIO.is_dir():

    @app.get("/{ruta_completa:path}", include_in_schema=False)
    def pantallas(ruta_completa: str):
        """Lo que no es la API ni el sistema es el sitio del club."""
        return _entregar(SITIO, ruta_completa)

elif ESTATICOS.is_dir():
    # Sin el sitio compilado —una imagen vieja, o una compilación a medias— la
    # raíz lleva al sistema. Vale más eso que una página en blanco.
    @app.get("/{ruta_completa:path}", include_in_schema=False)
    def pantallas_sin_sitio(ruta_completa: str):
        return _entregar(ESTATICOS, ruta_completa)
