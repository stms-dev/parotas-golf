"""El cobro con tarjeta, a través de Stripe.

Se usa **Checkout alojado**: el huésped se va a la página de Stripe, teclea su
tarjeta ahí y vuelve. Es una decisión deliberada frente a cobrar dentro del
sitio, y la razón es que ningún número de tarjeta pasa jamás por el servidor
del club. Eso saca al club de casi toda la carga de cumplimiento de PCI, y de
pilón Stripe resuelve solo la autenticación del banco (3-D Secure), los
monederos del celular y los mensajes de error en el idioma del visitante.

Lo que se paga a cambio es un brinco a otro dominio a mitad del flujo. Vale la
pena: el día que se quiera el formulario dentro del sitio, se cambia a Payment
Element sin mover nada de lo que está debajo.

Tres reglas que no se negocian, porque aquí se mueve dinero de verdad:

1. **El monto sale del servidor, nunca del navegador.** Se lee de la reserva.
   Si viniera del cliente, cualquiera pagaría un peso por una partida.
2. **El webhook manda, no el regreso del navegador.** Que el huésped vuelva a
   la página de "listo" no prueba nada: esa dirección se puede teclear. Lo que
   confirma la reserva es el aviso firmado de Stripe.
3. **La firma se verifica siempre.** Sin eso, cualquiera podría avisar que
   pagó mandando un JSON.
"""
from decimal import Decimal
from typing import Optional

import stripe

from app.core.config import settings
from app.core.exceptions import BusinessRuleError

# Stripe cobra en la unidad mínima: centavos para los pesos.
CENTAVOS = Decimal("100")


def disponible() -> bool:
    """¿Hay llave de Stripe configurada?"""
    return bool(settings.STRIPE_SECRET_KEY)


def _cliente():
    if not disponible():
        raise BusinessRuleError(
            "El cobro en línea todavía no está configurado. Comuníquese con "
            "el club para confirmar su salida."
        )
    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


def en_centavos(monto: Decimal) -> int:
    return int((Decimal(monto) * CENTAVOS).quantize(Decimal("1")))


def crear_sesion(
    *,
    folio: str,
    total: Decimal,
    descripcion: str,
    correo: Optional[str],
    vence_en: int,
) -> dict:
    """Abre la página de pago de Stripe para una reserva ya apartada.

    `vence_en` es la marca de tiempo en segundos a la que la sesión caduca. Se
    hace coincidir con el apartado de la salida: si la sesión durara más,
    alguien podría pagar un horario que ya se devolvió a la venta.
    """
    s = _cliente()
    sesion = s.checkout.Session.create(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": "mxn",
                    "product_data": {
                        "name": f"Green fee · {folio}",
                        "description": descripcion,
                    },
                    # El monto, en centavos, calculado por el servidor.
                    "unit_amount": en_centavos(total),
                },
                "quantity": 1,
            }
        ],
        # El folio viaja con el pago. Es lo que permite saber, cuando Stripe
        # avisa, cuál reserva confirmar.
        metadata={"folio": folio},
        payment_intent_data={"metadata": {"folio": folio}},
        customer_email=correo or None,
        expires_at=vence_en,
        locale="es",
        success_url=f"{settings.SITIO_URL}/?reserva={folio}&pago=listo",
        cancel_url=f"{settings.SITIO_URL}/?reserva={folio}&pago=cancelado",
    )
    return {"id": sesion.id, "url": sesion.url}


def leer_evento(cuerpo: bytes, firma: str):
    """Comprueba que el aviso viene de Stripe y lo devuelve.

    Si la firma no cuadra, se rechaza sin mirar el contenido.
    """
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise BusinessRuleError(
            "Falta la firma del webhook de Stripe. Sin ella no se confirma "
            "ningún pago."
        )
    try:
        return stripe.Webhook.construct_event(
            cuerpo, firma, settings.STRIPE_WEBHOOK_SECRET
        )
    except (ValueError, stripe.error.SignatureVerificationError) as error:
        raise BusinessRuleError("Aviso de pago no verificable") from error


def devolver(payment_intent: str, motivo: str = "requested_by_customer") -> Optional[str]:
    """Regresa el dinero de un cobro.

    Se usa en el caso feo: el pago entró justo cuando el apartado ya había
    vencido y la salida se revendió. Devolver es mejor que quedarse con el
    dinero de una partida que el huésped no va a poder jugar.
    """
    s = _cliente()
    devolucion = s.Refund.create(payment_intent=payment_intent, reason=motivo)
    return devolucion.id
