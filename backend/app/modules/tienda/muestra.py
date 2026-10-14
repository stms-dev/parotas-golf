"""Existencias y precios de MUESTRA para la tienda.

La lista del Pro-Shop llegó solo con costo y sin piezas. Para poder ver y
probar el punto de venta antes del conteo real, se ponen cantidades y precios
inventados — pero de forma ordenada:

- Precio: costo + 60%, redondeado hacia arriba a $10, solo donde no hay precio.
- Existencias, mínimo y máximo: solo si NINGÚN producto tiene piezas todavía.
  En cuanto hay un conteo real, esto ya no toca nada.

Cada pieza inventada deja su movimiento en el kardex con el motivo
"Datos de muestra", así que se distinguen y se corrigen con un conteo físico.

Usa SQL plano para poder correr igual desde una migración que desde la siembra.
"""
import math
from decimal import Decimal

from sqlalchemy import text

MOTIVO = "Datos de muestra (reemplazar con el conteo físico)"


def cargar_muestra(conn) -> dict:
    filas = conn.execute(text(
        "SELECT id, costo, precio, existencia, existencia_bodega FROM tienda_productos"
    )).fetchall()
    if not filas:
        return {"precios": 0, "existencias": 0}

    precios = 0
    for pid, costo, precio, *_ in filas:
        if precio is None:
            nuevo = Decimal(math.ceil(Decimal(costo or 0) * Decimal("1.6") / 10) * 10)
            conn.execute(text("UPDATE tienda_productos SET precio = CAST(:p AS NUMERIC(12,2)) WHERE id = :i"), {"p": str(nuevo), "i": pid})
            precios += 1

    existencias = 0
    if all((f[3] or 0) == 0 and (f[4] or 0) == 0 for f in filas):
        for pid, costo, *_ in filas:
            # Inventado pero estable: el mismo producto siempre recibe lo mismo.
            tienda = 2 + pid % 6            # 2 a 7 en el anaquel
            bodega = (pid * 7) % 15         # 0 a 14 guardadas
            minimo = 4 + pid % 3            # 4 a 6
            maximo = minimo + 12 + pid % 7  # 16 a 24
            conn.execute(text(
                "UPDATE tienda_productos SET existencia = :t, existencia_bodega = :b, "
                "minimo = :mn, maximo = :mx WHERE id = :i"
            ), {"t": tienda, "b": bodega, "mn": minimo, "mx": maximo, "i": pid})
            for lugar, piezas in (("TIENDA", tienda), ("BODEGA", bodega)):
                if piezas:
                    conn.execute(text(
                        "INSERT INTO tienda_movimientos (producto_id, tipo, ubicacion, cantidad, "
                        "existencia_despues, motivo, costo_unitario, atendio, created_at) VALUES "
                        "(:i, 'AJUSTE', :u, :c, :c, :m, CAST(:k AS NUMERIC(12,2)), 'Sistema', CURRENT_TIMESTAMP)"
                    ), {"i": pid, "u": lugar, "c": piezas, "m": MOTIVO, "k": str(costo)})
            existencias += 1
    return {"precios": precios, "existencias": existencias}
