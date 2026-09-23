"""Generación de pases QR y envío de correos.

Va aparte del request a propósito: armar un QR y hablar con un SMTP tarda, y
recepción no debería esperar a que eso termine para despachar una partida.

El pase es por reserva (una partida = un QR). Al escanearlo, recepción ve la
lista completa de jugadores y marca quién llegó.
"""
import base64
import smtplib
from email.message import EmailMessage
from io import BytesIO
from typing import Optional

import qrcode

from app.core.config import settings


def generar_qr_png(token: str) -> bytes:
    """Genera el PNG del pase. El QR apunta a la URL pública de la reserva."""
    url = f"{settings.QR_BASE_URL}/{token}"
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)

    buffer = BytesIO()
    qr.make_image(fill_color="#1d3b2e", back_color="white").save(buffer, format="PNG")
    return buffer.getvalue()


def generar_qr_base64(token: str) -> str:
    """Versión embebible en HTML: <img src="data:image/png;base64,…">."""
    return base64.b64encode(generar_qr_png(token)).decode("ascii")


def _cuerpo_html(reservation, qr_base64: str) -> str:
    jugadores = "".join(
        f"<tr><td style='padding:6px 0;border-bottom:1px solid #eee'>{player.full_name}</td>"
        f"<td style='padding:6px 0;border-bottom:1px solid #eee;color:#666'>"
        f"{'Infantil' if player.category == 'INFANTIL' else 'Adulto'}</td></tr>"
        for player in reservation.players
    )
    slot = reservation.tee_slot
    return f"""
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1d3b2e">
      <h1 style="font-size:24px;margin-bottom:4px">Las Parotas</h1>
      <p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8f7145;margin-top:0">
        Club de Golf
      </p>

      <p>Estimado(a) {reservation.holder_name}:</p>
      <p>Su salida ha quedado registrada. Presente este pase en recepción.</p>

      <div style="background:#f2f7f4;border-radius:12px;padding:20px;margin:20px 0;text-align:center">
        <p style="font-family:monospace;font-size:22px;margin:0">{reservation.folio}</p>
        <p style="margin:6px 0 16px;color:#37634e">
          {slot.slot_date.strftime('%d/%m/%Y') if slot else ''} ·
          {slot.slot_time.strftime('%H:%M') if slot else ''} hrs ·
          {reservation.holes} hoyos
        </p>
        <img src="data:image/png;base64,{qr_base64}" alt="Pase de acceso" style="width:180px"/>
        <p style="font-size:12px;color:#666;margin-top:12px">
          Un solo pase para toda la partida
        </p>
      </div>

      <table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
        <thead>
          <tr><th style="text-align:left;padding-bottom:8px;font-size:11px;text-transform:uppercase;color:#888">
            Jugadores</th><th></th></tr>
        </thead>
        <tbody>{jugadores}</tbody>
      </table>

      <p style="font-family:system-ui,sans-serif;font-size:12px;color:#666;margin-top:24px">
        Se recomienda presentarse 30 minutos antes de la salida. Código de etiqueta: polo con
        cuello y calzado con soft spikes.
      </p>
    </div>
    """


def enviar_pase(reservation) -> bool:
    """Envía el pase al titular. Devuelve False si no hay SMTP configurado."""
    if not settings.SMTP_HOST:
        return False

    qr_base64 = generar_qr_base64(reservation.qr_token)

    message = EmailMessage()
    message["Subject"] = f"Pase de acceso · {reservation.folio} · Las Parotas"
    message["From"] = settings.SMTP_FROM
    message["To"] = reservation.holder_email
    message.set_content(
        f"Reserva {reservation.folio} confirmada. "
        f"Presente el pase adjunto en recepción."
    )
    message.add_alternative(_cuerpo_html(reservation, qr_base64), subtype="html")
    message.add_attachment(
        generar_qr_png(reservation.qr_token),
        maintype="image",
        subtype="png",
        filename=f"pase-{reservation.folio}.png",
    )

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        if settings.SMTP_TLS:
            server.starttls()
        if settings.SMTP_USER:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.send_message(message)

    return True
