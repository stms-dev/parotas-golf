"""Verificación de alcance por rol.

No prueba el menú: prueba los endpoints directamente, que es lo que alguien
alcanzaría escribiendo la URL o usando una herramienta como curl. Si el
backend deja pasar algo, esconder el botón en React no sirve de nada.

    python verificar_roles.py
"""
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
FALLOS = []

MANANA = (date.today() + timedelta(days=1)).isoformat()


def check(label: str, condition: bool, extra: str = ""):
    marca = "✓" if condition else "✗"
    print(f"  {marca} {label}" + (f" · {extra}" if extra else ""))
    if not condition:
        FALLOS.append(label)


def sesion(email: str):
    response = client.post(
        "/api/auth/login", json={"email": email, "password": "Reserva2026*"}
    )
    assert response.status_code == 200, response.text
    data = response.json()
    return {
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
        "permisos": set(data["permissions"]),
        "home": data["home_route"],
        "rol": data["user"]["role"],
    }


ADMIN = sesion("admin@lasparotas.mx")
OPERACIONES = sesion("operaciones@lasparotas.mx")
RECEPCION = sesion("recepcion@lasparotas.mx")
HOTEL = sesion("concierge@celeste.mx")

PANTALLAS = [
    "screen:panel",
    "screen:tee_sheet",
    "screen:reservations",
    "screen:new_reservation",
    "screen:checkin",
    "screen:requests",
    "screen:finance",
    "screen:settings",
    "screen:audit",
    "screen:inventory",
]


def pantallas_de(perfil):
    return sorted(p.replace("screen:", "") for p in perfil["permisos"] if p in PANTALLAS)


print("\n" + "=" * 70)
print("  VERIFICACIÓN DE ALCANCE POR ROL")
print("=" * 70)

# -------------------------------------------------------------- 1. pantallas
print("\n1. Pantallas asignadas a cada perfil")

check(
    "Administrador general: todas",
    len(pantallas_de(ADMIN)) == 10,
    ", ".join(pantallas_de(ADMIN)),
)
check(
    "Dirección de operaciones: todas menos auditoría",
    len(pantallas_de(OPERACIONES)) == 9 and "audit" not in pantallas_de(OPERACIONES)
    and "inventory" in pantallas_de(OPERACIONES),
    ", ".join(pantallas_de(OPERACIONES)),
)
check(
    # El mostrador también levanta reservas de quien llega sin hotel y ve la
    # lista de partidas, pero sigue sin tarifas, auditoría ni inventario.
    "Recepción: mostrador, solicitudes, partidas, alta y finanzas",
    pantallas_de(RECEPCION)
    == ["checkin", "finance", "new_reservation", "requests", "reservations"],
    ", ".join(pantallas_de(RECEPCION)),
)
check(
    "Hotel: solo su panel y nueva reserva",
    pantallas_de(HOTEL) == ["new_reservation", "panel"],
    ", ".join(pantallas_de(HOTEL)),
)

check("Recepción aterriza en el mostrador", RECEPCION["home"] == "/recepcion", RECEPCION["home"])
check("El hotel aterriza en su panel", HOTEL["home"] == "/", HOTEL["home"])

# ------------------------------------------------------- 2. lo que el hotel NO
print("\n2. El hotel NO alcanza lo ajeno (aunque escriba la URL)")

prohibidos_hotel = [
    ("Resumen financiero global", "GET", "/api/treasury/summary"),
    ("Auditoría de beneficios PGA", "GET", "/api/treasury/pga-benefits"),
    ("Turno de caja", "GET", "/api/treasury/cash/current"),
    ("Histórico de cierres", "GET", "/api/treasury/cash"),
    ("Liquidaciones", "GET", "/api/treasury/settlements"),
    ("Bitácora de auditoría", "GET", "/api/audit"),
    ("Padrón PGA", "GET", "/api/catalog/pga/credentials"),
    ("Configuración del beneficio PGA", "GET", "/api/catalog/pga/config"),
    ("Validación de credencial PGA", "GET", "/api/catalog/pga/validate?pga_code=PGA-00123"),
    ("Búsqueda de check-in", "GET", "/api/checkin/lookup?folio=LP-0001"),
    ("Listado de usuarios", "GET", "/api/users"),
    ("Estado del canal en vivo", "GET", "/api/realtime/status"),
]
for etiqueta, metodo, ruta in prohibidos_hotel:
    response = client.request(metodo, ruta, headers=HOTEL["headers"])
    check(f"Hotel bloqueado: {etiqueta}", response.status_code == 403, f"HTTP {response.status_code}")

