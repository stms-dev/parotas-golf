"""tarifa por franja horaria: el twilight

Las últimas salidas del día no alcanzan a terminar 18 hoyos, así que el club las
vende más baratas. Eso es una tarifa distinta, no un descuento: se resuelve al
cotizar y queda congelada en la reserva como cualquier otra.

La columna nace en TODAS para todas las tarifas que ya existen, así que nada
cambia de precio con esta migración. Cuando el club dé de alta su tarifa de
twilight desde Control del sistema, las salidas de esa franja la empiezan a
tomar; mientras no exista, caen en la normal y el horario se puede vender igual.

Revision ID: d6e8f0a2b4c7
Revises: c5d7e9f1a3b6
"""
import sqlalchemy as sa
from alembic import op

revision = "d6e8f0a2b4c7"
down_revision = "c5d7e9f1a3b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rate_plans",
        sa.Column(
            "time_band",
            sa.String(length=16),
            nullable=False,
            server_default="TODAS",
        ),
    )
    op.create_index("ix_rate_plans_time_band", "rate_plans", ["time_band"])


def downgrade() -> None:
    op.drop_index("ix_rate_plans_time_band", table_name="rate_plans")
    op.drop_column("rate_plans", "time_band")
