"""El pase con QR y los cuerpos de los correos que entrega el club.

El pase es por partida, no por jugador: un solo QR trae a todo el grupo. Al
escanearlo en el mostrador aparece la lista completa y se palomea quién llegó.

El QR guarda una dirección con un identificador largo y aleatorio, nada más.
Ni nombres, ni correos, ni montos: si alguien fotografía un pase ajeno, no se
lleva datos de nadie, y ese identificador se puede regenerar.
"""
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


def _fecha_y_hora(reservation) -> str:
    slot = reservation.tee_slot
    if not slot:
        return ""
    return f"{slot.slot_date.strftime('%d/%m/%Y')} · {slot.slot_time.strftime('%H:%M')} hrs"


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
    """
    cuando = _fecha_y_hora(reservation)
    jugadores = [p.full_name for p in reservation.players]

    texto = (
        f"Hola {reservation.holder_name}:\n\n"
        f"Su salida quedó registrada.\n\n"
        f"Folio: {reservation.folio}\n"
        f"Fecha y hora: {cuando}\n"
        f"Recorrido: {reservation.holes} hoyos\n"
        f"Jugadores: {', '.join(jugadores)}\n\n"
        f"Presente el pase adjunto en recepción. Es uno solo para toda la partida.\n"
        f"Le pedimos llegar 30 minutos antes de su salida.\n\n"
        f"Las Parotas Club de Golf"
    )

    filas = "".join(
        f"<tr><td style='padding:7px 0;border-bottom:1px solid #eeece6'>{p.full_name}</td>"
        f"<td style='padding:7px 0;border-bottom:1px solid #eeece6;color:#77756c;text-align:right'>"
        f"{'Infantil' if p.category == 'INFANTIL' else 'Adulto'}</td></tr>"
        for p in reservation.players
    )
    acompanantes = ""
    if reservation.companions:
        nombres = ", ".join(c.full_name for c in reservation.companions)
        acompanantes = (
            f"<p style='font-family:system-ui,sans-serif;font-size:13px;color:#77756c;margin:10px 0 0'>"
            f"Acompañantes (no juegan): {nombres}</p>"
        )

    html = _marco(f"""
    <p style="font-family:system-ui,sans-serif;font-size:15px">
      Hola {reservation.holder_name}, su salida quedó registrada.
    </p>

    <div style="background:#f2f7f4;border-radius:12px;padding:22px;margin:18px 0;text-align:center">
      <p style="margin:0;font-family:ui-monospace,monospace;font-size:22px">{reservation.folio}</p>
      <p style="margin:6px 0 16px;font-family:system-ui,sans-serif;font-size:14px;color:#37634e">
        {cuando} · {reservation.holes} hoyos
      </p>
      <img src="cid:pase-qr" alt="Pase de la partida" style="width:190px;height:190px"/>
      <p style="margin:12px 0 0;font-family:system-ui,sans-serif;font-size:12px;color:#77756c">
        Un solo pase para toda la partida
      </p>
    </div>

    <table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
      <tr><th colspan="2" style="text-align:left;padding-bottom:6px;font-size:11px;
          letter-spacing:1px;text-transform:uppercase;color:#8a8a80">Jugadores</th></tr>
      {filas}
    </table>
    {acompanantes}

    <p style="font-family:system-ui,sans-serif;font-size:13px;color:#77756c;margin-top:20px">
      Le pedimos llegar <strong>30 minutos antes</strong> de su salida. El cobro y la
      validación de credenciales PGA se hacen en recepción.
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
        {cuando} · {reservation.holes} hoyos
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
