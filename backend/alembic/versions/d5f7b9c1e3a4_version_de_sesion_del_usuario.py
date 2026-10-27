"""versión de sesión del usuario

Hasta ahora un token valía hasta vencer: cambiar la contraseña, cerrar las
sesiones o quitar un permiso no tumbaba las sesiones ya abiertas. Esta columna
es un contador. El token lo lleva dentro; cada vez que se cambia la contraseña,
el rol, o se piden cerrar las sesiones, el contador sube y todos los tokens
anteriores dejan de valer.

Arranca en 0 y los tokens emitidos antes de esta versión (que no traen el
contador) se leen como 0, así que nadie pierde su sesión al actualizar.

Revision ID: d5f7b9c1e3a4
Revises: c4e6a8b0d2f3
"""
import sqlalchemy as sa
from alembic import op

revision = "d5f7b9c1e3a4"
down_revision = "c4e6a8b0d2f3"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users") as t:
        t.add_column(sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    with op.batch_alter_table("users") as t:
        t.drop_column("token_version")