# Escrituras de configuración
escrituras_hotel = [
    ("Cambiar el tipo de cambio", "POST", "/api/catalog/exchange-rate", {"rate": "1.00"}),
    ("Crear un hotel", "POST", "/api/catalog/hotels", {"code": "X", "name": "Hotel Pirata"}),
    ("Crear un bloqueo", "POST", "/api/events", {
        "name": "Bloqueo pirata", "event_type": "TORNEO", "event_date": MANANA,
        "start_time": "09:00:00", "end_time": "09:30:00",
    }),
]
for etiqueta, metodo, ruta, cuerpo in escrituras_hotel:
    response = client.request(metodo, ruta, headers=HOTEL["headers"], json=cuerpo)
    check(f"Hotel bloqueado: {etiqueta}", response.status_code == 403, f"HTTP {response.status_code}")

# ------------------------------------------------- 3. fugas de datos sutiles
print("\n3. El hotel no ve información de los demás hoteles")

hoteles = client.get("/api/catalog/hotels", headers=HOTEL["headers"]).json()
check(
    "Solo aparece su propio hotel en el catálogo",
    len(hoteles) == 1 and hoteles[0]["name"] == "Celeste",
    f"{len(hoteles)} hotel(es): {[h['name'] for h in hoteles]}",
)
check(
    "No se filtran comisiones de otras entidades",
    all(h["name"] == "Celeste" for h in hoteles),
)

todos = client.get("/api/catalog/hotels", headers=ADMIN["headers"]).json()
directos = [h for h in todos if h["is_direct"]]
check("El administrador ve los nueve convenios más la venta directa",
      len(todos) == 10 and len(directos) == 1,
      f"{len(todos)} registros · directo: {directos[0]['name'] if directos else '—'}")

# Convenio exclusivo de otro hotel
client.post(
    "/api/catalog/discounts",
    headers=ADMIN["headers"],
    json={
        "code": "EXCLUSIVO_BAR", "description": "Solo Barceló",
        "discount_type": "PORCENTAJE", "value": "25.00",
        "valid_from": date.today().isoformat(),
        "hotel_id": next(h["id"] for h in todos if h["code"] == "BARCELO"),
    },
)
convenios_celeste = client.get("/api/catalog/discounts", headers=HOTEL["headers"]).json()
codigos_celeste = [d["code"] for d in convenios_celeste]
check(
    "No ve el convenio exclusivo de la competencia",
    "EXCLUSIVO_BAR" not in codigos_celeste,
    f"ve: {', '.join(codigos_celeste)}",
)
check("Sí ve los convenios generales", "HOTELVIP" in codigos_celeste)

# ---------------------------------------------------- 4. lo que recepción NO
print("\n4. Recepción no alcanza administración ni auditoría")

prohibidos_recepcion = [
    ("Bitácora de auditoría", "GET", "/api/audit"),
    ("Listado de usuarios", "GET", "/api/users"),
]
for etiqueta, metodo, ruta in prohibidos_recepcion:
    response = client.request(metodo, ruta, headers=RECEPCION["headers"])
    check(f"Recepción bloqueada: {etiqueta}", response.status_code == 403, f"HTTP {response.status_code}")

