"""Tienda: existencia en bodega, máximo, ubicación de movimientos y datos de muestra.

- `tienda_productos.existencia` pasa a ser lo que está en tienda (piso de
  venta); se agrega `existencia_bodega` y `maximo`.
- `tienda_movimientos.ubicacion` dice en qué lugar pasó el movimiento.
- Se cargan precios y piezas de muestra (ver app/modules/tienda/muestra.py):
  precios solo donde falta; piezas solo si todavía no hay ninguna.

Revision ID: a7c9e1f3b5d2
Revises: e2a4c6b8d0f1
"""
import sqlalchemy as sa
from alembic import op

revision = "a7c9e1f3b5d2"
down_revision = "e2a4c6b8d0f1"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("tienda_productos") as t:
        t.add_column(sa.Column("existencia_bodega", sa.Integer(), nullable=False, server_default="0"))
        t.add_column(sa.Column("maximo", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("tienda_movimientos") as t:
        t.add_column(sa.Column("ubicacion", sa.String(8), nullable=False, server_default="TIENDA"))

    from app.modules.tienda.muestra import cargar_muestra

    cargar_muestra(op.get_bind())


def downgrade():
    with op.batch_alter_table("tienda_movimientos") as t:
        t.drop_column("ubicacion")
    with op.batch_alter_table("tienda_productos") as t:
        t.drop_column("maximo")
        t.drop_column("existencia_bodega")
