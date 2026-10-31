"""zona de práctica: «120 pelotas o 90 minutos» (sin «por persona»)

Solo cambia el texto de fábrica; si alguien lo editó desde el sistema, no se
le pisa.

Revision ID: c3e5a7b9d1f3
Revises: b2d4f6a8c0e2
"""
from alembic import op

revision = "c3e5a7b9d1f3"
down_revision = "b2d4f6a8c0e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE additional_services "
        "SET description = '120 pelotas o 90 minutos. No incluye bastones ni tees.' "
        "WHERE code = 'PRACTICA' AND description = '120 pelotas o 90 minutos por persona. No incluye bastones ni tees.'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE additional_services "
        "SET description = '120 pelotas o 90 minutos por persona. No incluye bastones ni tees.' "
        "WHERE code = 'PRACTICA' AND description = '120 pelotas o 90 minutos. No incluye bastones ni tees.'"
    )
