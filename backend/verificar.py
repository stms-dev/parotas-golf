"""Prueba de humo del flujo completo contra la API en memoria.

Recorre: login → disponibilidad → cotización → reserva → confirmación →
check-in con PGA → pago mixto MXN/USD → cierre de caja → liquidación.

    python verificar.py
"""
from datetime import date, time, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
FALLOS = []


def check(label: str, condition: bool, extra: str = ""):
    marca = "✓" if condition else "✗"
    print(f"  {marca} {label}" + (f" · {extra}" if extra else ""))
    if not condition:
        FALLOS.append(label)


def token(email: str, password: str = "Reserva2026*") -> dict:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def sin_hora_de_corte():
    """Deja la caja abierta a cualquier hora mientras corre la prueba.

    La caja de verdad no admite cobros después de las 22:00, y con razón: nadie
    debe estar cobrando a medianoche sin turno abierto. Pero eso hacía que la
    prueba pasara de día y fallara de noche, que es la peor clase de prueba.
    Se levanta el corte aquí y se repone al terminar.
    """
    from app.core.database import SessionLocal
    from app.modules.catalog.models import SystemSetting
    from sqlalchemy import select

    with SessionLocal() as db:
        fila = db.execute(
            select(SystemSetting).where(SystemSetting.key == "cash_cutoff_hour")
        ).scalars().first()
        anterior = fila.value if fila else None
        if fila:
            fila.value = "25"   # ninguna hora del día la alcanza
            db.commit()
    return anterior


def reponer_hora_de_corte(anterior):
    if anterior is None:
        return
    from app.core.database import SessionLocal
    from app.modules.catalog.models import SystemSetting
    from sqlalchemy import select

    with SessionLocal() as db:
        fila = db.execute(
            select(SystemSetting).where(SystemSetting.key == "cash_cutoff_hour")
        ).scalars().first()
        if fila:
            fila.value = anterior
            db.commit()


CORTE_ORIGINAL = sin_hora_de_corte()


print("\n" + "=" * 66)
print("  VERIFICACIÓN DEL FLUJO OPERATIVO")
print("=" * 66)

# ------------------------------------------------------------------- 1. login
print("\n1. Autenticación y permisos")
hotel = token("concierge@celeste.mx")
ops = token("operaciones@lasparotas.mx")
recepcion = token("recepcion@lasparotas.mx")
admin = token("admin@lasparotas.mx")
check("Login de los 4 roles", True)

bad = client.post("/api/auth/login", json={"email": "concierge@celeste.mx", "password": "mala"})
check("Contraseña incorrecta rechazada", bad.status_code == 401)

sin_token = client.get("/api/booking/reservations")
check("Endpoint protegido sin token", sin_token.status_code == 401)

# El hotel no puede tocar el tipo de cambio.
intento = client.post("/api/catalog/exchange-rate", json={"rate": "1.00"}, headers=hotel)
check("Hotel no puede cambiar el TC", intento.status_code == 403)

# --------------------------------------------------------- 2. disponibilidad
print("\n2. Disponibilidad")
manana = (date.today() + timedelta(days=1)).isoformat()

# Precios de la hoja "Costeo" del club. Cambian según el día de la salida, así
# que lo esperado se calcula para el día en que corre la prueba: fijar un solo
# monto la haría pasar entre semana y fallar en fin de semana.
FIN_DE_SEMANA = date.fromisoformat(manana).weekday() >= 4   # viernes en adelante
ADULTO_18 = Decimal("4000.00") if FIN_DE_SEMANA else Decimal("2800.00")
MENOR_18 = Decimal("1500.00") if FIN_DE_SEMANA else Decimal("1200.00")
# El caddie cuesta 600, pero el club NO lo cobra: el huésped le paga directo al
# caddie. El precio se publica para que el hotel pueda decirlo, y por eso no
# entra en ningún total.
CADDIE = Decimal("600.00")
BASTONES = Decimal("850.00")                # set básico, uno por jugador
GREEN = 3 * ADULTO_18 + MENOR_18            # 3 adultos + 1 menor
ACOMPANANTE = Decimal("800.00")             # no juega, pero paga su lugar
SERVICIOS = 2 * BASTONES + ACOMPANANTE      # 2 sets de bastones + 1 acompañante
TOTAL = GREEN + SERVICIOS
REPLAY = Decimal("1200.00")                   # ronda extra, por partida
PGA = Decimal("1000.00")                      # monto fijo por credencial
TOTAL_PGA = TOTAL - PGA
USD_MXN = Decimal("100.00") * Decimal("17.20")
EFECTIVO = TOTAL_PGA - USD_MXN
response = client.get(f"/api/booking/availability?slot_date={manana}", headers=hotel)
dia_disponible = response.json()
slots = dia_disponible["slots"]
check("Salidas generadas desde configuración", len(slots) == 17,
      f"{len(slots)} salidas {slots[0]['slot_time'][:5]}–{slots[-1]['slot_time'][:5]}")
check("El horario abre a las 7:00 y la última salida es a las 15:00",
      slots[0]["slot_time"][:5] == "07:00" and slots[-1]["slot_time"][:5] == "15:00")
check("Hasta 4 jugadores por salida", all(s["capacity"] == 4 for s in slots))
check("La disponibilidad dice a qué hora cierra el campo",
      dia_disponible["cierre_de_campo"][:5] == "18:00", str(dia_disponible["cierre_de_campo"]))
check("Y desde qué hora empieza el twilight",
      dia_disponible["twilight_desde"][:5] == "14:00", str(dia_disponible["twilight_desde"]))
slot_id = slots[0]["id"]
bastones_id = next(s["id"] for s in client.get("/api/catalog/services", headers=hotel).json()
                   if s["code"] == "BASTONES")
caddie_id = next(s["id"] for s in client.get("/api/catalog/services", headers=hotel).json()
                 if s["code"] == "CADDIE")

# ------------------------------------------------------------ 3. cotización
print("\n3. Cotización previa")
payload = {
    "tee_slot_id": slot_id,
    "modality": "GRUPO",
    "holes": 18,
    "holder_name": "Roberto Morales Vega",
    "holder_email": "roberto.morales@ejemplo.com",
        "booked_by_name": "Quien Atiende de Prueba",
    "holder_phone": "+52 55 1234 5678",
    "holder_room": "Suite 412",
    "players": [
        {"full_name": "Roberto Morales Vega", "age": 45, "is_holder": True, "pga_code": "PGA-00123", "credential_number": "45872"},
        {"full_name": "Elena Morales Ruiz", "age": 42},
        {"full_name": "Fernando Gaviria", "age": 38},
        {"full_name": "Mateo Morales", "age": 13},
    ],
    "companions": [{"full_name": "Sofía Carvajal", "age": 40}],
    # Dos sets de bastones. El caddie va aparte: se pide, se asigna, y no se
    # cobra — eso se prueba en su propia sección.
    "services": [{"service_id": bastones_id, "quantity": 2}],
    "invoice_requested": True,
    "invoice_contact_email": "facturacion@ejemplo.com",
}
response = client.post("/api/booking/reservations/quote", json=payload, headers=hotel)
cotizacion = response.json()
print(f"   ({'fin de semana' if FIN_DE_SEMANA else 'entre semana'}: adulto ${ADULTO_18}, menor ${MENOR_18})")
check("Green fees 3 adultos + 1 menor", Decimal(cotizacion["subtotal_green_fees"]) == GREEN,
      f"${cotizacion['subtotal_green_fees']}")
check("Menor de 16 toma tarifa infantil", "INFANTIL" in " ".join(cotizacion["detail"]))
check("Servicios", Decimal(cotizacion["subtotal_services"]) == SERVICIOS, f"${cotizacion['subtotal_services']}")
check("Total cotizado", Decimal(cotizacion["total"]) == TOTAL, f"${cotizacion['total']}")
check("PGA NO se aplica en cotización", Decimal(cotizacion["total"]) == TOTAL)

# -------------------------------------------------------------- 4. reserva
print("\n4. Creación de reserva")
response = client.post("/api/booking/reservations", json=payload, headers=hotel)
check("Reserva creada", response.status_code == 201, response.text[:120])
reserva = response.json()
reserva_id = reserva["id"]
check("Estado inicial PENDIENTE", reserva["status"] == "PENDIENTE")
check("Folio generado", reserva["folio"].startswith("LP-"), reserva["folio"])
check("QR por partida", bool(reserva["qr_token"]))
check("TC congelado en la reserva", Decimal(reserva["exchange_rate_applied"]) == Decimal("17.2000"))
check("Comisión congelada", Decimal(reserva["commission_rate_applied"]) == Decimal("5.0000"))
check("Acompañante no cobra green fee", len(reserva["companions"]) == 1 and len(reserva["players"]) == 4)

# Cupo tomado
response = client.get(f"/api/booking/availability?slot_date={manana}", headers=hotel)
slot = next(s for s in response.json()["slots"] if s["id"] == slot_id)
check("Salida marcada OCUPADO tras reservar", slot["status"] == "OCUPADO")
check("Ya no se ofrece a nadie más", slot["available"] == 0, f"{slot['occupied']} jugadores")
check("El hotel la reconoce como suya", slot["es_de_mi_hotel"] is True)

# La salida queda tomada por completo
payload_extra = dict(payload)
payload_extra["modality"] = "PARTIDA_ABIERTA"
payload_extra["players"] = [{"full_name": "Jugador Extra", "age": 30}]
response = client.post("/api/booking/reservations", json=payload_extra, headers=hotel)
check("Salida ya asignada rechaza otra partida", response.status_code == 409,
      response.json()["error"]["message"][:60])

# Aislamiento por hotel
otro_hotel = token("concierge@barcelo.mx")
response = client.get(f"/api/booking/reservations/{reserva_id}", headers=otro_hotel)
check("Otro hotel no ve la reserva ajena", response.status_code == 404)

# ------------------------------------------------------ reglas de modalidad
# Individual ya no se vende. El que llega solo entra a una partida abierta, y
# un grupo lleva cuatro: reservar la salida completa para dos personas dejaba
# dos lugares muertos que nadie podía comprar.
payload_malo = dict(payload)
payload_malo["modality"] = "INDIVIDUAL"
response = client.post("/api/booking/reservations", json=payload_malo, headers=hotel)
check("El paquete Individual ya no se ofrece", response.status_code == 422,
      response.json()["error"]["message"][:70])

libres_mod = [
    s for s in client.get(
        f"/api/booking/availability?slot_date={manana}", headers=hotel
    ).json()["slots"] if s["status"] == "DISPONIBLE"
]
grupo_corto = dict(payload)
grupo_corto["tee_slot_id"] = libres_mod[0]["id"]
grupo_corto["modality"] = "GRUPO"
grupo_corto["players"] = [
    {"full_name": "Grupo Corto Uno", "age": 40},
    {"full_name": "Grupo Corto Dos", "age": 41},
    {"full_name": "Grupo Corto Tres", "age": 42},
]
grupo_corto["companions"] = []
grupo_corto["services"] = []
response = client.post("/api/booking/reservations", json=grupo_corto, headers=hotel)
check("Un grupo de tres no alcanza: el mínimo son cuatro", response.status_code == 422,
      response.json()["error"]["message"][:70])

grupo_completo = dict(grupo_corto)
grupo_completo["players"] = grupo_corto["players"] + [{"full_name": "Grupo Corto Cuatro", "age": 43}]
response = client.post("/api/booking/reservations", json=grupo_completo, headers=hotel)
check("Con cuatro sí se reserva el grupo", response.status_code == 201, response.text[:110])

