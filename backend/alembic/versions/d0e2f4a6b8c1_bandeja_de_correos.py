"""bandeja de salida de correos

Revision ID: d0e2f4a6b8c1
Revises: c9d1e3f5a7b9
"""
import sqlalchemy as sa
from alembic import op

revision = "d0e2f4a6b8c1"
down_revision = "c9d1e3f5a7b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "outbox_emails",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("to_email", sa.String(length=180), nullable=False),
        sa.Column("subject", sa.String(length=240), nullable=False),
        sa.Column(
            "reservation_id", sa.Integer(),
            sa.ForeignKey("reservations.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="PENDIENTE"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_outbox_emails_kind", "outbox_emails", ["kind"])
    op.create_index("ix_outbox_emails_status", "outbox_emails", ["status"])
    op.create_index("ix_outbox_emails_created_at", "outbox_emails", ["created_at"])
    op.create_index("ix_outbox_emails_reservation_id", "outbox_emails", ["reservation_id"])


def downgrade() -> None:
    op.drop_table("outbox_emails")
