"""token público de la reserva

El sitio del club consulta, suelta y paga apartados sin cuenta, y hasta ahora lo
único que identificaba la reserva era el folio (LP-1000 a LP-9999): unos nueve
mil valores que un script recorre en minutos. Con solo el folio cualquiera podía
ver a nombre de quién estaba una reserva ajena o cancelar un apartado.

Esta columna guarda un token al azar que se entrega una sola vez, a quien aparta,
y que desde ahora piden las rutas públicas junto con el folio. Es nullable: las
reservas anteriores (del mostrador o ya confirmadas) no lo tienen y por lo tanto
no se pueden consultar desde el sitio, que es lo que se quiere.

Revision ID: b3d5f7a9c1e2
Revises: a7c9e1f3b5d2
"""
import sqlalchemy as sa
from alembic import op

revision = "b3d5f7a9c1e2"
down_revision = "a7c9e1f3b5d2"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("reservations") as t:
        t.add_column(sa.Column("public_token", sa.String(64), nullable=True))
        t.create_index("ix_reservations_public_token", ["public_token"], unique=True)


def downgrade():
    with op.batch_alter_table("reservations") as t:
        t.drop_index("ix_reservations_public_token")
        t.drop_column("public_token")
