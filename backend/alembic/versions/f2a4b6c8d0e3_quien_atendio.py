"""el nombre de quién levantó la reserva y quién atendió

Las cuentas son por hotel y por puesto, no por persona: la del concierge de
Celeste la usan varios turnos. Así que `created_by_id` dice "Celeste", que no
sirve cuando hay que aclarar una reserva mal capturada o un cobro que no cuadra.

Estos campos guardan el nombre de la persona que estuvo frente a la pantalla.
Se piden en cada reserva y en cada check-in, y quedan escritos junto al
movimiento y en la bitácora.

Las reservas que ya existen se quedan sin nombre: no hay forma de adivinar
quién las levantó, y poner "desconocido" sería inventar un dato.

Revision ID: f2a4b6c8d0e3
Revises: e1f3a5b7c9d2
"""
import sqlalchemy as sa
from alembic import op

revision = "f2a4b6c8d0e3"
down_revision = "e1f3a5b7c9d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reservations",
        sa.Column("booked_by_name", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "reservations",
        sa.Column("attended_by_name", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "replay_tickets",
        sa.Column("attended_by_name", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("replay_tickets", "attended_by_name")
    op.drop_column("reservations", "attended_by_name")
    op.drop_column("reservations", "booked_by_name")
