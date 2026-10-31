"""hotel AMHMH: el nombre es solo «Park Royal»

Solo cambia el nombre de fábrica; si alguien ya lo editó desde el sistema, no
se le pisa. El código AMHMH no cambia.

Revision ID: d4f6b8c0e2a4
Revises: c3e5a7b9d1f3
"""
from alembic import op

revision = "d4f6b8c0e2a4"
down_revision = "c3e5a7b9d1f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE hotels SET name = 'Park Royal' "
        "WHERE code = 'AMHMH' AND name = 'AMHMH (Binniguenda, Marina, Park Royal)'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE hotels SET name = 'AMHMH (Binniguenda, Marina, Park Royal)' "
        "WHERE code = 'AMHMH' AND name = 'Park Royal'"
    )
