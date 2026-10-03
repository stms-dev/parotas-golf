"""el GHIN del jugador, junto a su hándicap

El hándicap es el número; el GHIN es el identificador con el que ese número se
verifica en el padrón. Son dos datos distintos y el campo pide los dos, así que
se guardan por separado en vez de meter los dos en un mismo campo de texto.

Revision ID: c5d7e9f1a3b6
Revises: b4c6d8e0f2a5
"""
import sqlalchemy as sa
from alembic import op

revision = "c5d7e9f1a3b6"
down_revision = "b4c6d8e0f2a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reservation_players",
        sa.Column("ghin", sa.String(length=24), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("reservation_players", "ghin")
