"""Prueba de la caja de la tienda y del cobro: abren solas, respetan la hora.

    python prueba_caja_automatica.py

- La caja de la tienda se abre sola, a nombre de quien atiende, con el primer
  movimiento (abrir la pantalla o vender).
- Pasada la hora de cierre no se abre ni se cobra (caja, tienda y check-in),
  y se mide con la hora del campo, no con la del servidor.
- El fondo de cambio se ajusta con la caja abierta.
"""
import os
import subprocess
import sys

os.environ["ENVIRONMENT"] = "development"
if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select              # noqa: E402

import app.models  # noqa: E402,F401
from app.core.database import SessionLocal  # noqa: E402
from app.main import app                    # noqa: E402
from app.modules.catalog.models import SystemSetting  # noqa: E402

FALLOS = []


def check(label, condition, extra=""):
    print(f"  {'✓' if condition else '✗'} {label}" + (f" · {extra}" if extra else ""))
    if not condition:
        FALLOS.append(label)


def poner_cierre(valor):
    with SessionLocal() as db:
        fila = db.execute(select(SystemSetting).where(SystemSetting.key == "cierre_automatico_caja")).scalars().first()
        fila.value = valor
        db.commit()


c = TestClient(app)
_n = [0]


def entrar(email):
    _n[0] += 1
    r = c.post("/api/auth/login", json={"email": email, "password": "Reserva2026*"},
               headers={"X-Forwarded-For": f"10.7.0.{_n[0]}"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


recep = entrar("recepcion@lasparotas.mx")

print("\n1. En horario: la caja abre sola")
poner_cierre("23:59")
r = c.get("/api/tienda/caja/actual", headers=recep)
j = r.json()
check("Pedir la caja la deja abierta", r.status_code == 200 and j["abierta"] is True, r.text[:160])
check("Quedó a nombre de la cuenta si no se dijo quién", j["corte"]["abierto_por_nombre"] == "Recepción Casa Club",
      str(j["corte"] and j["corte"]["abierto_por_nombre"]))
check("Empieza con fondo en cero", float(j["corte"]["fondo_inicial"]) == 0)
check("Dice a qué hora se cierra sola", j["cierra_a"] == "23:59")
id1 = j["corte"]["id"]
r = c.get("/api/tienda/caja/actual", params={"atiende": "Otra Persona"}, headers=recep)
check("Volver a pedirla no abre otra", r.json()["corte"]["id"] == id1)

print("\n2. Fondo de cambio")
r = c.put("/api/tienda/caja/fondo", json={"fondo_inicial": "500"}, headers=recep)
check("Se ajusta el fondo con la caja abierta", r.status_code == 200 and float(r.json()["fondo_inicial"]) == 500, r.text[:120])
check("El efectivo esperado lo incluye", float(r.json()["efectivo_esperado"]) == 500)
check("Un fondo negativo se rechaza", c.put("/api/tienda/caja/fondo", json={"fondo_inicial": "-5"}, headers=recep).status_code == 422)

print("\n3. Vender sin haber abierto nada")
c.post("/api/tienda/caja/cerrar", json={"efectivo_contado": "500", "atendio": "Cajero Uno"}, headers=recep)
check("La caja quedó cerrada", c.get("/api/tienda/caja/actual", headers=recep).json()["corte"]["id"] != id1)  # se reabre sola
# cerrar otra vez y vender directo, sin consultar la caja antes
c.post("/api/tienda/caja/cerrar", json={"efectivo_contado": "0", "atendio": "Cajero Uno"}, headers=recep)
prod = [p for p in c.get("/api/tienda/productos", headers=recep).json() if p.get("precio") and p.get("existencia", 1) > 0]
if prod:
    p = prod[0]
    r = c.post("/api/tienda/ventas", headers=recep, json={
        "lineas": [{"producto_id": p["id"], "cantidad": 1}],
        "pagos": [{"metodo": "TARJETA", "monto": str(p["precio"])}],
        "atendio": "María Ríos"})
    check("Vender abre la caja sola", r.status_code == 201, r.text[:160])
    actual = c.get("/api/tienda/caja/actual", headers=recep).json()["corte"]
    check("Quedó a nombre de quien atendió", actual["abierto_por_nombre"] == "María Ríos", actual["abierto_por_nombre"])
else:
    check("Hay productos de muestra para vender", False)

print("\n4. Pasada la hora de cierre")
c.post("/api/tienda/caja/cerrar", json={"efectivo_contado": "0", "atendio": "Cajero Uno"}, headers=recep)
poner_cierre("00:01")   # ya pasó, a menos que se corra entre las 00:00 y las 00:01
r = c.get("/api/tienda/caja/actual", headers=recep)
j = r.json()
check("Ya no se abre sola", r.status_code == 200 and j["abierta"] is False, r.text[:160])
check("Avisa que es fuera de horario", j["fuera_de_horario"] is True)
r = c.post("/api/tienda/caja/abrir", json={"fondo_inicial": "0", "atendio": "Alguien"}, headers=recep)
check("Abrirla a mano tampoco se puede", r.status_code in (400, 409, 422), f"{r.status_code} {r.text[:120]}")
check("El mensaje dice la hora de cierre", "00:01" in r.text)
if prod:
    r = c.post("/api/tienda/ventas", headers=recep, json={
        "lineas": [{"producto_id": p["id"], "cantidad": 1}],
        "pagos": [{"metodo": "TARJETA", "monto": str(p["precio"])}], "atendio": "María Ríos"})
    check("Vender fuera de horario se rechaza", r.status_code in (400, 409, 422), f"{r.status_code}")

print("\n5. Turno de Green Fee")
admin = entrar("admin@lasparotas.mx")
r = c.post("/api/treasury/cash/open", json={"opening_balance": "0"}, headers=admin)
check("El turno de Green Fee tampoco abre fuera de horario", r.status_code in (400, 409, 422), f"{r.status_code} {r.text[:100]}")
poner_cierre("23:59")
r = c.post("/api/treasury/cash/open", json={"opening_balance": "0"}, headers=admin)
check("En horario sí abre", r.status_code == 201, f"{r.status_code} {r.text[:100]}")

print()
if FALLOS:
    print("=" * 60)
    print(f"  FALLARON {len(FALLOS)}: " + "; ".join(FALLOS))
    print("=" * 60)
    sys.exit(1)
print("=" * 60)
print("  LAS CAJAS ABREN SOLAS Y RESPETAN LA HORA")
print("=" * 60)