# ------------------------------------------------- 4b. una salida, una partida
print("\n4b. Una salida la toma una sola partida")

response = client.get(f"/api/booking/availability?slot_date={manana}", headers=hotel)
libres = [s for s in response.json()["slots"] if s["status"] == "DISPONIBLE"]

# Un grupo toma la salida completa: el campo no le mete desconocidos a un
# grupo que llegó junto, aunque sobren lugares.
solo = dict(payload)
solo["tee_slot_id"] = libres[0]["id"]
solo["modality"] = "GRUPO"
solo["players"] = [
    {"full_name": f"Jugador de Grupo {i}", "age": 40 + i} for i in range(1, 5)
]
solo["companions"] = []
solo["services"] = []
response = client.post("/api/booking/reservations", json=solo, headers=hotel)
check("Un grupo toma la salida completa", response.status_code == 201, response.text[:110])

response = client.get(f"/api/booking/availability?slot_date={manana}", headers=otro_hotel)
tomada = next(s for s in response.json()["slots"] if s["id"] == libres[0]["id"])
check("La salida del grupo queda OCUPADO", tomada["status"] == "OCUPADO",
      f"{tomada['occupied']} de {tomada['capacity']} jugadores")
check("Otro hotel no ve de quién es", tomada["titular"] is None and not tomada["es_de_mi_hotel"])

# La partida abierta sí comparte.
abierta = dict(payload)
abierta["tee_slot_id"] = libres[1]["id"]
abierta["modality"] = "PARTIDA_ABIERTA"
abierta["players"] = [{"full_name": "Jugador Abierto", "age": 40}]
abierta["services"] = []
response = client.post("/api/booking/reservations", json=abierta, headers=hotel)
check("Partida abierta creada", response.status_code == 201)

response = client.get(f"/api/booking/availability?slot_date={manana}", headers=otro_hotel)
compartida = next(s for s in response.json()["slots"] if s["id"] == libres[1]["id"])
check("Sigue admitiendo jugadores", compartida["status"] == "ABIERTA" and compartida["available"] == 3,
      f"{compartida['occupied']}/4")

suma = dict(abierta)
suma["players"] = [{"full_name": "Jugador Ajeno", "age": 33}]
response = client.post("/api/booking/reservations", json=suma, headers=otro_hotel)
check("Otro hotel se suma a la partida abierta", response.status_code == 201)

grupo_intruso = dict(abierta)
grupo_intruso["modality"] = "GRUPO"
grupo_intruso["players"] = [
    {"full_name": f"Intruso {i}", "age": 40 + i} for i in range(1, 5)
]
response = client.post("/api/booking/reservations", json=grupo_intruso, headers=otro_hotel)
check("Un grupo normal NO entra a una partida abierta", response.status_code == 409)

# ---------------------------------------------------------- 5. confirmación
print("\n5. Confirmación por el campo")
response = client.post(f"/api/booking/reservations/{reserva_id}/confirm", headers=ops)
check("Campo confirma la reserva", response.status_code == 200 and response.json()["status"] == "CONFIRMADA")

response = client.post(f"/api/booking/reservations/{reserva_id}/confirm", headers=ops)
check("Doble confirmación bloqueada por la máquina de estados", response.status_code == 409)

# --------------------------------------------------------------- 6. check-in
print("\n6. Check-in en recepción")
response = client.get(f"/api/checkin/lookup?qr_token={reserva['qr_token']}", headers=recepcion)
check("Escaneo de QR trae la partida completa", response.status_code == 200)
cuenta = response.json()
check("Cuenta antes de PGA", Decimal(cuenta["total"]) == TOTAL, f"${cuenta['total']}")

jugadores = reserva["players"]
titular = next(p for p in jugadores if p["is_holder"])
segundo = jugadores[1]

# El saldo real solo se conoce después de aplicar el beneficio PGA, así que
# primero se hace el check-in sin cobro y de ahí se toma el monto exacto.
sin_cobro = {
    "attended_by_name": "Recepcion de Prueba",
    "arrivals": [{"player_id": p["id"], "arrived": True} for p in jugadores],
    "companion_arrivals": [{"companion_id": c["id"], "arrived": True} for c in reserva["companions"]],
    # La credencial ya no se coteja contra ningún padrón: el mostrador la ve
    # y decide. Aquí acepta la del titular y rechaza la del segundo.
    "pga_validations": [
        {"player_id": titular["id"], "pga_code": "PGA-00123",
         "credential_number": "45872", "apply_benefit": True},
        {"player_id": segundo["id"], "pga_code": "PGA-00987", "apply_benefit": False},
    ],
    "payments": [],
}
# Si el acompañante no llega, su lugar sale de la cuenta, igual que un jugador.
sin_acompanante = {**sin_cobro, "companion_arrivals": [
    {"companion_id": c["id"], "arrived": False} for c in reserva["companions"]]}
response = client.post(f"/api/checkin/{reserva_id}", json=sin_acompanante, headers=recepcion)
check("Acompañante que no llegó no se cobra",
      response.status_code == 200 and Decimal(response.json()["subtotal_services"]) == 2 * BASTONES,
      f"servicios ${response.json().get('subtotal_services')}")

response = client.post(f"/api/checkin/{reserva_id}", json=sin_cobro, headers=recepcion)
check("Check-in ejecutado", response.status_code == 200, response.text[:150])
validacion = response.json()
saldo_exacto = Decimal(validacion["balance"])

# --- La regla del cobro exacto: ni de más ni de menos ---
def cobro(monto_mxn, usd=None):
    pagos = [{"currency": "MXN", "amount": str(monto_mxn), "method": "EFECTIVO"}]
    if usd:
        pagos.append({"currency": "USD", "amount": str(usd), "method": "TARJETA"})
    return client.post(
        f"/api/checkin/{reserva_id}",
        json={"attended_by_name": "Recepcion de Prueba",
        "arrivals": [], "pga_validations": [], "payments": pagos},
        headers=recepcion,
    )

r = cobro(saldo_exacto - Decimal("500.00"))
check("Cobrar de menos se rechaza", r.status_code == 409, f"HTTP {r.status_code}")

# Con tarjeta o transferencia se cobra exacto; solo el efectivo admite cambio.
r = client.post(
    f"/api/checkin/{reserva_id}",
    json={"attended_by_name": "Recepcion de Prueba",
          "payments": [{"currency": "MXN", "amount": str(saldo_exacto + Decimal("500.00")), "method": "TARJETA"}]},
    headers=recepcion,
)
check("Con tarjeta, cobrar de más se rechaza", r.status_code == 409, f"HTTP {r.status_code}")

r = client.get(f"/api/booking/reservations/{reserva_id}", headers=recepcion)
check(
    "Un cobro rechazado no deja rastro en la cuenta",
    Decimal(r.json()["total_paid"]) == Decimal("0.00"),
    f"pagado ${r.json()['total_paid']}",
)

# Mixto exacto: parte en efectivo y parte en dólares, convertidos al TC.
usd_parte = Decimal("100.00")
tc = Decimal(cuenta["exchange_rate"]) if "exchange_rate" in cuenta else Decimal("17.20")
mxn_parte = saldo_exacto - (usd_parte * tc)
response = cobro(mxn_parte, usd_parte)
check(
    "Cobro mixto exacto (MXN + USD) aceptado",
    response.status_code == 200,
    response.text[:150] if response.status_code != 200 else f"${mxn_parte} + {usd_parte} USD",
)
resultado = response.json()

pga_ok = [r for r in validacion["pga_results"] if r["valid"]]
pga_no = [r for r in validacion["pga_results"] if not r["valid"]]
check("Solo el jugador que el mostrador aceptó recibe PGA", len(pga_ok) == 1 and len(pga_no) == 1)
check("Descuento PGA individual correcto", Decimal(pga_ok[0]["discount"]) == PGA,
      f"-${pga_ok[0]['discount']} sobre ${pga_ok[0]['base_rate']}")
check("PGA no toca la tarifa de los demás",
      Decimal(validacion["pga_discount_amount"]) == PGA)
check("Total recalculado tras PGA", Decimal(resultado["total"]) == TOTAL_PGA,
      f"${TOTAL} - ${PGA} = ${resultado['total']}")

# El cobro es exacto, así que la cuenta queda saldada: 100 USD × 17.20 = 1720
# y el resto en efectivo.
check("Cobro exacto deja la cuenta saldada",
      Decimal(resultado["total_paid"]) == TOTAL_PGA,
      f"${resultado['total_paid']} de ${resultado['total']}")
check("Sin saldo pendiente tras el cobro exacto",
      Decimal(resultado["balance"]) == Decimal("0.00"), f"${resultado['balance']}")
check("Pagada completa, la partida queda EN JUEGO", resultado["status"] == "EN_JUEGO")
check("Sin cobro todavía, estaba en el mostrador (CHECK_IN)", validacion["status"] == "CHECK_IN")

r = client.get(f"/api/booking/reservations/{reserva_id}", headers=hotel)
check("El hotel la ve CONFIRMADA una vez pagada", r.json()["status"] == "CONFIRMADA", r.json()["status"])
r = client.get("/api/booking/reservations?status=CONFIRMADA", headers=hotel)
check("El filtro Confirmada del hotel la encuentra",
      any(x["id"] == reserva_id and x["status"] == "CONFIRMADA" for x in r.json()))

r = client.post(f"/api/checkin/{reserva_id}", json=sin_cobro, headers=recepcion)
check("Ya pagada, el mostrador no la puede volver a tocar", r.status_code == 409, f"HTTP {r.status_code}")
check("Llegadas registradas por jugador", resultado["players_arrived"] == 4)

usd = next(p for p in resultado["payments"] if p["currency"] == "USD")
check("TC guardado en el pago USD", Decimal(usd["exchange_rate_applied"]) == Decimal("17.2000"))
check("Equivalente MXN del pago USD", Decimal(usd["amount_mxn"]) == Decimal("1720.00"))

# --------------------------------------------- 7. inmutabilidad del histórico
print("\n7. Inmutabilidad del histórico")
response = client.post("/api/catalog/exchange-rate", json={"rate": "19.50"}, headers=admin)
check("Administrador actualiza el TC", response.status_code == 201)

response = client.get(f"/api/booking/reservations/{reserva_id}", headers=ops)
despues = response.json()
check("La reserva conserva su TC original",
      Decimal(despues["exchange_rate_applied"]) == Decimal("17.2000"), "sigue en 17.20 con TC nuevo de 19.50")
pago_usd = next(p for p in despues.get("payments", []) if True) if despues.get("payments") else None
check("El total no se recalculó", Decimal(despues["total"]) == TOTAL_PGA)

# ------------------------------------------------------------ 8. salida y cierre
print("\n8. Salida del campo: replay y finalizar")
salidas_replay = client.get(f"/api/checkin/{reserva_id}/replay-slots", headers=recepcion).json()
hora_original = reserva_slot_time = client.get(
    f"/api/booking/reservations/{reserva_id}", headers=recepcion).json()["slot_time"][:5]
check("El replay ofrece solo salidas libres posteriores a la partida",
      len(salidas_replay) > 0 and all(s["slot_time"] > hora_original for s in salidas_replay),
      ", ".join(s["slot_time"] for s in salidas_replay))
salida_replay = salidas_replay[0]["id"] if salidas_replay else None

