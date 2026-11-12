"""Correos de cuponera: la bandeja de salida ahora también guarda de qué cuponera
es el correo y lo que decía en ese momento (saldo, jugadores).

Revision ID: b8d0f2a4c6e8
Revises: a7c9e1b3d5f7
"""
import sqlalchemy as sa
from alembic import op

revision = "b8d0f2a4c6e8"
down_revision = "a7c9e1b3d5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("outbox_emails") as lote:
        lote.add_column(sa.Column("cuponera_id", sa.Integer(), nullable=True))
        lote.add_column(sa.Column("datos", sa.Text(), nullable=True))
        lote.create_index("ix_outbox_emails_cuponera_id", ["cuponera_id"])
        lote.create_foreign_key(
            "fk_outbox_cuponera", "cuponeras", ["cuponera_id"], ["id"], ondelete="CASCADE"
        )


def downgrade() -> None:
    with op.batch_alter_table("outbox_emails") as lote:
        lote.drop_constraint("fk_outbox_cuponera", type_="foreignkey")
        lote.drop_index("ix_outbox_emails_cuponera_id")
        lote.drop_column("datos")
        lote.drop_column("cuponera_id")
