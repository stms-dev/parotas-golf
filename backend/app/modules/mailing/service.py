"""Envío de correos del club: el pase de la partida y el recibo del cobro.

Dos reglas mandan aquí:

1. **Un correo nunca frena la operación.** El concierge no puede quedarse
   mirando la pantalla porque Gmail tardó; ni perder una reserva porque el
   SMTP estaba caído. Todo se encola en la bandeja de salida y sale después,
   en segundo plano.
2. **Nada se pierde en silencio.** Cada intento queda escrito con su error.
   Si algo no llegó, se ve y se reenvía.
"""
from __future__ import annotations

import logging
import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import List, Optional

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
        """Deja el correo listo para salir. No lo manda todavía."""
        destinatario = (destino or reservation.holder_email or "").strip()
        if not destinatario:
            return None

        asunto = (
            f"Pase de la partida · {reservation.folio} · Las Parotas"
            if kind == EmailKind.PASE
            else f"Recibo de su partida · {reservation.folio} · Las Parotas"
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
        """¿Hay servidor de correo puesto? Sin esto, todo se queda encolado."""
        return bool(settings.SMTP_HOST and settings.SMTP_FROM)

    def _armar(self, correo: OutboxEmail) -> EmailMessage:
        reservation = correo.reservation
        mensaje = EmailMessage()
        mensaje["Subject"] = correo.subject
        mensaje["From"] = f"Las Parotas Club de Golf <{settings.SMTP_FROM}>"
        mensaje["To"] = correo.to_email

        if correo.kind == EmailKind.PASE:
            texto, html = cuerpo_pase(reservation)
        else:
            texto, html = cuerpo_recibo(reservation)

        mensaje.set_content(texto)
        mensaje.add_alternative(html, subtype="html")

        # El QR va pegado al correo, no como liga a otro servidor: casi todos
        # los clientes de correo bloquean imágenes remotas y el pase se vería
        # en blanco justo cuando hace falta.
        if correo.kind == EmailKind.PASE and reservation and reservation.qr_token:
            imagen = generar_qr_png(reservation.qr_token)
            parte_html = mensaje.get_payload()[1]
            parte_html.add_related(
                imagen, maintype="image", subtype="png", cid="<pase-qr>"
            )
            mensaje.add_attachment(
                imagen,
                maintype="image",
                subtype="png",
                filename=f"pase-{reservation.folio}.png",
            )

        return mensaje

    def _entregar(self, mensaje: EmailMessage) -> None:
        """Habla con el servidor de correo. Es lo único que sale a la red."""
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as servidor:
            if settings.SMTP_TLS:
                servidor.starttls()
            if settings.SMTP_USER:
                servidor.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            servidor.send_message(mensaje)

    def procesar_pendientes(self, limite: int = 20) -> dict:
        """Intenta mandar lo que está en cola. Devuelve el resumen."""
        if not self.configurado():
            return {"enviados": 0, "fallidos": 0, "motivo": "sin servidor de correo"}

        enviados = fallidos = 0
        for correo in self.pendientes(limite):
            correo.attempts += 1
            try:
                self._entregar(self._armar(correo))
                correo.status = EmailStatus.ENVIADO
                correo.sent_at = datetime.utcnow()
                correo.last_error = None
                enviados += 1
            except Exception as exc:  # el detalle importa: queda escrito
                correo.last_error = str(exc)[:500]
                if correo.attempts >= MAX_INTENTOS:
                    correo.status = EmailStatus.FALLIDO
                fallidos += 1
                logger.warning(
                    "No se pudo enviar el correo %s a %s: %s",
                    correo.id, correo.to_email, exc,
                )
            self.db.commit()

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
