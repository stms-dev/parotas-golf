"""Prueba del flujo de reserva desde el sitio, de punta a punta.

Arranca con la base recién sembrada para que corra igual las veces que sea.

    python prueba_publica.py
"""
import os
import subprocess
import sys

os.environ["PAGOS_SIMULADOS"] = "true"

if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"],
               check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)
from datetime import date, timedelta
from fastapi.testclient import TestClient
from app.core.config import settings
settings.PAGOS_SIMULADOS = True
from app.main import app

c = TestClient(app)
manana = (date.today() + timedelta(days=3)).isoformat()


def jugadores(cuantos, *, menores=0, sets=0, base="Jugador"):
    """Arma la lista como la manda el sitio: el titular primero."""
    lista = []
    for i in range(cuantos):
        es_menor = i >= (cuantos - menores)
        lista.append({
            "nombre": f"{base} {chr(65 + i)} de Prueba",
            "edad": 12 if es_menor else 35 + i,
            "handicap": "14.2" if i == 0 else None,
            "pga": None,
            "bastones": "DIESTRO" if i < sets else None,
        })
    return lista


def cuerpo_de(slot_id, *, modalidad, cuantos, menores=0, sets=0, correo):
    return {
        "tee_slot_id": slot_id,
        "fecha": manana,
        "modalidad": modalidad,
        "hoyos": 18,
        "jugadores": jugadores(cuantos, menores=menores, sets=sets),
        "correo": correo,
        "telefono": "+1 555 123 4567",
    }


print("\n1. El catálogo del campo")
r = c.get("/api/public/campo")
d = r.json()
print("  HTTP", r.status_code, "· tarifas:", len(d["tarifas"]), "· extras:", len(d["extras"]))
print("  horario", d["primera_salida"], "-", d["ultima_salida"], "· cierre", d["cierre_de_campo"], "· twilight", d["twilight_desde"])
print("  cobro disponible:", d["cobro_disponible"])
print("  paquetes:", [(p["modalidad"], p["minimo"], p["maximo"]) for p in d["paquetes"]])
caddie = [e for e in d["extras"] if e["code"] == "CADDIE"][0]
print("  caddie:", caddie["precio"], "pago_directo =", caddie["pago_directo"])
assert not any(t["modalidad"] == "INDIVIDUAL" for t in d["tarifas"]), "no debe publicar Individual"
assert not any(e["code"] == "REPLAY" for e in d["extras"]), "el replay no se vende por internet"
assert len(d["paquetes"]) == 2, "el sitio necesita los dos paquetes para pintarlos"
grupo = next(p for p in d["paquetes"] if p["modalidad"] == "GRUPO")
assert grupo["minimo"] == 4, "un grupo sigue siendo desde cuatro"

print("\n2. Disponibilidad")
r = c.get(f"/api/public/disponibilidad?fecha={manana}")
dd = r.json()
print("  HTTP", r.status_code, "· salidas:", len(dd["salidas"]), "· admite abiertas:", dd["admite_partida_abierta"])
tw = [s for s in dd["salidas"] if s["twilight"]]
print("  twilight:", [s["hora"][:5] for s in tw])
texto = r.text
for prohibido in ("holder", "hotel", "titular", "folio"):
    assert prohibido not in texto.lower(), f"la disponibilidad pública filtró '{prohibido}'"
print("  no filtra datos de nadie ✓")

libre = next(s for s in dd["salidas"] if s["libres"] > 0)

print("\n3. La cotización la calcula el servidor")
coti = {
    "tee_slot_id": libre["id"],
    "modalidad": "PARTIDA_ABIERTA",
    "hoyos": 18,
    "jugadores": jugadores(3, menores=1, sets=2),
}
r = c.post("/api/public/cotizacion", json=coti)
q = r.json()
print("  HTTP", r.status_code, "·", q["fecha"], q["hora"][:5], "· twilight", q["twilight"])
for j in q["jugadores"]:
    print(f"    {j['nombre']:<28} {j['categoria']:<9} {j['green_fee']}")
print("  green fees", q["green_fees"], "+ bastones", q["subtotal_bastones"],
      f"({q['sets_bastones']} sets a {q['precio_bastones']})", "= total", q["total"])
print("  caddie aparte:", q["caddie_por_persona"])
assert q["sets_bastones"] == 2
assert float(q["total"]) == float(q["green_fees"]) + float(q["subtotal_bastones"])
# El menor paga distinto: es la razón de pedir la edad por jugador.
menor = [j for j in q["jugadores"] if j["categoria"] == "INFANTIL"]
adulto = [j for j in q["jugadores"] if j["categoria"] == "ADULTO"]
assert len(menor) == 1 and len(adulto) == 2
assert float(menor[0]["green_fee"]) < float(adulto[0]["green_fee"]), "el menor debe pagar menos"
print("  el menor paga menos que el adulto ✓")

print("\n4. La cotización rechaza un paquete imposible")
r = c.post("/api/public/cotizacion", json={**coti, "modalidad": "GRUPO"})
print("  tres jugadores en Grupo →", r.status_code, "·", r.json()["error"]["message"][:60])
assert r.status_code == 409, "un grupo no se arma con tres"
r = c.post("/api/public/cotizacion", json={
    **coti, "modalidad": "PARTIDA_ABIERTA", "jugadores": jugadores(5)})
