"""replay como segundo ticket del mismo folio

Revision ID: e5f7a9b1c3d4
Revises: d4e6f8a0b2c3
"""
import sqlalchemy as sa
from alembic import op

revision = "e5f7a9b1c3d4"
down_revision = "d4e6f8a0b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "replay_tickets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reservation_id", sa.Integer(), sa.ForeignKey("reservations.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("players_count", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("total", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_replay_tickets_reservation_id", "replay_tickets", ["reservation_id"])
    with op.batch_alter_table("payments") as batch:
        batch.add_column(sa.Column("replay_id", sa.Integer(), nullable=True))
        batch.create_index("ix_payments_replay_id", ["replay_id"])
        batch.create_foreign_key(
            "fk_payments_replay_id", "replay_tickets", ["replay_id"], ["id"], ondelete="RESTRICT"
        )


def downgrade() -> None:
    with op.batch_alter_table("payments") as batch:
        batch.drop_constraint("fk_payments_replay_id", type_="foreignkey")
        batch.drop_index("ix_payments_replay_id")
        batch.drop_column("replay_id")
    op.drop_index("ix_replay_tickets_reservation_id", table_name="replay_tickets")
    op.drop_table("replay_tickets")
