"""Máquina de estados de la reserva.

Las transiciones viven en un solo lugar. Ningún servicio cambia
`reservation.status` a mano: todos pasan por aquí.
"""
from typing import Dict, Set

from app.core.exceptions import BusinessRuleError
from app.shared.enums import ReservationStatus as S

TRANSITIONS: Dict[S, Set[S]] = {
    # Una solicitud del hotel a la que nadie llegó también se cierra como
    # no presentada: no tiene que pasar por confirmada para eso.
    S.PENDIENTE: {S.CONFIRMADA, S.CANCELADA, S.NO_SHOW},
    S.CONFIRMADA: {S.CHECK_IN, S.CANCELADA, S.NO_SHOW},
    S.CHECK_IN: {S.EN_JUEGO, S.CANCELADA},
    # Una partida en juego se termina, o se interrumpe si el campo se suspende.
    S.EN_JUEGO: {S.COMPLETADA, S.INTERRUMPIDA},
    # Interrumpida se cierra cuando el campo da por concluido el asunto. No
    # vuelve a EN_JUEGO: la ronda que se les repone es otra reserva, con su
    # propio folio y su propia salida.
    S.INTERRUMPIDA: {S.COMPLETADA, S.CANCELADA},
    S.COMPLETADA: set(),
    S.CANCELADA: set(),
    S.NO_SHOW: set(),
}

# Estados que mantienen el cupo tomado en la franja. Interrumpida entra: esa
# salida se jugó, aunque a medias, y no se puede volver a vender.
OCCUPYING_STATES = {
    S.PENDIENTE, S.CONFIRMADA, S.CHECK_IN, S.EN_JUEGO, S.COMPLETADA, S.INTERRUMPIDA,
}


def can_transition(current: S, target: S) -> bool:
    return target in TRANSITIONS.get(current, set())


def assert_transition(current: S, target: S) -> None:
    if not can_transition(current, target):
        allowed = ", ".join(sorted(TRANSITIONS.get(current, set()))) or "ninguno"
        raise BusinessRuleError(
            f"No se puede pasar de {current} a {target}. Transiciones válidas: {allowed}"
        )


def releases_slot(target: S) -> bool:
    """¿Esta transición libera el cupo de la franja?"""
    return target in {S.CANCELADA, S.NO_SHOW}


# --------------------------------------------------------------- vista hotel
# El hotel solo conoce cuatro estados. Todo lo que pasa en el mostrador antes
# de pagar sigue siendo "pendiente" para él, y desde que se paga es
# "confirmada" aunque el campo la lleve después a en juego o finalizada.
_ESTADO_HOTEL = {
    S.PENDIENTE: S.PENDIENTE,
    S.CONFIRMADA: S.PENDIENTE,
    S.CHECK_IN: S.PENDIENTE,
    S.EN_JUEGO: S.CONFIRMADA,
    # Para el hotel su reserva se cumplió: el huésped llegó y jugó. Que el campo
    # se haya suspendido y le repongan la ronda es asunto del campo.
    S.INTERRUMPIDA: S.CONFIRMADA,
    S.COMPLETADA: S.CONFIRMADA,
    S.CANCELADA: S.CANCELADA,
    S.NO_SHOW: S.NO_SHOW,
}


def estado_para_hotel(status) -> S:
    return _ESTADO_HOTEL[S(status)]


def estados_internos_para_hotel(visible) -> list:
    """Al revés: qué estados reales caben en lo que el hotel filtra."""
    visible = S(visible)
    return [real for real, vista in _ESTADO_HOTEL.items() if vista == visible]
