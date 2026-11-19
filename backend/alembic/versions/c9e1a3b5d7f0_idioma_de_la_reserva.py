"""idioma de la reserva

El cliente que reserva en el sitio en inglés recibe su pase en inglés.

Revision ID: c9e1a3b5d7f0
Revises: b8d0f2a4c6e8
"""
from alembic import op
import sqlalchemy as sa

revision = "c9e1a3b5d7f0"
down_revision = "b8d0f2a4c6e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("reservations") as lote:
        lote.add_column(sa.Column("idioma", sa.String(length=2), nullable=False, server_default="es"))


def downgrade() -> None:
    with op.batch_alter_table("reservations") as lote:
        lote.drop_column("idioma")
