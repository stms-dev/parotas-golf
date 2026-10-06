"""Enumeraciones del dominio. Una sola fuente de verdad."""
from enum import Enum


class UserRole(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ADMIN_OPERACIONES = "ADMIN_OPERACIONES"
    RECEPCION = "RECEPCION"
    HOTEL = "HOTEL"


class ReservationStatus(str, Enum):
    """Estados de reserva.

    VALIDATED y CONFIRMED del README se colapsaron en CONFIRMADA: no había un
    paso operativo real entre ambos.
    """

    PENDIENTE = "PENDIENTE"
    CONFIRMADA = "CONFIRMADA"
    CHECK_IN = "CHECK_IN"
    EN_JUEGO = "EN_JUEGO"
    COMPLETADA = "COMPLETADA"
    CANCELADA = "CANCELADA"
    NO_SHOW = "NO_SHOW"
    # La partida salió pero no se pudo terminar: llovió, cayó tormenta, el
    # campo se suspendió. No es una cancelación —ya jugaron y ya pagaron— ni
    # una partida completada. Queda aparte para poder reponerles la ronda.
    INTERRUMPIDA = "INTERRUMPIDA"


class BookingModality(str, Enum):
    """Los tres paquetes del club.

    Una salida la toma una sola partida: no se juntan dos grupos que no se
    conocen en el mismo tee time. La partida abierta es la excepción, y existe
    justamente para emparejar jugadores de distintos hoteles.
    """

    INDIVIDUAL = "INDIVIDUAL"
    GRUPO = "GRUPO"
    PARTIDA_ABIERTA = "PARTIDA_ABIERTA"


class HolesOption(int, Enum):
    NUEVE = 9
    DIECIOCHO = 18


class PlayerCategory(str, Enum):
    ADULTO = "ADULTO"
    INFANTIL = "INFANTIL"
    # Vive en Huatulco: lo acredita enseñando su credencial en el mostrador.
    # Solo tiene precio en 18 hoyos entre semana; fuera de eso paga adulto.
    LOCAL = "LOCAL"


# Hasta qué edad un jugador paga tarifa junior (incluida esa edad).
EDAD_JR_MAX = 16


def es_junior(edad) -> bool:
    return edad is not None and edad <= EDAD_JR_MAX


class DayType(str, Enum):
    """Qué días aplica una tarifa.

    El campo cobra distinto de lunes a jueves que de viernes a domingo. Una
    tarifa marcada TODOS vale cualquier día y sirve de respaldo cuando no hay
    una específica para el día de la salida.
    """

    TODOS = "TODOS"
    ENTRE_SEMANA = "ENTRE_SEMANA"    # lunes a jueves
    FIN_DE_SEMANA = "FIN_DE_SEMANA"  # viernes a domingo

    @classmethod
    def del_dia(cls, dia) -> "DayType":
        # weekday(): lunes = 0 … domingo = 6. Viernes (4) ya es fin de semana.
        return cls.FIN_DE_SEMANA if dia.weekday() >= 4 else cls.ENTRE_SEMANA


class TimeBand(str, Enum):
    """A qué horario aplica una tarifa.

    Las últimas salidas del día no alcanzan a terminar 18 hoyos, así que se
    venden más baratas. Una tarifa TODAS vale a cualquier hora y es el respaldo
    cuando no hay una de twilight dada de alta — así el campo puede empezar a
    vender el horario antes de haber decidido su precio.
    """

    TODAS = "TODAS"
    TWILIGHT = "TWILIGHT"


class SlotStatus(str, Enum):
    """Estado de una salida.

    ABIERTA es una partida abierta que aún admite jugadores; para efectos de
    una reserva normal cuenta como ocupada.
    """

    DISPONIBLE = "DISPONIBLE"
    ABIERTA = "ABIERTA"
    OCUPADO = "OCUPADO"
    BLOQUEADO = "BLOQUEADO"


class PaymentMethod(str, Enum):
    EFECTIVO = "EFECTIVO"
    TARJETA = "TARJETA"
    TRANSFERENCIA = "TRANSFERENCIA"


class Currency(str, Enum):
    MXN = "MXN"
    USD = "USD"


class InvoiceStatus(str, Enum):
    NO_REQUERIDA = "NO_REQUERIDA"
    SOLICITADA = "SOLICITADA"
    EN_PROCESO = "EN_PROCESO"
    FACTURADA = "FACTURADA"
    ERROR = "ERROR"


class DiscountType(str, Enum):
    PORCENTAJE = "PORCENTAJE"
    MONTO = "MONTO"


class CashSessionStatus(str, Enum):
    ABIERTA = "ABIERTA"
    CERRADA = "CERRADA"
    CON_DIFERENCIA = "CON_DIFERENCIA"


class SettlementStatus(str, Enum):
    PENDIENTE = "PENDIENTE"
    LIQUIDADO = "LIQUIDADO"
    CANCELADO = "CANCELADO"


class EventType(str, Enum):
    TORNEO = "TORNEO"
    EVENTO_CORPORATIVO = "EVENTO_CORPORATIVO"
    EVENTO_ESPECIAL = "EVENTO_ESPECIAL"
    MANTENIMIENTO = "MANTENIMIENTO"
    BLOQUEO_TECNICO = "BLOQUEO_TECNICO"


class AuditAction(str, Enum):
    CREAR = "CREAR"
    MODIFICAR = "MODIFICAR"
    ELIMINAR = "ELIMINAR"
    CONFIRMAR = "CONFIRMAR"
    CANCELAR = "CANCELAR"
    CHECK_IN = "CHECK_IN"
    PAGO = "PAGO"
    CIERRE_CAJA = "CIERRE_CAJA"
    VALIDAR_PGA = "VALIDAR_PGA"
    LOGIN = "LOGIN"


class ServiceUnit(str, Enum):
    POR_RONDA = "POR_RONDA"
    POR_PERSONA = "POR_PERSONA"
    POR_TRAYECTO = "POR_TRAYECTO"
    POR_UNIDAD = "POR_UNIDAD"


class EmailKind(str, Enum):
    """Qué correo es. Uno por documento que el club entrega."""

    PASE = "PASE"
    RECIBO = "RECIBO"


class EmailStatus(str, Enum):
    PENDIENTE = "PENDIENTE"
    ENVIADO = "ENVIADO"
    FALLIDO = "FALLIDO"