escrituras_recepcion = [
    ("Cambiar tarifas", "POST", "/api/catalog/rates", {
        "name": "Pirata", "modality": "INDIVIDUAL", "holes": 18,
        "category": "ADULTO", "price": "1.00", "valid_from": date.today().isoformat(),
    }),
    ("Cambiar el tipo de cambio", "POST", "/api/catalog/exchange-rate", {"rate": "1.00"}),
]
for etiqueta, metodo, ruta, cuerpo in escrituras_recepcion:
    response = client.request(metodo, ruta, headers=RECEPCION["headers"], json=cuerpo)
    check(f"Recepción bloqueada: {etiqueta}", response.status_code == 403, f"HTTP {response.status_code}")

print("\n5. Recepción sí hace su trabajo")
permitidos_recepcion = [
    ("Consultar el turno de caja", "/api/treasury/cash/current"),
    ("Validar una credencial PGA", "/api/catalog/pga/validate?pga_code=PGA-00123"),
    ("Consultar servicios", "/api/catalog/services"),
    ("Ver el tipo de cambio", "/api/catalog/exchange-rate"),
]
for etiqueta, ruta in permitidos_recepcion:
    response = client.get(ruta, headers=RECEPCION["headers"])
    check(f"Recepción puede: {etiqueta}", response.status_code == 200, f"HTTP {response.status_code}")

# ------------------------------------------------------- 6. operaciones
print("\n6. Dirección de operaciones ve todo, pero no toca lo financiero")

consultas_operaciones = [
    ("Tarifas", "/api/catalog/rates"),
    ("Tipo de cambio", "/api/catalog/exchange-rate"),
    ("Convenios", "/api/catalog/discounts"),
    ("Configuración PGA", "/api/catalog/pga/config"),
    ("Padrón PGA", "/api/catalog/pga/credentials"),
    ("Resumen financiero", "/api/treasury/summary"),
    ("Los nueve hoteles", "/api/catalog/hotels"),
]
for etiqueta, ruta in consultas_operaciones:
    response = client.get(ruta, headers=OPERACIONES["headers"])
    check(f"Operaciones consulta: {etiqueta}", response.status_code == 200, f"HTTP {response.status_code}")

escrituras_operaciones = [
    ("Cambiar tarifas", "POST", "/api/catalog/rates", {
        "name": "Pirata", "modality": "INDIVIDUAL", "holes": 18,
        "category": "ADULTO", "price": "1.00", "valid_from": date.today().isoformat(),
    }),
    ("Cambiar el tipo de cambio", "POST", "/api/catalog/exchange-rate", {"rate": "1.00"}),
    ("Crear convenios", "POST", "/api/catalog/discounts", {
        "code": "PIRATA", "discount_type": "PORCENTAJE", "value": "90.00",
        "valid_from": date.today().isoformat(),
    }),
    ("Administrar usuarios", "POST", "/api/users", {
        "email": "pirata@x.mx", "full_name": "Usuario Pirata",
        "role": "SUPER_ADMIN", "password": "Pirata12345",
    }),
]
for etiqueta, metodo, ruta, cuerpo in escrituras_operaciones:
    response = client.request(metodo, ruta, headers=OPERACIONES["headers"], json=cuerpo)
    check(f"Operaciones NO puede: {etiqueta}", response.status_code == 403, f"HTTP {response.status_code}")

# La bitácora pasó a ser exclusiva de la Administración.
response = client.get("/api/audit", headers=OPERACIONES["headers"])
check("Operaciones NO consulta la bitácora", response.status_code == 403, f"HTTP {response.status_code}")
response = client.get("/api/audit", headers=ADMIN["headers"])
check("La Administración sí consulta la bitácora", response.status_code == 200, f"HTTP {response.status_code}")

# El inventario lo lleva operaciones; el mostrador y los hoteles no lo tocan.
print("\n   Inventario del Pro-Shop:")
check("Operaciones consulta el inventario",
      client.get("/api/inventory/items", headers=OPERACIONES["headers"]).status_code == 200)
check("Recepción NO ve el inventario",
      client.get("/api/inventory/items", headers=RECEPCION["headers"]).status_code == 403)