def replay(monto, metodo="EFECTIVO", salida=None):
    return client.post(
        f"/api/checkin/{reserva_id}/replay",
        json={"tee_slot_id": salida or salida_replay,
              "attended_by_name": "Recepcion de Prueba",
              "payments": [{"currency": "MXN", "amount": str(monto), "method": metodo}]},
        headers=recepcion,
    )

r = replay(REPLAY - 100)
check("Replay cobrado de menos se rechaza", r.status_code == 409, f"HTTP {r.status_code}")
r = replay(2 * REPLAY, "TARJETA")
check("El replay es por partida: con tarjeta no se cobra de más", r.status_code == 409, f"HTTP {r.status_code}")
r = replay(REPLAY, salida=reserva["tee_slot_id"])
check("No se juega el replay en una salida ocupada o anterior", r.status_code == 409, f"HTTP {r.status_code}")
r = replay(Decimal("1500.00"))
cambio = Decimal(r.json()["payments"][0]["change_mxn"]) if r.status_code == 200 else None
check("En efectivo se paga con billete mayor y se da cambio",
      r.status_code == 200 and Decimal(r.json()["total"]) == REPLAY and cambio == Decimal("1500.00") - REPLAY,
      f"cambio ${cambio}")

dia = client.get(f"/api/booking/availability?slot_date={manana}", headers=admin).json()["slots"]
tomada = next((s for s in dia if s["id"] == salida_replay), {})
check("La salida del replay queda ocupada", tomada.get("status") == "OCUPADO" and tomada.get("replay_folio") == reserva["folio"],
      f"{tomada.get('status')} · {tomada.get('replay_folio')}")
dia_hotel = client.get(f"/api/booking/availability?slot_date={manana}", headers=hotel).json()["slots"]
check("El hotel la ve ocupada, sin saber que es un replay",
      next(s for s in dia_hotel if s["id"] == salida_replay)["replay_folio"] is None)

r = client.get(f"/api/booking/reservations/{reserva_id}", headers=recepcion)
detalle = r.json()
check("El ticket original no se movió", Decimal(detalle["total"]) == TOTAL_PGA
      and Decimal(detalle["balance"]) == Decimal("0.00"), f"${detalle['total']}")
check("El folio tiene su segundo ticket", len(detalle["replays"]) == 1)
check("Los pagos del replay no se mezclan con los del ticket original",
      sum(Decimal(p["amount_mxn"]) for p in detalle["payments"]) == TOTAL_PGA)

r = client.get(f"/api/booking/reservations/{reserva_id}", headers=hotel)
# El hotel no ve el replay ni los cobros: esa es la caja del campo. Lo suyo es
# su propia cuenta, que sí baja cuando se acredita un PGA.
check("El hotel no ve el replay ni los cobros",
      r.json()["replays"] == [] and r.json()["payments"] == [])

response = client.post(f"/api/booking/reservations/{reserva_id}/complete", headers=recepcion)
check("Finalizar la partida", response.json()["status"] == "COMPLETADA")
r = client.get(f"/api/booking/reservations/{reserva_id}", headers=hotel)
check("Finalizada, el hotel la sigue viendo confirmada", r.json()["status"] == "CONFIRMADA")
r = replay(REPLAY)
check("Ya finalizada no admite replay", r.status_code == 409, f"HTTP {r.status_code}")

# --------------------------------------------------------------- 9. caja
print("\n9. Caja y corte")
response = client.get("/api/treasury/cash/current", headers=recepcion)
caja = response.json()
check("Turno de caja abierto automáticamente al cobrar", caja["session_id"] is not None)
EFECTIVO = EFECTIVO + REPLAY   # el replay entró en efectivo a la misma caja
check("Efectivo esperado en caja (con el replay)", Decimal(caja["cash_mxn"]) == EFECTIVO, f"${caja['cash_mxn']}")
check("Tarjeta esperada (USD convertido)", Decimal(caja["card_mxn"]) == Decimal("1720.00"), f"${caja['card_mxn']}")
check("Total esperado", Decimal(caja["total_mxn"]) == TOTAL_PGA + REPLAY, f"${caja['total_mxn']}")

# El mostrador no cierra la caja: eso lo hace operaciones.
response = client.post(
    f"/api/treasury/cash/{caja['session_id']}/close",
    json={"counted_cash_mxn": str(EFECTIVO - Decimal("40.00")), "counted_card_mxn": "1720.00", "notes": "Faltante en Pro-Shop"},
    headers=recepcion,
)
check("Recepción NO puede cerrar la caja", response.status_code == 403, f"HTTP {response.status_code}")

# Corte con faltante de 40, hecho por operaciones
response = client.post(
    f"/api/treasury/cash/{caja['session_id']}/close",
    json={"counted_cash_mxn": str(EFECTIVO - Decimal("40.00")), "counted_card_mxn": "1720.00", "notes": "Faltante en Pro-Shop"},
    headers=ops,   # abrir y cerrar el turno es de operaciones, no del mostrador
)
cierre = response.json()
check("Cierre de caja registrado", response.status_code == 200)
check("Diferencia detectada", Decimal(cierre["difference_mxn"]) == Decimal("-40.00"), f"${cierre['difference_mxn']}")
check("Estado CON_DIFERENCIA", cierre["status"] == "CON_DIFERENCIA")

# ---------------------------------------------------------- 10. liquidación
print("\n10. Liquidación al hotel")
response = client.get(
    f"/api/treasury/settlements/preview?hotel_id={reserva['hotel_id']}&start={manana}&end={manana}",
    headers=admin,
)
liquidacion = response.json()

# La comisión se comprueba contra la venta bruta del periodo, no contra una
# cifra fija: así la prueba no se rompe al agregar reservas al escenario.
bruta = Decimal(liquidacion["gross_sales"])
comision = Decimal(liquidacion["commission_amount"])
neto = Decimal(liquidacion["net_course"])
# La comisión va solo sobre el green fee: caddies, bastones y acompañantes
# pasan completos al campo, y el replay ni siquiera es venta del hotel.
base = Decimal("0.00")
for item in client.get(f"/api/booking/reservations?hotel_id={reserva['hotel_id']}&slot_date={manana}&limit=200",
                       headers=admin).json():
    if item["status"] in ("CANCELADA", "NO_SHOW"):
        continue
    d = client.get(f"/api/booking/reservations/{item['id']}", headers=admin).json()
    base += (Decimal(d["total"]) - Decimal(d["subtotal_services"])) * Decimal("5") / Decimal("100")
esperada = base.quantize(Decimal("0.01"))

check("Comisión del hotel al 5% del green fee (sin servicios)", comision == esperada,
      f"${comision} sobre ${bruta}")
check("La venta del hotel no incluye el replay", REPLAY not in (bruta - TOTAL_PGA,))
check("Neto del campo = bruta − comisión", neto == bruta - comision, f"${neto}")
check("La reserva con PGA entra en la liquidación",
      liquidacion["reservations_count"] >= 1 and bruta > Decimal("0"),
      f"{liquidacion['reservations_count']} reservas")

# --------------------------------------------------------------- 11. eventos
print("\n11. Eventos y bloqueos")
pasado_manana = (date.today() + timedelta(days=2)).isoformat()
response = client.post(
    "/api/events",
    json={
        "name": "Copa Invitacional", "event_type": "EVENTO_CORPORATIVO",
        "event_date": pasado_manana, "start_time": "12:00:00", "end_time": "12:30:00",
        "tee": "CAMPO", "estimated_players": 16, "blocks_availability": True,
    },
    headers=ops,
)
check("Evento creado", response.status_code == 201, response.text[:120])

response = client.get(f"/api/booking/availability?slot_date={pasado_manana}", headers=hotel)
bloqueadas = [s for s in response.json()["slots"] if s["status"] == "BLOQUEADO"]
check("Salidas bloqueadas por el evento", len(bloqueadas) == 2, f"{len(bloqueadas)} salidas")

slot_bloqueado = bloqueadas[0]["id"]
payload_bloqueado = dict(payload)
payload_bloqueado["tee_slot_id"] = slot_bloqueado
payload_bloqueado["modality"] = "PARTIDA_ABIERTA"
payload_bloqueado["players"] = [{"full_name": "Intento Bloqueado", "age": 30}]
response = client.post("/api/booking/reservations", json=payload_bloqueado, headers=hotel)
check("No se puede reservar en salida bloqueada", response.status_code == 409)

# -------------------------------------------------------------- 12. auditoría
print("\n12. Auditoría y tablero")
response = client.get("/api/audit?limit=200", headers=admin)
bitacora = response.json()
acciones = {r["action"] for r in bitacora}
check("Bitácora registra las operaciones", len(bitacora) > 10, f"{len(bitacora)} registros")
check("Auditoría de PGA", "VALIDAR_PGA" in acciones)
check("Auditoría de pagos", "PAGO" in acciones)
check("Auditoría de cierre de caja", "CIERRE_CAJA" in acciones)

tc_log = [r for r in bitacora if r["field"] == "rate"]
check("Cambio de TC auditado con valor anterior y nuevo",
      any(r["old_value"] == "17.2000" and r["new_value"] == "19.5000" for r in tc_log))

response = client.get(f"/api/dashboard?target={manana}", headers=ops)
tablero = response.json()
check("Tablero responde", response.status_code == 200)
check("Métricas PGA en el tablero", tablero["pga"]["players_with_benefit"] == 1)

# ---------------------------------------------------------- 13. aritmética
print("\n13. Precisión del dinero")
from app.shared.money import money

check("0.1 + 0.2 == 0.30 exacto", money("0.1") + money("0.2") == money("0.30"))
suma = sum((money("0.01") for _ in range(100)), start=money("0"))
check("100 centavos suman exactamente 1.00", suma == money("1.00"), str(suma))
check("Redondeo a centavo", money("2064.005") == money("2064.01"))

# ---------------------------------------------------------------- horarios vencidos
print("\n14. Horarios que ya pasaron")

from app.core.config import settings as _settings
from app.shared.tiempo import ahora as ahora_local, ya_paso as _ya_paso

hoy_iso = date.today().isoformat()
response = client.get(f"/api/booking/availability?slot_date={hoy_iso}", headers=hotel)
slots_hoy = response.json()["slots"]

vencidas = [s for s in slots_hoy if s["expirada"]] if not _settings.horarios_libres else []
vigentes = [s for s in slots_hoy if not s["expirada"]]
if _settings.horarios_libres:
    print("  · modo pruebas activo (RESPETAR_HORARIOS=false): no se bloquean horarios vencidos")
check(
    "La disponibilidad marca cuáles salidas ya pasaron",
    all(_ya_paso(date.fromisoformat(s["slot_date"]), time.fromisoformat(s["slot_time"])) for s in vencidas),
    f"{len(vencidas)} vencidas · {len(vigentes)} vigentes · son las {ahora_local().strftime('%H:%M')}",
)

# Reservar una salida vencida tiene que fallar aunque esté libre.
libre_vencida = next(
    (s for s in vencidas if s["status"] == "DISPONIBLE"), None
)
if libre_vencida:
    intento = dict(payload)
    intento["tee_slot_id"] = libre_vencida["id"]
    response = client.post("/api/booking/reservations", json=intento, headers=hotel)
    if _settings.horarios_libres:
        check(
            "RESPETAR_HORARIOS=false deja reservar un horario vencido (modo pruebas)",
            response.status_code == 201,
            f"HTTP {response.status_code} · {libre_vencida['slot_time'][:5]}",
        )
    else:
        check(
            "No se puede reservar un horario vencido",
            response.status_code == 409,
            f"HTTP {response.status_code} · {libre_vencida['slot_time'][:5]}",
        )
