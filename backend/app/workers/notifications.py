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

VERDE = "#16382C"
ARENA = "#8f7145"


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
            f"{'Zona de práctica' if practica else ('Junior' if p.category == 'INFANTIL' else 'Green fee')}"
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
            else "El cobro y la validación de credenciales PGA se hacen en recepción."))
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
