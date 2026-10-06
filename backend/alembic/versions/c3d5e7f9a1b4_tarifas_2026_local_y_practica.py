"""tarifas 2026: precio de fin de semana en servicios, local y zona de práctica

La zona de práctica cuesta $250 de lunes a jueves y $400 de viernes a domingo.
Los servicios tenían un solo precio, así que se les agrega uno opcional de fin
de semana: si está vacío, el servicio vale lo mismo cualquier día.

También se dan de alta, si no existen, la zona de práctica y la tarifa de
local (18 hoyos, lunes a jueves, $2,500). La categoría LOCAL no necesita
cambio de esquema: la columna ya es texto.

Revision ID: c3d5e7f9a1b4
Revises: b2c4d6e8f0a3
"""
import sqlalchemy as sa
from alembic import op

revision = "c3d5e7f9a1b4"
down_revision = "b2c4d6e8f0a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "additional_services",
        sa.Column("weekend_price", sa.Numeric(12, 2), nullable=True),
    )

    conn = op.get_bind()
    existe = conn.execute(
        sa.text("select 1 from additional_services where code = 'PRACTICA'")
    ).first()
    if not existe:
        conn.execute(sa.text(
            "insert into additional_services "
            "(code, name, description, price, weekend_price, currency, unit, is_active) "
            "values ('PRACTICA', 'Zona de práctica', "
            "'180 pelotas de práctica. No incluye bastones ni tees.', "
            "250.00, 400.00, 'MXN', 'POR_PERSONA', true)"
        ))

    hay_local = conn.execute(
        sa.text("select 1 from rate_plans where category = 'LOCAL'")
    ).first()
    if not hay_local:
        for modalidad, etiqueta in (
            ("GRUPO", "Grupo"), ("PARTIDA_ABIERTA", "Partida abierta"), ("INDIVIDUAL", "Individual"),
        ):
            conn.execute(
                sa.text(
                    "insert into rate_plans "
                    "(name, modality, holes, category, day_type, time_band, price, currency, valid_from, is_active) "
                    "values (:n, :m, 18, 'LOCAL', 'ENTRE_SEMANA', 'TODAS', 2500.00, 'MXN', :d, true)"
                ),
                {"n": f"{etiqueta} · 18 hoyos (local) · lun a jue", "m": modalidad, "d": "2026-10-06"},
            )


def downgrade() -> None:
    op.execute("delete from rate_plans where category = 'LOCAL'")
    op.execute("delete from additional_services where code = 'PRACTICA'")
    op.drop_column("additional_services", "weekend_price")
