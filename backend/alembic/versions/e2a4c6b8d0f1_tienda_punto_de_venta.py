"""tienda: punto de venta del Pro-Shop con su propia caja

Crea las tablas de la tienda (prefijo tienda_), copia los productos y
movimientos del inventario anterior y retira las tablas viejas. La tienda
queda aparte del campo: no comparte tablas con reservas ni con la caja de
green fees.

Revision ID: e2a4c6b8d0f1
Revises: c3d5e7f9a1b4
"""
import sqlalchemy as sa
from alembic import op

revision = "e2a4c6b8d0f1"
down_revision = "c3d5e7f9a1b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tienda_productos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("codigo", sa.String(40), nullable=False),
        sa.Column("tiene_codigo_barras", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("descripcion", sa.String(255), nullable=False),
        sa.Column("categoria", sa.String(40), nullable=False),
        sa.Column("marca", sa.String(80), nullable=True),
        sa.Column("talla", sa.String(60), nullable=True),
        sa.Column("costo", sa.Numeric(12, 2), nullable=False),
        sa.Column("precio", sa.Numeric(12, 2), nullable=True),
        sa.Column("existencia", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("minimo", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_tienda_productos_codigo", "tienda_productos", ["codigo"], unique=True)
    op.create_index("ix_tienda_productos_categoria", "tienda_productos", ["categoria"])

    op.create_table(
        "tienda_cortes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("estado", sa.String(12), nullable=False, server_default="ABIERTO"),
        sa.Column("abierto_en", sa.DateTime(), nullable=False),
        sa.Column("abierto_por_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("abierto_por_nombre", sa.String(120), nullable=False),
        sa.Column("fondo_inicial", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("cerrado_en", sa.DateTime(), nullable=True),
        sa.Column("cerrado_por_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("cerrado_por_nombre", sa.String(120), nullable=True),
        sa.Column("ventas_total", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("ventas_cuenta", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("efectivo_esperado", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tarjeta_total", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("transferencia_total", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("efectivo_contado", sa.Numeric(12, 2), nullable=True),
        sa.Column("diferencia", sa.Numeric(12, 2), nullable=True),
        sa.Column("notas", sa.Text(), nullable=True),
    )
    op.create_index("ix_tienda_cortes_fecha", "tienda_cortes", ["fecha"])
    op.create_index("ix_tienda_cortes_estado", "tienda_cortes", ["estado"])

    op.create_table(
        "tienda_ventas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("folio", sa.String(20), nullable=False),
        sa.Column("corte_id", sa.Integer(), sa.ForeignKey("tienda_cortes.id"), nullable=False),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("estado", sa.String(12), nullable=False, server_default="PAGADA"),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False),
        sa.Column("descuento", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("descuento_motivo", sa.String(200), nullable=True),
        sa.Column("total", sa.Numeric(12, 2), nullable=False),
        sa.Column("costo_total", sa.Numeric(12, 2), nullable=False),
        sa.Column("piezas", sa.Integer(), nullable=False),
        sa.Column("cambio_mxn", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tipo_cambio", sa.Numeric(10, 4), nullable=False),
        sa.Column("cliente", sa.String(120), nullable=True),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("atendio", sa.String(120), nullable=False),
        sa.Column("usuario_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("cancelada_en", sa.DateTime(), nullable=True),
        sa.Column("cancelada_por", sa.String(120), nullable=True),
        sa.Column("motivo_cancelacion", sa.Text(), nullable=True),
    )
    op.create_index("ix_tienda_ventas_folio", "tienda_ventas", ["folio"], unique=True)
    op.create_index("ix_tienda_ventas_corte_id", "tienda_ventas", ["corte_id"])
    op.create_index("ix_tienda_ventas_fecha", "tienda_ventas", ["fecha"])
    op.create_index("ix_tienda_ventas_estado", "tienda_ventas", ["estado"])

    op.create_table(
        "tienda_venta_lineas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("venta_id", sa.Integer(), sa.ForeignKey("tienda_ventas.id"), nullable=False),
        sa.Column("producto_id", sa.Integer(), sa.ForeignKey("tienda_productos.id"), nullable=False),
        sa.Column("codigo", sa.String(40), nullable=False),
        sa.Column("descripcion", sa.String(255), nullable=False),
        sa.Column("categoria", sa.String(40), nullable=False),
        sa.Column("cantidad", sa.Integer(), nullable=False),
        sa.Column("precio_unitario", sa.Numeric(12, 2), nullable=False),
        sa.Column("costo_unitario", sa.Numeric(12, 2), nullable=False),
        sa.Column("total", sa.Numeric(12, 2), nullable=False),
    )
    op.create_index("ix_tienda_venta_lineas_venta_id", "tienda_venta_lineas", ["venta_id"])
    op.create_index("ix_tienda_venta_lineas_producto_id", "tienda_venta_lineas", ["producto_id"])

    op.create_table(
        "tienda_pagos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("venta_id", sa.Integer(), sa.ForeignKey("tienda_ventas.id"), nullable=False),
        sa.Column("metodo", sa.String(16), nullable=False),
        sa.Column("moneda", sa.String(3), nullable=False),
        sa.Column("monto", sa.Numeric(12, 2), nullable=False),
        sa.Column("tipo_cambio", sa.Numeric(10, 4), nullable=False),
        sa.Column("monto_mxn", sa.Numeric(12, 2), nullable=False),
        sa.Column("referencia", sa.String(80), nullable=True),
    )
    op.create_index("ix_tienda_pagos_venta_id", "tienda_pagos", ["venta_id"])

    op.create_table(
        "tienda_movimientos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("producto_id", sa.Integer(), sa.ForeignKey("tienda_productos.id"), nullable=False),
        sa.Column("tipo", sa.String(16), nullable=False),
        sa.Column("cantidad", sa.Integer(), nullable=False),
        sa.Column("existencia_despues", sa.Integer(), nullable=False),
        sa.Column("motivo", sa.Text(), nullable=True),
        sa.Column("costo_unitario", sa.Numeric(12, 2), nullable=True),
        sa.Column("venta_id", sa.Integer(), sa.ForeignKey("tienda_ventas.id"), nullable=True),
        sa.Column("usuario_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("atendio", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_tienda_movimientos_producto_id", "tienda_movimientos", ["producto_id"])
    op.create_index("ix_tienda_movimientos_tipo", "tienda_movimientos", ["tipo"])
    op.create_index("ix_tienda_movimientos_venta_id", "tienda_movimientos", ["venta_id"])

    # Los productos y movimientos del inventario anterior pasan tal cual.
    # Las SALIDAS manuales de antes quedan como AJUSTE: ya no existen salidas
    # sueltas, toda salida es una venta.
    conn = op.get_bind()
    insp = sa.inspect(conn)
    if insp.has_table("inventory_items"):
        conn.execute(sa.text(
            "insert into tienda_productos (id, codigo, tiene_codigo_barras, descripcion, categoria, "
            "marca, talla, costo, precio, existencia, minimo, activo, created_at, updated_at) "
            "select id, code, has_barcode, description, category, brand, size, purchase_price, "
            "sale_price, stock, min_stock, is_active, created_at, updated_at from inventory_items"
        ))
        if insp.has_table("inventory_movements"):
            conn.execute(sa.text(
                "insert into tienda_movimientos (producto_id, tipo, cantidad, existencia_despues, "
                "motivo, usuario_id, created_at) "
                "select item_id, case when kind = 'SALIDA' then 'AJUSTE' else kind end, quantity, "
                "stock_after, reason, user_id, created_at from inventory_movements"
            ))
            op.drop_table("inventory_movements")
        op.drop_table("inventory_items")
        if conn.dialect.name == "postgresql":
            conn.execute(sa.text(
                "select setval(pg_get_serial_sequence('tienda_productos','id'), "
                "coalesce((select max(id) from tienda_productos), 0) + 1, false)"
            ))


def downgrade() -> None:
    op.create_table(
        "inventory_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("has_barcode", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("brand", sa.String(length=80), nullable=True),
        sa.Column("size", sa.String(length=60), nullable=True),
        sa.Column("purchase_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("sale_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("stock", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("min_stock", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_inventory_items_code", "inventory_items", ["code"], unique=True)
    op.create_index("ix_inventory_items_category", "inventory_items", ["category"])
    op.create_table(
        "inventory_movements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("inventory_items.id"), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("stock_after", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_inventory_movements_item_id", "inventory_movements", ["item_id"])
    op.execute(
        "insert into inventory_items (id, code, has_barcode, description, category, brand, size, "
        "purchase_price, sale_price, stock, min_stock, is_active, created_at, updated_at) "
        "select id, codigo, tiene_codigo_barras, descripcion, categoria, marca, talla, costo, precio, "
        "existencia, minimo, activo, created_at, updated_at from tienda_productos"
    )
    for tabla in ("tienda_movimientos", "tienda_pagos", "tienda_venta_lineas", "tienda_ventas",
                  "tienda_cortes", "tienda_productos"):
        op.drop_table(tabla)