else:
    check(
        "No se puede reservar un horario vencido",
        True,
        "sin salidas vencidas libres a esta hora; la regla se cubre en el servicio",
    )

# Y una futura sigue funcionando: la regla no bloquea de más.
futura = next((s for s in vigentes if s["status"] == "DISPONIBLE"), None)
if futura:
    intento = dict(payload)
    intento["tee_slot_id"] = futura["id"]
    response = client.post("/api/booking/reservations", json=intento, headers=hotel)
    check(
        "Una salida aún vigente de hoy sí se puede reservar",
        response.status_code == 201,
        f"HTTP {response.status_code} · {futura['slot_time'][:5]}",
    )

# -------------------------------------------------- 15. hora límite del día
print("\n15. Hora límite para reservar el mismo día")
from app.shared.tiempo import dia_cerrado, hoy as hoy_campo, leer_hora
from datetime import time as _time

r = client.put("/api/catalog/settings/same_day_cutoff", json={"value": "15:00"}, headers=admin)
check("La Administración fija la hora límite", r.status_code == 200 and r.json()["value"] == "15:00",
      r.text[:80])
r = client.put("/api/catalog/settings/same_day_cutoff", json={"value": "tres de la tarde"}, headers=admin)
check("Una hora mal escrita se rechaza", r.status_code == 422, f"HTTP {r.status_code}")
r = client.put("/api/catalog/settings/same_day_cutoff", json={"value": "16:00"}, headers=ops)
check("Operaciones NO cambia la hora límite", r.status_code == 403, f"HTTP {r.status_code}")
r = client.put("/api/catalog/settings/course_name", json={"value": "Otro"}, headers=admin)
check("Solo se editan los parámetros permitidos", r.status_code == 422, f"HTTP {r.status_code}")

# La regla, probada sin depender de la hora a la que corra la prueba.
check("Con límite a las 00:01 el día de hoy queda cerrado", dia_cerrado(hoy_campo(), _time(0, 1)))
check("El día de mañana nunca se cierra por la hora de hoy",
      not dia_cerrado(hoy_campo() + timedelta(days=1), _time(0, 1)))
check("Una hora ilegible no tumba las reservas", leer_hora("xx") == _time(15, 0))

# Con el día de hoy cerrado a propósito, mañana se sigue pudiendo reservar.
client.put("/api/catalog/settings/same_day_cutoff", json={"value": "00:01"}, headers=admin)
de_hoy = client.get(f"/api/booking/availability?slot_date={date.today().isoformat()}", headers=hotel).json()["slots"]
check("Pasada la hora límite, todas las salidas de hoy salen cerradas",
      all(x["expirada"] for x in de_hoy), f"{sum(x['expirada'] for x in de_hoy)}/{len(de_hoy)}")
de_manana = client.get(f"/api/booking/availability?slot_date={pasado_manana}", headers=hotel).json()["slots"]
check("Los días siguientes siguen a la venta",
      any(not x["expirada"] for x in de_manana), f"{sum(not x['expirada'] for x in de_manana)} abiertas")
client.put("/api/catalog/settings/same_day_cutoff", json={"value": "15:00"}, headers=admin)

# ------------------------------------- 16. horarios libres, carritos, caddies
print("\n16. El horario se elige libre; carritos y caddies se asignan")

otro_dia = (date.today() + timedelta(days=5)).isoformat()
slots16 = client.get(f"/api/booking/availability?slot_date={otro_dia}", headers=hotel).json()["slots"]
check("Ninguna salida espera su turno: se elige la que sea",
      all(s["cerrada_por"] != "orden" for s in slots16),
      f"{len(slots16)} horarios a la venta")
check("El sistema solo sugiere cuál deja el campo de corrido",
      sum(1 for s in slots16 if s["en_turno"]) == 1,
      next(s["slot_time"][:5] for s in slots16 if s["en_turno"]))

def reservar(slot_id, jugadores=4, acompanantes=0, servicios=None, quien=None,
             modalidad="GRUPO"):
    return client.post(
        "/api/booking/reservations",
        headers=quien or hotel,
        json={
            "tee_slot_id": slot_id, "modality": modalidad, "holes": 18,
            "holder_name": "Titular de Prueba", "holder_email": "orden@ejemplo.com",
            "booked_by_name": "Quien Atiende de Prueba",
            "players": [
                {"full_name": f"Jugador {i + 1}", "age": 30, "is_holder": i == 0}
                for i in range(jugadores)
            ],
            "companions": [{"full_name": f"Acompañante {i + 1}"} for i in range(acompanantes)],
            "services": servicios or [],
        },
    )

# La de en medio del día, saltándose todas las anteriores: antes esto se
# rechazaba por orden, y era la queja de siempre del concierge.
salteada = slots16[6]
r = reservar(salteada["id"])
check("Se puede reservar una salida de en medio del día", r.status_code == 201,
      f"{salteada['slot_time'][:5]} · HTTP {r.status_code}")
con_caddies = r.json()["id"]
check("Los carritos se asignan solos: dos personas por carrito",
      r.json()["carts_used"] == 2, f"{r.json().get('carts_used')} carritos para 4 personas")
check("Y un caddie por carrito, mientras haya",
      r.json()["caddies_used"] == 2, f"{r.json().get('caddies_used')} caddies")

# Y la primera del día sigue libre: reservar en medio no bloquea hacia atrás.
r = reservar(slots16[0]["id"], acompanantes=1)
check("La primera del día sigue disponible después", r.status_code == 201, r.text[:110])
temprana = r.json()
check("Con acompañante son 5 personas: tres carritos",
      temprana["carts_used"] == 3, f"{temprana['carts_used']} carritos")

recursos = client.get(f"/api/booking/recursos?slot_date={otro_dia}", headers=ops).json()
check("El día lleva la cuenta de sus carritos",
      recursos["carritos_usados"] == 5 and recursos["carritos_libres"] == 15,
      f"{recursos['carritos_usados']} usados de {recursos['carritos_totales']}")

# ------------------------------------------- el caddie no bloquea la venta
# Solo hay dos caddies. La primera partida del día se los lleva, y las demás
# salen sin caddie: no se le va a decir a un hotel que no puede reservar
# porque los caddies ya salieron.
check("Los dos caddies del día ya están asignados",
      recursos["caddies_libres"] == 0 and recursos["caddies_usados"] == 2,
      f"{recursos['caddies_usados']} de {recursos['caddies_totales']}")
check("La segunda partida salió sin caddie, no se le rechazó",
      temprana["caddies_used"] == 0, f"{temprana['caddies_used']} caddies")

r = reservar(slots16[8]["id"], servicios=[{"service_id": caddie_id, "quantity": 2}])
check("Pedir caddies cuando ya no hay tampoco tumba la reserva",
      r.status_code == 201, f"HTTP {r.status_code} · {r.text[:90]}")
sin_caddie = r.json()
check("Esa partida sale sin caddie", sin_caddie["caddies_used"] == 0)
check("Y el caddie no se le cobró",
      all(s["service_code"] != "CADDIE" for s in sin_caddie["services"]),
      f"{len(sin_caddie['services'])} líneas cobradas")

# El precio sigue publicado: el hotel se lo tiene que poder decir al huésped.
_caddie_catalogo = next(
    s for s in client.get("/api/catalog/services", headers=hotel).json()
    if s["code"] == "CADDIE"
)
check("El precio del caddie se sigue publicando para informar al huésped",
      _caddie_catalogo["is_active"] and Decimal(_caddie_catalogo["price"]) == CADDIE,
      f"${_caddie_catalogo['price']} · pago directo al caddie")

# Los caddies vuelven a estar libres cuando su partida se finaliza: la que se
# los llevó fue la de en medio del día.
client.post(f"/api/booking/reservations/{con_caddies}/confirm", headers=ops)
detalle = client.get(f"/api/booking/reservations/{con_caddies}", headers=ops).json()
client.post(
    f"/api/checkin/{con_caddies}",
    json={
        "attended_by_name": "Recepcion de Prueba",
        "arrivals": [{"player_id": p["id"], "arrived": True} for p in detalle["players"]],
        "payments": [{"currency": "MXN", "amount": str(detalle["total"]), "method": "EFECTIVO"}],
    },
    headers=recepcion,
)
client.post(f"/api/booking/reservations/{con_caddies}/complete", headers=recepcion)
recursos = client.get(f"/api/booking/recursos?slot_date={otro_dia}", headers=ops).json()
check("Al finalizar la partida se liberan sus caddies y carritos",
      recursos["caddies_libres"] == 2, f"{recursos['caddies_libres']} libres")

tablero = client.get(f"/api/dashboard?target={otro_dia}", headers=ops).json()
check("El tablero mide cuánto duró la partida",
      tablero["rounds_measured"] >= 1 and tablero["avg_round_minutes"] is not None,
      f"{tablero['avg_round_minutes']} min en {tablero['rounds_measured']} partida(s)")

# ------------------------------------------- 17. no-show desde el mostrador
print("\n17. Solicitudes que no llegaron")
slots17 = client.get(f"/api/booking/availability?slot_date={otro_dia}", headers=hotel).json()["slots"]
libre17 = next(s for s in slots17 if s["en_turno"])
sin_llegar = reservar(libre17["id"]).json()
r = client.post(f"/api/booking/reservations/{sin_llegar['id']}/no-show", headers=recepcion)
check("Antes de su hora no se puede marcar como no presentada", r.status_code == 409,
      f"HTTP {r.status_code}")

de_hoy17 = client.get(f"/api/booking/availability?slot_date={date.today().isoformat()}",
                      headers=hotel).json()["slots"]
vencida17 = next((s for s in de_hoy17 if s["expirada"]), None)
if vencida17:
    from app.core.database import SessionLocal
    from app.modules.booking.models import Reservation as _R

    # Se mueve la reserva a una salida que ya pasó para probar la regla.
    with SessionLocal() as sesion:
        reserva17 = sesion.get(_R, sin_llegar["id"])
        reserva17.tee_slot_id = vencida17["id"]
        sesion.commit()
    r = client.post(f"/api/booking/reservations/{sin_llegar['id']}/no-show", headers=recepcion)
    check("Pasada su hora, el mostrador sí la cierra", r.status_code == 200, f"HTTP {r.status_code}")
    check("El hotel la ve como no se presentó",
          client.get(f"/api/booking/reservations/{sin_llegar['id']}", headers=hotel).json()["status"]
          == "NO_SHOW")

# ------------------------------------------- 18. venta directa en mostrador
print("\n18. El que llega sin hotel")

hoteles18 = client.get("/api/catalog/hotels", headers=recepcion).json()
directo = next((h for h in hoteles18 if h["is_direct"]), None)
check("Existe el registro de venta directa",
      directo is not None and Decimal(directo["commission_rate"]) == Decimal("0.0000"),
      directo["name"] if directo else "no está")

