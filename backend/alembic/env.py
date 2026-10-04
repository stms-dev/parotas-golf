"""Entorno de Alembic.

Lee la URL de la base desde la configuración de la aplicación, no del .ini, para
que haya una sola fuente de verdad: cambiar DATABASE_URL cambia todo.
"""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.models import Base  # importa todos los modelos y llena Base.metadata

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

# La bitácora del .ini solo se arma cuando Alembic se corre a mano.
#
# `fileConfig` no es inocente: reemplaza los manejadores de la raíz, le baja el
# nivel a WARNING y —lo peor— trae `disable_existing_loggers=True`, que apaga
# TODOS los loggers que ya existían. En el servidor la aplicación migra sola al
# arrancar, dentro de su propio proceso, así que esa llamada dejaba muda a la
# aplicación entera desde el primer segundo de vida: ni los avisos del arranque,
# ni las trazas de los errores, nada. Un cobro con Stripe se cayó y no hubo
# manera de saber por qué, porque el log terminaba justo aquí.
#
# Cuando migra la aplicación, `arranque.migrar()` marca esta bandera y la
# bitácora que ya está puesta se queda como está.
if config.config_file_name is not None and not config.attributes.get("app_configuro_log"):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            # Necesario en SQLite para poder alterar columnas.
            render_as_batch=connection.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
