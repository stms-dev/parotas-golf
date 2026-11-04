"""Cuponeras: paquetes de Green Fees prepagados y su historial de canjes

Revision ID: f6b8d0e2a4c6
Revises: e5a7c9b1d3f5
"""
import sqlalchemy as sa
from alembic import op

revision = "f6b8d0e2a4c6"
down_revision = "e5a7c9b1d3f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cuponeras",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("folio", sa.String(16), nullable=False),
        sa.Column("titular_nombre", sa.String(180), nullable=False),
        sa.Column("empresa", sa.String(180), nullable=True),
        sa.Column("telefono", sa.String(40), nullable=True),
        sa.Column("correo", sa.String(180), nullable=True),
        sa.Column("pases_total", sa.Integer(), nullable=False),
        sa.Column("pases_usados", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hoyos_18", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("hoyos_9", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("precio_total", sa.Numeric(12, 2), nullable=False),
        sa.Column("precio_lista", sa.Numeric(12, 2), nullable=True),
        sa.Column("vence_el", sa.Date(), nullable=False),
        sa.Column("fechas_bloqueadas", sa.Text(), nullable=True),
        sa.Column("pago_estado", sa.String(12), nullable=False, server_default="PENDIENTE"),
        sa.Column("pago_referencia", sa.String(120), nullable=True),
        sa.Column("pagada_en", sa.DateTime(), nullable=True),
        sa.Column("pago_confirmo_nombre", sa.String(120), nullable=True),
        sa.Column("pago_confirmo_usuario_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("cancelada", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("cancelada_en", sa.DateTime(), nullable=True),
        sa.Column("cancelada_por", sa.String(120), nullable=True),
        sa.Column("cancelada_nota", sa.Text(), nullable=True),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("creada_por_nombre", sa.String(120), nullable=True),
        sa.Column("creada_por_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_cuponeras_folio", "cuponeras", ["folio"], unique=True)
    op.create_index("ix_cuponeras_titular_nombre", "cuponeras", ["titular_nombre"])
    op.create_index("ix_cuponeras_vence_el", "cuponeras", ["vence_el"])
    op.create_table(
        "cuponera_usos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cuponera_id", sa.Integer(), sa.ForeignKey("cuponeras.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("jugadores", sa.Integer(), nullable=False),
        sa.Column("hoyos", sa.Integer(), nullable=False),
        sa.Column("reserva_folio", sa.String(32), nullable=True),
        sa.Column("nota", sa.String(300), nullable=True),
        sa.Column("validado_por_nombre", sa.String(120), nullable=False),
        sa.Column("validado_por_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("anulado", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("anulado_en", sa.DateTime(), nullable=True),
        sa.Column("anulado_por", sa.String(120), nullable=True),
        sa.Column("anulado_nota", sa.String(300), nullable=True),
    )
    op.create_index("ix_cuponera_usos_cuponera_id", "cuponera_usos", ["cuponera_id"])
    op.create_index("ix_cuponera_usos_fecha", "cuponera_usos", ["fecha"])


def downgrade() -> None:
    op.drop_table("cuponera_usos")
    op.drop_table("cuponeras")
