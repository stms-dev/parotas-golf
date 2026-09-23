"""llegada del acompañante

Revision ID: f6a8b0c2d4e5
Revises: e5f7a9b1c3d4
"""
import sqlalchemy as sa
from alembic import op

revision = "f6a8b0c2d4e5"
down_revision = "e5f7a9b1c3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("reservation_companions") as batch:
        batch.add_column(sa.Column("arrived", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("reservation_companions") as batch:
        batch.drop_column("arrived")
