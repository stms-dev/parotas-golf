"""Resumen ejecutivo: lo cobrado por día y por concepto, con el número de partidas.

Es una vista de lectura para la dirección. Reúne en una sola tabla lo que
`ventas.py` separa por sección y forma de pago, pero agrupado como se
conversa el negocio:

- Cuponeras ......... el día que se confirmó el pago de la cuponera
- Reservas en línea . Green Fee pagado por el sitio (Stripe)
- Transferencias .... Green Fee pagado por transferencia
- Pro Shop .......... tienda, sin alimentos ni bebidas
- Alimentos y bebidas  tienda, lo que se come o se bebe
- Otros ............. efectivo y tarjeta de mostrador, replay y servicios

Se cuenta lo que entró (el día del cobro), con el cambio ya descontado, en
pesos y sin centavos. «Partidas» es el número de reservas distintas detrás del
ingreso; en cuponeras son los pases vendidos.
"""
from collections import OrderedDict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Set

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.billing.models import Payment
from app.modules.cuponeras.models import Cuponera
from app.modules.tienda.models import TiendaVenta
from app.modules.treasury.ventas import _fecha_local
from app.shared.money import ZERO, money

CONCEPTOS = [
    ("CUPONERAS", "Cuponeras"),
    ("RESERVAS_EN_LINEA", "Reservas en línea"),
    ("TRANSFERENCIAS", "Transferencias"),
    ("PRO_SHOP", "Pro Shop"),
    ("ALIMENTOS_BEBIDAS", "Alimentos y bebidas"),
    ("OTROS", "Otros"),
]

# La tienda no separa los alimentos en una categoría propia (todo cae en
# «Accesorios»), así que se reconocen por el nombre del producto. Si algún día
# se crea la categoría «Alimentos y bebidas», también se respeta.
CATEGORIAS_DE_COMIDA = {"alimentos y bebidas", "alimentos", "bebidas"}
PALABRAS_DE_COMIDA = (
    "agua", "cerveza", "refresco", "botana", "cacahuate", "papas", "torcidito",
    "jugo", "gatorade", "powerade", "electrolit", "café", "cafe",
    "sandwich", "sándwich", "torta", "hot dog", "hamburguesa", "snack", "galleta",
    "chocolate", "fruta", "agua mineral", "vino", "tequila", "michelada",
    "coca cola", "coca-cola", "sprite", "fanta", "pepsi", "topo chico", "red bull", "energizante",
)


def es_comida(categoria: str, descripcion: str) -> bool:
    if (categoria or "").strip().lower() in CATEGORIAS_DE_COMIDA:
        return True
    texto = (descripcion or "").lower()
    return any(p in texto for p in PALABRAS_DE_COMIDA)


def _vacio() -> Dict:
    return {"monto": ZERO, "partidas": 0}


def resumen(db: Session, inicio: date, fin: date) -> dict:
    dias: "OrderedDict[date, dict]" = OrderedDict()
    reservas_de: Dict[tuple, Set[int]] = {}

    cur = inicio
    while cur <= fin:
        dias[cur] = {c: _vacio() for c, _ in CONCEPTOS}
        cur += timedelta(days=1)

    def sumar(dia: date, concepto: str, monto: Decimal, partidas: int = 0) -> None:
        if dia in dias:
            dias[dia][concepto]["monto"] += monto
            dias[dia][concepto]["partidas"] += partidas

    # --- cobros de reservas
    desde = datetime.combine(inicio - timedelta(days=1), datetime.min.time())
    hasta = datetime.combine(fin + timedelta(days=2), datetime.min.time())
    pagos = db.execute(
        select(Payment).where(
            Payment.is_voided.is_(False), Payment.paid_at >= desde, Payment.paid_at < hasta
        )
    ).scalars()
    for p in pagos:
        dia = _fecha_local(p.paid_at)
        if dia not in dias:
            continue
        metodo = p.method.value if hasattr(p.method, "value") else str(p.method)
        if metodo == "CUPONERA":
            continue  # el dinero entró cuando se vendió la cuponera
        neto = money((p.amount_mxn or ZERO) - (p.change_mxn or ZERO))
        if metodo == "PAGO_EN_LINEA":
            concepto = "RESERVAS_EN_LINEA"
        elif metodo == "TRANSFERENCIA":
            concepto = "TRANSFERENCIAS"
        else:
            concepto = "OTROS"
        sumar(dia, concepto, neto)
        if p.reservation_id is not None:
            reservas_de.setdefault((dia, concepto), set()).add(p.reservation_id)
    for (dia, concepto), ids in reservas_de.items():
        dias[dia][concepto]["partidas"] += len(ids)

    # --- tienda: cada línea a su concepto, con el descuento repartido
    ventas = db.execute(
        select(TiendaVenta).where(
            TiendaVenta.estado == "PAGADA", TiendaVenta.fecha >= inicio, TiendaVenta.fecha <= fin
        )
    ).scalars()
    for v in ventas:
        bruto = sum((l.total for l in v.lineas), ZERO)
        factor = (v.total / bruto) if bruto else Decimal("1")
        for l in v.lineas:
            concepto = "ALIMENTOS_BEBIDAS" if es_comida(l.categoria, l.descripcion) else "PRO_SHOP"
            sumar(v.fecha, concepto, money(l.total * factor))

    # --- cuponeras vendidas
    cups = db.execute(
        select(Cuponera).where(
            Cuponera.pago_estado == "PAGADA", Cuponera.cancelada.is_(False),
            Cuponera.pagada_en.is_not(None),
        )
    ).scalars()
    for c in cups:
        dia = _fecha_local(c.pagada_en)
        sumar(dia, "CUPONERAS", money(c.precio_total), c.pases_total or 0)

    # --- salida: pesos sin decimales
    def entero(x: Decimal) -> int:
        return int(Decimal(x).quantize(Decimal("1")))

    lista: List[dict] = []
    totales = {c: _vacio() for c, _ in CONCEPTOS}
    for dia, fila in dias.items():
        total = ZERO
        partidas = 0
        por_concepto = {}
        for c, _ in CONCEPTOS:
            m, n = fila[c]["monto"], fila[c]["partidas"]
            total += m
            partidas += n
            totales[c]["monto"] += m
            totales[c]["partidas"] += n
            por_concepto[c] = {"monto": entero(m), "partidas": n}
        lista.append({"fecha": dia, "por_concepto": por_concepto, "total": entero(total), "partidas": partidas})

    total_general = sum((totales[c]["monto"] for c, _ in CONCEPTOS), ZERO)
    partidas_general = sum(totales[c]["partidas"] for c, _ in CONCEPTOS)
    return {
        "inicio": inicio,
        "fin": fin,
        "conceptos": [{"clave": c, "nombre": n} for c, n in CONCEPTOS],
        "dias": lista,
        "totales": {
            "por_concepto": {c: {"monto": entero(totales[c]["monto"]), "partidas": totales[c]["partidas"]}
                             for c, _ in CONCEPTOS},
            "total": entero(total_general),
            "partidas": partidas_general,
        },
    }
