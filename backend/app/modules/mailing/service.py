"""Envío de correos del club: el pase de la partida y el recibo del cobro.

Tres reglas mandan aquí:

1. **Un correo nunca frena la operación.** El concierge no puede quedarse
   mirando la pantalla porque el servidor de correo tardó; ni perder una
   reserva porque estaba caído. Todo se escribe primero en la bandeja de
   salida.
2. **Pero sale al momento.** Encolar no es aplazar: apenas queda escrito se
   intenta entregar. Si eso falla, el repartidor de segundo plano lo reintenta
   solito cada minuto. El huésped recibe su pase en segundos, y si algo se
   atora, nadie tiene que acordarse de volver a mandarlo.
3. **Nada se pierde en silencio.** Cada intento queda escrito con su error.

Se entrega por **HTTPS**, no por SMTP. Los servidores administrados bloquean
los puertos de SMTP para que no se manden campañas de spam desde ahí, así que
un sistema que dependa de SMTP simplemente no manda correos en producción. La
API de Resend viaja por el puerto 443, el mismo de cualquier página web.
"""
from __future__ import annotations

import base64
import logging
import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import List, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.booking.models import Reservation
from app.modules.mailing.models import OutboxEmail
from app.shared.enums import EmailKind, EmailStatus
from app.workers.notifications import cuerpo_pase, cuerpo_recibo, generar_qr_png

logger = logging.getLogger(__name__)

# Después de tres intentos fallidos se deja de insistir: si el correo está
# mal escrito, reintentar mil veces no lo va a componer. Queda en la bandeja
# como fallido y con un botón para reenviar a mano.
MAX_INTENTOS = 3

RESEND_URL = "https://api.resend.com/emails"

# Cuánto se espera al proveedor. Corto cuando hay alguien esperando frente a
# la pantalla; holgado cuando el repartidor trabaja solo en segundo plano.
ESPERA_AL_MOMENTO = 6
ESPERA_EN_SEGUNDO_PLANO = 20

# El identificador con el que el HTML llama a la imagen del QR.
CID_QR = "pase-qr"


