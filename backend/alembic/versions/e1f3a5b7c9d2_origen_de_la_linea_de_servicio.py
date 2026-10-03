"""de dónde vino cada línea de servicio

El hotel tiene derecho a ver su propia reserva al día: si en el mostrador se
validó una credencial PGA o alguien no llegó, su total baja y eso le toca
saberlo, porque de ahí sale su comisión.

Lo que no le toca es lo que el huésped compró después en el mostrador. Esa
venta es del campo y no pasa por el convenio. Sin esta marca las dos cosas
viven en la misma tabla y no hay forma de separarlas al mostrar.

Revision ID: e1f3a5b7c9d2
Revises: d0e2f4a6b8c1
"""
import sqlalchemy as sa
from alembic import op

revision = "e1f3a5b7c9d2"
down_revision = "d0e2f4a6b8c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Lo que ya existía se queda como línea de la reserva: hasta hoy el
    # mostrador no agregaba servicios que el hotel no hubiera pedido.
    op.add_column(
        "reservation_services",
        sa.Column(
            "added_at_counter",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("reservation_services", "added_at_counter")
