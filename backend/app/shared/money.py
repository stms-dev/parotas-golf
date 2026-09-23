"""Tipo de dinero con decimales exactos.

El problema: SQLite no tiene un tipo DECIMAL real. Si se guarda dinero como
float, `0.1 + 0.2` da `0.30000000000000004` y el arqueo termina con diferencias
de centavos que nadie puede explicar.

La solución: `Decimal` de Python en todo el código, y en la base de datos
`Numeric(12, 2)`. En PostgreSQL eso es `NUMERIC` nativo (exacto). En SQLite se
guarda como texto y se regresa como `Decimal`, gracias al TypeDecorator de
abajo. En ambos casos la aritmética ocurre en Python con precisión exacta.
"""
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from sqlalchemy import Numeric, String
from sqlalchemy.types import TypeDecorator

CENTAVO = Decimal("0.01")
ZERO = Decimal("0.00")


def money(value) -> Decimal:
    """Convierte cualquier entrada a Decimal con 2 decimales exactos.

    Nunca se pasa un float directo a Decimal: se convierte a str primero,
    porque Decimal(0.1) arrastra el error binario del float.
    """
    if value is None:
        return ZERO
    if isinstance(value, Decimal):
        d = value
    else:
        d = Decimal(str(value))
    return d.quantize(CENTAVO, rounding=ROUND_HALF_UP)


def rate(value) -> Decimal:
    """Tipo de cambio y porcentajes: 4 decimales."""
    if value is None:
        return Decimal("0.0000")
    d = value if isinstance(value, Decimal) else Decimal(str(value))
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def apply_percentage(base: Decimal, percentage: Decimal) -> Decimal:
    """Aplica un porcentaje sobre un monto y redondea a centavo."""
    return money(money(base) * rate(percentage) / Decimal("100"))


def to_mxn(amount: Decimal, currency: str, exchange_rate: Decimal) -> Decimal:
    """Convierte un monto a MXN usando el tipo de cambio dado.

    El tipo de cambio se recibe como parámetro a propósito: siempre es el que
    se guardó en la operación, nunca el vigente hoy.
    """
    if currency == "MXN":
        return money(amount)
    return money(money(amount) * rate(exchange_rate))


class DecimalMoney(TypeDecorator):
    """Columna de dinero. Decimal exacto en cualquier motor."""

    impl = Numeric(12, 2)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "sqlite":
            return dialect.type_descriptor(String(20))
        return dialect.type_descriptor(Numeric(12, 2))

    def process_bind_param(self, value, dialect) -> Optional[str]:
        if value is None:
            return None
        d = money(value)
        return str(d) if dialect.name == "sqlite" else d

    def process_result_value(self, value, dialect) -> Optional[Decimal]:
        if value is None:
            return None
        return money(value)


class DecimalRate(TypeDecorator):
    """Columna de tipo de cambio o porcentaje. 4 decimales exactos."""

    impl = Numeric(10, 4)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "sqlite":
            return dialect.type_descriptor(String(20))
        return dialect.type_descriptor(Numeric(10, 4))

    def process_bind_param(self, value, dialect) -> Optional[str]:
        if value is None:
            return None
        d = rate(value)
        return str(d) if dialect.name == "sqlite" else d

    def process_result_value(self, value, dialect) -> Optional[Decimal]:
        if value is None:
            return None
        return rate(value)
