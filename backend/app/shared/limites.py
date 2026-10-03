"""Topes de intentos, para lo que está abierto al mundo.

Dos puertas dan a la calle: el acceso al sistema y las rutas que usa el sitio
para reservar. Las dos se pueden aporrear desde un script, y las dos necesitan
un freno.

El contador vive en memoria a propósito. Es una **contención**, no una
cerradura: frena al que está probando contraseñas a mano o con un script
simple, y se olvida de todo si el servidor se reinicia. Lo que detiene a un
atacante decidido es otra cosa —un captcha delante del formulario, o un
servicio de reputación de IP—, y eso se pone cuando haga falta. Guardar los
intentos en la base para que sobrevivan al reinicio tampoco serviría de
mucho: quien quiere entrar a la fuerza cambia de dirección antes.
"""
from collections import defaultdict
from datetime import datetime, timedelta
from threading import Lock
from typing import Dict, List

_intentos: Dict[str, List[datetime]] = defaultdict(list)
# El servidor atiende varias peticiones a la vez; sin esto, dos intentos
# simultáneos pueden leer la misma lista y pasar los dos.
_candado = Lock()


def registrar(clave: str, *, ventana_minutos: int) -> int:
    """Anota un intento y devuelve cuántos van en la ventana."""
    ahora = datetime.utcnow()
    desde = ahora - timedelta(minutes=ventana_minutos)
    with _candado:
        _intentos[clave] = [t for t in _intentos[clave] if t > desde]
        _intentos[clave].append(ahora)
        return len(_intentos[clave])


def cuantos(clave: str, *, ventana_minutos: int) -> int:
    """Cuántos intentos lleva esa clave, sin anotar uno nuevo."""
    desde = datetime.utcnow() - timedelta(minutes=ventana_minutos)
    with _candado:
        _intentos[clave] = [t for t in _intentos[clave] if t > desde]
        return len(_intentos[clave])


def limpiar(clave: str) -> None:
    """Borra el historial de una clave.

    Se llama cuando el intento salió bien: a quien ya entró no se le cuentan
    los tropiezos de antes.
    """
    with _candado:
        _intentos.pop(clave, None)


def olvidar_todo() -> None:
    """Para las pruebas, que necesitan empezar de cero cada vez."""
    with _candado:
        _intentos.clear()
