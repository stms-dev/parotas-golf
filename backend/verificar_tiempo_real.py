"""Verificación del canal de tiempo real.

Levanta la API, conecta dos terminales por WebSocket (un hotel y recepción) y
comprueba que los avisos llegan a quien corresponde y no a quien no.

    python verificar_tiempo_real.py
"""
import json
import threading
import time
from datetime import date, timedelta

import httpx
import uvicorn
from websockets.sync.client import connect

BASE = "http://127.0.0.1:8901"
WS = "ws://127.0.0.1:8901/api/ws"
FALLOS = []


def check(label: str, condition: bool, extra: str = ""):
    marca = "✓" if condition else "✗"
    print(f"  {marca} {label}" + (f" · {extra}" if extra else ""))
    if not condition:
        FALLOS.append(label)


class Terminal:
    """Una pantalla conectada, escuchando en segundo plano."""

    def __init__(self, nombre: str, token: str):
        self.nombre = nombre
        self.recibidos = []
        self.ws = connect(f"{WS}?token={token}")
        self._activo = True
        self._hilo = threading.Thread(target=self._escuchar, daemon=True)
        self._hilo.start()

    def _escuchar(self):
        while self._activo:
            try:
                mensaje = json.loads(self.ws.recv(timeout=1))
                self.recibidos.append(mensaje)
            except Exception:
                if not self._activo:
                    return

    def tipos(self):
        return [m["type"] for m in self.recibidos]

    def buscar(self, tipo):
        return [m for m in self.recibidos if m["type"] == tipo]

    def cerrar(self):
        self._activo = False
        try:
            self.ws.close()
        except Exception:
            pass


def login(client, email):
    response = client.post(
        "/api/auth/login", json={"email": email, "password": "Reserva2026*"}
    )
    response.raise_for_status()
    return response.json()["access_token"]


def hora_de_corte(valor=None):
    """Lee, y de paso cambia, la hora en que la caja deja de admitir cobros.

    De noche la caja cierra —y con razón—, pero esta prueba necesita cobrar para
    ver si el aviso del check-in llega. Se levanta el corte mientras corre y se
    repone al final, para no dejar la configuración alterada.
    """
    # app.models registra todos los modelos de una vez. Importar solo el del
    # catálogo dejaría relaciones apuntando a clases que aún no existen.
    import app.models  # noqa: F401
    from app.core.database import SessionLocal
    from app.modules.catalog.models import SystemSetting
    from sqlalchemy import select

    with SessionLocal() as db:
        fila = db.execute(
            select(SystemSetting).where(SystemSetting.key == "cash_cutoff_hour")
        ).scalars().first()
        if fila is None:
            return None
        anterior = fila.value
        if valor is not None:
            fila.value = valor
            db.commit()
        return anterior


