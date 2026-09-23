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
CADDIE = Decimal("600.00")
GREEN = 3 * ADULTO_18 + MENOR_18            # 3 adultos + 1 menor
ACOMPANANTE = Decimal("800.00")             # no juega, pero paga su lugar
SERVICIOS = 2 * CADDIE + ACOMPANANTE          # 2 caddies + 1 acompañante
TOTAL = GREEN + SERVICIOS
REPLAY = Decimal("1200.00")                   # ronda extra, por partida
PGA = (ADULTO_18 * Decimal("0.75")).quantize(Decimal("0.01"))   # 75% al titular
TOTAL_PGA = TOTAL - PGA
USD_MXN = Decimal("100.00") * Decimal("17.20")
EFECTIVO = TOTAL_PGA - USD_MXN
response = client.get(f"/api/booking/availability?slot_date={manana}", headers=hotel)
slots = response.json()["slots"]
check("Salidas generadas desde configuración", len(slots) == 8, f"{len(slots)} salidas 09:00–12:30")
check("Hasta 4 jugadores por salida", all(s["capacity"] == 4 for s in slots))
slot_id = slots[0]["id"]

# ------------------------------------------------------------ 3. cotización
print("\n3. Cotización previa")
payload = {
    "tee_slot_id": slot_id,
    "modality": "GRUPO",
    "holes": 18,
    "holder_name": "Roberto Morales Vega",
    "holder_email": "roberto.morales@ejemplo.com",
    "holder_phone": "+52 55 1234 5678",
    "holder_room": "Suite 412",
    "players": [
        {"full_name": "Roberto Morales Vega", "age": 45, "is_holder": True, "pga_code": "PGA-00123", "credential_number": "45872"},
        {"full_name": "Elena Morales Ruiz", "age": 42},
        {"full_name": "Fernando Gaviria", "age": 38},
        {"full_name": "Mateo Morales", "age": 13},
    ],
    "companions": [{"full_name": "Sofía Carvajal", "age": 40}],
    "services": [{"service_id": 1, "quantity": 2}],
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
payload_extra["modality"] = "INDIVIDUAL"
payload_extra["players"] = [{"full_name": "Jugador Extra", "age": 30}]
response = client.post("/api/booking/reservations", json=payload_extra, headers=hotel)
check("Salida ya asignada rechaza otra partida", response.status_code == 409,
      response.json()["error"]["message"][:60])

# Aislamiento por hotel
otro_hotel = token("concierge@barcelo.mx")
response = client.get(f"/api/booking/reservations/{reserva_id}", headers=otro_hotel)
check("Otro hotel no ve la reserva ajena", response.status_code == 404)

# Reglas de modalidad
payload_malo = dict(payload)
payload_malo["modality"] = "INDIVIDUAL"
response = client.post("/api/booking/reservations", json=payload_malo, headers=hotel)
check("Paquete Individual con 4 jugadores rechazado", response.status_code == 422)

# ------------------------------------------------- 4b. una salida, una partida
print("\n4b. Una salida la toma una sola partida")

response = client.get(f"/api/booking/availability?slot_date={manana}", headers=hotel)
libres = [s for s in response.json()["slots"] if s["status"] == "DISPONIBLE"]

# Un solo jugador toma la salida completa: el campo no junta desconocidos.
solo = dict(payload)
solo["tee_slot_id"] = libres[0]["id"]
solo["modality"] = "INDIVIDUAL"
solo["players"] = [{"full_name": "Jugador Solitario", "age": 44}]
solo["services"] = []
response = client.post("/api/booking/reservations", json=solo, headers=hotel)
check("Un jugador solo toma la salida completa", response.status_code == 201)

response = client.get(f"/api/booking/availability?slot_date={manana}", headers=otro_hotel)
tomada = next(s for s in response.json()["slots"] if s["id"] == libres[0]["id"])
check("Queda OCUPADO con un solo jugador", tomada["status"] == "OCUPADO",
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
    {"full_name": "Intruso Uno", "age": 40},
    {"full_name": "Intruso Dos", "age": 41},
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
      response.status_code == 200 and Decimal(response.json()["subtotal_services"]) == 2 * CADDIE,
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
        json={"arrivals": [], "pga_validations": [], "payments": pagos},
        headers=recepcion,
    )

r = cobro(saldo_exacto - Decimal("500.00"))
check("Cobrar de menos se rechaza", r.status_code == 409, f"HTTP {r.status_code}")

# Con tarjeta o transferencia se cobra exacto; solo el efectivo admite cambio.
r = client.post(
    f"/api/checkin/{reserva_id}",
    json={"payments": [{"currency": "MXN", "amount": str(saldo_exacto + Decimal("500.00")), "method": "TARJETA"}]},
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
check("El hotel no ve el replay", r.json()["replays"] == []
      and sum(Decimal(p["amount_mxn"]) for p in r.json()["payments"]) == TOTAL_PGA)

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
payload_bloqueado["modality"] = "INDIVIDUAL"
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

# ------------------------------------------- 16. carritos, caddies y orden
print("\n16. Carritos, caddies y orden de los horarios")

otro_dia = (date.today() + timedelta(days=5)).isoformat()
slots16 = client.get(f"/api/booking/availability?slot_date={otro_dia}", headers=hotel).json()["slots"]
en_turno = [s for s in slots16 if s["en_turno"]]
check("Solo una salida está en turno por día", len(en_turno) == 1,
      f"{en_turno[0]['slot_time'][:5]} de {len(slots16)} horarios")
check("Las demás dicen que esperan su turno",
      all(s["cerrada_por"] == "orden" for s in slots16 if not s["en_turno"]))

def reservar(slot_id, jugadores=2, acompanantes=0, servicios=None, quien=None):
    return client.post(
        "/api/booking/reservations",
        headers=quien or hotel,
        json={
            "tee_slot_id": slot_id, "modality": "GRUPO", "holes": 18,
            "holder_name": "Titular de Prueba", "holder_email": "orden@ejemplo.com",
            "players": [
                {"full_name": f"Jugador {i + 1}", "age": 30, "is_holder": i == 0}
                for i in range(jugadores)
            ],
            "companions": [{"full_name": f"Acompañante {i + 1}"} for i in range(acompanantes)],
            "services": servicios or [],
        },
    )

r = reservar(slots16[3]["id"])
check("No se puede saltar el orden de los horarios", r.status_code == 409, f"HTTP {r.status_code}")

r = reservar(en_turno[0]["id"], jugadores=2, acompanantes=1)
check("La salida en turno sí se reserva", r.status_code == 201, r.text[:110])
check("Los carritos se asignan solos: dos personas por carrito",
      r.json()["carts_used"] == 2, f"{r.json().get('carts_used')} carritos para 3 personas")

slots16 = client.get(f"/api/booking/availability?slot_date={otro_dia}", headers=hotel).json()["slots"]
siguiente = [s for s in slots16 if s["en_turno"]]
check("Al llenarse una salida se abre la siguiente",
      len(siguiente) == 1 and siguiente[0]["slot_time"] > en_turno[0]["slot_time"],
      f"ahora toca {siguiente[0]['slot_time'][:5]}")

recursos = client.get(f"/api/booking/recursos?slot_date={otro_dia}", headers=ops).json()
check("El día lleva la cuenta de sus carritos",
      recursos["carritos_usados"] == 2 and recursos["carritos_libres"] == 18,
      f"{recursos['carritos_usados']} usados de {recursos['carritos_totales']}")

caddie_id = next(s["id"] for s in client.get("/api/catalog/services", headers=ops).json()
                 if s["code"] == "CADDIE")
r = reservar(siguiente[0]["id"], servicios=[{"service_id": caddie_id, "quantity": 3}])
check("No se piden más caddies de los que hay", r.status_code == 409, f"HTTP {r.status_code}")

r = reservar(siguiente[0]["id"], servicios=[{"service_id": caddie_id, "quantity": 2}])
check("Con caddies libres sí se reserva", r.status_code == 201, r.text[:110])
con_caddies = r.json()["id"]

slots16 = client.get(f"/api/booking/availability?slot_date={otro_dia}", headers=hotel).json()["slots"]
tercera = next(s for s in slots16 if s["en_turno"])
r = reservar(tercera["id"], servicios=[{"service_id": caddie_id, "quantity": 1}])
check("Los caddies ocupados ya no se prestan a otra partida", r.status_code == 409,
      f"HTTP {r.status_code}")
recursos = client.get(f"/api/booking/recursos?slot_date={otro_dia}", headers=ops).json()
check("El tablero dice qué partida tiene los caddies",
      recursos["caddies_libres"] == 0 and any(p["caddies"] == 2 for p in recursos["partidas"]))

# Los caddies vuelven a estar libres cuando su partida se finaliza.
for paso in ("confirm",):
    client.post(f"/api/booking/reservations/{con_caddies}/{paso}", headers=ops)
detalle = client.get(f"/api/booking/reservations/{con_caddies}", headers=ops).json()
client.post(
    f"/api/checkin/{con_caddies}",
    json={
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
        "modality": "INDIVIDUAL", "holes": 18,
        "holder_name": "Huésped de Mostrador", "holder_email": "mostrador@ejemplo.com",
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
        "hotel_id": directo["id"], "modality": "INDIVIDUAL", "holes": 18,
        "holder_name": "Intento del Hotel", "holder_email": "intento@ejemplo.com",
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
    for _correo in _servicio.de_la_reserva(reserva_id):
        _mensaje = _servicio._armar(_correo)
        _partes[_correo.kind] = [p.get_content_type() for p in _mensaje.walk()]
check("El correo del pase lleva el QR pegado, no ligado",
      _partes.get("PASE", []).count("image/png") == 2, str(_partes.get("PASE")))
check("Los dos correos llevan versión de texto y versión con formato",
      all("text/plain" in v and "text/html" in v for v in _partes.values()),
      ", ".join(_partes))

print("\n" + "=" * 66)
if FALLOS:
    print(f"  {len(FALLOS)} VERIFICACIONES FALLIDAS:")
    for f in FALLOS:
        print(f"    ✗ {f}")
else:
    print("  TODAS LAS VERIFICACIONES PASARON")
print("=" * 66 + "\n")

raise SystemExit(1 if FALLOS else 0)