print("  cinco en Partida Abierta →", r.status_code, "·", r.json()["error"]["message"][:60])
assert r.status_code == 409, "la partida abierta no pasa de cuatro"

print("\n5. Apartar la salida")
cuerpo = cuerpo_de(libre["id"], modalidad="PARTIDA_ABIERTA", cuantos=3,
                   menores=1, sets=2, correo="turista@ejemplo.com")
r = c.post("/api/public/reservas", json=cuerpo)
print("  HTTP", r.status_code, r.text[:160])
ap = r.json()
folio = ap["folio"]
print(f"  folio {folio} · {ap['modalidad']} · total {ap['total']} · vence {ap['vence']}")
assert ap["modalidad"] == "PARTIDA_ABIERTA"
assert float(ap["total"]) == float(q["total"]), "lo apartado debe costar lo cotizado"
print("  el total apartado coincide con la cotización ✓")

print("\n6. La salida ya está apartada")
r = c.get(f"/api/public/disponibilidad?fecha={manana}")
ahora = next(s for s in r.json()["salidas"] if s["id"] == libre["id"])
print(f"  libres antes {libre['libres']} → ahora {ahora['libres']}")
assert ahora["libres"] == libre["libres"] - 3

print("\n7. El cobro")
mala = {"numero": "4000000000000002", "mes": 12, "anio": 2030, "cvv": "123", "nombre": "Turista de Prueba"}
r = c.post(f"/api/public/reservas/{folio}/pago", json=mala)
print("  rechazada:", r.json()["aprobado"], "·", r.json()["motivo"])
assert r.json()["aprobado"] is False

r = c.get(f"/api/public/reservas/{folio}")
print("  tras el rechazo sigue:", r.json()["estado"])
assert r.json()["estado"] == "PENDIENTE", "un rechazo no debe soltar la salida"

buena = {"numero": "4242 4242 4242 4242", "mes": 12, "anio": 2030, "cvv": "123", "nombre": "Turista de Prueba"}
r = c.post(f"/api/public/reservas/{folio}/pago", json=buena)
p = r.json()
print("  aprobada:", p["aprobado"], "·", p["marca"], "····"+str(p["ultimos4"]), "·", p["referencia"], "·", p["total"])
assert p["aprobado"] is True

print("\n8. La reserva quedó en el sistema")
r = c.get(f"/api/public/reservas/{folio}")
e = r.json()
print("  estado:", e["estado"], "·", e["fecha"], e["hora"][:5], "·", e["jugadores"], "jugadores ·", e["total"])
assert e["estado"] == "CONFIRMADA"

tok = c.post("/api/auth/login", json={"email": "operaciones@lasparotas.mx", "password": "Reserva2026*"}).json()["access_token"]
h = {"Authorization": f"Bearer {tok}"}
r = c.get(f"/api/booking/reservations?slot_date={manana}", headers=h)
fila = next(x for x in r.json() if x["folio"] == folio)
det = c.get(f"/api/booking/reservations/{fila['id']}", headers=h).json()
print("  en el tee sheet:", det["folio"], "·", det["hotel_name"], "· comisión", det["commission_rate_applied"])
print("  quién la levantó:", det["booked_by_name"], "· saldo", det["balance"])
print("  servicios:", [(s["service_code"], s["total"]) for s in det["services"]])
assert det["hotel_name"] == "Público general (sin hotel)" or "úblico" in det["hotel_name"]
assert float(det["commission_rate_applied"]) == 0.0, "la venta directa no deja comisión"
assert float(det["balance"]) == 0.0, "pagada en línea = sin saldo"
assert all(s["service_code"] != "CADDIE" for s in det["services"]), "el caddie no se cobra"

print("\n9. Los nombres y datos de cada jugador llegaron completos")
for pl in det["players"]:
    print(f"    {pl['full_name']:<28} {pl['category']:<9} hcp {pl['handicap'] or '—':<6} "
          f"bastones {pl['club_hand'] or '—':<8} titular {pl['is_holder']}")
nombres = [pl["full_name"] for pl in det["players"]]
assert not any(n.startswith("Jugador ") and len(n.split()) == 2 for n in nombres), \
    "ya no se inventan nombres: los manda el sitio"
assert sum(1 for pl in det["players"] if pl["is_holder"]) == 1, "un solo titular"
assert sum(1 for pl in det["players"] if pl["club_hand"]) == 2, "dos sets de bastones"
assert sum(1 for pl in det["players"] if pl["category"] == "INFANTIL") == 1, "un menor"
titular = next(pl for pl in det["players"] if pl["is_holder"])
assert titular["handicap"] == "14.2", "el handicap del titular se guardó"
print("  cada jugador quedó con su nombre, su categoría y sus bastones ✓")

print("\n10. El cobro no entró a la caja del mostrador")
caja = c.get("/api/treasury/cash/current", headers=h).json()
print("  caja:", caja.get("session_id"), "· efectivo", caja.get("cash_mxn"), "· tarjeta", caja.get("card_mxn"))
assert caja.get("session_id") is None, "una reserva en línea no debe abrir turno de caja"