def main():
    corte_original = hora_de_corte("25")   # ninguna hora del día lo alcanza
    servidor = uvicorn.Server(
        uvicorn.Config("app.main:app", host="127.0.0.1", port=8901, log_level="error")
    )
    hilo = threading.Thread(target=servidor.run, daemon=True)
    hilo.start()

    for _ in range(50):
        time.sleep(0.2)
        try:
            httpx.get(f"{BASE}/health", timeout=1)
            break
        except Exception:
            continue

    print("\n" + "=" * 66)
    print("  VERIFICACIÓN DEL CANAL DE TIEMPO REAL")
    print("=" * 66)

    client = httpx.Client(base_url=BASE, timeout=20)

    token_celeste = login(client, "concierge@celeste.mx")
    token_barcelo = login(client, "concierge@barcelo.mx")
    token_recepcion = login(client, "recepcion@lasparotas.mx")
    token_admin = login(client, "admin@lasparotas.mx")

    print("\n1. Conexión y autenticación")
    celeste = Terminal("Celeste", token_celeste)
    barcelo = Terminal("Barceló", token_barcelo)
    recepcion = Terminal("Recepción", token_recepcion)
    time.sleep(1.2)

    check("Tres terminales conectadas", all(t.buscar("conexion.establecida") for t in (celeste, barcelo, recepcion)))

    try:
        connect(f"{WS}?token=token-basura")
        check("Token inválido rechazado", False, "aceptó una conexión sin credencial válida")
    except Exception:
        check("Token inválido rechazado", True)

    status = client.get("/api/realtime/status", headers={"Authorization": f"Bearer {token_admin}"}).json()
    check("Estado del canal reporta conexiones", status["conexiones_activas"] >= 3,
          f"{status['conexiones_activas']} activas")

    # ------------------------------------------------- reserva y disponibilidad
    print("\n2. Reserva creada por Celeste")
    manana = (date.today() + timedelta(days=1)).isoformat()
    slots = client.get(
        f"/api/booking/availability?slot_date={manana}",
        headers={"Authorization": f"Bearer {token_celeste}"},
    ).json()["slots"]
    libre = next(s for s in slots if s["status"] == "DISPONIBLE")

    creada = client.post(
        "/api/booking/reservations",
        headers={"Authorization": f"Bearer {token_celeste}"},
        json={
            "tee_slot_id": libre["id"],
            "modality": "GRUPO",
            "holes": 18,
            "holder_name": "Prueba Tiempo Real",
            "holder_email": "prueba@ejemplo.com",
        "booked_by_name": "Quien Atiende de Prueba",
            # Un grupo lleva cuatro: es el mínimo del paquete.
            "players": [
                {"full_name": "Jugador Uno", "age": 40},
                {"full_name": "Jugador Dos", "age": 38},
                {"full_name": "Jugador Tres", "age": 44},
                {"full_name": "Jugador Cuatro", "age": 36},
            ],
        },
    )
    check("Reserva creada por REST", creada.status_code == 201, creada.text[:90])
    reserva = creada.json()
    time.sleep(1.2)

    check("Celeste recibe el aviso de su reserva", len(celeste.buscar("reserva.creada")) == 1)
    check(
        "Barceló NO recibe la reserva ajena",
        len(barcelo.buscar("reserva.creada")) == 0,
        "aislamiento por hotel respetado",
    )
    check("Recepción sí la recibe", len(recepcion.buscar("reserva.creada")) == 1)

    disponibilidad = barcelo.buscar("disponibilidad.cambiada")
    check(
        "Barceló SÍ ve cambiar la disponibilidad",
        len(disponibilidad) == 1,
        "la franja ocupada le importa a todos",
    )
    if disponibilidad:
        payload = disponibilidad[0]["payload"]
        check(
            "El aviso dice que la salida quedó tomada",
            payload["estado"] == "OCUPADO" and payload["disponibles"] == 0,
            f"{payload['estado']} · {payload['ocupados']} jugadores",
        )

    # ------------------------------------------------------ confirmar y cobrar
    print("\n3. Confirmación y check-in")
    client.post(
        f"/api/booking/reservations/{reserva['id']}/confirm",
        headers={"Authorization": f"Bearer {token_admin}"},
    )
    time.sleep(1.0)
    check("Cambio de estado difundido", len(celeste.buscar("reserva.actualizada")) >= 1)

    client.post(
        f"/api/checkin/{reserva['id']}",
        headers={"Authorization": f"Bearer {token_recepcion}"},
        json={
            "attended_by_name": "Recepcion de Prueba",
            "arrivals": [{"player_id": p["id"], "arrived": True} for p in reserva["players"]],
            # Se paga exactamente lo que cuesta la partida: el precio cambia
            # entre semana y fin de semana, y el cobro tiene que cuadrar.
            "payments": [{"currency": "MXN", "amount": str(reserva["total"]), "method": "EFECTIVO"}],
        },
    )
    time.sleep(1.2)

    # El mostrador es del campo: el hotel no ve el check-in, solo que su
    # reserva quedó confirmada al pagarse.
    confirmadas = [
        m for m in celeste.buscar("reserva.actualizada")
        if m["payload"].get("estado_hotel") == "CONFIRMADA" and m["payload"].get("para_hotel")
    ]
    check("Al pagar, el hotel recibe su reserva como Confirmada", len(confirmadas) == 1)
    check("El hotel NO recibe el movimiento del mostrador", len(celeste.buscar("checkin.registrado")) == 0)
    check("Recepción sí recibe el check-in", len(recepcion.buscar("checkin.registrado")) == 1)
    check(
        "El hotel NO recibe el detalle de caja",
        len(celeste.buscar("pago.registrado")) == 0 and len(celeste.buscar("caja.actualizada")) == 0,
        "la información financiera queda restringida por rol",
    )
    check("Recepción sí recibe el movimiento de caja", len(recepcion.buscar("caja.actualizada")) >= 1)

    # ------------------------------------------------------- tipo de cambio
    print("\n4. Tipo de cambio")
    client.post(
        "/api/catalog/exchange-rate",
        headers={"Authorization": f"Bearer {token_admin}"},
        json={"rate": "18.40"},
    )
    time.sleep(1.0)
    avisos_tc = celeste.buscar("tipo_cambio.actualizado")
    check("Cambio de TC llega a todas las terminales",
          len(avisos_tc) == 1 and len(recepcion.buscar("tipo_cambio.actualizado")) == 1)
    if avisos_tc:
        check("El aviso trae valor anterior y nuevo",
              avisos_tc[0]["payload"]["nuevo"] == "18.4000",
              f"{avisos_tc[0]['payload']['anterior']} → {avisos_tc[0]['payload']['nuevo']}")

    # ------------------------------------------------------------- bloqueos
    print("\n5. Evento que bloquea franjas")
    pasado = (date.today() + timedelta(days=3)).isoformat()
    respuesta = client.post(
        "/api/events",
        headers={"Authorization": f"Bearer {token_admin}"},
        json={
            "name": "Torneo de prueba",
            "event_type": "TORNEO",
            "event_date": pasado,
            "start_time": "12:00:00",
            "end_time": "12:30:00",
            "tee": "CAMPO",
            "blocks_availability": True,
        },
    )
    check("Evento creado", respuesta.status_code == 201, respuesta.text[:80])
    time.sleep(1.0)
    check("Bloqueo difundido a los hoteles",
          len(celeste.buscar("evento.creado")) == 1 and len(barcelo.buscar("evento.creado")) == 1)

    # ------------------------------------------------------- cancelación
    print("\n6. Cancelación libera cupo")
    # La partida pagada ya está en juego y no se cancela; se prueba con otra.
    slots = client.get(
        f"/api/booking/availability?slot_date={manana}",
        headers={"Authorization": f"Bearer {token_celeste}"},
    ).json()["slots"]
    otra_libre = next(s for s in slots if s["status"] == "DISPONIBLE" and not s.get("expirada"))
    otra = client.post(
        "/api/booking/reservations",
        headers={"Authorization": f"Bearer {token_celeste}"},
        json={
            "tee_slot_id": otra_libre["id"], "modality": "GRUPO", "holes": 18,
            "holder_name": "Prueba Cancelación", "holder_email": "cancela@ejemplo.com",
        "booked_by_name": "Quien Atiende de Prueba",
            "players": [
                {"full_name": f"Jugador {n}", "age": 36 + n} for n in range(1, 5)
            ],
        },
    ).json()
    time.sleep(1.0)
    barcelo.recibidos.clear()
    client.post(
        f"/api/booking/reservations/{otra['id']}/cancel",
        headers={"Authorization": f"Bearer {token_admin}"},
        json={"reason": "Prueba de liberación de cupo"},
    )
    time.sleep(1.2)
    liberacion = barcelo.buscar("disponibilidad.cambiada")
    check("Barceló ve liberarse el cupo", len(liberacion) == 1)
    if liberacion:
        check("La salida vuelve a quedar disponible",
              liberacion[0]["payload"]["estado"] == "DISPONIBLE",
              liberacion[0]["payload"]["estado"])

    # ------------------------------------------------------------ resiliencia
    print("\n7. Resiliencia")
    barcelo.cerrar()
    time.sleep(0.6)
    slots2 = client.get(
        f"/api/booking/availability?slot_date={manana}",
        headers={"Authorization": f"Bearer {token_celeste}"},
    ).json()["slots"]
    libre2 = next(s for s in slots2 if s["status"] == "DISPONIBLE")
    segunda = client.post(
        "/api/booking/reservations",
        headers={"Authorization": f"Bearer {token_celeste}"},
        json={
            "tee_slot_id": libre2["id"],
            "modality": "PARTIDA_ABIERTA",
            "holes": 9,
            "holder_name": "Segunda Prueba",
            "holder_email": "prueba2@ejemplo.com",
        "booked_by_name": "Quien Atiende de Prueba",
            "players": [{"full_name": "Jugador Solo", "age": 50}],
        },
    )
    check("Una terminal caída no rompe la operación", segunda.status_code == 201,
          "la reserva se creó con un suscriptor muerto")
    time.sleep(1.0)
    check("Las terminales vivas siguen recibiendo", len(celeste.buscar("reserva.creada")) == 3)

    celeste.cerrar()
    recepcion.cerrar()
    time.sleep(0.5)

    print("\n" + "=" * 66)
    if FALLOS:
        print(f"  {len(FALLOS)} VERIFICACIONES FALLIDAS:")
        for f in FALLOS:
            print(f"    ✗ {f}")
    else:
        print("  TODAS LAS VERIFICACIONES DE TIEMPO REAL PASARON")
    print("=" * 66 + "\n")

    hora_de_corte(corte_original)
    servidor.should_exit = True
    return 1 if FALLOS else 0


if __name__ == "__main__":
    raise SystemExit(main())
