"""Bitácora del servidor, con los secretos tapados.

En producción cada línea sale como JSON porque Railway las indexa así y se
pueden buscar por campo. En desarrollo sale como texto, que es lo que se lee
cómodo en una terminal.

Lo importante: antes de escribir, se tapan contraseñas y tokens. Un log es
un archivo que acaba copiado en un ticket de soporte; no puede llevar la
llave de nadie.
"""
from __future__ import annotations

import json
import logging
import re
import sys
from typing import Any

CAMPOS_SENSIBLES = (
    "password",
    "contrasena",
    "contraseña",
    "token",
    "secret",
    "secret_key",
    "authorization",
    "api_key",
    "smtp_password",
    "database_url",
)

# "Bearer abc...", "token=abc...", "password': 'abc..."
PATRONES = [
    re.compile(r"(Bearer\s+)[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE),
    re.compile(r"((?:token|password|secret|api_key)['\"]?\s*[:=]\s*['\"]?)[^\s,'\"}\)]+", re.IGNORECASE),
    re.compile(r"(postgres(?:ql)?(?:\+\w+)?://[^:]+:)[^@]+", re.IGNORECASE),
]


def tapar(texto: str) -> str:
    for patron in PATRONES:
        texto = patron.sub(r"\1***", texto)
    return texto


def limpiar(valor: Any) -> Any:
    """Recorre diccionarios y listas tapando lo que no debe quedar escrito."""
    if isinstance(valor, dict):
        return {
            k: ("***" if k.lower() in CAMPOS_SENSIBLES else limpiar(v))
            for k, v in valor.items()
        }
    if isinstance(valor, (list, tuple)):
        return [limpiar(v) for v in valor]
    if isinstance(valor, str):
        return tapar(valor)
    return valor


class FormatoJson(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        linea = {
            "hora": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "nivel": record.levelname,
            "origen": record.name,
            "mensaje": tapar(record.getMessage()),
        }
        if hasattr(record, "request_id"):
            linea["request_id"] = record.request_id
        if record.exc_info:
            linea["traza"] = tapar(self.formatException(record.exc_info))
        return json.dumps(linea, ensure_ascii=False)


class FormatoTexto(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return tapar(super().format(record))


class SinRuidoDeSalud(logging.Filter):
    """El monitor de Railway pega a /health cada pocos segundos. Sin esto, la
    bitácora se llena de líneas que no dicen nada."""

    def filter(self, record: logging.LogRecord) -> bool:
        mensaje = record.getMessage()
        return "/health" not in mensaje


def configurar_logging(*, produccion: bool, debug: bool = False) -> None:
    raiz = logging.getLogger()
    for handler in list(raiz.handlers):
        raiz.removeHandler(handler)

    salida = logging.StreamHandler(sys.stdout)
    salida.setFormatter(
        FormatoJson()
        if produccion
        else FormatoTexto("%(asctime)s  %(levelname)-7s %(name)s  %(message)s", "%H:%M:%S")
    )
    raiz.addHandler(salida)
    raiz.setLevel(logging.DEBUG if debug else logging.INFO)

    logging.getLogger("uvicorn.access").addFilter(SinRuidoDeSalud())
    # SQLAlchemy en INFO imprime cada consulta con sus parámetros.
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
