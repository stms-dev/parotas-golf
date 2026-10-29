"""Ventas totales: lo cobrado, separado por sección y por forma de pago.

Cada fuente se cuenta aparte —green fees, replay y tienda— y dentro de cada
una por forma de pago: efectivo en pesos, efectivo en dólares, tarjeta y
transferencia. Se agrupa por día, semana, mes o año para poder ver el detalle
de un día y, con el mismo cálculo, el acumulado.

Se suma lo que **entró a la caja**, no lo vendido: en efectivo el cambio que se
regresó al cliente se descuenta, y los pagos anulados no cuentan. Los dólares
se guardan con el tipo de cambio de cada pago, así que cambiar el tipo de
cambio hoy no mueve lo cobrado ayer.
"""
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional, Dict, List

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.billing.models import Payment
from app.modules.tienda.models import TiendaPago, TiendaVenta
from app.shared.money import ZERO, money
from app.shared.tiempo import zona

FUENTES = [
    ("GREEN_FEES", "Green fees y servicios"),
    ("REPLAY", "Replay"),
    ("TIENDA", "Tienda"),
]
AGRUPACIONES = ("dia", "semana", "mes", "anio")
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def _vacio() -> Dict[str, Decimal]:
    return {
        "efectivo_mxn": ZERO,
        "efectivo_usd": ZERO,        # dólares recibidos, en dólares
        "efectivo_usd_en_mxn": ZERO,  # esos mismos dólares valuados al tipo de cambio de cada pago
        "tarjeta": ZERO,
        "transferencia": ZERO,
        "total": ZERO,
        "operaciones": 0,
    }


def _sumar(destino: Dict, origen: Dict) -> None:
    for k, v in origen.items():
        destino[k] = destino[k] + v


def _fecha_local(momento: datetime) -> date:
    """Un datetime guardado en UTC, en la fecha del campo."""
    tz = zona()
    if tz is None:
        return momento.date()
    return momento.replace(tzinfo=timezone.utc).astimezone(tz).date()


def _asentar(fila: Dict, metodo: str, moneda: str, monto: Decimal, monto_mxn: Decimal,
             cambio: Decimal) -> None:
    """Un cobro dentro de una fila de totales. `monto_mxn` ya incluye lo que se dio de cambio."""
    neto = money(monto_mxn - cambio)
    if metodo == "EFECTIVO":
        if moneda == "USD":
            fila["efectivo_usd"] += money(monto)
            fila["efectivo_usd_en_mxn"] += neto
        else:
            fila["efectivo_mxn"] += neto
    elif metodo == "TARJETA":
        fila["tarjeta"] += neto
    else:
        fila["transferencia"] += neto
    fila["total"] += neto
    fila["operaciones"] += 1


def _clave(dia: date, agrupar: str):
    """(clave ordenable, etiqueta, inicio, fin) del periodo al que pertenece un día."""
    if agrupar == "dia":
        return dia.isoformat(), dia.strftime("%d/%m/%Y"), dia, dia
    if agrupar == "semana":
        lunes = dia - timedelta(days=dia.weekday())
        domingo = lunes + timedelta(days=6)
        return (
            lunes.isoformat(),
            f"Semana del {lunes.strftime('%d/%m')} al {domingo.strftime('%d/%m/%Y')}",
            lunes, domingo,
        )
    if agrupar == "mes":
        inicio = dia.replace(day=1)
        siguiente = (inicio + timedelta(days=32)).replace(day=1)
        return (
            inicio.isoformat(),
            f"{MESES[dia.month - 1].capitalize()} {dia.year}",
            inicio, siguiente - timedelta(days=1),
        )
    inicio = date(dia.year, 1, 1)
    return inicio.isoformat(), str(dia.year), inicio, date(dia.year, 12, 31)


