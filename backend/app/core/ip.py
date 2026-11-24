"""La dirección de quien hace la petición, sin creerle al visitante.

`X-Forwarded-For` es una lista que cada proxy va **alargando por la derecha**.
Lo que está a la izquierda lo puede escribir cualquiera: quien manda la
petición pone ahí lo que quiera. Por eso el primer valor no sirve para decidir
"es la misma persona de antes": un script cambia ese valor en cada intento y se
salta cualquier límite.

Lo confiable es lo que agregaron NUESTROS proxies, que están a la derecha.
`PROXIES_DE_CONFIANZA` es cuántos hay entre el visitante y la aplicación; la
dirección del visitante es la que ese último proxy anotó, contando desde la
derecha.
"""
import logging
from typing import List

from fastapi import Request

from app.core.config import settings

logger = logging.getLogger("parotas.ip")


def _cadena(request: Request) -> List[str]:
    crudo = request.headers.get("x-forwarded-for", "")
    return [p.strip() for p in crudo.split(",") if p.strip()]


def ip_del_cliente(request: Request) -> str:
    cadena = _cadena(request)
    if settings.LOG_CADENA_IP:
        # Para comprobar en producción cómo llega la cadena y ajustar
        # PROXIES_DE_CONFIANZA. Se apaga después.
        logger.warning("cadena de IP: xff=%s client=%s", cadena, request.client)
    saltos = max(int(settings.PROXIES_DE_CONFIANZA), 1)
    if len(cadena) >= saltos:
        return cadena[-saltos]
    if cadena:
        return cadena[0]
    return request.client.host if request.client else "desconocida"
