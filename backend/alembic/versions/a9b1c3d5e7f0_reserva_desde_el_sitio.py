"""reserva hecha desde el sitio, sin cuenta

El sitio del club deja reservar a quien no tiene cuenta. Eso trae dos cosas
que las reservas del mostrador no necesitan:

- Mientras el huésped está tecleando su tarjeta, la salida se le **aparta**.
  Sin eso, dos personas pagan el mismo tee time y una se queda sin jugar con
  el cargo ya hecho. El apartado vence: pasados unos minutos sin pago, la
  reserva se cancela sola y el horario vuelve a la venta.
- Una cuenta a cuyo nombre queden. Se da de alta un usuario del sistema,
  "Reservas en línea", que no puede iniciar sesión: existe para que la
  reserva tenga autor en la bitácora y para que caiga en público general con
  cero comisión, igual que las que levanta recepción.

Revision ID: a9b1c3d5e7f0
Revises: f8a0b2c4d6e9
"""
import sqlalchemy as sa
from alembic import op

revision = "a9b1c3d5e7f0"
down_revision = "f8a0b2c4d6e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reservations",
        sa.Column("hold_expires_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_reservations_hold_expires_at", "reservations", ["hold_expires_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_reservations_hold_expires_at", table_name="reservations")
    op.drop_column("reservations", "hold_expires_at")
