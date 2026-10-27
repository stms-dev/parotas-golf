"""la cuenta interna del sitio pasa a un rol sin permisos

Las reservas que nacen en el sitio público quedan firmadas por una cuenta
interna (sitio@parotasgolf.com) que estaba dada de alta como Recepción. Está
desactivada y nadie conoce su contraseña, pero con ese rol, si algún día alguien
la reactivara por error, tendría los permisos del mostrador.

Esta migración la pasa al rol SISTEMA, que no tiene permiso para nada, y la
deja desactivada. Si la cuenta no existe todavía (base nueva), no hace nada: el
sembrado y el sitio ya la crean con el rol correcto.

Revision ID: c4e6a8b0d2f3
Revises: b3d5f7a9c1e2
"""
import sqlalchemy as sa
from alembic import op

revision = "c4e6a8b0d2f3"
down_revision = "b3d5f7a9c1e2"
branch_labels = None
depends_on = None

CUENTA = "sitio@parotasgolf.com"


def upgrade():
    op.get_bind().execute(
        sa.text("UPDATE users SET role = 'SISTEMA', is_active = :apagada WHERE email = :correo"),
        {"apagada": False, "correo": CUENTA},
    )


def downgrade():
    op.get_bind().execute(
        sa.text("UPDATE users SET role = 'RECEPCION' WHERE email = :correo"),
        {"correo": CUENTA},
    )
