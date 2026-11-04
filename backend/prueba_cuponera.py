"""Prueba de las cuponeras: se vende, se paga, se canjea con el folio.

    python prueba_cuponera.py
"""
import os
import subprocess
import sys
from datetime import date, timedelta

if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

import logging
logging.disable(logging.INFO)
from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.shared.tiempo import hoy  # noqa: E402

c = TestClient(app)
fallas = []
_n = [0]


def check(nombre, ok, detalle=""):
    print(("  ✓ " if ok else "  ✗ ") + nombre + (f" · {detalle}" if detalle else ""))
    if not ok:
        fallas.append(nombre)


def entrar(correo):
    _n[0] += 1
    r = c.post("/api/auth/login", json={"email": correo, "password": "Reserva2026*"},
               headers={"X-Forwarded-For": f"10.8.0.{_n[0]}"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


adm = entrar("admin@lasparotas.mx")
ops = entrar("operaciones@lasparotas.mx")
rec = entrar("recepcion@lasparotas.mx")
hotel = entrar("concierge@celeste.mx")

D = hoy()
base = {
    "titular_nombre": "Roberto Salinas", "empresa": "Constructora del Pacífico", "telefono": "9581234567",
    "pases_total": 50, "hoyos_18": True, "hoyos_9": False, "precio_total": "90000", "precio_lista": "120000",
    "vence_el": (D + timedelta(days=180)).isoformat(), "notas": "Venta directa",
}

print("\n1. Venta")
r = c.post("/api/cuponeras", json=base, headers=hotel)
check("Un hotel no puede vender cuponeras", r.status_code == 403, f"HTTP {r.status_code}")
r = c.post("/api/cuponeras", json=base, headers=rec)
check("Recepción tampoco", r.status_code == 403, f"HTTP {r.status_code}")
r = c.post("/api/cuponeras", json={**base, "hoyos_18": False, "hoyos_9": False}, headers=ops)
check("Debe tener al menos una modalidad", r.status_code in (409, 422), r.text[:80])
r = c.post("/api/cuponeras", json={**base, "vence_el": (D - timedelta(days=1)).isoformat()}, headers=ops)
check("No acepta una vigencia pasada", r.status_code in (409, 422), r.text[:80])
r = c.post("/api/cuponeras", json={**base, "precio_total": "130000"}, headers=ops)
check("El precio no puede pasar de la tarifa normal", r.status_code in (409, 422), r.text[:80])
r = c.post("/api/cuponeras", json={**base, "pagada": True}, headers=ops)
check("Pagada exige la referencia", r.status_code in (409, 422), r.text[:80])
r = c.post("/api/cuponeras", json=base, headers=ops)
check("Operaciones vende la cuponera", r.status_code == 201, r.text[:100])
cup = r.json()
check("Folio con formato CUP-0001", cup["folio"] == "CUP-0001", cup["folio"])
check("Nace pendiente de pago", cup["estado"] == "PENDIENTE_PAGO" and cup["pago_estado"] == "PENDIENTE")
check("Calcula descuento y precio por pase", float(cup["descuento_pct"]) == 25.0 and float(cup["precio_por_pase"]) == 1800.0,
      f"{cup['descuento_pct']} / {cup['precio_por_pase']}")

print("\n2. Sin pago confirmado no se canjea")
canje = {"jugadores": 4, "hoyos": 18, "atendio": "Laura Pérez"}
r = c.post(f"/api/cuponeras/{cup['id']}/canjear", json=canje, headers=rec)
check("Pendiente de pago: rechaza", r.status_code == 409 and "transferencia" in r.text, r.text[:100])
r = c.get(f"/api/cuponeras/codigo/{cup['folio']}", headers=rec)
check("El mostrador ve por qué no se puede", r.status_code == 200 and r.json()["motivo_bloqueo"], r.text[:100])
check("El mostrador no ve precio ni pago", "precio_total" not in r.json() and "pago_referencia" not in r.json())
r = c.post(f"/api/cuponeras/{cup['id']}/pago", json={"referencia": "SPEI 99887766"}, headers=rec)
check("Recepción no confirma pagos", r.status_code == 403)
r = c.post(f"/api/cuponeras/{cup['id']}/pago", json={"referencia": "SPEI 99887766"}, headers=ops)
check("Operaciones confirma el pago", r.status_code == 200 and r.json()["estado"] == "ACTIVA", r.text[:100])
check("Queda quién y cuándo", r.json()["pago_confirmo_nombre"] and r.json()["pagada_en"])
r = c.post(f"/api/cuponeras/{cup['id']}/pago", json={"referencia": "otra"}, headers=ops)
check("No se confirma dos veces", r.status_code == 409)

print("\n3. Canje en el mostrador")
r = c.get("/api/cuponeras/codigo/%20cup-0001%20", headers=rec)
check("El folio se lee aunque venga con espacios y minúsculas", r.status_code == 200 and r.json()["saldo"] == 50, r.text[:80])
r = c.get("/api/cuponeras/codigo/CUP-9999", headers=rec)
check("Folio inexistente: 404", r.status_code == 404)
r = c.post(f"/api/cuponeras/{cup['id']}/canjear", json={**canje, "jugadores": 9, "reserva_folio": "rp-123"}, headers=rec)
check("Recepción canjea 9 jugadores", r.status_code == 200 and r.json()["saldo"] == 41, r.text[:100])
check("Queda en el historial", len(r.json()["usos"]) == 1 and r.json()["usos"][0]["jugadores"] == 9
      and r.json()["usos"][0]["reserva_folio"] == "RP-123" and r.json()["usos"][0]["validado_por_nombre"] == "Laura Pérez")
r = c.post(f"/api/cuponeras/{cup['id']}/canjear", json={**canje, "hoyos": 9}, headers=rec)
check("No canjea 9 hoyos si no está prendida", r.status_code == 409 and "9 hoyos" in r.text, r.text[:80])
r = c.post(f"/api/cuponeras/{cup['id']}/canjear", json={**canje, "jugadores": 42}, headers=rec)
check("No canjea más de lo que queda", r.status_code == 409 and "41" in r.text, r.text[:100])
r = c.post(f"/api/cuponeras/{cup['id']}/canjear", json={**canje, "atendio": "x"}, headers=rec)
check("Exige el nombre de quien valida", r.status_code == 422)

print("\n4. Cambios: solo la Administración")
cambio = {"hoyos_9": True, "precio_total": "85000", "nota_cambio": "Descuento acordado"}
r = c.patch(f"/api/cuponeras/{cup['id']}", json=cambio, headers=ops)
check("Operaciones no cambia precio ni modalidad", r.status_code == 403)
r = c.patch(f"/api/cuponeras/{cup['id']}", json={"pases_total": 5, "nota_cambio": "prueba"}, headers=adm)
check("No baja pases por debajo de los usados", r.status_code == 409, r.text[:100])
r = c.patch(f"/api/cuponeras/{cup['id']}", json=cambio, headers=adm)
check("La Administración cambia precio y prende 9 hoyos", r.status_code == 200 and r.json()["hoyos_9"] and float(r.json()["precio_total"]) == 85000, r.text[:100])
r = c.post(f"/api/cuponeras/{cup['id']}/canjear", json={**canje, "jugadores": 2, "hoyos": 9}, headers=rec)
check("Ahora sí canjea 9 hoyos (1 pase por jugador)", r.status_code == 200 and r.json()["saldo"] == 39, r.text[:80])

print("\n5. Fechas bloqueadas")
r = c.patch(f"/api/cuponeras/{cup['id']}", json={"fechas_bloqueadas": [
    {"desde": D.isoformat(), "hasta": (D + timedelta(days=1)).isoformat(), "motivo": "Torneo"}], "nota_cambio": "Torneo"}, headers=adm)
check("Se bloquea un rango", r.status_code == 200 and len(r.json()["fechas_bloqueadas"]) == 1)
r = c.post(f"/api/cuponeras/{cup['id']}/canjear", json=canje, headers=rec)
check("Hoy bloqueado: rechaza con el motivo", r.status_code == 409 and "Torneo" in r.text, r.text[:100])
r = c.patch(f"/api/cuponeras/{cup['id']}", json={"fechas_bloqueadas": [], "nota_cambio": "Se liberó"}, headers=adm)
check("Se libera el bloqueo", r.status_code == 200 and r.json()["fechas_bloqueadas"] == [])
r = c.patch(f"/api/cuponeras/{cup['id']}", json={"fechas_bloqueadas": [
    {"desde": D.isoformat(), "hasta": (D - timedelta(days=2)).isoformat()}], "nota_cambio": "mal"}, headers=adm)
check("Un rango al revés se rechaza", r.status_code in (409, 422))

print("\n6. Anular un canje")
usos = c.get(f"/api/cuponeras/{cup['id']}", headers=ops).json()["usos"]
uso9 = next(u for u in usos if u["jugadores"] == 9)
r = c.post(f"/api/cuponeras/usos/{uso9['id']}/anular", json={"nota": "Se capturó dos veces"}, headers=ops)
check("Operaciones no anula canjes", r.status_code == 403)
r = c.post(f"/api/cuponeras/usos/{uso9['id']}/anular", json={"nota": "Se capturó dos veces"}, headers=adm)
check("La Administración anula y regresan los pases", r.status_code == 200 and r.json()["saldo"] == 48, r.text[:100])
r = c.post(f"/api/cuponeras/usos/{uso9['id']}/anular", json={"nota": "otra vez"}, headers=adm)
check("No se anula dos veces", r.status_code == 409)

print("\n7. Agotada, vencida y cancelada")
r = c.post("/api/cuponeras", json={**base, "pases_total": 3, "pagada": True, "pago_referencia": "SPEI 1"}, headers=adm)
chica = r.json()
check("Pagada al registrar queda activa", r.status_code == 201 and chica["estado"] == "ACTIVA")
r = c.post(f"/api/cuponeras/{chica['id']}/canjear", json={**canje, "jugadores": 3}, headers=rec)
check("Canjear todos la deja agotada", r.status_code == 200 and r.json()["estado"] == "AGOTADA" and r.json()["saldo"] == 0)
r = c.post(f"/api/cuponeras/{chica['id']}/canjear", json={**canje, "jugadores": 1}, headers=rec)
check("Agotada no canjea", r.status_code == 409)
r = c.post("/api/cuponeras", json={**base, "pagada": True, "pago_referencia": "SPEI 2"}, headers=ops)
otra = r.json()
r = c.post(f"/api/cuponeras/{otra['id']}/cancelar", json={"nota": "Se devolvió el pago"}, headers=ops)
check("Operaciones no cancela", r.status_code == 403)
r = c.post(f"/api/cuponeras/{otra['id']}/cancelar", json={"nota": "Se devolvió el pago"}, headers=adm)
check("La Administración cancela", r.status_code == 200 and r.json()["estado"] == "CANCELADA")
r = c.post(f"/api/cuponeras/{otra['id']}/canjear", json=canje, headers=rec)
check("Cancelada no canjea", r.status_code == 409 and "cancelada" in r.text)
# Vencida: se vence a mano en la base.
from app.core.database import SessionLocal  # noqa: E402
from app.modules.cuponeras.models import Cuponera  # noqa: E402
with SessionLocal() as db:
    k = db.get(Cuponera, cup["id"])
    k.vence_el = D - timedelta(days=1)
    db.commit()
r = c.post(f"/api/cuponeras/{cup['id']}/canjear", json=canje, headers=rec)
check("Vencida no canjea", r.status_code == 409 and "Venció" in r.text, r.text[:100])

print("\n8. Lista y filtros")
r = c.get("/api/cuponeras", headers=ops)
check("Operaciones ve la lista", r.status_code == 200 and len(r.json()) == 3, str(len(r.json())))
r = c.get("/api/cuponeras?estado=AGOTADA", headers=adm)
check("Filtra por estado", [x["folio"] for x in r.json()] == [chica["folio"]], str([x["folio"] for x in r.json()]))
r = c.get("/api/cuponeras?q=salinas", headers=adm)
check("Busca por titular", len(r.json()) == 3)
r = c.get("/api/cuponeras", headers=rec)
check("Recepción no ve la lista (ni precios)", r.status_code == 403)

print()
if fallas:
    print("FALLARON:", fallas)
    sys.exit(1)
print("Todo en orden.")