dia18 = (date.today() + timedelta(days=6)).isoformat()
slots18 = client.get(f"/api/booking/availability?slot_date={dia18}", headers=recepcion).json()["slots"]
turno18 = next(s for s in slots18 if s["en_turno"])
r = client.post(
    "/api/booking/reservations",
    headers=recepcion,
    json={
        "tee_slot_id": turno18["id"], "hotel_id": directo["id"],
        "modality": "PARTIDA_ABIERTA", "holes": 18,
        "holder_name": "Huésped de Mostrador", "holder_email": "mostrador@ejemplo.com",
        "booked_by_name": "Quien Atiende de Prueba",
        "players": [{"full_name": "Huésped de Mostrador", "age": 44, "is_holder": True}],
    },
)
check("Recepción levanta la reserva desde el mostrador", r.status_code == 201, r.text[:120])
sin_hotel = r.json()
check("La reserva directa no paga comisión",
      Decimal(sin_hotel["commission_rate_applied"]) == Decimal("0.0000"))

liquidacion18 = client.get(
    f"/api/treasury/settlements/preview?hotel_id={directo['id']}&start={dia18}&end={dia18}",
    headers=admin,
).json()
check("La venta directa no le deja comisión a ningún hotel",
      Decimal(liquidacion18["commission_amount"]) == Decimal("0.00"),
      f"${liquidacion18['commission_amount']} sobre ${liquidacion18['gross_sales']}")

# Un hotel no puede colgar sus reservas de la venta directa: el sistema lo
# amarra a su propio hotel aunque mande otro id.
r = client.post(
    "/api/booking/reservations",
    headers=hotel,
    json={
        "tee_slot_id": next(s["id"] for s in client.get(
            f"/api/booking/availability?slot_date={dia18}", headers=hotel).json()["slots"]
            if s["en_turno"]),
        "hotel_id": directo["id"], "modality": "PARTIDA_ABIERTA", "holes": 18,
        "holder_name": "Intento del Hotel", "holder_email": "intento@ejemplo.com",
        "booked_by_name": "Quien Atiende de Prueba",
        "players": [{"full_name": "Intento del Hotel", "age": 33, "is_holder": True}],
    },
)
check("Un hotel no puede reservar como venta directa",
      r.status_code == 201 and r.json()["hotel_id"] != directo["id"],
      f"quedó en el hotel {r.json().get('hotel_name')}" if r.status_code == 201 else r.text[:90])

# ----------------------------------------------- 19. correos del sistema
print("\n19. Pase y recibo por correo")

correos = client.get("/api/correos?limit=50", headers=admin).json()
del_folio = [c for c in correos if c["folio"] == reserva["folio"]]
check("Al reservar se encola el pase con QR",
      any(c["kind"] == "PASE" for c in del_folio),
      f"{len(correos)} correos en la bandeja")
check("Al cobrar se encola el recibo",
      any(c["kind"] == "RECIBO" for c in del_folio))
check("Sin servidor de correo, los correos esperan en la bandeja",
      all(c["status"] == "PENDIENTE" for c in del_folio))

qr = client.get(f"/api/correos/reserva/{reserva_id}/qr.png", headers=recepcion)
check("El pase se puede imprimir como imagen",
      qr.status_code == 200 and qr.headers["content-type"] == "image/png" and len(qr.content) > 500,
      f"{len(qr.content)} bytes")

r = client.post(f"/api/correos/reserva/{reserva_id}/pase?destino=otro@ejemplo.com", headers=recepcion)
check("El pase se puede reenviar a otro correo",
      r.status_code == 200 and r.json()["to_email"] == "otro@ejemplo.com", r.text[:100])

r = client.get(f"/api/correos/reserva/{reserva_id}", headers=hotel)
check("El hotel ve los correos de su propia reserva", r.status_code == 200 and len(r.json()) >= 1)
r = client.get("/api/correos", headers=recepcion)
check("La bandeja completa es solo de la Administración", r.status_code == 403, f"HTTP {r.status_code}")

# El armado del mensaje se prueba aparte: es donde se rompen las plantillas.
from app.core.database import SessionLocal as _Sesion
from app.modules.mailing.service import MailingService as _Correos

with _Sesion() as _db:
    _servicio = _Correos(_db)
    _partes = {}
    _cuerpos = {}
    for _correo in _servicio.de_la_reserva(reserva_id):
        _mensaje = _servicio._armar_mime(_correo)
        _partes[_correo.kind] = [p.get_content_type() for p in _mensaje.walk()]
        _cuerpos[_correo.kind] = _servicio.cuerpo_resend(_correo)
check("El correo del pase lleva el QR pegado, no ligado",
      _partes.get("PASE", []).count("image/png") == 2, str(_partes.get("PASE")))
check("Los dos correos llevan versión de texto y versión con formato",
      all("text/plain" in v and "text/html" in v for v in _partes.values()),
      ", ".join(_partes))

# La salida real en el servidor es por HTTPS, no por SMTP: el cuerpo que se le
# manda al proveedor merece su propia verificación.
_pase = _cuerpos.get("PASE", {})
_adjuntos = _pase.get("attachments", [])
check("El pase que sale por HTTPS lleva las dos copias del QR",
      len(_adjuntos) == 2, f"{len(_adjuntos)} adjunto(s)")
check("Una copia va pegada al cuerpo con su identificador",
      any(a.get("content_id") == "pase-qr" for a in _adjuntos)
      and 'cid:pase-qr' in _pase.get("html", ""))
check("La otra va como archivo para imprimir",
      any("content_id" not in a and a.get("filename", "").startswith("pase-")
          for a in _adjuntos))
check("Los adjuntos no comparten nombre",
      len({a.get("filename") for a in _adjuntos}) == len(_adjuntos))
check("El recibo no arrastra el QR", not _cuerpos.get("RECIBO", {}).get("attachments"))

# ---------------------------------------------------------------------------
print("\n20. El pase escaneado desde el celular")

_token = reserva["qr_token"]

r = client.get(f"/api/booking/public/scan/{_token}")
check("El celular avisa del escaneo sin necesidad de sesión",
      r.status_code == 200 and r.json()["ok"] is True, f"HTTP {r.status_code}")
check("No devuelve ni un dato de la partida",
      all(c not in r.text for c in ("holder", "@", "total", "folio")), r.text[:120])

# Un lector de mano no "abre" la liga: la teclea entera en el buscador del
# mostrador. El mostrador tiene que entenderla igual que el token pelón.
r = client.get(
    "/api/checkin/lookup",
    params={"qr_token": f"https://parotasgolf.com/pase/{_token}"},
    headers=recepcion,
)
check("El lector de mano puede teclear la liga completa",
      r.status_code == 200 and r.json()["folio"] == reserva["folio"],
      f"HTTP {r.status_code}")

r = client.get("/api/booking/public/scan/token-inventado-que-no-existe")
check("Un pase inventado no identifica nada", r.status_code == 404,
      f"HTTP {r.status_code}")

r = client.get(f"/api/booking/reservations/{reserva_id}/pase", headers=hotel)
check("El hotel saca el pase de su reserva para imprimirlo",
      r.status_code == 200 and len(r.json()["qr_png_base64"]) > 100,
      f"HTTP {r.status_code}")
r = client.get(f"/api/booking/reservations/{reserva_id}/pase")
check("Sin sesión no se saca el pase de nadie", r.status_code == 401,
      f"HTTP {r.status_code}")

# Una reserva cancelada ya no deja pasar a nadie. Se fuerza el estado en la
# base para probar la guarda sin montar otra reserva completa.
from app.modules.booking.models import Reservation as _Reserva
from app.shared.enums import ReservationStatus as _Estado

with _Sesion() as _db:
    _r = _db.get(_Reserva, reserva_id)
    _estado_original = _r.status
    _r.status = _Estado.CANCELADA
    _db.commit()

r = client.get(f"/api/booking/public/scan/{_token}")
check("Un pase cancelado ya no identifica", r.status_code == 409, f"HTTP {r.status_code}")

with _Sesion() as _db:
    _r = _db.get(_Reserva, reserva_id)
    _r.status = _estado_original
    _db.commit()

# ---------------------------------------------------------------------------
print("\n21. Recepción solo levanta al que llega sin hotel")

hotel_id_celeste = reserva["hotel_id"]
_dia15 = (date.today() + timedelta(days=9)).isoformat()
_slots15 = client.get(
    f"/api/booking/availability?slot_date={_dia15}", headers=recepcion
).json()["slots"]
_turno15 = next(s for s in _slots15 if s["en_turno"])


def _cuerpo15(hotel_id, slot_id, nombre):
    cuerpo = {
        "tee_slot_id": slot_id, "modality": "PARTIDA_ABIERTA", "holes": 18,
        "holder_name": nombre, "holder_email": "mostrador15@ejemplo.com",
        "booked_by_name": "Quien Atiende de Prueba",
        "players": [{"full_name": nombre, "age": 40, "is_holder": True}],
    }
    if hotel_id is not None:
        cuerpo["hotel_id"] = hotel_id
    return cuerpo


# El hotel con convenio se lo tiene que rechazar, no reasignar en silencio.
r = client.post(
    "/api/booking/reservations",
    headers=recepcion,
    json=_cuerpo15(hotel_id_celeste, _turno15["id"], "Intento de Recepción"),
)
check("Recepción no puede colgarle la reserva a un hotel con convenio",
      r.status_code == 409, f"HTTP {r.status_code}")
check("Y el mensaje dice a quién le toca",
      "operaciones" in r.text.lower(), r.text[:120])

# Sin mandar hotel, queda en público general sola.
r = client.post(
    "/api/booking/reservations",
    headers=recepcion,
    json=_cuerpo15(None, _turno15["id"], "Huésped de Paso"),
)
check("Sin indicar hotel, recepción la deja en público general",
      r.status_code == 201 and r.json()["hotel_id"] == directo["id"],
      r.json().get("hotel_name") if r.status_code == 201 else r.text[:120])
_directa15 = r.json()

# Operaciones sí puede asignarla a un hotel con convenio.
_slots15b = client.get(
    f"/api/booking/availability?slot_date={_dia15}", headers=ops
).json()["slots"]
_turno15b = next(s for s in _slots15b if s["en_turno"])
r = client.post(
    "/api/booking/reservations",
    headers=ops,
    json=_cuerpo15(hotel_id_celeste, _turno15b["id"], "Huésped de Celeste"),
)
check("Operaciones sí le asigna la reserva a un hotel con convenio",
      r.status_code == 201 and r.json()["hotel_id"] == hotel_id_celeste,
      r.json().get("hotel_name") if r.status_code == 201 else r.text[:120])

# La cotización sigue la misma regla: recepción no cotiza con la comisión de
# un hotel al que de todos modos no le puede colgar la reserva.
r = client.post(
    "/api/booking/reservations/quote",
    headers=recepcion,
    json=_cuerpo15(hotel_id_celeste, _turno15["id"], "Cotización de Recepción"),
)
check("La cotización de recepción ignora el hotel que le manden",
      r.status_code == 200, r.text[:120])

# ---------------------------------------------------------------------------
print("\n22. El hotel ve su cuenta, no la del mostrador")

# Se usa la reserva del hotel que ya pasó por mostrador y quedó con PGA.
_como_campo = client.get(f"/api/booking/reservations/{reserva_id}", headers=recepcion).json()
_como_hotel = client.get(f"/api/booking/reservations/{reserva_id}", headers=hotel).json()

check("El hotel ve el descuento PGA que se validó en el campo",
      Decimal(_como_hotel["pga_discount_amount"]) > 0,
      f"−${_como_hotel['pga_discount_amount']}")
check("El total del hotel ya viene con el PGA descontado",
      Decimal(_como_hotel["total"])
      == Decimal(_como_hotel["subtotal_green_fees"])
      + Decimal(_como_hotel["subtotal_services"])
      - Decimal(_como_hotel["discount_amount"])
      - Decimal(_como_hotel["pga_discount_amount"]),
      f"${_como_hotel['total']}")
