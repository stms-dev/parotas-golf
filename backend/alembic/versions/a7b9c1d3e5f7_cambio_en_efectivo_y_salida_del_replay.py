"""cambio en efectivo y salida del replay

Revision ID: a7b9c1d3e5f7
Revises: f6a8b0c2d4e5
"""
import sqlalchemy as sa
from alembic import op

revision = "a7b9c1d3e5f7"
down_revision = "f6a8b0c2d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("payments") as batch:
        batch.add_column(sa.Column("change_mxn", sa.Numeric(12, 2), nullable=False, server_default="0"))
    with op.batch_alter_table("replay_tickets") as batch:
        batch.add_column(sa.Column("tee_slot_id", sa.Integer(), nullable=True))
        batch.create_index("ix_replay_tickets_tee_slot_id", ["tee_slot_id"])
        batch.create_foreign_key(
            "fk_replay_tickets_tee_slot_id", "tee_slots", ["tee_slot_id"], ["id"], ondelete="RESTRICT"
        )


def downgrade() -> None:
    with op.batch_alter_table("replay_tickets") as batch:
        batch.drop_constraint("fk_replay_tickets_tee_slot_id", type_="foreignkey")
        batch.drop_index("ix_replay_tickets_tee_slot_id")
        batch.drop_column("tee_slot_id")
    with op.batch_alter_table("payments") as batch:
        batch.drop_column("change_mxn")
