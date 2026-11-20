"""v23: teléfono obligatorio, comentario, hotel sin habitación, políticas aceptadas,
correo del pase en español e inglés con las Políticas y Reglamento.

    python prueba_v23.py
"""
import os
import subprocess
import sys
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
from app.modules.booking.models import Reservation  # noqa: E402
from app.shared.tiempo import hoy  # noqa: E402
from app.workers.notifications import cuerpo_pase  # noqa: E402
from app.modules.mailing.service import MailingService  # noqa: E402,F401

c = TestClient(app)
fallas = []


def check(nombre, ok, detalle=""):
    print(("  ✓ " if ok else "  ✗ ") + nombre + (f" · {detalle}" if detalle else ""))
    if not ok:
        fallas.append(nombre)


dia = (hoy() + timedelta(days=4)).isoformat()
salidas = [s for s in c.get(f"/api/public/disponibilidad?fecha={dia}&modalidad=GRUPO").json()["salidas"] if s["libres"] >= 4]
campo = c.get("/api/public/campo").json()
hoteles = campo["hoteles"]
usadas = []


def cuerpo(**extra):
    s = next(x for x in salidas if x["id"] not in usadas)
    usadas.append(s["id"])
    base = {"tee_slot_id": s["id"], "fecha": dia, "modalidad": "GRUPO", "hoyos": 18,
            "jugadores": [{"nombre": f"Jugador {i} Prueba", "edad": 35} for i in range(4)],
            "correo": "cliente@ejemplo.com", "telefono": "958 123 4567", "acepto_politicas": True, "acepto_privacidad": True}
    base.update(extra)
    return base


print("1. El catálogo trae las Políticas en los dos idiomas")
p = campo.get("politicas", {})
check("hay español e inglés", "es" in p and "en" in p)
check("9 políticas y 7 apartados de reglamento", len(p["es"]["politicas"]) == 9 and len(p["es"]["reglamento"]) == 7)
check("el inglés dice Policies and Rules", p["en"]["titulo"].startswith("Policies and Rules"))

print("2. Validaciones al apartar")
r = c.post("/api/public/reservas", json=cuerpo(telefono=None))
check("sin teléfono: rechaza", r.status_code == 422, str(r.status_code))
usadas.pop()
r = c.post("/api/public/reservas", json=cuerpo(telefono="abc"))
check("teléfono sin dígitos: rechaza", r.status_code == 422, str(r.status_code))
usadas.pop()
r = c.post("/api/public/reservas", json=cuerpo(acepto_politicas=False))
check("sin aceptar las políticas: rechaza", r.status_code == 422, str(r.status_code))
usadas.pop()
r = c.post("/api/public/reservas", json=cuerpo(acepto_privacidad=False))
check("sin aceptar el aviso de privacidad: rechaza", r.status_code == 422, str(r.status_code))
usadas.pop()
r = c.post("/api/public/reservas", json=cuerpo(comentario="x" * 51))
check("comentario de 51 caracteres: rechaza", r.status_code == 422, str(r.status_code))
usadas.pop()

print("3. Hotel sin habitación, comentario e idioma")
hotel = hoteles[0]["id"]
r = c.post("/api/public/reservas", json=cuerpo(hotel_id=hotel, comentario="Cumpleaños de mi papá", idioma="en"))
check("hotel sin habitación: acepta", r.status_code == 201, r.text[:120])
folio = r.json()["folio"]
with SessionLocal() as db:
    from sqlalchemy import select
    res = db.scalar(select(Reservation).where(Reservation.code == folio)) if hasattr(Reservation, "code") else None
    if res is None:
        res = db.scalars(select(Reservation).order_by(Reservation.id.desc())).first()
    check("guarda el hotel", res.hotel_id == hotel)
    check("guarda el comentario en las notas", "Cumpleaños de mi papá" in (res.notes or ""))
    check("guarda el idioma en", res.idioma == "en")
    texto, html = cuerpo_pase(res)
    check("correo en inglés: saludo", "Hello" in texto and "your reservation has been confirmed" in texto)
    check("correo en inglés: Policies and Rules", "Policies and Rules" in html and "Policies and Rules" in texto)
    check("correo en inglés: sin español de las políticas", "Aceptación" not in html)
    check("correo en inglés: footer con teléfono", "55 2721 9345" in html)

print("4. Correo en español")
r = c.post("/api/public/reservas", json=cuerpo())
check("español por omisión", r.status_code == 201, r.text[:120])
with SessionLocal() as db:
    res = db.scalars(select(Reservation).order_by(Reservation.id.desc())).first()
    check("idioma es", res.idioma == "es")
    texto, html = cuerpo_pase(res)
    check("trae Políticas y Reglamento completos", "Políticas y Reglamento" in html and "Asunción de riesgo" in html and "Bebidas y alimentos" in html)
    check("las viñetas de Reglas de juego", "120 pelotas o 90 minutos" in html)
    check("versión texto también trae las políticas", "Asunción de riesgo" in texto)
    check("sin referencia de pago", "Referencia" not in html + texto)
    check("«reserva» y no «salida»", "su salida" not in html)

print()
if fallas:
    print("FALLAS:", *fallas, sep="\n  - ")
    sys.exit(1)
print("Todo bien.")