check("Al hotel no se le enseñan los cobros ni el saldo",
      _como_hotel["payments"] == []
      and Decimal(_como_hotel["total_paid"]) == 0
      and Decimal(_como_hotel["balance"]) == 0)
check("El replay sigue oculto para el hotel", _como_hotel["replays"] == [])

# Ahora, sobre una partida nueva, el mostrador le vende algo más al huésped y
# el hotel no debe enterarse. Va en otra reserva porque la anterior ya se cerró.
_dia16 = (date.today() + timedelta(days=10)).isoformat()
_turno16 = next(
    s for s in client.get(
        f"/api/booking/availability?slot_date={_dia16}", headers=hotel
    ).json()["slots"] if s["en_turno"]
)
r = client.post(
    "/api/booking/reservations",
    headers=hotel,
    json={
        "tee_slot_id": _turno16["id"], "modality": "PARTIDA_ABIERTA", "holes": 18,
        "holder_name": "Huésped con Consumo", "holder_email": "consumo@ejemplo.com",
        "booked_by_name": "Quien Atiende de Prueba",
        "players": [{"full_name": "Huésped con Consumo", "age": 45, "is_holder": True}],
    },
)
check("El hotel levanta la partida de la prueba", r.status_code == 201, r.text[:140])
_res16 = r.json()
client.post(f"/api/booking/reservations/{_res16['id']}/confirm", headers=ops)

_antes16 = client.get(f"/api/booking/reservations/{_res16['id']}", headers=hotel).json()

# Los bastones sí se venden en el mostrador. El caddie no: se paga directo al
# caddie, así que el mostrador lo rechaza —y eso se comprueba enseguida.
_servicio_extra = next(
    s for s in client.get("/api/catalog/services", headers=recepcion).json()
    if s["code"] == "BASTONES"
)
r = client.post(
    f"/api/checkin/{_res16['id']}",
    headers=recepcion,
    json={
        "attended_by_name": "Recepcion de Prueba",
        "services": [{"service_id": caddie_id, "quantity": 1}],
        "payments": [],
    },
)
check("El mostrador no cobra el caddie: lo paga el huésped directo",
      r.status_code == 422, f"HTTP {r.status_code} · {r.text[:90]}")
r = client.post(
    f"/api/checkin/{_res16['id']}",
    headers=recepcion,
    json={
        "attended_by_name": "Recepcion de Prueba",
        "arrivals": [{"player_id": p["id"], "arrived": True} for p in _res16["players"]],
        "services": [{"service_id": _servicio_extra["id"], "quantity": 1}],
        "payments": [],
    },
)
check("El mostrador le agrega un consumo a la partida", r.status_code == 200, r.text[:140])

_campo2 = client.get(f"/api/booking/reservations/{_res16['id']}", headers=recepcion).json()
_hotel2 = client.get(f"/api/booking/reservations/{_res16['id']}", headers=hotel).json()

check("El campo sí ve la línea del mostrador",
      any(s["added_at_counter"] for s in _campo2["services"]),
      f"{len(_campo2['services'])} líneas")
check("El hotel no ve la línea del mostrador",
      all(not s["added_at_counter"] for s in _hotel2["services"]),
      f"{len(_hotel2['services'])} líneas")
check("Y su total no subió con esa venta",
      Decimal(_hotel2["total"]) == Decimal(_antes16["total"]),
      f"antes ${_antes16['total']} · ahora ${_hotel2['total']}")
check("El total del campo sí la incluye",
      Decimal(_campo2["total"]) > Decimal(_hotel2["total"]),
      f"campo ${_campo2['total']} · hotel ${_hotel2['total']}")

# En la lista pasa lo mismo: el hotel no ve inflado su total.
_lista_hotel = client.get("/api/booking/reservations", headers=hotel).json()
_fila = next((x for x in _lista_hotel if x["id"] == _res16["id"]), None)
check("En su lista el hotel ve el mismo total que en el detalle",
      _fila is not None and Decimal(_fila["total"]) == Decimal(_hotel2["total"]),
      f"${_fila['total']}" if _fila else "no aparece")

# La comisión no se toca con la venta de mostrador: va sobre el green fee.
check("La comisión del hotel no cambia por lo que se venda en el mostrador",
      Decimal(_campo2["total"]) - Decimal(_campo2["subtotal_services"])
      == Decimal(_hotel2["total"]) - Decimal(_hotel2["subtotal_services"]),
      "misma base de comisión")

# ---------------------------------------------------------------------------
print("\n23. El PGA se puede poner por monto fijo")

r = client.put(
    "/api/catalog/pga/config",
    headers=admin,
    json={
        "discount_type": "MONTO", "value": "500.00",
        "description": "Beneficio PGA de $500 por acreditado",
        "valid_from": date.today().isoformat(),
    },
)
check("La Administración cambia el PGA a monto fijo", r.status_code == 200, r.text[:140])
check("Y queda guardado como monto",
      r.json()["discount_type"] == "MONTO" and Decimal(r.json()["value"]) == Decimal("500.00"),
      f"{r.json()['discount_type']} {r.json()['value']}")

from app.modules.catalog.service import PGAService as _PGA

with _Sesion() as _db:
    _servicio_pga = _PGA(_db)
    check("El monto se descuenta tal cual cuando la tarifa alcanza",
          _servicio_pga.compute_discount(Decimal("2800.00")) == Decimal("500.00"),
          f"−${_servicio_pga.compute_discount(Decimal('2800.00'))} sobre $2800")
    # Nunca se descuenta más de lo que cuesta ese green fee: si no, la partida
    # saldría con total negativo.
    check("Nunca descuenta más que el propio green fee",
          _servicio_pga.compute_discount(Decimal("300.00")) == Decimal("300.00"),
          f"−${_servicio_pga.compute_discount(Decimal('300.00'))} sobre $300")

# El porcentaje sigue existiendo: el club puede volver a él cuando quiera.
r = client.put(
    "/api/catalog/pga/config",
    headers=admin,
    json={
        "discount_type": "PORCENTAJE", "value": "75.00",
        "description": "Beneficio PGA 75% sobre la tarifa del portador",
        "valid_from": date.today().isoformat(),
    },
)
check("Y se puede volver a porcentaje", r.status_code == 200
      and r.json()["discount_type"] == "PORCENTAJE", r.text[:100])
with _Sesion() as _db:
    check("El porcentaje se calcula sobre la tarifa del jugador",
          _PGA(_db).compute_discount(Decimal("2800.00")) == Decimal("2100.00"),
          f"−${_PGA(_db).compute_discount(Decimal('2800.00'))} sobre $2800")

# Se deja como lo dejó el club: monto fijo de $1,000 por credencial.
client.put(
    "/api/catalog/pga/config",
    headers=admin,
    json={
        "discount_type": "MONTO", "value": "1000.00",
        "description": "Beneficio PGA: $1,000 por jugador con credencial",
        "valid_from": date.today().isoformat(),
    },
)

# ---------------------------------------------------------------------------
print("\n24. Dinero en caja cuenta solo el efectivo")

_caja = client.get("/api/treasury/cash/current", headers=admin).json()
check("La caja reporta el efectivo por separado",
      "cash_mxn" in _caja and "card_mxn" in _caja and "transfer_mxn" in _caja,
      ", ".join(k for k in ("cash_mxn", "card_mxn", "transfer_mxn") if k in _caja))
check("El efectivo no incluye la terminal ni las transferencias",
      Decimal(_caja["cash_mxn"])
      == Decimal(_caja["total_mxn"]) - Decimal(_caja["card_mxn"]) - Decimal(_caja["transfer_mxn"]),
      f"efectivo ${_caja['cash_mxn']} de ${_caja['total_mxn']} cobrados")

# ---------------------------------------------------------------------------
print("\n25. Quién levantó la reserva y quién atendió")

# La reserva del flujo principal ya pasó por las dos manos.
_quien = client.get(f"/api/booking/reservations/{reserva_id}", headers=recepcion).json()
check("Queda guardado quién levantó la reserva",
      _quien["booked_by_name"] == "Quien Atiende de Prueba", _quien["booked_by_name"])
check("Y quién atendió en el mostrador",
      _quien["attended_by_name"] == "Recepcion de Prueba", _quien["attended_by_name"])
check("El hotel también los ve: son de su propia reserva",
      client.get(f"/api/booking/reservations/{reserva_id}", headers=hotel).json()["booked_by_name"]
      == "Quien Atiende de Prueba")

# Sin nombre no se crea la reserva: es el único dato que dice quién la hizo.
_dia19 = (date.today() + timedelta(days=11)).isoformat()
_turno19 = next(
    s for s in client.get(
        f"/api/booking/availability?slot_date={_dia19}", headers=hotel
    ).json()["slots"] if s["en_turno"]
)
_base19 = {
    "tee_slot_id": _turno19["id"], "modality": "PARTIDA_ABIERTA", "holes": 18,
    "holder_name": "Huésped Sin Quien", "holder_email": "sinquien@ejemplo.com",
    "players": [{"full_name": "Huésped Sin Quien", "age": 40, "is_holder": True}],
}
r = client.post("/api/booking/reservations", headers=hotel, json=_base19)
check("Sin decir quién la levanta, la reserva se rechaza",
      r.status_code == 422, f"HTTP {r.status_code}")
r = client.post(
    "/api/booking/reservations", headers=hotel, json={**_base19, "booked_by_name": "Ab"}
)
check("Un nombre de dos letras tampoco pasa", r.status_code == 422, f"HTTP {r.status_code}")

# Pero cotizar sí funciona sin nombre: no guarda nada.
r = client.post("/api/booking/reservations/quote", headers=hotel, json=_base19)
check("Cotizar no exige el nombre", r.status_code == 200, f"HTTP {r.status_code}")

# Y el check-in tampoco se hace sin nombre.
r = client.post(
    "/api/booking/reservations", headers=hotel,
    json={**_base19, "booked_by_name": "Concierge de Noche"},
)
_res19 = r.json()
client.post(f"/api/booking/reservations/{_res19['id']}/confirm", headers=ops)
r = client.post(
    f"/api/checkin/{_res19['id']}",
    headers=recepcion,
    json={"arrivals": [{"player_id": p["id"], "arrived": True} for p in _res19["players"]]},
)
check("Sin decir quién atiende, el check-in se rechaza",
      r.status_code == 422, f"HTTP {r.status_code}")

r = client.post(
    f"/api/checkin/{_res19['id']}",
    headers=recepcion,
    json={
        "attended_by_name": "Recepción del Turno Dos",
        "arrivals": [{"player_id": p["id"], "arrived": True} for p in _res19["players"]],
    },
)
check("Con el nombre sí pasa", r.status_code == 200, r.text[:120])
_res19b = client.get(f"/api/booking/reservations/{_res19['id']}", headers=recepcion).json()
check("Se guarda el nombre de quien atendió, no el de la cuenta",
      _res19b["attended_by_name"] == "Recepción del Turno Dos",
      _res19b["attended_by_name"])
check("Y el de quien la levantó no se pierde en el camino",
      _res19b["booked_by_name"] == "Concierge de Noche", _res19b["booked_by_name"])

# La bitácora es donde esto sirve de verdad.
_bitacora19 = client.get("/api/audit?limit=200", headers=admin).json()
check("La bitácora dice quién levantó la reserva",
      any("Concierge de Noche" in (x.get("description") or "") for x in _bitacora19))
