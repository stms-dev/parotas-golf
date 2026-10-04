"""Configuración central. Todo por variables de entorno, nada hardcodeado."""
from functools import lru_cache
from typing import Annotated, List
from urllib.parse import urlparse

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


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

    # --- Reserva pública y cobro en línea ---
    # El sitio del club deja reservar sin cuenta y cobrar con tarjeta.
    #
    # El cobro lo hace Stripe. Con la llave puesta, el huésped paga en la
    # página de Stripe y vuelve; sin ella, el sitio aparta la salida y avisa
    # que el club le va a llamar para confirmar — nunca pide una tarjeta que
    # no va a poder cobrar.
    STRIPE_SECRET_KEY: str = ""
    # La firma con la que Stripe avisa que un pago se completó. SIN ESTO NO SE
    # CONFIRMA NADA: sin verificar la firma, cualquiera podría avisar que pagó.
    STRIPE_WEBHOOK_SECRET: str = ""
    # A dónde vuelve el huésped desde Stripe. En producción es el sitio del
    # club; en desarrollo, el que corre en el 5180.
    SITIO_URL: str = "http://localhost:5180"

    @field_validator("SITIO_URL")
    @classmethod
    def _completar_sitio(cls, valor: str) -> str:
        """Le pone el esquema si falta y le quita la diagonal del final.

        Stripe exige la dirección completa: con `parotasgolf.com` a secas
        contesta "An explicit scheme (such as https) must be provided" y el
        cobro se cae. Y es un error facilísimo de cometer, porque al teclear
        un dominio en una variable de entorno nadie piensa en el https://.
        Costó un 500 en producción averiguarlo, así que mejor que el servidor
        lo complete en vez de esperar a que alguien lo note.
        """
        valor = (valor or "").strip().rstrip("/")
        if valor and not valor.startswith(("http://", "https://")):
            valor = f"https://{valor}"
        return valor

    # El simulador de tarjetas, para desarrollar sin tocar Stripe. Queda
    # apagado por omisión y Stripe le gana si las dos están prendidas: un
    # servidor que confirma reservas con tarjetas inventadas es peor que uno
    # que no cobra.
    PAGOS_SIMULADOS: bool = False

    # Cuánto se le aparta la salida a quien está pagando. Treinta porque es el
    # mínimo que Stripe permite para que una sesión de pago venza, y conviene
    # que las dos cosas caduquen juntas: si el apartado venciera antes, alguien
    # podría pagar una salida que ya se revendió.
    APARTADO_MINUTOS: int = 30
    # Cuántas reservas puede intentar una misma dirección por hora. Sin esto,
    # un script llena el tee sheet de reservas falsas en diez minutos.
    PUBLICO_INTENTOS_POR_HORA: int = 12

    # --- Seguridad ---
    SECRET_KEY: str = "CAMBIAR-ESTA-LLAVE-EN-PRODUCCION-openssl-rand-hex-32"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8  # jornada operativa
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # --- CORS ---
    # `NoDecode` apaga el intérprete de JSON que pydantic-settings le pone
    # encima a las listas. Sin eso nunca llega al validador de abajo: revienta
    # antes, al intentar leer `https://a.com,https://b.com` como JSON.
    CORS_ORIGINS: Annotated[List[str], NoDecode] = [
        # El sistema de operación.
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        # El sitio público del club, que vive en otro origen y llama a las
        # rutas /public para reservar.
        "http://localhost:5180",
        "http://127.0.0.1:5180",
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _leer_origenes(cls, valor):
        """Admite lista JSON o direcciones separadas por comas.

        Escribir la lista como JSON en el panel de un proveedor es fácil de
        equivocar; con esto, `https://a.com,https://b.com` también sirve.
        """
        if isinstance(valor, str):
            texto = valor.strip()
            if texto.startswith("["):
                import json

                return json.loads(texto)
            return [parte.strip() for parte in texto.split(",") if parte.strip()]
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

    # --- Correo ---
    # Se sale por HTTPS, no por SMTP. Railway bloquea los puertos de SMTP en
    # sus planes chicos, y no es capricho suyo: casi todo servidor compartido
    # hace lo mismo para que nadie mande spam desde ahí. La API de Resend va
    # por el puerto 443, el mismo que cualquier página, y ese nunca se bloquea.
    RESEND_API_KEY: str = ""
    MAIL_FROM: str = ""
    MAIL_FROM_NAME: str = "Las Parotas Club de Golf"

    # SMTP queda como alternativa: sirve en una computadora del club o en otro
    # servidor que sí lo permita, y es lo que usan las pruebas.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    SMTP_TLS: bool = True

    @property
    def remitente(self) -> str:
        """De qué dirección salen los correos del club."""
        return self.MAIL_FROM or self.SMTP_FROM

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
