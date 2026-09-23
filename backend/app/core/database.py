"""Motor de base de datos y sesión.

Aislado a propósito: el resto de la aplicación no sabe qué motor hay detrás.
Cambiar de SQLite a PostgreSQL es cambiar DATABASE_URL, nada más.
"""
from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

def _opciones_de_conexion() -> dict:
    """Lo que necesita cada motor para conectarse bien.

    Con PostgreSQL detrás de un *pooler* (Supabase, PgBouncer y similares) hay
    que apagar las consultas preparadas: el pooler reparte una misma conexión
    entre varias transacciones y la sentencia preparada en una no existe en la
    siguiente. Sin esto la aplicación arranca y truena al segundo movimiento.
    """
    if _is_sqlite:
        return {"check_same_thread": False}
    if settings.DATABASE_URL.startswith("postgresql+psycopg"):
        return {"prepare_threshold": None}
    return {}


engine = create_engine(
    settings.DATABASE_URL,
    connect_args=_opciones_de_conexion(),
    # Una conexión que el pooler cerró por su cuenta se descarta antes de
    # usarla, en vez de fallarle al huésped que está en el mostrador.
    pool_pre_ping=True,
    # El plan gratuito del proveedor limita las conexiones simultáneas: se
    # abren pocas y se reciclan cada media hora.
    pool_size=5 if not _is_sqlite else 5,
    max_overflow=5 if not _is_sqlite else 10,
    pool_recycle=1800,
    echo=False,
)


if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        """SQLite no aplica llaves foráneas por default. Aquí sí."""
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    """Dependencia de FastAPI. Una sesión por request, siempre cerrada."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
