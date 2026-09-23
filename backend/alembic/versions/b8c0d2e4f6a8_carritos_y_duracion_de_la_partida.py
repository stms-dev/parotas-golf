"""carritos y duración de la partida

Revision ID: b8c0d2e4f6a8
Revises: a7b9c1d3e5f7
"""
import sqlalchemy as sa
from alembic import op

revision = "b8c0d2e4f6a8"
down_revision = "a7b9c1d3e5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("reservations") as batch:
        batch.add_column(sa.Column("carts_used", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("round_started_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("reservations") as batch:
        batch.drop_column("round_started_at")
        batch.drop_column("carts_used")
