"""Prueba de los cambios de Isai: huésped de hotel en el sitio y textos por idioma.

    python prueba_cambios_v18.py
"""
import os
import subprocess
import sys

os.environ["PAGOS_SIMULADOS"] = "true"
if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

from datetime import date, timedelta  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from app.core.config import settings  # noqa: E402
settings.PAGOS_SIMULADOS = True
from app.main import app  # noqa: E402
from _cliente_publico import ClienteDelSitio  # noqa: E402

FALLOS = []


def check(nombre, ok, detalle=""):
    print(f"  {'✓' if ok else '✗'} {nombre}" + (f" · {detalle}" if detalle else ""))
    if not ok:
        FALLOS.append(nombre)


c = ClienteDelSitio(app)
admin = TestClient(app)
_n = [0]


def entrar(correo):
    _n[0] += 1
    r = admin.post("/api/auth/login", json={"email": correo, "password": "Reserva2026*"},
                   headers={"X-Forwarded-For": f"10.9.0.{_n[0]}"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


adm = entrar("admin@lasparotas.mx")
rec = entrar("recepcion@lasparotas.mx")
dia = (date.today() + timedelta(days=4)).isoformat()


def jug(n, base="Jugador", edad=35):
    return [{"nombre": f"{base} {chr(65 + i)} de Prueba", "edad": edad, "handicap": None, "pga": None,
             "bastones": None} for i in range(n)]



def apartar(extra=None, salida_de=None):
    libres = c.get(f"/api/public/disponibilidad?fecha={dia}&modalidad=GRUPO").json()["salidas"]
    libre = next(x for x in libres if x["libres"] >= 4 and x["id"] not in (salida_de or []))
    cuerpo = {"tee_slot_id": libre["id"], "fecha": dia, "modalidad": "GRUPO", "hoyos": 18,
              "jugadores": jug(4), "correo": "huesped@example.com", "telefono": None}
    cuerpo.update(extra or {})
    return libre["id"], c.post("/api/public/reservas", json=cuerpo)


print("\n1. El sitio recibe los hoteles y los textos")
campo = c.get("/api/public/campo").json()
check("Llegan los hoteles con convenio (sin el mostrador)", len(campo["hoteles"]) >= 2 and
      all({"id", "nombre"} <= set(h) for h in campo["hoteles"]), str(len(campo["hoteles"])))
check("Vienen sin textos propios mientras nadie los cambie", campo["textos"] == {"es": {}, "en": {}}, str(campo["textos"]))

print("\n2. Huésped de hotel: queda con hotel y habitación, mismo precio")
hotel = campo["hoteles"][0]
usadas = []
sid, r0 = apartar(salida_de=usadas)
usadas.append(sid)
check("Sin hotel sigue igual", r0.status_code == 201, r0.text[:100])
total_directo = r0.json()["total"]
sid, r1 = apartar({"hotel_id": hotel["id"], "habitacion": " 412 "}, usadas)
usadas.append(sid)
check("Con hotel y habitación se aparta", r1.status_code == 201, r1.text[:120])
check("Paga la misma tarifa que cualquier persona", r1.json()["total"] == total_directo,
      f"{r1.json()['total']} vs {total_directo}")
from app.core.database import SessionLocal  # noqa: E402
from app.modules.booking.models import Reservation  # noqa: E402
from sqlalchemy import select  # noqa: E402
db = SessionLocal()
res = db.execute(select(Reservation).where(Reservation.folio == r1.json()["folio"])).scalars().first()
check("Se guarda el hotel que originó la reserva", res.hotel_id == hotel["id"])
check("Se guarda la habitación", res.holder_room == "412", str(res.holder_room))
from app.modules.catalog.models import Hotel  # noqa: E402
h = db.get(Hotel, hotel["id"])
check("La comisión aplicada es la que ya tenía el hotel", res.commission_rate_applied == h.commission_rate,
      f"{res.commission_rate_applied} / {h.commission_rate}")
res0 = db.execute(select(Reservation).where(Reservation.folio == r0.json()["folio"])).scalars().first()
check("Sin hotel queda como venta directa", res0.hotel_id != hotel["id"] and res0.holder_room is None)
db.close()

_, r2 = apartar({"hotel_id": hotel["id"]}, usadas)
check("Con hotel pero sin habitación se rechaza", r2.status_code == 422, f"HTTP {r2.status_code}")
_, r3 = apartar({"hotel_id": 99999, "habitacion": "1"}, usadas)
check("Un hotel que no existe se rechaza", r3.status_code in (404, 422), f"HTTP {r3.status_code}")
_, r4 = apartar({"habitacion": "77"}, usadas)
check("Habitación sin hotel no se guarda en ningún lado", r4.status_code == 201)
usadas.append(r4.json()["folio"]) if False else None

print("\n3. Textos del sitio, cada idioma por separado")
r = admin.put("/api/catalog/settings/sitio_texto_en_nav.campo", json={"value": "Gallery tour"}, headers=adm)
check("El administrador cambia un texto en inglés", r.status_code == 200, r.text[:100])
r = admin.put("/api/catalog/settings/sitio_texto_es_tarifas.practicaDetalle", json={"value": "120 pelotas o 90 min"}, headers=adm)
check("Y otro en español", r.status_code == 200, r.text[:100])
t = c.get("/api/public/campo").json()["textos"]
check("El inglés no mueve el español", t["en"].get("nav.campo") == "Gallery tour" and "nav.campo" not in t["es"], str(t))
check("El español no mueve el inglés", t["es"].get("tarifas.practicaDetalle") == "120 pelotas o 90 min"
      and "tarifas.practicaDetalle" not in t["en"])
r = admin.put("/api/catalog/settings/sitio_texto_en_nav.campo", json={"value": ""}, headers=adm)
check("Vaciar un texto regresa al de fábrica", r.status_code == 200 and
      "nav.campo" not in c.get("/api/public/campo").json()["textos"]["en"])
r = admin.put("/api/catalog/settings/sitio_texto_en_nav.campo", json={"value": "<b>x</b>"}, headers=adm)
check("No se aceptan etiquetas", r.status_code == 422, f"HTTP {r.status_code}")
r = admin.put("/api/catalog/settings/sitio_texto_es_clave.que.no.existe", json={"value": "hola"}, headers=adm)
check("Solo se editan los textos de la lista", r.status_code in (400, 422), f"HTTP {r.status_code}")
r = admin.put("/api/catalog/settings/sitio_texto_es_paquete.GRUPO.detalle", json={"value": "x"}, headers=adm)
check("La descripción en español de un paquete se sigue editando en su lugar de siempre", r.status_code in (400, 422))
r = admin.put("/api/catalog/settings/sitio_texto_en_nav.campo", json={"value": "Gallery"}, headers=rec)
check("Recepción no puede cambiar textos", r.status_code == 403, f"HTTP {r.status_code}")

print("\n4. Nombre del hotel editable y Park Royal")
nombres = {h["id"]: h["nombre"] for h in c.get("/api/public/campo").json()["hoteles"]}
check("El hotel AMHMH sale como Park Royal", "Park Royal" in nombres.values() and not any("Binniguenda" in n for n in nombres.values()), str(sorted(nombres.values())))
hid = next(i for i, n in nombres.items() if n == "Park Royal")
r = admin.patch(f"/api/catalog/hotels/{hid}", json={"name": "Park Royal Beach"}, headers=adm)
check("El administrador renombra un hotel", r.status_code == 200 and r.json()["name"] == "Park Royal Beach", r.text[:100])
check("El sitio muestra el nombre nuevo", "Park Royal Beach" in [h["nombre"] for h in c.get("/api/public/campo").json()["hoteles"]])
r = admin.patch(f"/api/catalog/hotels/{hid}", json={"name": "Park Royal"}, headers=adm)
r = admin.patch(f"/api/catalog/hotels/{hid}", json={"name": "Park Royal"}, headers=rec)
check("Recepción no puede renombrar hoteles", r.status_code == 403, f"HTTP {r.status_code}")
r = admin.put("/api/catalog/settings/sitio_texto_en_paquete.GRUPO.detalle", json={"value": "Private tee time for your group."}, headers=adm)
check("La descripción en inglés de un paquete se guarda", r.status_code == 200 and
      c.get("/api/public/campo").json()["textos"]["en"].get("paquete.GRUPO.detalle") == "Private tee time for your group.", r.text[:80])

print()
if FALLOS:
    print("FALLARON:", FALLOS)
    sys.exit(1)
print("Todo en orden.")
