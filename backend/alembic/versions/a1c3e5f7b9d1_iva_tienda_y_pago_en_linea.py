"""IVA en la tienda (bruto/neto) y método de pago "en línea"

- tienda_ventas guarda la tasa de IVA y el monto de IVA contenidos en el total
  de cada venta. El precio de lista es el bruto (con IVA); el neto sale de él.
  Las ventas anteriores quedan con IVA en cero: no se les inventa un desglose.
- Los cobros que entraron por internet se llamaban TARJETA; ahora tienen su
  propio método, PAGO_EN_LINEA.

Revision ID: a1c3e5f7b9d1
Revises: e6a8c0d2f4b5
"""
import sqlalchemy as sa
from alembic import op

revision = "a1c3e5f7b9d1"
down_revision = "e6a8c0d2f4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("tienda_ventas") as lote:
        lote.add_column(sa.Column("iva_pct", sa.Numeric(5, 2), nullable=False, server_default="0"))
        lote.add_column(sa.Column("iva_monto", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.execute(
        "UPDATE payments SET method = 'PAGO_EN_LINEA' "
        "WHERE method = 'TARJETA' AND notes LIKE 'Pago en l%nea%'"
    )


def downgrade() -> None:
    op.execute("UPDATE payments SET method = 'TARJETA' WHERE method = 'PAGO_EN_LINEA'")
    with op.batch_alter_table("tienda_ventas") as lote:
        lote.drop_column("iva_monto")
        lote.drop_column("iva_pct")
