"""zona de práctica: 120 pelotas o 90 minutos por persona

Solo cambia el texto de fábrica de la descripción; si alguien la editó desde el
sistema, no se le pisa.

Revision ID: b2d4f6a8c0e2
Revises: a1c3e5f7b9d1
"""
from alembic import op

revision = "b2d4f6a8c0e2"
down_revision = "a1c3e5f7b9d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE additional_services "
        "SET description = '120 pelotas o 90 minutos por persona. No incluye bastones ni tees.' "
        "WHERE code = 'PRACTICA' AND description = '120 pelotas de práctica. No incluye bastones ni tees.'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE additional_services "
        "SET description = '120 pelotas de práctica. No incluye bastones ni tees.' "
        "WHERE code = 'PRACTICA' AND description = '120 pelotas o 90 minutos por persona. No incluye bastones ni tees.'"
    )
