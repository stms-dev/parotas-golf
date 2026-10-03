"""el caddie se asigna por carrito y se paga directo

Dos cambios que van juntos.

El caddie ya no se pide: se asigna, uno por carrito, hasta donde alcancen los
que hay. Antes venía como una línea de servicio elegida a mano y el sistema
rechazaba la reserva cuando no quedaban; ahora la partida sale igual, sin
caddie, porque perder una venta por eso no tiene sentido.

Y el caddie ya no lo cobra el club: el huésped le paga directo. Así que deja de
sumar al total de la reserva, a la base de comisión del hotel y a la caja. Su
precio se sigue mostrando —el hotel tiene que poder decírselo al huésped— pero
como información, no como cargo.

Las reservas viejas conservan su línea de caddie cobrada: las operaciones
históricas no se recalculan.

Revision ID: b4c6d8e0f2a5
Revises: a3b5c7d9e1f4
"""
import sqlalchemy as sa
from alembic import op

revision = "b4c6d8e0f2a5"
down_revision = "a3b5c7d9e1f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reservations",
        sa.Column(
            "caddies_used",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("reservations", "caddies_used")