class MailingService:
    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------- encolar
    def encolar(
        self,
        *,
        kind: EmailKind,
        reservation: Reservation,
        destino: Optional[str] = None,
    ) -> Optional[OutboxEmail]:
        """Deja el correo escrito en la bandeja. Todavía no sale."""
        destinatario = (destino or reservation.holder_email or "").strip()
        if not destinatario:
            return None

        practica = str(reservation.modality) == "PRACTICA"
        pagada = any(not p.is_voided for p in (reservation.payments or []))
        if kind == EmailKind.PASE:
            asunto = (
                f"{'Pase · Zona de práctica' if practica else 'Pase de la partida'}"
                f"{' · pagado' if pagada else ''} · {reservation.folio} · Las Parotas"
            )
        else:
            asunto = (
                f"Recibo de su {'visita' if practica else 'partida'} · "
                f"{reservation.folio} · Las Parotas"
            )

        correo = OutboxEmail(
            kind=kind,
            to_email=destinatario,
            subject=asunto,
            reservation_id=reservation.id,
            status=EmailStatus.PENDIENTE,
        )
        self.db.add(correo)
        self.db.flush()
        return correo

    def enviar_ahora(
        self,
        *,
        kind: EmailKind,
        reservation: Reservation,
        destino: Optional[str] = None,
    ) -> Optional[OutboxEmail]:
        """Lo encola y lo manda de inmediato, sin esperar al repartidor.

        Si la entrega falla, el correo se queda pendiente y el repartidor de
        segundo plano lo reintenta. Quien llamó no se entera del tropiezo: su
        reserva ya está hecha y eso es lo que importa.
        """
        correo = self.encolar(kind=kind, reservation=reservation, destino=destino)
        if correo is None:
            return None
        self.db.commit()
        try:
            # Espera corta a propósito: del otro lado hay una persona parada en
            # el mostrador. Si el proveedor no contesta en unos segundos, el
            # correo se queda pendiente y el repartidor lo saca después; nadie
            # se queda mirando la pantalla por un correo.
            self._intentar(correo, timeout=ESPERA_AL_MOMENTO)
        except Exception:  # pragma: no cover
            logger.exception("Falló el envío inmediato del correo %s", correo.id)
        return correo

    # ------------------------------------------------------------- consulta
    def pendientes(self, limite: int = 20) -> List[OutboxEmail]:
        stmt = (
            select(OutboxEmail)
            .where(
                OutboxEmail.status == EmailStatus.PENDIENTE,
                OutboxEmail.attempts < MAX_INTENTOS,
            )
            .order_by(OutboxEmail.id)
            .limit(limite)
        )
        return list(self.db.execute(stmt).scalars().all())

    def ultimos(self, limite: int = 50) -> List[OutboxEmail]:
        stmt = select(OutboxEmail).order_by(OutboxEmail.id.desc()).limit(limite)
        return list(self.db.execute(stmt).scalars().all())

    def de_la_reserva(self, reservation_id: int) -> List[OutboxEmail]:
        stmt = (
            select(OutboxEmail)
            .where(OutboxEmail.reservation_id == reservation_id)
            .order_by(OutboxEmail.id.desc())
        )
        return list(self.db.execute(stmt).scalars().all())

    # --------------------------------------------------------------- envío
    @staticmethod
    def configurado() -> bool:
        """¿Hay por dónde mandar? Sin esto, todo se queda en la bandeja."""
        if not settings.remitente:
            return False
        return bool(settings.RESEND_API_KEY or settings.SMTP_HOST)

    def _piezas(self, correo: OutboxEmail) -> tuple[str, str, Optional[bytes]]:
        """Texto, HTML y —si es el pase— la imagen del QR."""
        reservation = correo.reservation
        if correo.kind == EmailKind.PASE:
            texto, html = cuerpo_pase(reservation)
            qr = (
                generar_qr_png(reservation.qr_token)
                if reservation and reservation.qr_token
                else None
            )
            return texto, html, qr
        texto, html = cuerpo_recibo(reservation)
        return texto, html, None

    def cuerpo_resend(self, correo: OutboxEmail) -> dict:
        """El correo tal como lo recibe la API, ya listo para mandar.

        El QR va **dentro** del mensaje, no como liga a otro servidor: casi
        todos los clientes de correo bloquean las imágenes remotas y el pase se
        vería en blanco justo cuando hace falta. Va dos veces a propósito: una
        pegada al cuerpo para que se vea, y otra como archivo adjunto para
        quien lo quiera imprimir.
        """
        texto, html, qr = self._piezas(correo)

        cuerpo = {
            "from": f"{settings.MAIL_FROM_NAME} <{settings.remitente}>",
            "to": [correo.to_email],
            "subject": correo.subject,
            "text": texto,
            "html": html,
        }

        if qr:
            folio = correo.reservation.folio if correo.reservation else "pase"
            imagen = base64.b64encode(qr).decode("ascii")
            cuerpo["attachments"] = [
                # El nombre de las dos copias tiene que ser distinto o hay
                # clientes que enseñan una sola.
                {
                    "filename": "qr.png",
                    "content": imagen,
                    "content_type": "image/png",
                    "content_id": CID_QR,
                },
                {
                    "filename": f"pase-{folio}.png",
                    "content": imagen,
                    "content_type": "image/png",
                },
            ]

        return cuerpo

    def _entregar_por_https(self, correo: OutboxEmail, timeout: int) -> None:
        """Le entrega el correo a Resend por su API."""
        respuesta = httpx.post(
            RESEND_URL,
            json=self.cuerpo_resend(correo),
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            timeout=timeout,
        )
        if respuesta.status_code >= 400:
            # El detalle del proveedor es lo que dice si fue la dirección, la
            # llave o el dominio sin verificar. Sin él, el error no sirve.
            raise RuntimeError(f"Resend {respuesta.status_code}: {respuesta.text[:300]}")

    def _armar_mime(self, correo: OutboxEmail) -> EmailMessage:
        """El mismo correo en formato MIME, para la salida por SMTP."""
        texto, html, qr = self._piezas(correo)

        mensaje = EmailMessage()
        mensaje["Subject"] = correo.subject
        mensaje["From"] = f"{settings.MAIL_FROM_NAME} <{settings.remitente}>"
        mensaje["To"] = correo.to_email
        mensaje.set_content(texto)
        mensaje.add_alternative(html, subtype="html")

        if qr:
            folio = correo.reservation.folio if correo.reservation else "pase"
            parte_html = mensaje.get_payload()[1]
            parte_html.add_related(qr, maintype="image", subtype="png", cid=f"<{CID_QR}>")
            mensaje.add_attachment(
                qr, maintype="image", subtype="png", filename=f"pase-{folio}.png"
            )
        return mensaje

    def _entregar_por_smtp(self, correo: OutboxEmail, timeout: int) -> None:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=timeout) as servidor:
            if settings.SMTP_TLS:
                servidor.starttls()
            if settings.SMTP_USER:
                servidor.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            servidor.send_message(self._armar_mime(correo))

    def _entregar(self, correo: OutboxEmail, timeout: int) -> None:
        """Lo saca por donde haya. HTTPS primero, que es lo que funciona."""
        if settings.RESEND_API_KEY:
            self._entregar_por_https(correo, timeout)
        else:
            self._entregar_por_smtp(correo, timeout)

    def _intentar(self, correo: OutboxEmail, timeout: int = ESPERA_EN_SEGUNDO_PLANO) -> bool:
        """Un intento de entrega, con su resultado escrito. No lanza errores."""
        if not self.configurado():
            return False

        correo.attempts += 1
        try:
            self._entregar(correo, timeout)
            correo.status = EmailStatus.ENVIADO
            correo.sent_at = datetime.utcnow()
            correo.last_error = None
            self.db.commit()
            return True
        except Exception as exc:  # el detalle importa: queda escrito
            correo.last_error = str(exc)[:500]
            if correo.attempts >= MAX_INTENTOS:
                correo.status = EmailStatus.FALLIDO
            self.db.commit()
            logger.warning(
                "No se pudo enviar el correo %s a %s: %s",
                correo.id, correo.to_email, exc,
            )
            return False

    def procesar_pendientes(self, limite: int = 20) -> dict:
        """Intenta mandar lo que quedó en cola. Devuelve el resumen."""
        if not self.configurado():
            return {"enviados": 0, "fallidos": 0, "motivo": "sin servidor de correo"}

        enviados = fallidos = 0
        for correo in self.pendientes(limite):
            if self._intentar(correo):
                enviados += 1
            else:
                fallidos += 1
        return {"enviados": enviados, "fallidos": fallidos}

    def reintentar(self, correo_id: int) -> OutboxEmail:
        """Devuelve un correo fallido a la cola, con los intentos en cero."""
        from app.core.exceptions import NotFoundError

        correo = self.db.get(OutboxEmail, correo_id)
        if not correo:
            raise NotFoundError(f"Correo {correo_id} no encontrado")
        correo.status = EmailStatus.PENDIENTE
        correo.attempts = 0
        correo.last_error = None
        self.db.commit()
        return correo
