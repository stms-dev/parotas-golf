"""v23.1: acompañantes (no juegan) en el sitio: $800 por persona, sin tomar lugar.

    python prueba_v231.py
"""
import os, subprocess, sys
from datetime import timedelta

if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

import logging
logging.disable(logging.INFO)
from fastapi.testclient import TestClient  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.booking.models import Reservation, TeeSlot  # noqa: E402
from app.shared.tiempo import hoy  # noqa: E402

c = TestClient(app)
fallas = []


def check(n, ok, d=""):
    print(("  ✓ " if ok else "  ✗ ") + n + (f" · {d}" if d else ""))
    if not ok:
        fallas.append(n)


dia = (hoy() + timedelta(days=4)).isoformat()
sal = [s for s in c.get(f"/api/public/disponibilidad?fecha={dia}&modalidad=PARTIDA_ABIERTA").json()["salidas"] if s["libres"] >= 2]
s = sal[0]
base = {"tee_slot_id": s["id"], "modalidad": "PARTIDA_ABIERTA", "hoyos": 18,
        "jugadores": [{"nombre": "Titular Prueba", "edad": 35}]}

print("1. Cotización")
q0 = c.post("/api/public/cotizacion", json=base).json()
q2 = c.post("/api/public/cotizacion", json={**base, "acompanantes": [{"nombre": "Ana Acompaña", "edad": 30}, {"nombre": "Beto Acompaña"}]}).json()
check("sin acompañantes no cambia", q0.get("acompanantes") == 0 and float(q0["total"]) > 0, q0.get("total"))
check("2 acompañantes = 1600", q2["acompanantes"] == 2 and float(q2["subtotal_acompanantes"]) == 1600.0, q2.get("subtotal_acompanantes"))
check("el total suma 1600", float(q2["total"]) == float(q0["total"]) + 1600.0, f'{q0["total"]} -> {q2["total"]}')
check("precio por persona 800", float(q2["precio_acompanante"]) == 800.0)
r = c.post("/api/public/cotizacion", json={**base, "acompanantes": [{"nombre": "x"}]})
check("nombre corto se rechaza", r.status_code == 422)

print("2. Apartar")
cuerpo = {**base, "fecha": dia, "correo": "cliente@ejemplo.com", "telefono": "958 123 4567", "acepto_politicas": True, "acepto_privacidad": True,
          "acompanantes": [{"nombre": "Ana Acompaña", "edad": 30}]}
r = c.post("/api/public/reservas", json=cuerpo)
check("aparta", r.status_code in (200, 201), r.text[:200])
folio = r.json()["folio"]
db = SessionLocal()
res = db.query(Reservation).filter(Reservation.folio == folio).one()
slot = db.get(TeeSlot, s["id"])
check("guardó 1 acompañante", len(res.companions) == 1 and res.companions[0].full_name == "Ana Acompaña")
check("total = green fee + 800", float(res.total) == float(q0["total"]) + 800.0, res.total)
check("subtotal servicios 800", float(res.subtotal_services) == 800.0, res.subtotal_services)
check("no toma lugar en la salida (ocupa 1)", slot.occupied == 1, slot.occupied)
db.close()
print("\nFALLAS:" if fallas else "\nTODO BIEN", fallas or "")
sys.exit(1 if fallas else 0)
