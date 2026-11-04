"""Cuponera ligada a la reserva: se aparta el horario y los pases se descuentan en recepción.

    python prueba_cuponera_reserva.py
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
               headers={"X-Forwarded-For": f"10.9.0.{_n[0]}"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


adm = entrar("admin@lasparotas.mx")
ops = entrar("operaciones@lasparotas.mx")
rec = entrar("recepcion@lasparotas.mx")
hotel = entrar("concierge@celeste.mx")

D = hoy()
dia = (D + timedelta(days=2)).isoformat()
hoteles = c.get("/api/catalog/hotels", headers=ops).json()
directo = next(h for h in hoteles if h.get("is_direct"))
usadas = []


def salida():
    libres = [s for s in c.get(f"/api/booking/availability?slot_date={dia}", headers=ops).json()["slots"]
              if s["status"] == "DISPONIBLE" and s["id"] not in usadas]
    usadas.append(libres[0]["id"])
    return libres[0]["id"]


def cuerpo(folio=None, n=4):  # el grupo siempre es de 4; se cubren los que lleguen
    d = {
        "tee_slot_id": salida(), "modality": "GRUPO", "holes": 18, "hotel_id": directo["id"],
        "holder_name": "Roberto Salinas", "holder_email": "roberto@ejemplo.com",
        "booked_by_name": "Operación de Prueba",
        "players": [{"full_name": f"Jugador Uno {i}", "age": 40, **({"is_holder": True} if i == 0 else {})} for i in range(n)],
    }
    if folio:
        d["cuponera_folio"] = folio
    return d


def nueva_cuponera(pases=10, pagada=True, **extra):
    base = {"titular_nombre": "Roberto Salinas", "pases_total": pases, "hoyos_18": True, "hoyos_9": False,
            "precio_total": "9000", "precio_lista": "12000", "vence_el": (D + timedelta(days=90)).isoformat(),
            "pagada": pagada, "pago_referencia": "SPEI 1" if pagada else None}
    base.update(extra)
    return c.post("/api/cuponeras", json=base, headers=ops).json()


def cup(id_):
    return c.get(f"/api/cuponeras/{id_}", headers=ops).json()


print("\n1. Apartar el horario con la cuponera (Operación)")
cp = nueva_cuponera()
r = c.post("/api/booking/reservations", json=cuerpo(cp["folio"]), headers=ops)
check("Operación aparta con la cuponera", r.status_code == 201, r.text[:120])
res = r.json()
check("La reserva lleva el folio de la cuponera", res["cuponera_folio"] == cp["folio"], str(res.get("cuponera_folio")))
check("Los pases NO se descuentan al reservar", cup(cp["id"])["saldo"] == 10)
r = c.post("/api/booking/reservations", json=cuerpo(cp["folio"]), headers=rec)
check("Recepción no aparta con cuponera", r.status_code in (403, 409), f"HTTP {r.status_code} {r.text[:80]}")
r = c.post("/api/booking/reservations", json=cuerpo(cp["folio"]), headers=hotel)
check("Un hotel tampoco", r.status_code in (403, 409), f"HTTP {r.status_code}")
pend = nueva_cuponera(pagada=False)
r = c.post("/api/booking/reservations", json=cuerpo(pend["folio"]), headers=ops)
check("Sin pago confirmado no se puede apartar", r.status_code == 409 and "transferencia" in r.text, r.text[:90])
r = c.post("/api/booking/reservations", json=cuerpo("CUP-9999"), headers=ops)
check("Folio inexistente: 404", r.status_code == 404)
r = c.get(f"/api/booking/reservations/{res['id']}", headers=hotel)
check("El hotel no ve la cuponera", r.status_code in (403, 404) or r.json().get("cuponera_folio") is None)

print("\n2. Recepción escanea al llegar y cubre a quienes llegaron")
detalle = c.get(f"/api/booking/reservations/{res['id']}", headers=rec).json()
jug = detalle["players"]
tres = [p["id"] for p in jug[:3]]
precio = Decimal(jug[0]["rate_applied"])
r = c.post(f"/api/checkin/{res['id']}/cuponera",
           json={"cuponera_folio": "cup-0001 ", "player_ids": tres, "attended_by_name": "Laura Pérez"}, headers=rec)
check("Cubre a 3 de 4 jugadores", r.status_code == 200, r.text[:150])
check("La cuenta ya trae lo cubierto", Decimal(r.json()["total_paid"]) == precio * 3, r.json().get("total_paid"))
check("Saldo de la cuponera: 7", cup(cp["id"])["saldo"] == 7)
d2 = c.get(f"/api/booking/reservations/{res['id']}", headers=rec).json()
check("Quedan marcados como llegados y cubiertos", sum(1 for p in d2["players"] if p["cuponera_uso_id"] and p["arrived"]) == 3)
r = c.post(f"/api/checkin/{res['id']}/cuponera",
           json={"cuponera_folio": cp["folio"], "player_ids": tres[:1], "attended_by_name": "Laura Pérez"}, headers=rec)
check("No se cubre dos veces al mismo jugador", r.status_code == 409, r.text[:90])
otra = nueva_cuponera()
r = c.post(f"/api/checkin/{res['id']}/cuponera",
           json={"cuponera_folio": otra["folio"], "player_ids": [jug[3]["id"]], "attended_by_name": "Laura Pérez"}, headers=rec)
check("Otra cuponera distinta a la apartada se rechaza", r.status_code == 409 and cp["folio"] in r.text, r.text[:100])
r = c.post(f"/api/checkin/{res['id']}/cuponera",
           json={"cuponera_folio": cp["folio"], "player_ids": [jug[3]["id"]], "attended_by_name": "x"}, headers=hotel)
check("Un hotel no puede aplicar cuponeras", r.status_code == 403)

print("\n3. El que no tiene pase paga normal; la caja no se mueve")
sin_cobro = {"attended_by_name": "Recepcion de Prueba",
             "arrivals": [{"player_id": p["id"], "arrived": True} for p in jug], "payments": []}
r = c.post(f"/api/checkin/{res['id']}", json=sin_cobro, headers=rec)
check("Check-in: queda el saldo del 4.º jugador", r.status_code == 200 and Decimal(r.json()["balance"]) == precio, r.text[:150])
saldo = Decimal(r.json()["balance"])
r = c.post(f"/api/checkin/{res['id']}",
           json={**sin_cobro, "arrivals": [], "payments": [{"currency": "MXN", "amount": str(saldo), "method": "EFECTIVO"}]},
           headers=rec)
check("Paga ese saldo y la partida sale", r.status_code == 200 and r.json()["status"] == "EN_JUEGO", r.text[:150])
caja = c.get("/api/treasury/cash/current", headers=rec)
check("La caja solo trae el efectivo, no la cuponera",
      caja.status_code == 200 and Decimal(str(caja.json()["total_mxn"])) == saldo, caja.text[:120])

print("\n4. Ventas: la cuponera cuenta como venta, no como cobro de Green Fee")
v = c.get(f"/api/treasury/sales-breakdown?start={D.isoformat()}&end={D.isoformat()}&group=dia", headers=adm)
if v.status_code == 200:
    j = v.json()
    t = j["totales"]["por_fuente"]
    check("Hay sección de cuponeras vendidas", any(f["clave"] == "CUPONERAS" for f in j["fuentes"]))
    check("Se cuentan las 3 cuponeras pagadas como transferencia", Decimal(t["CUPONERAS"]["transferencia"]) == Decimal("18000"), t["CUPONERAS"]["transferencia"])
    check("Green Fee solo trae el efectivo del 4.º jugador", Decimal(t["GREEN_FEES"]["total"]) == saldo, t["GREEN_FEES"]["total"])
else:
    check("Ventas totales responde", False, f"HTTP {v.status_code} {v.text[:80]}")

print("\n5. Cancelar la reserva regresa los pases")
cp2 = nueva_cuponera(pases=6)
r2 = c.post("/api/booking/reservations", json=cuerpo(cp2["folio"]), headers=ops).json()
ids = [p["id"] for p in c.get(f"/api/booking/reservations/{r2['id']}", headers=rec).json()["players"]][:2]
c.post(f"/api/checkin/{r2['id']}/cuponera", json={"cuponera_folio": cp2["folio"], "player_ids": ids, "attended_by_name": "Laura Pérez"}, headers=rec)
check("Antes de cancelar: 4 pases", cup(cp2["id"])["saldo"] == 4)
r = c.post(f"/api/booking/reservations/{r2['id']}/cancel", json={"reason": "El cliente avisó que no viene"}, headers=ops)
check("Se cancela la reserva", r.status_code == 200, r.text[:100])
check("Regresan los pases", cup(cp2["id"])["saldo"] == 6)
check("El canje queda anulado en el historial", all(u["anulado"] for u in cup(cp2["id"])["usos"]))
d3 = c.get(f"/api/booking/reservations/{r2['id']}", headers=rec).json()
check("Y el cobro de cuponera queda anulado", Decimal(d3["total_paid"]) == 0, str(d3["total_paid"]))

print("\n6. La Administración anula un canje de reserva")
cp3 = nueva_cuponera(pases=5)
r3 = c.post("/api/booking/reservations", json=cuerpo(cp3["folio"]), headers=ops).json()
ids = [p["id"] for p in c.get(f"/api/booking/reservations/{r3['id']}", headers=rec).json()["players"]][:2]
c.post(f"/api/checkin/{r3['id']}/cuponera", json={"cuponera_folio": cp3["folio"], "player_ids": ids, "attended_by_name": "Laura Pérez"}, headers=rec)
uso = cup(cp3["id"])["usos"][0]
r = c.post(f"/api/cuponeras/usos/{uso['id']}/anular", json={"nota": "Se aplicó por error"}, headers=adm)
check("Anula y regresan los pases", r.status_code == 200 and r.json()["saldo"] == 5, r.text[:80])
d4 = c.get(f"/api/booking/reservations/{r3['id']}", headers=rec).json()
check("La reserva vuelve a deber su Green Fee", Decimal(d4["total_paid"]) == 0 and not any(p["cuponera_uso_id"] for p in d4["players"]))

print("\n7. Más jugadores que pases")
cp4 = nueva_cuponera(pases=1)
r4 = c.post("/api/booking/reservations", json=cuerpo(cp4["folio"]), headers=ops).json()
ids = [p["id"] for p in c.get(f"/api/booking/reservations/{r4['id']}", headers=rec).json()["players"]]
r = c.post(f"/api/checkin/{r4['id']}/cuponera", json={"cuponera_folio": cp4["folio"], "player_ids": ids, "attended_by_name": "Laura Pérez"}, headers=rec)
check("Pide más pases de los que hay: rechaza", r.status_code == 409 and "Solo quedan 1 pase" in r.text, r.text[:100])
r = c.post(f"/api/checkin/{r4['id']}/cuponera", json={"cuponera_folio": cp4["folio"], "player_ids": ids[:1], "attended_by_name": "Laura Pérez"}, headers=rec)
check("Con el pase que queda cubre a uno", r.status_code == 200 and cup(cp4["id"])["estado"] == "AGOTADA")

print()
if fallas:
    print("FALLARON:", fallas)
    sys.exit(1)
print("Todo en orden.")
