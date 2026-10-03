"""la sesión de pago de Stripe

Cuando el huésped se va a pagar, Stripe abre una sesión con su propio
identificador. Guardarlo permite rastrear un cobro hasta su reserva cuando algo
sale raro y hay que mirarlo en el panel de Stripe.

No es lo que confirma la reserva —eso lo hace el aviso firmado del webhook—,
pero sin esta columna un pago huérfano es una búsqueda a mano entre cientos.

Revision ID: b2c4d6e8f0a3
Revises: a9b1c3d5e7f0
"""
import sqlalchemy as sa
from alembic import op

revision = "b2c4d6e8f0a3"
down_revision = "a9b1c3d5e7f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reservations",
        sa.Column("stripe_session_id", sa.String(length=120), nullable=True),
    )
    op.create_index(
        "ix_reservations_stripe_session_id", "reservations", ["stripe_session_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_reservations_stripe_session_id", table_name="reservations")
    op.drop_column("reservations", "stripe_session_id")