check("Un hotel NO ve el inventario",
      client.get("/api/inventory/items", headers=HOTEL["headers"]).status_code == 403)

print("\n   Y sí administra lo operativo:")
operativas = [
    ("Crear eventos y bloqueos", "POST", "/api/events", {
        "name": "Torneo de operaciones", "event_type": "TORNEO",
        "event_date": (date.today() + timedelta(days=5)).isoformat(),
        "start_time": "12:00:00", "end_time": "12:30:00",
    }),
]
for etiqueta, metodo, ruta, cuerpo in operativas:
    response = client.request(metodo, ruta, headers=OPERACIONES["headers"], json=cuerpo)
    check(f"Operaciones puede: {etiqueta}", response.status_code in (200, 201), f"HTTP {response.status_code}")

print("\n   Precios y configuración: Operaciones solo consulta")
solo_consulta = [
    ("Ajustar horarios del campo", "PATCH", "/api/catalog/schedule/1", {"slot_capacity": 4}),
    ("Cambiar el precio de un servicio", "PATCH", "/api/catalog/services/1", {"price": "1.00"}),
    ("Cambiar la comisión de un hotel", "PATCH", "/api/catalog/hotels/1", {"commission_rate": "1.00"}),
]
for etiqueta, metodo, ruta, cuerpo in solo_consulta:
    response = client.request(metodo, ruta, headers=OPERACIONES["headers"], json=cuerpo)
    check(f"Operaciones NO puede: {etiqueta}", response.status_code == 403, f"HTTP {response.status_code}")

# --------------------------------------------------- 7. el hotel sí trabaja
print("\n7. El hotel sí hace lo suyo")

permitidos_hotel = [
    ("Ver su panel del día", f"/api/dashboard?target={MANANA}"),
    ("Consultar disponibilidad", f"/api/booking/availability?slot_date={MANANA}"),
    ("Ver sus propias reservas", "/api/booking/reservations"),
    ("Consultar tarifas y servicios", "/api/catalog/services"),
    ("Ver los horarios del campo", "/api/catalog/schedule"),
]
for etiqueta, ruta in permitidos_hotel:
    response = client.get(ruta, headers=HOTEL["headers"])
    check(f"Hotel puede: {etiqueta}", response.status_code == 200, f"HTTP {response.status_code}")

slots = client.get(
    f"/api/booking/availability?slot_date={MANANA}", headers=HOTEL["headers"]
).json()["slots"]
libre = next(s for s in slots if s["status"] == "DISPONIBLE")
creada = client.post(
    "/api/booking/reservations",
    headers=HOTEL["headers"],
    json={
        "tee_slot_id": libre["id"], "modality": "GRUPO", "holes": 18,
        "holder_name": "Huésped de Celeste", "holder_email": "huesped@ejemplo.com",
        "players": [
            {"full_name": "Jugador A", "age": 40},
            {"full_name": "Jugador B", "age": 41},
        ],
    },
)
check("Hotel puede: crear una reserva", creada.status_code == 201, f"HTTP {creada.status_code}")

if creada.status_code == 201:
    reserva = creada.json()
    propia = client.get(f"/api/booking/reservations/{reserva['id']}", headers=HOTEL["headers"])
    check("Hotel puede: ver el detalle de SU reserva", propia.status_code == 200)

    otro = sesion("concierge@barcelo.mx")
    ajena = client.get(f"/api/booking/reservations/{reserva['id']}", headers=otro["headers"])
    check("Otro hotel NO ve esa reserva", ajena.status_code == 404, f"HTTP {ajena.status_code}")


# ------------------------------------------ 4. las pantallas nuevas del menú
print("\n4. Pantallas de administración añadidas al menú")

