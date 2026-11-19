"""v22: correo de la cuponera, «reserva» en vez de «salida», correo sin referencia de pago,
y la vista del hotel con valor y comisión por reserva (sin el porcentaje).

    python prueba_v22.py
"""
import os
import subprocess
import sys
from datetime import timedelta
from decimal import Decimal

if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

import logging
logging.disable(logging.INFO)
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
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
               headers={"X-Forwarded-For": f"10.22.0.{_n[0]}"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


adm = entrar("admin@lasparotas.mx")
ops = entrar("operaciones@lasparotas.mx")
hotel = entrar("concierge@celeste.mx")
D = hoy()

print("1. Correo de la cuponera")
from app.workers.notifications import cuerpo_cuponera, cuerpo_pase  # noqa: E402

cp = c.post("/api/cuponeras", json={
    "titular_nombre": "Isai Israel", "pases_total": 50, "hoyos_18": True, "hoyos_9": False,
    "precio_total": "90000", "precio_lista": "120000", "vence_el": (D + timedelta(days=90)).isoformat(),
    "correo": "isai@ejemplo.com", "pagada": True, "pago_referencia": "SPEI 1"}, headers=ops).json()
with SessionLocal() as db:
    from app.modules.cuponeras.models import Cuponera
    cup = db.get(Cuponera, cp["id"])
    texto, html = cuerpo_cuponera(cup)
for nombre, cuerpo in (("texto", texto), ("html", html)):
    check(f"{nombre}: pide reservar al 5527219345 con 24 horas", "previa reservación al 5527219345 con al menos 24 horas" in cuerpo)
    check(f"{nombre}: lleva las políticas", "Válido de lunes a miércoles en un horario de 7 am a 1 pm" in cuerpo
          and "intransferible" in cuerpo and "carrito compartido" in cuerpo)
    check(f"{nombre}: ya no dice «Para jugar, mande un WhatsApp»", "Para jugar, mande" not in cuerpo)
    check(f"{nombre}: no dice «salida»", "su salida" not in cuerpo)
check("html: el pie trae el teléfono", "marque al 55 2721 9345" in html)
check("html: el título «Políticas»", "Políticas" in html)

print("2. Correo del pase: «reserva», sin referencia, con teléfono")
hoteles = c.get("/api/catalog/hotels", headers=ops).json()
directo = next(h for h in hoteles if h.get("is_direct"))
dia = (D + timedelta(days=3)).isoformat()
libres = [s for s in c.get(f"/api/booking/availability?slot_date={dia}", headers=ops).json()["slots"]
          if s["status"] == "DISPONIBLE"]


def cuerpo_res(slot, holder, hotel_id, n=4):
    return {"tee_slot_id": slot["id"], "modality": "GRUPO", "holes": 18, "hotel_id": hotel_id,
            "holder_name": holder, "holder_email": "h@ejemplo.com", "booked_by_name": "Prueba v22",
            "players": [{"full_name": f"Jugador {holder} {i}", "age": 40, **({"is_holder": True} if i == 0 else {})}
                        for i in range(n)]}


r_directa = c.post("/api/booking/reservations", json=cuerpo_res(libres[0], "Directa", directo["id"]), headers=ops).json()
from app.modules.billing.models import Payment  # noqa: E402
from app.modules.booking.models import Reservation  # noqa: E402
from app.shared.enums import PaymentMethod  # noqa: E402

with SessionLocal() as db:
    res = db.get(Reservation, r_directa["id"])
    db.add(Payment(reservation_id=res.id, currency="MXN", amount=res.total, exchange_rate_applied=Decimal("1"),
                   amount_mxn=res.total, change_mxn=Decimal("0"), method=PaymentMethod.TARJETA,
                   reference="pi_3Ub7kn1ymiH2ULAL1g0NT26y", notes="Pago en línea · visa ····4242"))
    db.commit()
    db.refresh(res)
    texto, html = cuerpo_pase(res)
check("pase pagado: no trae la referencia pi_", "pi_3Ub7" not in texto and "pi_3Ub7" not in html and "Referencia" not in html + texto)
check("pase pagado: sigue el detalle del pago", "Total pagado" in texto and "Pago recibido" in html)
check("pase: «su reserva quedó registrada»", "su reserva quedó registrada" in html and "su reserva quedó registrada" in texto)
check("pase: no dice «su salida»", "su salida" not in html and "su salida" not in texto.lower().replace("salida quedó", ""))
check("pase: «15 minutos previo a su reserva»", "15 minutos previo a su reserva" in texto)
check("pase: pie con el teléfono", "marque al 55 2721 9345" in html)

print("3. Vista del hotel: valor, comisión y sin porcentaje")
hid = next(h for h in hoteles if h["name"] == "Celeste")["id"]
r1 = c.post("/api/booking/reservations", json=cuerpo_res(libres[1], "Uno", hid), headers=hotel)
r2 = c.post("/api/booking/reservations", json=cuerpo_res(libres[2], "Dos", hid, n=5), headers=hotel)
check("el hotel crea sus reservas", r1.status_code == 201 and r2.status_code == 201, f"{r1.status_code}/{r2.status_code}")
r1, r2 = r1.json(), r2.json()
lista = c.get("/api/booking/reservations", headers=hotel).json()
por_folio = {x["folio"]: x for x in lista}
tasa = next(h for h in hoteles if h["name"] == "Celeste")["commission_rate"]
for r in (r1, r2):
    x = por_folio[r["folio"]]
    esperado = (Decimal(str(x["total"])) * Decimal(str(tasa)) / 100).quantize(Decimal("0.01"))
    check(f"{r['folio']}: comisión = tasa × valor", Decimal(str(x["commission_amount"])) == esperado,
          f"valor {x['total']} · comisión {x['commission_amount']}")
check("la lista del hotel no trae el porcentaje", all("commission_rate_applied" not in x for x in lista))
det = c.get(f"/api/booking/reservations/{r1['id']}", headers=hotel).json()
check("el detalle para el hotel no revela el porcentaje", Decimal(str(det["commission_rate_applied"])) == 0)
det_admin = c.get(f"/api/booking/reservations/{r1['id']}", headers=adm).json()
check("el administrador sí ve el porcentaje", Decimal(str(det_admin["commission_rate_applied"])) == Decimal(str(tasa)))

rc = c.post(f"/api/booking/reservations/{r2['id']}/cancel", json={"reason": "Prueba v22"}, headers=ops)
check("operaciones cancela la reserva del hotel", rc.status_code == 200, str(rc.status_code))
x2 = next(x for x in c.get("/api/booking/reservations", headers=hotel).json() if x["folio"] == r2["folio"])
check("cancelada: no vigente y sin comisión", x2["cuenta_vigente"] is False and Decimal(str(x2["commission_amount"])) == 0,
      f"estado {x2['status']}")
rd = next(x for x in c.get("/api/booking/reservations", headers=ops).json() if x["folio"] == r_directa["folio"])
check("venta directa: comisión 0", Decimal(str(rd["commission_amount"])) == 0, str(rd["commission_amount"]))

print("4. Grupo en el sitio: hasta 10")
campo = c.get("/api/public/campo").json()
g = next(p for p in campo["paquetes"] if p["modalidad"] == "GRUPO")
check("el sitio admite grupos de 4 a 10", (g["minimo"], g["maximo"]) == (4, 10), str((g["minimo"], g["maximo"])))
pa = next(p for p in campo["paquetes"] if p["modalidad"] == "PARTIDA_ABIERTA")
check("partida abierta: máximo 4 en total", pa["maximo"] == 4)

print()
print("FALLAS:" if fallas else "TODO BIEN", fallas if fallas else "")
sys.exit(1 if fallas else 0)
