"""El pase con QR y los cuerpos de los correos que entrega el club.

El pase es por partida, no por jugador: un solo QR trae a todo el grupo. Al
escanearlo en el mostrador aparece la lista completa y se palomea quién llegó.

El QR guarda una dirección con un identificador largo y aleatorio, nada más.
Ni nombres, ni correos, ni montos: si alguien fotografía un pase ajeno, no se
lleva datos de nadie, y ese identificador se puede regenerar.
"""
import base64
from io import BytesIO

import qrcode

from app.core.config import settings

# El identificador con el que el HTML llama a la imagen del código de barras.
CID_CODIGO = "cuponera-codigo"

VERDE = "#16382C"
ARENA = "#8f7145"


_PATRONES_128 = (
    '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 '
    '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
    '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 '
    '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
    '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 '
    '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 '
    '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 '
    '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
    '114131 311141 411131 211412 211214 211232 2331112'
).split()


def generar_qr_png(token: str) -> bytes:
    """PNG del pase. Sirve igual para el correo y para imprimirlo."""
    url = f"{settings.QR_BASE_URL}/{token}"
    qr = qrcode.QRCode(
        version=None,
        # Corrección media: un pase arrugado o con el logo encima se sigue
        # leyendo.
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)

    buffer = BytesIO()
    qr.make_image(fill_color=VERDE, back_color="white").save(buffer, format="PNG")
    return buffer.getvalue()


def generar_codigo_barras_png(valor: str) -> bytes:
    """PNG del código de barras (Code 128, juego B) de una cuponera.

    El lector del mostrador solo entiende códigos lineales. Es el mismo
    algoritmo que dibuja la pantalla (frontend/src/utils/codigoBarras.jsx).
    """
    from PIL import Image, ImageDraw

    valores = [104]
    for ch in valor:
        v = ord(ch) - 32
        if not 0 <= v <= 94:
            raise ValueError(f"Carácter no válido para el código de barras: {ch}")
        valores.append(v)
    suma = sum(v if i == 0 else v * i for i, v in enumerate(valores))
    valores += [suma % 103, 106]

    bits = []
    for v in valores:
        for i, ancho in enumerate(_PATRONES_128[v]):
            bits += [1 if i % 2 == 0 else 0] * int(ancho)

    modulo, margen, alto = 3, 12, 130
    imagen = Image.new("RGB", ((len(bits) + margen * 2) * modulo, alto), "white")
    dibujo = ImageDraw.Draw(imagen)
    for i, bit in enumerate(bits):
        if bit:
            x = (i + margen) * modulo
            dibujo.rectangle([x, 0, x + modulo - 1, alto], fill="black")
    buffer = BytesIO()
    imagen.save(buffer, format="PNG")
    return buffer.getvalue()


def generar_qr_base64(token: str) -> str:
    """El mismo PNG, en texto. Para incrustarlo en una pantalla o en el correo.

    Un `<img src="data:image/png;base64,…">` no pide nada al servidor, así que
    el pase se dibuja aunque la pantalla esté en un navegador sin sesión.
    """
    return base64.b64encode(generar_qr_png(token)).decode("ascii")


def _fecha_y_hora(reservation) -> str:
    slot = reservation.tee_slot
    if not slot:
        return ""
    return f"{slot.slot_date.strftime('%d/%m/%Y')} · {slot.slot_time.strftime('%H:%M')} hrs"


def _es_practica(reservation) -> bool:
    return str(reservation.modality) == "PRACTICA"


def _que_juega(reservation) -> str:
    """"18 hoyos" o "Zona de práctica": lo que se reservó."""
    return "Zona de práctica" if _es_practica(reservation) else f"{reservation.holes} hoyos"


def _hora_local(momento) -> str:
    """Un datetime guardado en UTC, en la hora del campo: "07/10/2026 a las 14:32"."""
    if momento is None:
        return ""
    from datetime import timezone

    from app.shared.tiempo import zona

    tz = zona()
    local = momento.replace(tzinfo=timezone.utc).astimezone(tz) if tz else momento
    return f"{local.strftime('%d/%m/%Y')} a las {local.strftime('%H:%M')}"


