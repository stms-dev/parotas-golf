"""control de partidas abiertas

Una partida abierta junta huéspedes de hoteles distintos en la misma salida. Eso
necesita a alguien decidiendo, y hasta ahora el sistema solo la dejaba llenarse
sola hasta los cuatro lugares.

Dos cosas nuevas:

- Una salida abierta se puede **cerrar a mano** antes de llenarse, cuando el
  operador ve que ya va a salir y no quiere que entre nadie más. No se toca el
  estado calculado: se marca aparte, para que el recálculo no borre la decisión.
- El día puede **no aceptar partidas abiertas**. En días pesados el campo
  prefiere no andar armando grupos revueltos, y eso es una regla del día, no del
  sistema entero.

Revision ID: f8a0b2c4d6e9
Revises: e7f9a1b3c5d8
"""
import sqlalchemy as sa
from alembic import op

revision = "f8a0b2c4d6e9"
down_revision = "e7f9a1b3c5d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tee_slots",
        sa.Column(
            "open_closed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column("tee_slots", sa.Column("open_closed_at", sa.DateTime(), nullable=True))

    op.create_table(
        "course_day_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False, unique=True, index=True),
        # Si el día acepta partidas abiertas. Sin fila, el día las acepta: es lo
        # normal, y así no hay que dar de alta 365 filas al año.
        sa.Column(
            "open_partidas_allowed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "updated_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


def downgrade() -> None:
    op.drop_table("course_day_rules")
    op.drop_column("tee_slots", "open_closed_at")
    op.drop_column("tee_slots", "open_closed")
