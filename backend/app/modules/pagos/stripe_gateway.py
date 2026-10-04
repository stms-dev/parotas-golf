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
import logging
from decimal import Decimal
from typing import Optional

import stripe

from app.core.config import settings
from app.core.exceptions import BusinessRuleError

logger = logging.getLogger(__name__)

# Stripe cobra en la unidad mínima: centavos para los pesos.
CENTAVOS = Decimal("100")

# Las llaves de Stripe se distinguen por el prefijo:
#   sk_ / rk_  secreta — la que va en el servidor
#   pk_        publicable — la que va en el navegador, NO sirve para cobrar
# El error clásico al configurar es copiar la publicable, porque en el panel de
# Stripe las dos están una junto a la otra. Con la publicable puesta, todo
# parece bien hasta que alguien le da a pagar: Stripe contesta 401 y la reserva
# muere sin decir por qué.
PREFIJOS_SECRETOS = ("sk_", "rk_")


def disponible() -> bool:
    """¿Hay llave de Stripe configurada?"""
    return bool(settings.STRIPE_SECRET_KEY)


def problema_de_configuracion() -> Optional[str]:
    """Lo que está mal puesto, si algo lo está. None cuando todo cuadra.

    Se revisa al arrancar y antes de cada cobro. Vale la pena repetirlo: un
    error de configuración que solo se nota cuando un huésped intenta pagar es
    un error que se descubre tarde y con dinero de por medio.
    """
    llave = (settings.STRIPE_SECRET_KEY or "").strip()
    if not llave:
        return None  # no configurado no es lo mismo que mal configurado

    if llave.startswith("pk_"):
        return (
            "STRIPE_SECRET_KEY trae la llave publicable (pk_…). La que va en "
            "el servidor es la secreta, que empieza con sk_ — en el panel de "
            "Stripe está escondida detrás de «Revelar»."
        )
    if not llave.startswith(PREFIJOS_SECRETOS):
        return (
            "STRIPE_SECRET_KEY no parece una llave de Stripe: las secretas "
            "empiezan con sk_ o rk_. Revise que no se haya copiado de más."
        )
    if llave != settings.STRIPE_SECRET_KEY:
        return (
            "STRIPE_SECRET_KEY trae espacios al principio o al final. Vuelva "
            "a pegarla sin ellos."
        )

    sitio = settings.SITIO_URL or ""
    if not sitio.startswith(("http://", "https://")):
        return (
            f"SITIO_URL vale «{sitio}» y Stripe exige una dirección completa: "
            "tiene que empezar con https://"
        )
    return None


def resumen() -> str:
    """Una línea para la bitácora del arranque. Sin secretos: del prefijo de la
    llave se sabe si es de prueba o real, y eso es todo lo que hace falta."""
    if not disponible():
        return "Cobro en línea: apagado (sin STRIPE_SECRET_KEY)"
    llave = (settings.STRIPE_SECRET_KEY or "").strip()
    modo = "prueba" if "_test_" in llave else "REAL"
    firma = "sí" if settings.STRIPE_WEBHOOK_SECRET else "NO — no se confirmará ningún pago"
    return (
        f"Cobro en línea: Stripe en modo {modo} ({llave[:7]}…) · "
        f"firma del webhook: {firma} · se vuelve a {settings.SITIO_URL}"
    )


def _cliente():
    if not disponible():
        raise BusinessRuleError(
            "El cobro en línea todavía no está configurado. Comuníquese con "
            "el club para confirmar su salida."
        )
    mal = problema_de_configuracion()
    if mal:
        # Al huésped se le dice que llame; el motivo de verdad va a la
        # bitácora, que es donde lo va a leer quien pueda arreglarlo.
        logger.error("Stripe mal configurado: %s", mal)
        raise BusinessRuleError(
            "El cobro en línea no está disponible en este momento. "
            "Comuníquese con el club para confirmar su salida."
        )
    stripe.api_key = settings.STRIPE_SECRET_KEY.strip()
    return stripe


def _traducir(error: Exception, haciendo: str) -> BusinessRuleError:
    """Convierte una queja de Stripe en algo que alguien pueda leer.

    Antes, cualquier error de Stripe subía sin tocar y salía como un 500 pelón:
    el huésped veía una pantalla rota, el log no decía nada y no había manera
    de saber si era la llave, la dirección de regreso o la red. Ahora el motivo
    exacto queda escrito y el visitante recibe una frase que sí le sirve.
    """
    # `exc_info=error` en vez de `logger.exception`: así la traza sale
    # completa aunque esto se llame fuera de un `except`.
    logger.error("Stripe falló al %s", haciendo, exc_info=error)

    if isinstance(error, stripe.error.AuthenticationError):
        logger.error(
            "Stripe rechazó la llave. Revise STRIPE_SECRET_KEY: tiene que ser "
            "la secreta (sk_…) de la misma cuenta donde está dado de alta el "
            "webhook, y del mismo modo (prueba o real)."
        )
    elif isinstance(error, stripe.error.APIConnectionError):
        logger.error("No se pudo salir a Stripe desde el servidor: %s", error)

    detalle = getattr(error, "user_message", None) or str(error)
    return BusinessRuleError(
        "No pudimos abrir la página de pago. Su salida sigue apartada; "
        "inténtelo de nuevo o llámenos y la confirmamos por teléfono.",
        detail=detalle,
    )


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
    # Sin la diagonal del final: con ella la dirección saldría con dos, y
    # aunque el navegador la aguanta, se ve a descuido en la barra.
    sitio = settings.SITIO_URL.rstrip("/")
    try:
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
            success_url=f"{sitio}/?reserva={folio}&pago=listo",
            cancel_url=f"{sitio}/?reserva={folio}&pago=cancelado",
        )
    except stripe.error.StripeError as error:
        raise _traducir(error, f"abrir la página de pago de {folio}") from error
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
    try:
        devolucion = s.Refund.create(payment_intent=payment_intent, reason=motivo)
    except stripe.error.StripeError as error:
        # Aquí ya hay dinero cobrado: si la devolución falla, lo que no se
        # puede es quedarse callado. Queda escrito con el intento de pago para
        # poder devolverlo a mano desde el panel de Stripe.
        logger.error(
            "NO SE PUDO DEVOLVER el pago %s: %s. Devuélvalo a mano en "
            "dashboard.stripe.com.", payment_intent, error,
        )
        raise _traducir(error, f"devolver el pago {payment_intent}") from error
    return devolucion.id