def _pago_en_linea(reservation):
    """Lo que ya se pagó de la reserva antes de llegar: cuándo, cómo y cuánto.

    Devuelve None si todavía no hay ningún cobro (la reserva del hotel, que se
    paga en el mostrador).
    """
    from app.modules.billing.models import pagos_de_la_reserva
    from app.shared.money import ZERO, money

    pagos = pagos_de_la_reserva(reservation)
    if not pagos:
        return None
    pagado = money(sum((p.neto_mxn for p in pagos), start=ZERO))
    ultimo = max(pagos, key=lambda p: p.paid_at or datetime_min())
    # La nota del cobro en línea dice "Pago en línea · visa ····4242".
    forma = (ultimo.notes or "").replace("Pago en línea · ", "").strip() or "Tarjeta"
    return {
        "pagado": pagado,
        "cuando": _hora_local(ultimo.paid_at),
        "forma": forma[:1].upper() + forma[1:],
        "referencia": ultimo.reference or "",
    }


def datetime_min():
    from datetime import datetime

    return datetime.min


def _marco(contenido: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#f6f5f1">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;
              padding:28px;font-family:Georgia,'Times New Roman',serif;color:{VERDE}">
    <p style="margin:0;font-size:24px">Las Parotas</p>
    <p style="margin:2px 0 22px;font-size:11px;letter-spacing:3px;text-transform:uppercase;
              color:{ARENA};font-family:system-ui,sans-serif">Club de Golf · Huatulco</p>
    {contenido}
    <p style="margin-top:26px;padding-top:14px;border-top:1px solid #e7e4dc;
              font-family:system-ui,sans-serif;font-size:11px;color:#8a8a80">
      Las Parotas Club de Golf · Bahías de Huatulco, Oaxaca<br>
      Este mensaje se generó solo. Para cualquier aclaración, responda a este correo.
    </p>
  </div>
</body></html>"""


def cuerpo_pase(reservation) -> tuple[str, str]:
    """Correo del pase. Devuelve (texto plano, HTML).

    El texto plano no es un adorno: hay clientes de correo que no muestran
    HTML, y un pase que no se puede leer no sirve de nada.

    Si la reserva ya viene pagada (la del sitio, pagada con tarjeta), el pase
    lleva también el detalle del pago: cuándo se pagó, con qué y el desglose.
    Así el huésped tiene su comprobante en el mismo correo.
    """
    from app.shared.money import money

    cuando = _fecha_y_hora(reservation)
    jugadores = [p.full_name for p in reservation.players]
    practica = _es_practica(reservation)
    que = _que_juega(reservation)
    pago = _pago_en_linea(reservation)
    llegada = (
        "Le pedimos llegar 15 minutos antes de su hora." if practica
        else "Le pedimos llegar 15 minutos antes de su salida."
    )

    servicios = [s for s in reservation.services if s.quantity > 0]

    texto = (
        f"Hola {reservation.holder_name}:\n\n"
        + ("Su visita a la zona de práctica quedó registrada.\n\n" if practica
           else "Su salida quedó registrada.\n\n")
        + f"Folio: {reservation.folio}\n"
        f"Fecha y hora: {cuando}\n"
        f"{'Paquete' if practica else 'Recorrido'}: {que}\n"
        f"{'Personas' if practica else 'Jugadores'}: {', '.join(jugadores)}\n\n"
    )
    if pago:
        texto += (
            f"PAGO RECIBIDO\n"
            f"Pagado el {pago['cuando']} · {pago['forma']}\n"
            + "".join(f"  {p.full_name}: ${money(p.rate_applied)} MXN\n" for p in reservation.players)
            + "".join(
                f"  {(s.service.name if s.service else 'Servicio')} x{s.quantity}: ${money(s.total)} MXN\n"
                for s in servicios
            )
            + f"Total pagado: ${pago['pagado']} MXN\n"
            + (f"Referencia: {pago['referencia']}\n" if pago["referencia"] else "")
            + "\n"
        )
    texto += (
        f"Presente el pase adjunto en recepción. Es uno solo para "
        f"{'todo el grupo' if practica else 'toda la partida'}.\n"
        f"{llegada}\n\n"
        f"Las Parotas Club de Golf"
    )

    filas = "".join(
        f"<tr><td style='padding:7px 0;border-bottom:1px solid #eeece6'>{p.full_name}</td>"
        f"<td style='padding:7px 0;border-bottom:1px solid #eeece6;color:#77756c;text-align:right'>"
        f"{'Junior' if p.category == 'INFANTIL' else 'Adulto'}</td></tr>"
        for p in reservation.players
    )
    acompanantes = ""
    if reservation.companions:
        nombres = ", ".join(c.full_name for c in reservation.companions)
        acompanantes = (
            f"<p style='font-family:system-ui,sans-serif;font-size:13px;color:#77756c;margin:10px 0 0'>"
            f"Acompañantes (no juegan): {nombres}</p>"
        )

    bloque_pago = ""
    if pago:
        renglones = "".join(
            f"<tr><td style='padding:6px 0;border-bottom:1px solid #e3ece6'>"
            f"{p.full_name}<span style='color:#77756c'> · "
            f"{'Zona de práctica' if practica else ('Junior' if p.category == 'INFANTIL' else 'Green Fee')}"
            f"</span></td>"
            f"<td style='padding:6px 0;border-bottom:1px solid #e3ece6;text-align:right;"
            f"font-family:ui-monospace,monospace'>${money(p.rate_applied)}</td></tr>"
            for p in reservation.players
        ) + "".join(
            f"<tr><td style='padding:6px 0;border-bottom:1px solid #e3ece6'>"
            f"{s.service.name if s.service else 'Servicio'} × {s.quantity}</td>"
            f"<td style='padding:6px 0;border-bottom:1px solid #e3ece6;text-align:right;"
            f"font-family:ui-monospace,monospace'>${money(s.total)}</td></tr>"
            for s in servicios
        )
        referencia = (
            f"<p style='margin:8px 0 0;font-size:11px;color:#8a8a80'>Referencia: {pago['referencia']}</p>"
            if pago["referencia"] else ""
        )
        bloque_pago = f"""
    <div style="border:1px solid #cfe3d6;border-radius:12px;padding:18px;margin:18px 0;
                font-family:system-ui,sans-serif">
      <p style="margin:0;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#37634e">
        &#10003; Pago recibido
      </p>
      <p style="margin:6px 0 12px;font-size:14px;color:{VERDE}">
        Pagado el <strong>{pago['cuando']}</strong> · {pago['forma']}
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        {renglones}
        <tr><td style="padding-top:10px;font-size:15px">Total pagado</td>
            <td style="padding-top:10px;text-align:right;font-size:17px;
                       font-family:ui-monospace,monospace">${pago['pagado']} MXN</td></tr>
      </table>
      {referencia}
    </div>"""

    nota_final = (
        f"Le pedimos llegar <strong>15 minutos antes</strong> de su "
        f"{'hora' if practica else 'salida'}. "
        + ("Su reserva ya está pagada: en recepción solo registramos su llegada."
           if pago else
           ("El cobro se hace en recepción." if practica
            else "El cobro se hace en recepción."))
    )

    html = _marco(f"""
    <p style="font-family:system-ui,sans-serif;font-size:15px">
      Hola {reservation.holder_name}, {'su visita a la zona de práctica quedó registrada'
      if practica else 'su salida quedó registrada'}.
    </p>

    <div style="background:#f2f7f4;border-radius:12px;padding:22px;margin:18px 0;text-align:center">
      <p style="margin:0;font-family:ui-monospace,monospace;font-size:22px">{reservation.folio}</p>
      <p style="margin:6px 0 16px;font-family:system-ui,sans-serif;font-size:14px;color:#37634e">
        {cuando} · {que}
      </p>
      <img src="cid:pase-qr" alt="Pase" style="width:190px;height:190px"/>
      <p style="margin:12px 0 0;font-family:system-ui,sans-serif;font-size:12px;color:#77756c">
        Un solo pase para {'todo el grupo' if practica else 'toda la partida'}
      </p>
    </div>

    <table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
      <tr><th colspan="2" style="text-align:left;padding-bottom:6px;font-size:11px;
          letter-spacing:1px;text-transform:uppercase;color:#8a8a80">
          {'Personas' if practica else 'Jugadores'}</th></tr>
      {filas}
    </table>
    {acompanantes}
    {bloque_pago}

    <p style="font-family:system-ui,sans-serif;font-size:13px;color:#77756c;margin-top:20px">
      {nota_final}
    </p>
    """)

    return texto, html


def cuerpo_recibo(reservation) -> tuple[str, str]:
    """Correo del recibo, después de cobrar en el mostrador."""
    from app.modules.billing.models import pagos_de_la_reserva
    from app.shared.money import ZERO, money

    cuando = _fecha_y_hora(reservation)
    pagos = pagos_de_la_reserva(reservation)
    pagado = money(sum((p.neto_mxn for p in pagos), start=ZERO))

    metodos = {
        "EFECTIVO": "Efectivo",
        "TARJETA": "Tarjeta",
        "TRANSFERENCIA": "Transferencia",
    }

    texto = (
        f"Hola {reservation.holder_name}:\n\n"
        f"Gracias por su visita. Este es el comprobante de su partida.\n\n"
        f"Folio: {reservation.folio}\n"
        f"Fecha y hora: {cuando}\n"
        f"Total: ${money(reservation.total)} MXN\n"
        f"Pagado: ${pagado} MXN\n\n"
        f"Comprobante interno de cobro; no es un comprobante fiscal.\n"
        f"Si requiere factura, solicítela en recepción.\n\n"
        f"Las Parotas Club de Golf"
    )

    lineas = "".join(
        f"<tr><td style='padding:6px 0;border-bottom:1px solid #eeece6'>{p.full_name}</td>"
        f"<td style='padding:6px 0;border-bottom:1px solid #eeece6;text-align:right;"
        f"font-family:ui-monospace,monospace'>${money(p.final_rate)}</td></tr>"
        for p in reservation.players
        if p.arrived
    )
    servicios = "".join(
        f"<tr><td style='padding:6px 0;border-bottom:1px solid #eeece6'>"
        f"{s.service.name if s.service else 'Servicio'} × {s.quantity}</td>"
        f"<td style='padding:6px 0;border-bottom:1px solid #eeece6;text-align:right;"
        f"font-family:ui-monospace,monospace'>${money(s.total)}</td></tr>"
        for s in reservation.services
        if s.quantity > 0
    )
    formas = "".join(
        f"<tr><td style='padding:4px 0;color:#77756c'>{metodos.get(str(p.method), p.method)}</td>"
        f"<td style='padding:4px 0;text-align:right;font-family:ui-monospace,monospace'>"
        f"${money(p.amount_mxn)}</td></tr>"
        + (
            f"<tr><td style='padding:4px 0;color:#77756c'>Cambio entregado</td>"
            f"<td style='padding:4px 0;text-align:right;font-family:ui-monospace,monospace'>"
            f"−${money(p.change_mxn)}</td></tr>"
            if p.change_mxn and money(p.change_mxn) > ZERO
            else ""
        )
        for p in pagos
    )

    html = _marco(f"""
    <p style="font-family:system-ui,sans-serif;font-size:15px">
      Hola {reservation.holder_name}, gracias por su visita.
    </p>

    <div style="background:#f2f7f4;border-radius:12px;padding:18px;margin:16px 0">
      <p style="margin:0;font-family:ui-monospace,monospace;font-size:18px">{reservation.folio}</p>
      <p style="margin:4px 0 0;font-family:system-ui,sans-serif;font-size:14px;color:#37634e">
        {cuando} · {_que_juega(reservation)}
      </p>
    </div>

    <table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
      {lineas}
      {servicios}
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:14px;
                  font-family:system-ui,sans-serif;font-size:14px">
      {formas}
      <tr><td style="padding-top:10px;font-size:16px">Total pagado</td>
          <td style="padding-top:10px;text-align:right;font-size:18px;
                     font-family:ui-monospace,monospace">${pagado}</td></tr>
    </table>

    <p style="font-family:system-ui,sans-serif;font-size:12px;color:#8a8a80;margin-top:18px">
      Comprobante interno de cobro. No es un comprobante fiscal; si requiere factura,
      solicítela en recepción.
    </p>
    """)

    return texto, html



def _fecha_larga(dia) -> str:
    meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
             "septiembre", "octubre", "noviembre", "diciembre"]
    return f"{dia.day} de {meses[dia.month - 1]} de {dia.year}"


def _plural_pases(n: int) -> str:
    return f"{n} pase" if n == 1 else f"{n} pases"


def _modalidad(c) -> str:
    if c.hoyos_18 and c.hoyos_9:
        return "18 o 9 hoyos"
    return "18 hoyos" if c.hoyos_18 else "9 hoyos"


def _bloqueos_txt(c) -> str:
    from app.modules.cuponeras.service import bloqueos_de

    partes = []
    for b in bloqueos_de(c):
        rango = b["desde"] if b["desde"] == b["hasta"] else f"{b['desde']} al {b['hasta']}"
        partes.append(rango + (f" ({b['motivo']})" if b.get("motivo") else ""))
    return "; ".join(partes)


def cuerpo_cuponera(c) -> tuple[str, str]:
    """Correo con la cuponera y su código de barras. Sin precios."""
    bloqueos = _bloqueos_txt(c)
    uso = (
        "Para jugar, mande un WhatsApp al club con el día y la hora en que quiere ir; "
        "nosotros apartamos su salida. Ese día, muestre este código en recepción y se "
        "descuentan los pases de quienes lleguen."
    )
    texto = (
        f"Hola {c.titular_nombre}:\n\n"
        f"Su cuponera quedó registrada.\n\n"
        f"Folio: {c.folio}\n"
        f"Pases: {c.pases_total} ({_modalidad(c)})\n"
        f"Vigencia: hasta el {_fecha_larga(c.vence_el)}\n"
        + (f"No válida: {bloqueos}\n" if bloqueos else "")
        + f"\n{uso}\n\nLas Parotas Club de Golf"
    )
    filas = [
        ("Folio", c.folio),
        ("Pases", f"{c.pases_total} · {_modalidad(c)}"),
        ("Vigencia", f"hasta el {_fecha_larga(c.vence_el)}"),
    ]
    if bloqueos:
        filas.append(("No válida", bloqueos))
    tabla = "".join(
        f"<tr><td style='padding:7px 0;border-bottom:1px solid #eeece6;color:#77756c'>{k}</td>"
        f"<td style='padding:7px 0;border-bottom:1px solid #eeece6;text-align:right'>{v}</td></tr>"
        for k, v in filas
    )
    contenido = f"""
    <p style="font-size:18px;margin:0 0 6px">Hola {c.titular_nombre},</p>
    <p style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;margin:0 0 16px">
      Su cuponera quedó registrada.</p>
    <table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">{tabla}</table>
    <div style="text-align:center;margin:22px 0 6px">
      <img src="cid:{CID_CODIGO}" alt="Código de barras {c.folio}" style="max-width:100%">
      <p style="font-family:ui-monospace,monospace;font-size:13px;letter-spacing:2px;margin:4px 0 0">{c.folio}</p>
    </div>
    <p style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.5;color:#55534b">{uso}</p>"""
    return texto, _marco(contenido)


def cuerpo_uso(c, datos: dict) -> tuple[str, str]:
    """Aviso de cada uso: cuántos pases se gastaron y cuántos quedan."""
    from datetime import date

    n = int(datos.get("jugadores", 0))
    saldo = int(datos.get("saldo", 0))
    hoyos = datos.get("hoyos")
    dia = date.fromisoformat(datos["dia"]) if datos.get("dia") else None
    cuando = f" el {_fecha_larga(dia)}" if dia else ""
    if saldo > 0:
        queda = f"Le quedan {_plural_pases(saldo)}, vigentes hasta el {_fecha_larga(c.vence_el)}."
        titulo = f"Le quedan {_plural_pases(saldo)}"
    else:
        queda = "Con esto se terminaron los pases de su cuponera. Gracias por jugar con nosotros."
        titulo = "Se terminaron los pases de su cuponera"
    detalle = f"Se descontaron {_plural_pases(n)}{cuando}" + (f" ({hoyos} hoyos)" if hoyos else "") + "."
    texto = (
        f"Hola {c.titular_nombre}:\n\n{detalle}\n{queda}\n\n"
        f"Cuponera: {c.folio} · {c.pases_total} pases\n\nLas Parotas Club de Golf"
    )
    contenido = f"""
    <p style="font-size:18px;margin:0 0 6px">Hola {c.titular_nombre},</p>
    <p style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;margin:0 0 14px">{detalle}</p>
    <p style="font-size:30px;margin:6px 0 4px">{titulo}</p>
    <p style="font-family:system-ui,sans-serif;font-size:14px;color:#55534b;margin:0">{queda}</p>
    <p style="font-family:ui-monospace,monospace;font-size:12px;color:#77756c;margin:16px 0 0">
      {c.folio} · {_plural_pases(c.pases_total)} en total</p>"""
    return texto, _marco(contenido)