# El Dashboard de Hoteles y Precios & Tarifas se montan sobre permisos que
# ya existían; se comprueba que sigan siendo exclusivos del campo.
check("Hotel NO ve el Dashboard de Hoteles", "catalog:view_hotels" not in HOTEL["permisos"])
# Recepción sí necesita la lista de hoteles: al levantar una reserva en
# mostrador tiene que poder decir de qué hotel viene el huésped.
check("Recepción sí elige el hotel al reservar", "catalog:view_hotels" in RECEPCION["permisos"])
for etiqueta, perfil in (("Hotel", HOTEL), ("Recepción", RECEPCION)):
    check(
        f"{etiqueta} NO ve Precios & Tarifas",
        "screen:settings" not in perfil["permisos"],
    )

check(
    "Dirección de operaciones sí ve el Dashboard de Hoteles",
    "catalog:view_hotels" in OPERACIONES["permisos"],
)
check(
    "Dirección de operaciones consulta precios pero no los edita",
    "screen:settings" in OPERACIONES["permisos"]
    and "catalog:manage_rates" not in OPERACIONES["permisos"],
)
check(
    "Solo la Administración edita tarifas",
    "catalog:manage_rates" in ADMIN["permisos"],
)

mis_hoteles = client.get("/api/catalog/hotels", headers=HOTEL["headers"])
check(
    "El hotel solo se ve a sí mismo en el catálogo de hoteles",
    mis_hoteles.status_code == 200 and len(mis_hoteles.json()) == 1,
    f"HTTP {mis_hoteles.status_code} · {len(mis_hoteles.json()) if mis_hoteles.status_code == 200 else '—'} hotel(es)",
)

todos_hoteles = client.get("/api/catalog/hotels", headers=OPERACIONES["headers"])
check(
    "El campo sí ve los nueve convenios",
    todos_hoteles.status_code == 200 and len(todos_hoteles.json()) >= 8,
    f"{len(todos_hoteles.json()) if todos_hoteles.status_code == 200 else '—'} hoteles",
)

benef = client.get("/api/treasury/pga-benefits", headers=OPERACIONES["headers"])
check(
    "Dirección de operaciones consulta la auditoría PGA",
    benef.status_code == 200,
    f"HTTP {benef.status_code}",
)

# Finanzas se ve igual desde el mostrador: la venta, las comisiones y el
# detalle PGA. Lo que sigue sin poder es abrir o cerrar el turno de caja.
recep_benef = client.get("/api/treasury/pga-benefits", headers=RECEPCION["headers"])
check(
    "Recepción SÍ consulta el detalle de beneficios PGA",
    recep_benef.status_code == 200,
    f"HTTP {recep_benef.status_code}",
)

# ----------------------------------------- 5. quién hace qué con la caja
print("\n5. El turno de caja es de operaciones, no del mostrador")

abrir = {"opening_cash_mxn": "0.00", "opening_cash_usd": "0.00"}
r = client.post("/api/treasury/cash/open", json=abrir, headers=RECEPCION["headers"])
check("Recepción NO abre el turno de caja", r.status_code == 403, f"HTTP {r.status_code}")

r = client.get("/api/treasury/cash/current", headers=RECEPCION["headers"])
check("Recepción SÍ ve la caja contra la que cobra", r.status_code == 200, f"HTTP {r.status_code}")

r = client.post("/api/treasury/cash/open", json=abrir, headers=OPERACIONES["headers"])
check("Operaciones abre el turno de caja", r.status_code in (200, 201, 409), f"HTTP {r.status_code}")

r = client.get("/api/catalog/rates", headers=OPERACIONES["headers"])
check("Operaciones consulta precios y tarifas", r.status_code == 200, f"HTTP {r.status_code}")

r = client.get("/api/treasury/summary", headers=RECEPCION["headers"])
check("Recepción ve el resumen financiero", r.status_code == 200, f"HTTP {r.status_code}")

print("\n" + "=" * 70)
if FALLOS:
    print(f"  {len(FALLOS)} VERIFICACIONES FALLIDAS:")
    for f in FALLOS:
        print(f"    ✗ {f}")
else:
    print("  TODAS LAS VERIFICACIONES DE ALCANCE PASARON")
print("=" * 70 + "\n")

raise SystemExit(1 if FALLOS else 0)
