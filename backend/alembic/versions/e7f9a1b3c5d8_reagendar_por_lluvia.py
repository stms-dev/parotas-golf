"""reponer la ronda cuando el campo se suspende

Cuando llueve y la partida no se puede terminar, el club le repone la ronda como
cortesía. Eso no es una cancelación —el huésped llegó, jugó y pagó— ni una
partida completada, así que la reserva original queda en un estado propio con el
hoyo en el que se quedaron.

La ronda de reposición es **otra reserva**, con su folio y su salida, marcada
como cortesía: total en cero y sin comisión, porque el hotel ya cobró la suya en
la reserva original. Puede ser cualquier día, y en partida abierta el huésped no
tiene que volver con la misma gente — al ser una reserva aparte, eso sale solo.

Revision ID: e7f9a1b3c5d8
Revises: d6e8f0a2b4c7
"""
import sqlalchemy as sa
from alembic import op

revision = "e7f9a1b3c5d8"
down_revision = "d6e8f0a2b4c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reservations",
        sa.Column("interrupted_at_hole", sa.Integer(), nullable=True),
    )
    op.add_column(
        "reservations",
        sa.Column("interrupted_reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "reservations",
        sa.Column("interrupted_at", sa.DateTime(), nullable=True),
    )
    # La reposición apunta a la partida que no se pudo terminar. RESTRICT a
    # propósito: borrar la original dejaría una cortesía sin explicación.
    #
    # Va en batch porque SQLite no sabe agregar una llave foránea con ALTER y
    # necesita recrear la tabla. En PostgreSQL el batch emite el ALTER normal,
    # así que la misma migración sirve en los dos lados.
    with op.batch_alter_table("reservations") as lote:
        lote.add_column(sa.Column("rescheduled_from_id", sa.Integer(), nullable=True))
        lote.create_foreign_key(
            "fk_reservations_rescheduled_from",
            "reservations",
            ["rescheduled_from_id"],
            ["id"],
            ondelete="RESTRICT",
        )
    op.create_index(
        "ix_reservations_rescheduled_from_id", "reservations", ["rescheduled_from_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_reservations_rescheduled_from_id", table_name="reservations")
    with op.batch_alter_table("reservations") as lote:
        lote.drop_constraint("fk_reservations_rescheduled_from", type_="foreignkey")
        lote.drop_column("rescheduled_from_id")
    op.drop_column("reservations", "interrupted_at")
    op.drop_column("reservations", "interrupted_reason")
    op.drop_column("reservations", "interrupted_at_hole")
