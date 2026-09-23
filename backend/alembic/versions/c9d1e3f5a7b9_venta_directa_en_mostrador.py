"""venta directa en el mostrador (huésped sin hotel)

Revision ID: c9d1e3f5a7b9
Revises: b8c0d2e4f6a8
"""
import sqlalchemy as sa
from alembic import context, op

revision = "c9d1e3f5a7b9"
down_revision = "b8c0d2e4f6a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("hotels") as batch:
        batch.add_column(sa.Column("is_direct", sa.Boolean(), nullable=False, server_default=sa.false()))

    # La venta directa necesita su propio registro para que una partida sin
    # hotel tenga dónde colgarse. Si la base ya viene de antes, se crea aquí.
    hotels = sa.table(
        "hotels",
        sa.column("code", sa.String),
        sa.column("name", sa.String),
        sa.column("commission_rate", sa.Numeric),
        sa.column("is_direct", sa.Boolean),
        sa.column("is_active", sa.Boolean),
    )
    # En modo offline (alembic upgrade --sql) no hay conexión que consultar:
    # ahí siempre se emite el alta, que es lo correcto en una base nueva.
    existe = None
    if not context.is_offline_mode():
        existe = op.get_bind().execute(
            sa.text("SELECT 1 FROM hotels WHERE code = 'DIRECTO'")
        ).first()
    if not existe:
        op.bulk_insert(
            hotels,
            [{
                "code": "DIRECTO",
                "name": "Público general (sin hotel)",
                "commission_rate": 0,
                "is_direct": True,
                "is_active": True,
            }],
        )


def downgrade() -> None:
    op.execute("DELETE FROM hotels WHERE code = 'DIRECTO'")
    with op.batch_alter_table("hotels") as batch:
        batch.drop_column("is_direct")
