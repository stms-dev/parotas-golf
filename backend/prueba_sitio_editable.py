"""Prueba de lo que el administrador edita y el sitio público muestra.

    python prueba_sitio_editable.py

Comprueba que teléfono, correo y domicilio se editan desde Configuración (con
validación y solo con permiso), que /public/campo los entrega, y que cambiar
una tarifa o un extra en el sistema se refleja en lo que el sitio recibe.
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
from app.main import app                   # noqa: E402

FALLOS = []


def check(label, condition, extra=""):
    print(f"  {'✓' if condition else '✗'} {label}" + (f" · {extra}" if extra else ""))
    if not condition:
        FALLOS.append(label)


c = TestClient(app)
_n = [0]


def entrar(email):
    _n[0] += 1
    r = c.post("/api/auth/login", json={"email": email, "password": "Reserva2026*"},
               headers={"X-Forwarded-For": f"10.8.0.{_n[0]}"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def campo():
    return c.get("/api/public/campo", headers={"X-Forwarded-For": "10.8.1.1"}).json()


admin = entrar("admin@lasparotas.mx")
recep = entrar("recepcion@lasparotas.mx")

print("\n1. Contacto: valores de respaldo")
ct = campo()["contacto"]
check("Sin editar, el sitio recibe el teléfono vigente", ct["telefono"] == "+52 55 2721 9345", ct["telefono"])
check("Trae correo y domicilio", bool(ct["correo"]) and bool(ct["domicilio"]))

print("\n2. Editar contacto")
def poner(k, v, h=admin):
    return c.put(f"/api/catalog/settings/{k}", json={"value": v}, headers=h)

check("Recepción NO puede cambiarlo", poner("contacto_telefono", "+52 958 000 0000", recep).status_code == 403)
check("Admin cambia el teléfono", poner("contacto_telefono", "+52 958 587 0000").status_code == 200)
check("Admin cambia el correo", poner("contacto_correo", " Info@LasParotas.mx ").status_code == 200)
check("Admin cambia el domicilio", poner("contacto_domicilio", "Tangolunda, Huatulco, Oaxaca").status_code == 200)
ct = campo()["contacto"]
check("El sitio recibe el teléfono nuevo", ct["telefono"] == "+52 958 587 0000", ct["telefono"])
check("El sitio recibe el correo nuevo", ct["correo"].lower() == "info@lasparotas.mx", ct["correo"])
check("El sitio recibe el domicilio nuevo", ct["domicilio"] == "Tangolunda, Huatulco, Oaxaca")

print("\n3. Validación")
check("Teléfono con letras se rechaza", poner("contacto_telefono", "llámenos").status_code == 422)
check("Teléfono corto se rechaza", poner("contacto_telefono", "12345").status_code == 422)
check("Correo mal escrito se rechaza", poner("contacto_correo", "sin-arroba").status_code == 422)
check("Domicilio con < > se rechaza", poner("contacto_domicilio", "<script>x</script>").status_code == 422)
check("Domicilio larguísimo se rechaza", poner("contacto_domicilio", "x" * 300).status_code == 422)
check("Lo rechazado no cambió nada", campo()["contacto"]["telefono"] == "+52 958 587 0000")
check("Una clave ajena sigue sin poder editarse", poner("secret_key", "x").status_code == 422)

print("\n4. Precios: lo que cambia el admin lo ve el sitio")
antes = campo()
def precio_adulto18(d, dia="ENTRE_SEMANA"):
    return [float(t["precio"]) for t in d["tarifas"]
            if t["hoyos"] == 18 and t["categoria"] == "ADULTO" and t["franja"] == "TODAS"
            and t["dia"] == dia and t["modalidad"] == "GRUPO"][0]
check("Precio inicial 18 hoyos entre semana = 3600", precio_adulto18(antes) == 3600)
planes = c.get("/api/catalog/rates", headers=admin).json()
plan = [p for p in planes if p["holes"] == 18 and p["category"] == "ADULTO" and p["time_band"] == "TODAS"
        and p["day_type"] == "ENTRE_SEMANA" and p["modality"] == "GRUPO"][0]
r = c.patch(f"/api/catalog/rates/{plan['id']}", json={"price": "3900.00"}, headers=admin)
check("Admin cambia la tarifa", r.status_code == 200, r.text[:120])
check("El sitio recibe 3900", precio_adulto18(campo()) == 3900)

servicios = c.get("/api/catalog/services", headers=admin).json()
prac = [s for s in servicios if s["code"] == "PRACTICA"][0]
r = c.patch(f"/api/catalog/services/{prac['id']}", json={"price": "300.00"}, headers=admin)
check("Admin cambia la zona de práctica", r.status_code == 200, r.text[:120])
ex = {e["code"]: e for e in campo()["extras"]}
check("El sitio recibe la práctica en 300", float(ex["PRACTICA"]["precio"]) == 300)
check("Y sigue trayendo el precio de fin de semana", ex["PRACTICA"]["precio_fin"] is not None)

r = c.post("/api/catalog/exchange-rate", json={"rate": "18.50", "from_currency": "USD", "to_currency": "MXN"}, headers=admin)
check("Admin cambia el tipo de cambio", r.status_code in (200, 201), r.text[:120])
check("El sitio recibe el tipo de cambio nuevo", float(campo()["tipo_de_cambio"]) == 18.5, str(campo()["tipo_de_cambio"]))

print()
if FALLOS:
    print("=" * 60)
    print(f"  FALLARON {len(FALLOS)}: " + "; ".join(FALLOS))
    print("=" * 60)
    sys.exit(1)
print("=" * 60)
print("  LO QUE EL ADMIN EDITA, EL SITIO LO MUESTRA")
print("=" * 60)
