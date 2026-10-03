"""horario de 7:00 a 15:00 y los ajustes nuevos del campo

El club amplió su jornada: antes se vendía de 09:00 a 12:30 y ahora de 07:00 a
15:00, lo que pasa de 8 salidas a 17. La configuración vive en la base, así que
el cambio va aquí y no en el código.

Los días ya materializados ganan sus salidas nuevas solos: la generación
completa lo que falte en vez de exigir que el día esté vacío.

Se agregan también dos parámetros que el campo necesita nombrar: la hora de
cierre y desde cuándo una salida es twilight.

Revision ID: a3b5c7d9e1f4
Revises: f2a4b6c8d0e3
"""
import sqlalchemy as sa
from alembic import context, op

revision = "a3b5c7d9e1f4"
down_revision = "f2a4b6c8d0e3"
branch_labels = None
depends_on = None


AJUSTES = (
    ("cierre_de_campo", "18:00", "Hora en que el campo cierra y ya no hay juego"),
    ("twilight_desde", "14:00", "Desde esta hora la salida toma tarifa twilight"),
)


def upgrade() -> None:
    if context.is_offline_mode():
        return

    conexion = op.get_bind()

    # El horario maestro. Se actualiza en vez de insertarse: si alguien ya lo
    # había ajustado a mano desde Control del sistema, esto lo deja en el nuevo
    # rango del club, que es el dato bueno.
    conexion.execute(
        sa.text(
            "UPDATE course_schedule_config "
            "SET start_time = :inicio, end_time = :fin "
            "WHERE is_active = true"
        ),
        {"inicio": "07:00:00", "fin": "15:00:00"},
    )

    for clave, valor, descripcion in AJUSTES:
        existe = conexion.execute(
            sa.text("SELECT 1 FROM system_settings WHERE key = :clave"), {"clave": clave}
        ).first()
        if not existe:
            conexion.execute(
                sa.text(
                    "INSERT INTO system_settings (key, value, description) "
                    "VALUES (:clave, :valor, :descripcion)"
                ),
                {"clave": clave, "valor": valor, "descripcion": descripcion},
            )


def downgrade() -> None:
    if context.is_offline_mode():
        return

    conexion = op.get_bind()
    conexion.execute(
        sa.text(
            "UPDATE course_schedule_config "
            "SET start_time = :inicio, end_time = :fin "
            "WHERE is_active = true"
        ),
        {"inicio": "09:00:00", "fin": "12:30:00"},
    )
    for clave, _valor, _descripcion in AJUSTES:
        conexion.execute(
            sa.text("DELETE FROM system_settings WHERE key = :clave"), {"clave": clave}
        )
