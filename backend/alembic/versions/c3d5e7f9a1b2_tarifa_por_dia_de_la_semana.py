"""tarifa por día de la semana

El campo cobra distinto de lunes a jueves que de viernes a domingo. Las
tarifas existentes quedan como TODOS, así que siguen valiendo cualquier día
y nada de lo ya vendido cambia de precio.

Revision ID: c3d5e7f9a1b2
Revises: 9141089ac8f0
"""
import sqlalchemy as sa
from alembic import op

revision = "c3d5e7f9a1b2"
down_revision = "9141089ac8f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rate_plans") as batch:
        batch.add_column(
            sa.Column("day_type", sa.String(length=16), nullable=False, server_default="TODOS")
        )
        batch.create_index("ix_rate_plans_day_type", ["day_type"])


def downgrade() -> None:
    with op.batch_alter_table("rate_plans") as batch:
        batch.drop_index("ix_rate_plans_day_type")
        batch.drop_column("day_type")
