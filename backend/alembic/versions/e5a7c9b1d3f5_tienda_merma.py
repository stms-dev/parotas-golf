"""Tienda: merma con autorización y evidencia

- tienda_productos.merma_total: piezas dadas de baja por merma.
- tienda_mermas: solicitudes de merma (la Administración las autoriza).

Revision ID: e5a7c9b1d3f5
Revises: d4f6b8c0e2a4
"""
import sqlalchemy as sa
from alembic import op

revision = "e5a7c9b1d3f5"
down_revision = "d4f6b8c0e2a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("tienda_productos") as lote:
        lote.add_column(sa.Column("merma_total", sa.Integer(), nullable=False, server_default="0"))
    op.create_table(
        "tienda_mermas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("folio", sa.String(16), nullable=False),
        sa.Column("producto_id", sa.Integer(), sa.ForeignKey("tienda_productos.id"), nullable=False),
        sa.Column("cantidad", sa.Integer(), nullable=False),
        sa.Column("ubicacion", sa.String(8), nullable=True),
        sa.Column("motivo_tipo", sa.String(16), nullable=False),
        sa.Column("justificacion", sa.Text(), nullable=False),
        sa.Column("estado", sa.String(12), nullable=False, server_default="PENDIENTE"),
        sa.Column("solicito_nombre", sa.String(120), nullable=False),
        sa.Column("solicito_usuario_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("resolvio_nombre", sa.String(120), nullable=True),
        sa.Column("resolvio_usuario_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("resuelta_en", sa.DateTime(), nullable=True),
        sa.Column("nota_resolucion", sa.Text(), nullable=True),
        sa.Column("de_tienda", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("de_bodega", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("costo_unitario", sa.Numeric(12, 2), nullable=True),
        sa.Column("evidencia_nombre", sa.String(120), nullable=True),
        sa.Column("evidencia_tipo", sa.String(40), nullable=True),
        sa.Column("evidencia", sa.LargeBinary(), nullable=True),
    )
    op.create_index("ix_tienda_mermas_folio", "tienda_mermas", ["folio"], unique=True)
    op.create_index("ix_tienda_mermas_producto_id", "tienda_mermas", ["producto_id"])
    op.create_index("ix_tienda_mermas_estado", "tienda_mermas", ["estado"])


def downgrade() -> None:
    op.drop_table("tienda_mermas")
    with op.batch_alter_table("tienda_productos") as lote:
        lote.drop_column("merma_total")