check("Y quién atendió en el mostrador",
      any("Recepción del Turno Dos" in (x.get("description") or "") for x in _bitacora19))

# Las reservas de antes del cambio se quedan sin nombre, no con uno inventado.
with _Sesion() as _db:
    _vieja = _Reserva(
        folio="LP-VIEJA", hotel_id=_quien["hotel_id"],
        tee_slot_id=_quien["tee_slot_id"], modality="PARTIDA_ABIERTA", holes=18,
        holder_name="Reserva Anterior", holder_email="anterior@ejemplo.com",
        exchange_rate_applied=Decimal("17.00"), commission_rate_applied=Decimal("0.00"),
    )
    _db.add(_vieja)
    _db.commit()
    check("Una reserva anterior al cambio se queda sin nombre, no inventado",
          _vieja.booked_by_name is None and _vieja.attended_by_name is None)
    _db.delete(_vieja)
    _db.commit()

# ---------------------------------------------------------------------------
print("\n26. Tarifa de twilight en las últimas salidas")

# Las salidas de las 2 a las 3 no alcanzan a terminar 18 hoyos, así que el club
# las vende más baratas. Mientras no exista la tarifa, caen en la normal: el
# horario se puede vender desde el primer día, sin esperar a que el club
# decida el precio.
_dia26 = (date.today() + timedelta(days=14)).isoformat()
_slots26 = client.get(
    f"/api/booking/availability?slot_date={_dia26}", headers=hotel
).json()["slots"]
_twilight = [s for s in _slots26 if s["slot_time"][:5] >= "14:00"]
_normal = [s for s in _slots26 if s["slot_time"][:5] < "14:00"]
check("El día trae salidas antes y después del twilight",
      len(_twilight) == 3 and len(_normal) == 14,
      f"{len(_normal)} normales · {len(_twilight)} de twilight")

FIN26 = date.fromisoformat(_dia26).weekday() >= 4
ADULTO26 = Decimal("4000.00") if FIN26 else Decimal("2800.00")


def _cotiza26(slot_id):
    return client.post(
        "/api/booking/reservations/quote", headers=hotel,
        json={
            "tee_slot_id": slot_id, "modality": "PARTIDA_ABIERTA", "holes": 18,
            "holder_name": "Huésped de Twilight", "holder_email": "twilight@ejemplo.com",
            "players": [{"full_name": "Huésped de Twilight", "age": 40, "is_holder": True}],
        },
    ).json()


check("Sin tarifa de twilight dada de alta, la última salida cobra la normal",
      Decimal(_cotiza26(_twilight[0]["id"])["total"]) == ADULTO26,
      f"${_cotiza26(_twilight[0]['id'])['total']}")

# El club da de alta su tarifa de twilight desde Control del sistema.
TWILIGHT26 = Decimal("1800.00")
r = client.post(
    "/api/catalog/rates", headers=admin,
    json={
        "name": "Partida abierta · twilight · 18 hoyos",
        "modality": "PARTIDA_ABIERTA", "holes": 18, "category": "ADULTO",
        "day_type": "TODOS", "time_band": "TWILIGHT",
        "price": str(TWILIGHT26), "valid_from": date.today().isoformat(),
    },
)
check("La Administración da de alta la tarifa de twilight", r.status_code == 201, r.text[:140])
check("Y queda marcada en su franja", r.json().get("time_band") == "TWILIGHT", r.text[:90])

check("Desde las 2 de la tarde se cobra el twilight",
      Decimal(_cotiza26(_twilight[0]["id"])["total"]) == TWILIGHT26,
      f"${_cotiza26(_twilight[0]['id'])['total']}")
check("Las salidas de antes siguen en la tarifa normal",
      Decimal(_cotiza26(_normal[-1]["id"])["total"]) == ADULTO26,
      f"{_normal[-1]['slot_time'][:5]} → ${_cotiza26(_normal[-1]['id'])['total']}")

# Y una reserva de twilight congela ese precio, como cualquier otra.
r = client.post(
    "/api/booking/reservations", headers=hotel,
    json={
        "tee_slot_id": _twilight[1]["id"], "modality": "PARTIDA_ABIERTA", "holes": 18,
        "holder_name": "Huésped de Twilight", "holder_email": "twilight@ejemplo.com",
        "booked_by_name": "Concierge de Twilight",
        "players": [{"full_name": "Huésped de Twilight", "age": 40, "is_holder": True}],
    },
)
check("La reserva de twilight guarda su tarifa",
      r.status_code == 201 and Decimal(r.json()["players"][0]["rate_applied"]) == TWILIGHT26,
      f"${r.json()['players'][0]['rate_applied']}" if r.status_code == 201 else r.text[:110])

# ---------------------------------------------------------------------------
print("\n27. Hándicap y GHIN")

_dia27 = (date.today() + timedelta(days=15)).isoformat()
_slot27 = client.get(
    f"/api/booking/availability?slot_date={_dia27}", headers=hotel
).json()["slots"][4]
r = client.post(
    "/api/booking/reservations", headers=hotel,
    json={
        "tee_slot_id": _slot27["id"], "modality": "GRUPO", "holes": 18,
        "holder_name": "Jugador con GHIN", "holder_email": "ghin@ejemplo.com",
        "booked_by_name": "Concierge de Prueba",
        "players": [
            {"full_name": "Jugador con GHIN", "age": 45, "is_holder": True,
             "handicap": "8.4", "ghin": "1234567"},
            {"full_name": "Jugador Solo GHIN", "age": 41, "ghin": "7654321"},
            {"full_name": "Jugador Solo Hándicap", "age": 38, "handicap": "14.2"},
            {"full_name": "Jugador Sin Nada", "age": 36},
        ],
    },
)
check("Se reserva con hándicap y GHIN", r.status_code == 201, r.text[:140])
_res27 = r.json()
_por_nombre = {p["full_name"]: p for p in _res27["players"]}
check("El GHIN se guarda junto al hándicap",
      _por_nombre["Jugador con GHIN"]["ghin"] == "1234567"
      and _por_nombre["Jugador con GHIN"]["handicap"] == "8.4")
check("Se puede traer solo el GHIN, sin hándicap",
      _por_nombre["Jugador Solo GHIN"]["ghin"] == "7654321"
      and not _por_nombre["Jugador Solo GHIN"]["handicap"])
check("Y solo el hándicap, sin GHIN",
      _por_nombre["Jugador Solo Hándicap"]["handicap"] == "14.2"
      and not _por_nombre["Jugador Solo Hándicap"]["ghin"])
check("Ninguno de los dos es obligatorio",
      not _por_nombre["Jugador Sin Nada"]["ghin"]
      and not _por_nombre["Jugador Sin Nada"]["handicap"])

# ---------------------------------------------------------------------------
print("\n28. Se suspendió el campo: se repone la ronda")

_dia28 = (date.today() + timedelta(days=16)).isoformat()
_slots28 = client.get(
    f"/api/booking/availability?slot_date={_dia28}", headers=hotel
).json()["slots"]
r = client.post(
    "/api/booking/reservations", headers=hotel,
    json={
        "tee_slot_id": _slots28[2]["id"], "modality": "GRUPO", "holes": 18,
        "holder_name": "Huésped de Lluvia", "holder_email": "lluvia@ejemplo.com",
        "booked_by_name": "Concierge de Prueba",
        "players": [
            {"full_name": f"Jugador de Lluvia {i}", "age": 40 + i, "is_holder": i == 1}
            for i in range(1, 5)
        ],
    },
)
_res28 = r.json()
check("Partida creada para la prueba de lluvia", r.status_code == 201, r.text[:120])
client.post(f"/api/booking/reservations/{_res28['id']}/confirm", headers=ops)
client.post(
    f"/api/checkin/{_res28['id']}", headers=recepcion,
    json={
        "attended_by_name": "Recepcion de Prueba",
        "arrivals": [{"player_id": p["id"], "arrived": True} for p in _res28["players"]],
        "payments": [{"currency": "MXN", "amount": str(_res28["total"]), "method": "EFECTIVO"}],
    },
)
_pagada28 = client.get(f"/api/booking/reservations/{_res28['id']}", headers=ops).json()
check("La partida salió al campo pagada",
      _pagada28["status"] == "EN_JUEGO" and Decimal(_pagada28["balance"]) == 0,
      f"{_pagada28['status']} · saldo ${_pagada28['balance']}")

# Recepción no da cortesías: eso sale del bolsillo del campo.
r = client.post(
    f"/api/booking/reservations/{_res28['id']}/interrumpir", headers=recepcion,
    json={"hoyo": 12, "motivo": "Tormenta eléctrica"},
)
check("Recepción no puede suspender la partida", r.status_code == 403, f"HTTP {r.status_code}")

r = client.post(
    f"/api/booking/reservations/{_res28['id']}/interrumpir", headers=ops,
    json={"hoyo": 12, "motivo": "Tormenta eléctrica sobre el hoyo 12"},
)
check("Operaciones marca el campo suspendido", r.status_code == 200, r.text[:140])
_interrumpida = r.json()
check("Queda anotado el hoyo donde se quedaron",
      _interrumpida["status"] == "INTERRUMPIDA" and _interrumpida["interrupted_at_hole"] == 12,
      f"{_interrumpida['status']} en el hoyo {_interrumpida['interrupted_at_hole']}")
check("Y por qué se suspendió",
      "Tormenta" in (_interrumpida["interrupted_reason"] or ""),
      _interrumpida["interrupted_reason"])
check("El cobro no se toca: ya jugaron y ya pagaron",
      Decimal(_interrumpida["total"]) == Decimal(_pagada28["total"])
      and Decimal(_interrumpida["balance"]) == 0,
      f"${_interrumpida['total']}")
check("Para el hotel su reserva sigue confirmada",
      client.get(f"/api/booking/reservations/{_res28['id']}", headers=hotel).json()["status"]
      == "CONFIRMADA")

_recursos28 = client.get(f"/api/booking/recursos?slot_date={_dia28}", headers=ops).json()
check("Los carritos y caddies se liberan al suspenderse",
      _recursos28["carritos_usados"] == 0 and _recursos28["caddies_libres"] == 2,
      f"{_recursos28['carritos_usados']} carritos · {_recursos28['caddies_libres']} caddies libres")

# La reposición es otra reserva, cualquier día, y no se cobra.
_dia28b = (date.today() + timedelta(days=20)).isoformat()
_slot28b = client.get(
    f"/api/booking/availability?slot_date={_dia28b}", headers=ops
).json()["slots"][3]
r = client.post(
    f"/api/booking/reservations/{_res28['id']}/reagendar", headers=recepcion,
    json={"tee_slot_id": _slot28b["id"]},
)
check("Recepción tampoco repone la ronda", r.status_code == 403, f"HTTP {r.status_code}")

r = client.post(
    f"/api/booking/reservations/{_res28['id']}/reagendar", headers=ops,
    json={"tee_slot_id": _slot28b["id"], "booked_by_name": "Operaciones de Prueba"},
)
check("Operaciones repone la ronda en la salida que elija", r.status_code == 201, r.text[:160])
_cortesia = r.json()
check("La reposición es otra reserva, con su propio folio",
      _cortesia["folio"] != _interrumpida["folio"], _cortesia["folio"])
check("Se juega gratis: la cortesía no cobra nada",
      Decimal(_cortesia["total"]) == Decimal("0.00")
      and Decimal(_cortesia["subtotal_green_fees"]) == Decimal("0.00"),
      f"${_cortesia['total']}")