print("\n11. El apartado vence")
from app.core.database import SessionLocal
from app.modules.booking.models import Reservation
from datetime import datetime
otra = next(s for s in c.get(f"/api/public/disponibilidad?fecha={manana}").json()["salidas"] if s["libres"] >= 2)
r = c.post("/api/public/reservas", json=cuerpo_de(
    otra["id"], modalidad="PARTIDA_ABIERTA", cuantos=2, correo="vence@ejemplo.com"))
folio2 = r.json()["folio"]
with SessionLocal() as s:
    res = s.query(Reservation).filter(Reservation.folio == folio2).first()
    res.hold_expires_at = datetime.utcnow() - timedelta(minutes=1)
    slot_id = res.tee_slot_id
    s.commit()
r = c.get(f"/api/public/disponibilidad?fecha={manana}")
tras = next(s for s in r.json()["salidas"] if s["id"] == slot_id)
print(f"  salida {slot_id}: libres tras vencer el apartado = {tras['libres']}")
estado2 = c.get(f"/api/public/reservas/{folio2}").json()["estado"]
print("  la reserva vencida quedó:", estado2)
assert estado2 == "CANCELADA"

print("\n12. El cobro apagado no acepta tarjetas")
settings.PAGOS_SIMULADOS = False
tercera = next(s for s in c.get(f"/api/public/disponibilidad?fecha={manana}").json()["salidas"] if s["libres"] >= 2)
r = c.post("/api/public/reservas", json=cuerpo_de(
    tercera["id"], modalidad="PARTIDA_ABIERTA", cuantos=2, correo="apagado@ejemplo.com"))
f3 = r.json()["folio"]
r = c.post(f"/api/public/reservas/{f3}/pago", json=buena)
print("  HTTP", r.status_code, "·", r.json()["error"]["message"][:70])
assert r.status_code == 409
settings.PAGOS_SIMULADOS = True

print("\n13. Las reglas del sistema siguen aplicando")
cuarta = next(s for s in c.get(f"/api/public/disponibilidad?fecha={manana}").json()["salidas"] if s["libres"] >= 4)
r = c.post("/api/public/reservas", json=cuerpo_de(
    cuarta["id"], modalidad="GRUPO", cuantos=4, correo="grupo@ejemplo.com"))
print("  cuatro jugadores en Grupo →", r.status_code, r.json().get("modalidad"))
assert r.json()["modalidad"] == "GRUPO"
ayer = (date.today() - timedelta(days=1)).isoformat()
r = c.get(f"/api/public/disponibilidad?fecha={ayer}")
print("  fecha pasada →", r.status_code, r.json()["error"]["message"][:40])
assert r.status_code == 409

print("\n14. La cuenta del sitio se da de alta sola")
# El sembrado la crea, pero solo corre con la base en blanco. En una base que
# ya estaba trabajando antes de que existiera el sitio la cuenta no existe, y
# la primera reserva tiene que poder crearla.
from app.modules.identity.models import User
from app.modules.pagos.service import CUENTA_DEL_SITIO
with SessionLocal() as s:
    cuenta = s.query(User).filter(User.email == CUENTA_DEL_SITIO).first()
    print("  cuenta sembrada:", cuenta.email, "· activa:", cuenta.is_active)
    assert cuenta.is_active is False, "la cuenta del sitio no debe poder entrar"
    # Se borra para simular la base que nunca pasó por el sembrado nuevo.
    s.query(Reservation).filter(Reservation.created_by_id == cuenta.id).update(
        {"created_by_id": None}, synchronize_session=False)
    s.delete(cuenta)
    s.commit()
with SessionLocal() as s:
    assert s.query(User).filter(User.email == CUENTA_DEL_SITIO).first() is None
print("  borrada a propósito, como una base vieja")

quinta = next(s for s in c.get(f"/api/public/disponibilidad?fecha={manana}").json()["salidas"] if s["libres"] >= 2)
r = c.post("/api/public/reservas", json=cuerpo_de(
    quinta["id"], modalidad="PARTIDA_ABIERTA", cuantos=2, correo="sincuenta@ejemplo.com"))
print("  reserva sin cuenta previa →", r.status_code, r.json().get("folio"))
assert r.status_code == 201, "la reserva no debe morir pidiendo que alguien corra el sembrado"
with SessionLocal() as s:
    rehecha = s.query(User).filter(User.email == CUENTA_DEL_SITIO).first()
    print("  se volvió a crear:", rehecha.email, "· rol", rehecha.role, "· activa:", rehecha.is_active)
    assert rehecha.is_active is False
# Y sigue sin ser una puerta de entrada.
r = c.post("/api/auth/login", json={"email": CUENTA_DEL_SITIO, "password": "cualquiera"})
print("  intento de entrar con ella →", r.status_code)
assert r.status_code in (401, 403)

print("\n" + "="*58)
print("  EL FLUJO PÚBLICO FUNCIONA DE PUNTA A PUNTA")
print("="*58 + "\n")
