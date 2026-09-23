"""Defensas que se aplican a toda la aplicación, no endpoint por endpoint.

Tres cosas viven aquí:

1. **Encabezados defensivos.** Le dicen al navegador qué se permite y qué no:
   forzar HTTPS, no ejecutar scripts ajenos, no dejarse meter en un iframe.
2. **Identificador de petición.** Cada request lleva un `X-Request-Id` que
   viaja a la bitácora y regresa al cliente: cuando alguien reporta un error,
   con ese número se encuentra la traza exacta.
3. **Límite de intentos.** Un candado simple contra fuerza bruta y contra el
   script que se pone a pedir mil veces por minuto.

El límite se lleva en memoria a propósito: es un proceso, un mostrador y un
campo. Meter Redis aquí sería cargar una pieza más que mantener para un
problema que no existe a este tamaño.
"""
from __future__ import annotations

import time
import uuid
from collections import defaultdict, deque
from typing import Deque, Dict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Le pone nombre a cada petición y lo devuelve en la respuesta."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:16]
        request.state.request_id = request_id
        response: Response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Encabezados de seguridad en cada respuesta.

    La política de contenido permite lo que la aplicación usa de verdad:
    sus propios archivos, imágenes en `data:` (los códigos QR y el logo),
    tipografías de Google y la conexión de tiempo real por WebSocket. Nada
    más. Si mañana se agrega un servicio externo, se agrega aquí y se ve en
    la revisión del código.
    """

    CSP = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: blob:; "
        "connect-src 'self' ws: wss:; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )

    def __init__(self, app, *, produccion: bool = False):
        super().__init__(app)
        self.produccion = produccion

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(self), microphone=(), geolocation=(), payment=()"
        )
        response.headers["Content-Security-Policy"] = self.CSP

        if self.produccion:
            # Solo con HTTPS de verdad: en local rompería el acceso por http.
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )

        # Las respuestas de la API llevan datos de huéspedes y dinero: que no
        # se queden guardadas en ningún intermediario.
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"

        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Tope de peticiones por IP, con un tope más estrecho para el login.

    Adivinar contraseñas se vuelve inútil si solo se pueden probar unas
    cuantas por minuto. El resto de la API tiene un tope amplio: no estorba
    al uso normal y frena a quien se pone a barrer folios.
    """

    def __init__(
        self,
        app,
        *,
        limite_general: int = 200,
        limite_login: int = 10,
        ventana: int = 60,
    ):
        super().__init__(app)
        self.limite_general = limite_general
        self.limite_login = limite_login
        self.ventana = ventana
        self._marcas: Dict[str, Deque[float]] = defaultdict(deque)

    def _ip(self, request: Request) -> str:
        # Detrás del proxy de Railway la IP real viene en X-Forwarded-For.
        reenviada = request.headers.get("X-Forwarded-For")
        if reenviada:
            return reenviada.split(",")[0].strip()
        return request.client.host if request.client else "desconocida"

    def _excedido(self, llave: str, limite: int) -> bool:
        ahora = time.monotonic()
        marcas = self._marcas[llave]
        while marcas and ahora - marcas[0] > self.ventana:
            marcas.popleft()
        if len(marcas) >= limite:
            return True
        marcas.append(ahora)
        return False

    async def dispatch(self, request: Request, call_next):
        ruta = request.url.path

        # El canal de tiempo real es una conexión larga, no una ráfaga de
        # peticiones: contarla aquí solo daría falsos positivos.
        if ruta.startswith("/api/ws") or ruta == "/health":
            return await call_next(request)

        ip = self._ip(request)
        es_login = ruta.endswith("/auth/login")
        limite = self.limite_login if es_login else self.limite_general
        llave = f"{ip}:{'login' if es_login else 'api'}"

        if self._excedido(llave, limite):
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": "DEMASIADAS_PETICIONES",
                        "message": (
                            "Demasiados intentos. Espere un minuto y vuelva a intentarlo."
                            if es_login
                            else "Demasiadas peticiones seguidas. Espere un momento."
                        ),
                    }
                },
                headers={"Retry-After": str(self.ventana)},
            )

        return await call_next(request)
