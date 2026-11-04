"""Cuponeras ligadas a la reserva: la cuponera apartada, el canje que cubrió a
cada jugador y el cobro que dejó en la cuenta.

Revision ID: a7c9e1b3d5f7
Revises: f6b8d0e2a4c6
"""
import sqlalchemy as sa
from alembic import op

revision = "a7c9e1b3d5f7"
down_revision = "f6b8d0e2a4c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("reservations") as lote:
        lote.add_column(sa.Column("cuponera_id", sa.Integer(), nullable=True))
        lote.create_index("ix_reservations_cuponera_id", ["cuponera_id"])
        lote.create_foreign_key("fk_reservations_cuponera", "cuponeras", ["cuponera_id"], ["id"])
    with op.batch_alter_table("reservation_players") as lote:
        lote.add_column(sa.Column("cuponera_uso_id", sa.Integer(), nullable=True))
        lote.create_foreign_key("fk_players_cuponera_uso", "cuponera_usos", ["cuponera_uso_id"], ["id"])
    with op.batch_alter_table("cuponera_usos") as lote:
        lote.add_column(sa.Column("payment_id", sa.Integer(), nullable=True))
        lote.create_foreign_key("fk_cuponera_usos_payment", "payments", ["payment_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("cuponera_usos") as lote:
        lote.drop_constraint("fk_cuponera_usos_payment", type_="foreignkey")
        lote.drop_column("payment_id")
    with op.batch_alter_table("reservation_players") as lote:
        lote.drop_constraint("fk_players_cuponera_uso", type_="foreignkey")
        lote.drop_column("cuponera_uso_id")
    with op.batch_alter_table("reservations") as lote:
        lote.drop_constraint("fk_reservations_cuponera", type_="foreignkey")
        lote.drop_index("ix_reservations_cuponera_id")
        lote.drop_column("cuponera_id")
