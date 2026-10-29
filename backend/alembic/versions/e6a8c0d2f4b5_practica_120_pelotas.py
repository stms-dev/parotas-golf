"""zona de práctica: 120 pelotas

La descripción del servicio decía 180 pelotas; el club entrega 120. Solo se
corrige si todavía trae el texto de fábrica: si alguien la editó desde el
sistema, no se le pisa.

Revision ID: e6a8c0d2f4b5
Revises: d5f7b9c1e3a4
"""
from alembic import op

revision = "e6a8c0d2f4b5"
down_revision = "d5f7b9c1e3a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE additional_services "
        "SET description = '120 pelotas de práctica. No incluye bastones ni tees.' "
        "WHERE code = 'PRACTICA' AND description LIKE '180 pelotas%'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE additional_services "
        "SET description = '180 pelotas de práctica. No incluye bastones ni tees.' "
        "WHERE code = 'PRACTICA' AND description LIKE '120 pelotas%'"
    )
