"""Cobro simulado con tarjeta.

Mientras el club decide entre Stripe y Mercado Pago, el sitio necesita poder
cobrar para que el flujo completo se pueda ver y probar. Esto hace de pasarela:
valida la tarjeta como lo haría una de verdad y responde aprobado o rechazado.

**No cobra nada.** Ningún dato de tarjeta se guarda: de la validación solo
sobreviven la marca y los últimos cuatro dígitos, que es lo mismo que deja un
cobro real en el recibo.

Cuando entre la pasarela de verdad, lo que se reemplaza es este archivo. La
forma de la respuesta —`aprobado`, `motivo`, `referencia`, `marca`,
`ultimos4`— se eligió para que calce con lo que devuelven Stripe y Mercado
Pago, y el resto del sistema no se entere del cambio.
"""
from dataclasses import dataclass
from datetime import date
from typing import Optional
import secrets


@dataclass(frozen=True)
class Resultado:
    aprobado: bool
    motivo: Optional[str] = None
    referencia: Optional[str] = None
    marca: Optional[str] = None
    ultimos4: Optional[str] = None


# Tarjetas de prueba. Son las mismas que publica Stripe, a propósito: así el
# día que se conecte la pasarela de verdad, quien pruebe no tiene que
# aprenderse otros números.
TARJETAS_DE_PRUEBA = {
    "4242424242424242": None,                       # aprobada
    "5555555555554444": None,                       # aprobada (Mastercard)
    "4000000000000002": "La tarjeta fue rechazada por el banco.",
    "4000000000009995": "Fondos insuficientes.",
    "4000000000000069": "La tarjeta está vencida.",
    "4000000000000127": "El código de seguridad no coincide.",
}

MARCAS = (
    ("VISA", ("4",), (13, 16, 19), 3),
    ("MASTERCARD", ("51", "52", "53", "54", "55", "22", "23", "24", "25", "26", "27"), (16,), 3),
    ("AMEX", ("34", "37"), (15,), 4),
)


def _solo_digitos(valor: str) -> str:
    return "".join(c for c in (valor or "") if c.isdigit())


def luhn(numero: str) -> bool:
    """El dígito verificador que traen todas las tarjetas.

    No comprueba que la tarjeta exista —eso solo lo sabe el banco—, pero
    atrapa el dedazo, que es el 99% de los errores en un formulario.
    """
    if not numero.isdigit() or len(numero) < 12:
        return False
    suma = 0
    for i, c in enumerate(reversed(numero)):
        d = int(c)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        suma += d
    return suma % 10 == 0


def marca_de(numero: str):
    """Marca, largos válidos y largo del código de seguridad."""
    for nombre, prefijos, largos, cvv in MARCAS:
        if numero.startswith(prefijos):
            return nombre, largos, cvv
    return None, (), 3


def cobrar(
    *,
    numero: str,
    mes: int,
    anio: int,
    cvv: str,
    nombre: str,
    hoy: Optional[date] = None,
) -> Resultado:
    """Valida la tarjeta y responde como lo haría una pasarela."""
    hoy = hoy or date.today()
    limpio = _solo_digitos(numero)

    if not (nombre or "").strip():
        return Resultado(False, "Falta el nombre como aparece en la tarjeta.")

    if not limpio:
        return Resultado(False, "Falta el número de la tarjeta.")

    marca, largos, cvv_largo = marca_de(limpio)
    if marca is None:
        return Resultado(False, "No reconocemos esa tarjeta. Use Visa, Mastercard o American Express.")
    if len(limpio) not in largos:
        return Resultado(False, f"Al número le faltan o le sobran dígitos para una {marca.title()}.")
    if not luhn(limpio):
        return Resultado(False, "El número de la tarjeta no es válido. Revíselo.")

    if not 1 <= mes <= 12:
        return Resultado(False, "El mes de vencimiento no existe.")
    anio = anio + 2000 if anio < 100 else anio
    # Una tarjeta vale hasta el último día de su mes.
    vencida = (anio, mes) < (hoy.year, hoy.month)
    if vencida:
        return Resultado(False, "La tarjeta está vencida.")

    if not _solo_digitos(cvv) or len(_solo_digitos(cvv)) != cvv_largo:
        return Resultado(
            False, f"El código de seguridad de una {marca.title()} es de {cvv_largo} dígitos."
        )

    ultimos4 = limpio[-4:]

    # Las tarjetas de prueba mandan sobre todo lo demás: así se puede ensayar
    # un rechazo sin tener que inventar un número inválido.
    if limpio in TARJETAS_DE_PRUEBA:
        motivo = TARJETAS_DE_PRUEBA[limpio]
        if motivo:
            return Resultado(False, motivo, marca=marca, ultimos4=ultimos4)

    return Resultado(
        True,
        referencia=f"SIM-{secrets.token_hex(5).upper()}",
        marca=marca,
        ultimos4=ultimos4,
    )