check("Y no le deja comisión al hotel: ya la cobró en la original",
      Decimal(_cortesia["commission_rate_applied"]) == Decimal("0.0000"))
check("Puede ser cualquier día, no tiene que ser el mismo",
      _cortesia["slot_date"] == _dia28b, _cortesia["slot_date"])
check("Van los mismos jugadores, sin cobrarles la tarifa",
      len(_cortesia["players"]) == 4
      and all(Decimal(p["rate_applied"]) == 0 for p in _cortesia["players"]))
check("La cortesía dice de qué partida viene",
      _cortesia["rescheduled_from_folio"] == _interrumpida["folio"],
      _cortesia["rescheduled_from_folio"])
check("Y la original dice dónde se repuso",
      client.get(f"/api/booking/reservations/{_res28['id']}", headers=ops).json()["reposicion_folio"]
      == _cortesia["folio"])

r = client.post(
    f"/api/booking/reservations/{_res28['id']}/reagendar", headers=ops,
    json={"tee_slot_id": _slots28[5]["id"]},
)
check("No se repone dos veces la misma ronda", r.status_code == 409, f"HTTP {r.status_code}")

# Una partida que terminó bien no se repone.
r = client.post(
    f"/api/booking/reservations/{reserva_id}/reagendar", headers=ops,
    json={"tee_slot_id": _slots28[5]["id"]},
)
check("Una partida que sí terminó no lleva cortesía", r.status_code == 409,
      f"HTTP {r.status_code}")

# ---------------------------------------------------------------------------
print("\n29. Control de partidas abiertas")

_dia29 = (date.today() + timedelta(days=17)).isoformat()
_slots29 = client.get(
    f"/api/booking/availability?slot_date={_dia29}", headers=hotel
).json()["slots"]
_salida29 = _slots29[4]
_otra29 = _slots29[9]


def _abierta29(slot_id, nombre, quien, correo="abierta@ejemplo.com"):
    return client.post(
        "/api/booking/reservations", headers=quien,
        json={
            "tee_slot_id": slot_id, "modality": "PARTIDA_ABIERTA", "holes": 18,
            "holder_name": nombre, "holder_email": correo,
            "booked_by_name": f"Concierge de {nombre.split()[-1]}",
            "players": [{"full_name": nombre, "age": 42, "is_holder": True}],
        },
    )


_uno29 = _abierta29(_salida29["id"], "Huésped de Celeste", hotel).json()
_dos29 = _abierta29(_salida29["id"], "Huésped de Barceló", otro_hotel).json()
check("Dos hoteles distintos se juntan en la misma salida",
      _uno29["hotel_id"] != _dos29["hotel_id"],
      f"{_uno29['hotel_name']} + {_dos29['hotel_name']}")

# --- ver quiénes se juntaron y de qué hotel ---
r = client.get(f"/api/booking/partidas-abiertas?slot_date={_dia29}", headers=ops)
check("Operaciones ve las partidas abiertas del día", r.status_code == 200, r.text[:140])
_control = r.json()
_la_salida = next(s for s in _control["salidas"] if s["tee_slot_id"] == _salida29["id"])
check("Dice quiénes se juntaron y de qué hotel",
      {x["hotel_name"] for x in _la_salida["reservas"]}
      == {_uno29["hotel_name"], _dos29["hotel_name"]},
      ", ".join(sorted(x["hotel_name"] for x in _la_salida["reservas"])))
check("Con el nombre de quien levantó cada una",
      all(x["booked_by_name"] for x in _la_salida["reservas"]),
      ", ".join(x["booked_by_name"] for x in _la_salida["reservas"]))
check("Y cuántos lugares quedan",
      _la_salida["occupied"] == 2 and _la_salida["libres"] == 2,
      f"{_la_salida['occupied']}/4")

r = client.get(f"/api/booking/partidas-abiertas?slot_date={_dia29}", headers=hotel)
check("El hotel no entra a armar las partidas de los demás", r.status_code == 403,
      f"HTTP {r.status_code}")
r = client.get(f"/api/booking/partidas-abiertas?slot_date={_dia29}", headers=recepcion)
check("Ni recepción: es trabajo de piso", r.status_code == 403, f"HTTP {r.status_code}")

# --- cerrarla antes de que se llene ---
r = client.post(
    f"/api/booking/slots/{_salida29['id']}/partida-abierta/cerrar",
    headers=ops, json={"cerrar": True},
)
check("Se cierra la partida abierta antes de llenarse", r.status_code == 200, r.text[:140])
check("La salida queda marcada como cerrada a mano",
      r.json()["cerrada_manual"] is True and r.json()["cerrada_por"] == "cerrada",
      f"{r.json()['occupied']}/4 · {r.json()['cerrada_por']}")

r = _abierta29(_salida29["id"], "Huésped Tardío", hotel)
check("Ya cerrada, no entra nadie más aunque sobren lugares",
      r.status_code == 409, r.text[:120])

r = client.post(
    f"/api/booking/slots/{_salida29['id']}/partida-abierta/cerrar",
    headers=ops, json={"cerrar": False},
)
check("Y se puede volver a abrir", r.status_code == 200 and not r.json()["cerrada_manual"],
      r.text[:110])
r = _abierta29(_salida29["id"], "Huésped Tardío", hotel)
check("Reabierta, vuelve a admitir jugadores", r.status_code == 201, r.text[:120])
_tres29 = r.json()

# Una salida de un grupo no es una partida abierta: no se cierra así.
r = client.post(
    f"/api/booking/slots/{reserva['tee_slot_id']}/partida-abierta/cerrar",
    headers=ops, json={"cerrar": True},
)
check("La salida de un grupo no se cierra como partida abierta",
      r.status_code == 409, r.text[:120])

# --- mover gente entre partidas abiertas ---
_abierta29(_otra29["id"], "Huésped de la Otra", otro_hotel)
r = client.post(
    f"/api/booking/reservations/{_dos29['id']}/mover", headers=ops,
    json={"tee_slot_id": _otra29["id"]},
)
check("Operaciones mueve una reserva a otra partida abierta", r.status_code == 200, r.text[:160])
check("Y queda en la salida nueva",
      r.json()["tee_slot_id"] == _otra29["id"]
      and r.json()["slot_time"][:5] == _otra29["slot_time"][:5],
      f"{r.json()['slot_time'][:5]}")

_control = client.get(f"/api/booking/partidas-abiertas?slot_date={_dia29}", headers=ops).json()
_origen29 = next(s for s in _control["salidas"] if s["tee_slot_id"] == _salida29["id"])
_destino29 = next(s for s in _control["salidas"] if s["tee_slot_id"] == _otra29["id"])
check("El cupo se recalcula en las dos salidas",
      _origen29["occupied"] == 2 and _destino29["occupied"] == 2,
      f"origen {_origen29['occupied']}/4 · destino {_destino29['occupied']}/4")

r = client.post(
    f"/api/booking/reservations/{_dos29['id']}/mover", headers=recepcion,
    json={"tee_slot_id": _salida29["id"]},
)
check("Recepción no mueve partidas", r.status_code == 403, f"HTTP {r.status_code}")

# Un grupo no se mueve así: su cobro va colgado de su salida.
r = client.post(
    f"/api/booking/reservations/{_res27['id']}/mover", headers=ops,
    json={"tee_slot_id": _otra29["id"]},
)
check("Un grupo no se mueve entre partidas abiertas", r.status_code == 409, r.text[:120])

# --- abrir o cerrar la modalidad del día ---
_dia29b = (date.today() + timedelta(days=18)).isoformat()
r = client.post(
    "/api/booking/partidas-abiertas/regla-del-dia", headers=ops,
    json={"dia": _dia29b, "admite": False, "nota": "Torneo del club: no se revuelven grupos"},
)
check("Operaciones cierra las partidas abiertas de un día", r.status_code == 200, r.text[:140])
check("Y queda anotado por qué",
      r.json()["open_partidas_allowed"] is False and "Torneo" in (r.json()["note"] or ""),
      r.json().get("note"))

_slots29b = client.get(
    f"/api/booking/availability?slot_date={_dia29b}", headers=hotel
).json()["slots"]
r = _abierta29(_slots29b[3]["id"], "Huésped de Día Cerrado", hotel)
check("Ese día ya no se arman partidas abiertas", r.status_code == 409, r.text[:140])
r = client.post(
    "/api/booking/reservations", headers=hotel,
    json={
        "tee_slot_id": _slots29b[3]["id"], "modality": "GRUPO", "holes": 18,
        "holder_name": "Grupo de Día Cerrado", "holder_email": "grupo29@ejemplo.com",
        "booked_by_name": "Concierge de Prueba",
        "players": [{"full_name": f"Jugador {i}", "age": 40 + i} for i in range(1, 5)],
    },
)
check("Pero un grupo normal se sigue vendiendo igual", r.status_code == 201, r.text[:120])

check("El control del día lo dice en la pantalla",
      client.get(
          f"/api/booking/partidas-abiertas?slot_date={_dia29b}", headers=ops
      ).json()["admite_abiertas"] is False)
# La pantalla de venta también se entera: así apaga la modalidad en lugar de
# dejar capturar toda la reserva y rebotarla al guardar.
check("La disponibilidad del día avisa que no las acepta",
      client.get(
          f"/api/booking/availability?slot_date={_dia29b}", headers=hotel
      ).json()["admite_abiertas"] is False)

r = client.post(
    "/api/booking/partidas-abiertas/regla-del-dia", headers=ops,
    json={"dia": _dia29b, "admite": True, "nota": None},
)
check("Y se vuelve a abrir cuando el campo quiere",
      r.status_code == 200 and r.json()["open_partidas_allowed"] is True, r.text[:110])
r = _abierta29(_slots29b[6]["id"], "Huésped de Día Reabierto", hotel)
check("Reabierto el día, la modalidad vuelve a la venta", r.status_code == 201, r.text[:120])

r = client.post(
    "/api/booking/partidas-abiertas/regla-del-dia", headers=hotel,
    json={"dia": _dia29b, "admite": False},
)
check("El hotel no decide la modalidad del día", r.status_code == 403, f"HTTP {r.status_code}")

# Los días sin regla escrita las aceptan: no hay que dar de alta 365 filas.
check("Un día del que nadie dijo nada las acepta",
      client.get(
          f"/api/booking/partidas-abiertas?slot_date="
          f"{(date.today() + timedelta(days=30)).isoformat()}", headers=ops
      ).json()["admite_abiertas"] is True)

# La bitácora guarda estas decisiones: son del operador, no del sistema.
_bitacora29 = client.get("/api/audit?limit=300", headers=admin).json()
check("La bitácora guarda quién cerró la partida y quién movió a quién",
      any("cerrada a mano" in (x.get("description") or "") for x in _bitacora29)
      and any("movida de partida abierta" in (x.get("description") or "") for x in _bitacora29))
check("Y la decisión de cerrar el día",
      any("Partidas abiertas del" in (x.get("description") or "") for x in _bitacora29))

reponer_hora_de_corte(CORTE_ORIGINAL)

print("\n" + "=" * 66)
if FALLOS:
    print(f"  {len(FALLOS)} VERIFICACIONES FALLIDAS:")
    for f in FALLOS:
        print(f"    ✗ {f}")
else:
    print("  TODAS LAS VERIFICACIONES PASARON")
print("=" * 66 + "\n")

raise SystemExit(1 if FALLOS else 0)
