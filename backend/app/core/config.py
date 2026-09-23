"""Configuración central. Todo por variables de entorno, nada hardcodeado."""
from functools import lru_cache
from typing import List
from urllib.parse import urlparse

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Aplicación ---
    APP_NAME: str = "Las Parotas API"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    API_PREFIX: str = "/api"

    # --- Base de datos ---
    # En local: SQLite. En despliegue basta cambiar esta variable a
    # postgresql+psycopg://usuario:clave@host:5432/las_parotas
    DATABASE_URL: str = "sqlite:///./las_parotas.db"

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalizar_url(cls, valor: str) -> str:
        """Acepta la URL tal como la copia y pega el proveedor.

        Supabase y compañía entregan `postgresql://…`, que en SQLAlchemy
        busca el driver viejo (psycopg2). Aquí se le pone el que sí está
        instalado, en vez de dejar que reviente al arrancar con un mensaje
        que no dice nada.
        """
        if valor.startswith("postgres://"):
            valor = valor.replace("postgres://", "postgresql+psycopg://", 1)
        elif valor.startswith("postgresql://"):
            valor = valor.replace("postgresql://", "postgresql+psycopg://", 1)
        return valor

    # --- Seguridad ---
    SECRET_KEY: str = "CAMBIAR-ESTA-LLAVE-EN-PRODUCCION-openssl-rand-hex-32"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8  # jornada operativa
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # --- CORS ---
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _leer_origenes(cls, valor):
        """Admite lista JSON o direcciones separadas por comas.

        Escribir la lista como JSON en el panel de un proveedor es fácil de
        equivocar; con esto, `https://a.com,https://b.com` también sirve.
        """
        if isinstance(valor, str) and not valor.strip().startswith("["):
            return [parte.strip() for parte in valor.split(",") if parte.strip()]
        return valor

    @property
    def HOSTS_PERMITIDOS(self) -> List[str]:
        """Dominios que el servidor reconoce como suyos, sacados de CORS."""
        hosts = []
        for origen in self.CORS_ORIGINS:
            nombre = urlparse(origen).hostname
            if nombre:
                hosts.append(nombre)
        return hosts

    # --- Reglas operativas (valores por defecto; la BD manda) ---
    DEFAULT_CURRENCY: str = "MXN"
    SECONDARY_CURRENCY: str = "USD"
    SLOT_CAPACITY: int = 4              # jugadores por franja
    CASH_CUTOFF_HOUR: int = 22          # después de esta hora no se registran cobros
    TIMEZONE: str = "America/Mexico_City"

    # Horarios que ya pasaron.
    #   true  → funcionamiento real: una salida cuya hora ya pasó (o de hoy,
    #           después de la hora límite) no se puede reservar.
    #   false → modo pruebas: se puede elegir cualquier horario del día aunque
    #           ya haya pasado. DEBE quedar en true en operación real.
    RESPETAR_HORARIOS: bool = True

    @property
    def horarios_libres(self) -> bool:
        """True cuando se permite reservar horarios vencidos (modo pruebas)."""
        return not self.RESPETAR_HORARIOS

    # --- Correo (worker) ---
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "no-reply@lasparotas.mx"
    SMTP_TLS: bool = True

    # --- QR ---
    QR_BASE_URL: str = "http://localhost:5173/pase"

    # --- Arranque en el servidor ---
    # Aplicar las migraciones al encender. En el servidor no hay terminal a
    # la mano, así que el propio proceso pone el esquema al día.
    MIGRAR_AL_ARRANCAR: bool = False
    # Primera cuenta de administración. Solo se usa si la base está en blanco.
    SEED_ADMIN_EMAIL: str = "admin@parotasgolf.com"
    SEED_ADMIN_PASSWORD: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