def desglose(db: Session, inicio: date, fin: date, agrupar: str = "dia",
             usuario_id: Optional[int] = None) -> dict:
    """Si se pasa `usuario_id`, solo cuenta lo que cobró ese usuario."""
    if agrupar not in AGRUPACIONES:
        agrupar = "dia"

    periodos: "OrderedDict[str, dict]" = OrderedDict()
    totales = {f: _vacio() for f, _ in FUENTES}

    def fila_de(dia: date, fuente: str) -> Dict:
        clave, etiqueta, ini, fn = _clave(dia, agrupar)
        if clave not in periodos:
            periodos[clave] = {
                "clave": clave, "etiqueta": etiqueta,
                "inicio": ini, "fin": fn,
                "por_fuente": {f: _vacio() for f, _ in FUENTES},
            }
        return periodos[clave]["por_fuente"][fuente]

    # --- cobros de reservas (green fees, servicios y replay)
    # Se trae un día de margen por lado: paid_at está en UTC y el día del campo
    # no empieza a la misma hora.
    desde = datetime.combine(inicio - timedelta(days=1), datetime.min.time())
    hasta = datetime.combine(fin + timedelta(days=2), datetime.min.time())
    consulta_pagos = select(Payment).where(
        Payment.is_voided.is_(False), Payment.paid_at >= desde, Payment.paid_at < hasta
    )
    if usuario_id is not None:
        consulta_pagos = consulta_pagos.where(Payment.received_by_id == usuario_id)
    pagos = db.execute(consulta_pagos).scalars().all()
    for p in pagos:
        dia = _fecha_local(p.paid_at)
        if not inicio <= dia <= fin:
            continue
        fuente = "REPLAY" if p.replay_id is not None else "GREEN_FEES"
        moneda = p.currency.value if hasattr(p.currency, "value") else str(p.currency)
        metodo = p.method.value if hasattr(p.method, "value") else str(p.method)
        _asentar(fila_de(dia, fuente), metodo, moneda, p.amount, p.amount_mxn, p.change_mxn or ZERO)

    # --- tienda: el cambio se guarda en la venta, no en cada pago
    consulta_ventas = select(TiendaVenta).where(
        TiendaVenta.estado == "PAGADA", TiendaVenta.fecha >= inicio, TiendaVenta.fecha <= fin
    )
    if usuario_id is not None:
        consulta_ventas = consulta_ventas.where(TiendaVenta.usuario_id == usuario_id)
    ventas = db.execute(consulta_ventas).scalars().all()
    for v in ventas:
        cambio_pendiente = money(v.cambio_mxn or 0)
        for pago in v.pagos:
            cambio = ZERO
            # El cambio sale del efectivo en pesos de esa venta.
            if pago.metodo == "EFECTIVO" and pago.moneda == "MXN" and cambio_pendiente > 0:
                cambio = min(cambio_pendiente, money(pago.monto_mxn))
                cambio_pendiente -= cambio
            _asentar(fila_de(v.fecha, "TIENDA"), pago.metodo, pago.moneda,
                     pago.monto, pago.monto_mxn, cambio)

    lista: List[dict] = []
    for clave in sorted(periodos):
        periodo = periodos[clave]
        general = _vacio()
        for fuente, _ in FUENTES:
            _sumar(general, periodo["por_fuente"][fuente])
            _sumar(totales[fuente], periodo["por_fuente"][fuente])
        periodo["general"] = general
        lista.append(periodo)

    general = _vacio()
    for fuente, _ in FUENTES:
        _sumar(general, totales[fuente])

    def plano(fila: Dict) -> Dict:
        return {k: (str(v) if isinstance(v, Decimal) else v) for k, v in fila.items()}

    return {
        "inicio": inicio, "fin": fin, "agrupar": agrupar,
        "fuentes": [{"clave": c, "nombre": n} for c, n in FUENTES],
        "totales": {"por_fuente": {k: plano(v) for k, v in totales.items()}, "general": plano(general)},
        "periodos": [
            {
                "clave": p["clave"], "etiqueta": p["etiqueta"],
                "inicio": p["inicio"], "fin": p["fin"],
                "por_fuente": {k: plano(v) for k, v in p["por_fuente"].items()},
                "general": plano(p["general"]),
            }
            for p in lista
        ],
    }
