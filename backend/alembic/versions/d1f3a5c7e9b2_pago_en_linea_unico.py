"""un pago en línea no se registra dos veces

Candado en la base: (reserva, referencia) único para los pagos en línea. Antes
solo había una pregunta previa ("¿ya lo anoté?") que dos avisos simultáneos de
Stripe podían ganar los dos.

Revision ID: d1f3a5c7e9b2
Revises: c9e1a3b5d7f0
"""
from alembic import op
import sqlalchemy as sa

revision = "d1f3a5c7e9b2"
down_revision = "c9e1a3b5d7f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Si ya hubiera duplicados, el índice no se podría crear y la migración
    # fallaría a media subida. Se avisa con un mensaje claro en lugar de eso.
    duplicados = op.get_bind().execute(sa.text(
        "SELECT reservation_id, reference, COUNT(*) FROM payments "
        "WHERE method = 'PAGO_EN_LINEA' AND reference IS NOT NULL "
        "GROUP BY reservation_id, reference HAVING COUNT(*) > 1"
    )).fetchall()
    if duplicados:
        raise RuntimeError(
            f"Hay pagos en línea duplicados que revisar antes de continuar: {duplicados}"
        )
    op.create_index(
        "uq_pago_en_linea_unico", "payments", ["reservation_id", "reference"], unique=True,
        sqlite_where=sa.text("method = 'PAGO_EN_LINEA'"),
        postgresql_where=sa.text("method = 'PAGO_EN_LINEA'"),
    )


def downgrade() -> None:
    op.drop_index("uq_pago_en_linea_unico", table_name="payments")
