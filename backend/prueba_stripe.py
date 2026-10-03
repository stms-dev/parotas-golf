"""Prueba del cobro con Stripe, sin tocar Stripe.

Se reemplaza la pasarela por un doble que responde como ella. Lo que se está
comprobando no es que Stripe funcione —de eso responde Stripe— sino las cuatro
cosas que son responsabilidad de este sistema y que, si fallan, cuestan dinero:

  1. Que el monto salga del servidor y no de lo que mande el navegador.
  2. Que lo que confirma una reserva sea el aviso firmado, no el regreso del
     navegador.
  3. Que un aviso repetido no cobre dos veces.
  4. Que un pago que llega tarde, con la salida ya revendida, se devuelva.

    python prueba_stripe.py
"""
import os
import subprocess
import sys
from datetime import date, datetime, timedelta

os.environ["STRIPE_SECRET_KEY"] = "sk_test_de_mentiras_para_la_prueba"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_de_mentiras"
os.environ["PAGOS_SIMULADOS"] = "false"

if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

from fastapi.testclient import TestClient            # noqa: E402
from app.core.config import settings                 # noqa: E402
from app.modules.pagos import stripe_gateway         # noqa: E402

settings.STRIPE_SECRET_KEY = "sk_test_de_mentiras_para_la_prueba"
settings.STRIPE_WEBHOOK_SECRET = "whsec_de_mentiras"
settings.PAGOS_SIMULADOS = False

# --- el doble de la pasarela -------------------------------------------------
SESIONES = []
DEVUELTOS = []

def _crear_sesion(**kw):
    SESIONES.append(kw)
    return {"id": f"cs_test_{len(SESIONES)}", "url": f"https://checkout.stripe.com/c/pay/{len(SESIONES)}"}

def _devolver(payment_intent, motivo="requested_by_customer"):
    DEVUELTOS.append(payment_intent)
    return f"re_{len(DEVUELTOS)}"

EVENTO = {}

def _leer_evento(cuerpo, firma):
    # El doble solo acepta la firma buena: así se comprueba que la ruta
    # realmente verifica en lugar de creerle a cualquiera.
    if firma != "firma-buena":
        from app.core.exceptions import BusinessRuleError
        raise BusinessRuleError("Aviso de pago no verificable")
    return EVENTO

stripe_gateway.crear_sesion = _crear_sesion
stripe_gateway.devolver = _devolver
stripe_gateway.leer_evento = _leer_evento

from app.main import app                             # noqa: E402
c = TestClient(app)
FALLOS = []

def check(etiqueta, ok, extra=""):
    print(f"  {'✓' if ok else '✗'} {etiqueta}" + (f" · {extra}" if extra else ""))
    if not ok:
        FALLOS.append(etiqueta)

dia = (date.today() + timedelta(days=4)).isoformat()

def apartar(correo="turista@ejemplo.com", jugadores=2):
    """Aparta como lo manda el sitio: cada jugador con su nombre y su edad."""
    salidas = c.get(f"/api/public/disponibilidad?fecha={dia}").json()["salidas"]
    libre = next(s for s in salidas if s["libres"] >= jugadores)
    lista = [
        {
            "nombre": f"Turista {chr(65 + i)} de Prueba",
            "edad": 35 + i,
            "handicap": "14.2" if i == 0 else None,
            "pga": None,
            "bastones": "DIESTRO" if i == 0 else None,
        }
        for i in range(jugadores)
    ]
    return c.post("/api/public/reservas", json={
        "tee_slot_id": libre["id"], "fecha": dia,
        "modalidad": "GRUPO" if jugadores >= 4 else "PARTIDA_ABIERTA",
        "hoyos": 18, "jugadores": lista,
        "correo": correo, "telefono": "+1 555 000 0000",
    }).json()

print("\n1. El catálogo dice que se cobra con Stripe")
campo = c.get("/api/public/campo").json()
check("Pasarela anunciada", campo["pasarela"] == "stripe", campo["pasarela"])
check("Cobro disponible", campo["cobro_disponible"] is True)
check("El apartado dura lo que Stripe permite", campo["apartado_minutos"] == 30,
      f"{campo['apartado_minutos']} min")

print("\n2. El monto lo pone el servidor")
ap = apartar()
folio, total = ap["folio"], ap["total"]
r = c.post(f"/api/public/reservas/{folio}/checkout")
check("Se abre la sesión de pago", r.status_code == 200 and r.json()["url"].startswith("https://"),
      r.json().get("url", r.text)[:50])
enviado = SESIONES[-1]
check("Va el total de la reserva, no el del navegador",
      str(enviado["total"]) == str(total), f"${enviado['total']} = ${total}")
check("Viaja el folio para saber qué confirmar", enviado["folio"] == folio)
# Con time.time(), no con utcnow().timestamp(): lo segundo interpreta una
# fecha sin zona como hora local, y este contenedor corre en hora de México.
# Comparar así daría seis horas de diferencia y escondería el error de verdad.
import time as _t                                     # noqa: E402
_faltan = (enviado["vence_en"] - int(_t.time())) / 60
check("La sesión de pago caduca junto con el apartado",
      29 <= _faltan <= 31, f"en {_faltan:.0f} min")

print("\n3. Volver del navegador NO confirma nada")
estado = c.get(f"/api/public/reservas/{folio}").json()
check("Sigue pendiente aunque el huésped ya 'volvió'", estado["estado"] == "PENDIENTE",
      estado["estado"])

print("\n4. Un aviso sin firma buena se rechaza")
EVENTO.clear()
EVENTO.update({"type": "checkout.session.completed", "data": {"object": {}}})
r = c.post("/api/public/stripe/webhook", content=b"{}", headers={"stripe-signature": "inventada"})
check("Firma inválida rechazada", r.status_code == 409, f"HTTP {r.status_code}")
check("Y la reserva sigue sin confirmar",
      c.get(f"/api/public/reservas/{folio}").json()["estado"] == "PENDIENTE")

print("\n5. El aviso firmado sí confirma")
centavos = int(float(total) * 100)
EVENTO.clear()
EVENTO.update({"type": "checkout.session.completed", "data": {"object": {
    "id": "cs_test_1", "metadata": {"folio": folio}, "payment_status": "paid",
    "amount_total": centavos, "payment_intent": "pi_test_1",
}}})
r = c.post("/api/public/stripe/webhook", content=b"{}", headers={"stripe-signature": "firma-buena"})
check("Webhook aceptado", r.status_code == 200 and r.json().get("estado") == "confirmada", r.text[:90])
estado = c.get(f"/api/public/reservas/{folio}").json()
check("La reserva quedó confirmada", estado["estado"] == "CONFIRMADA")

tok = c.post("/api/auth/login", json={"email": "operaciones@lasparotas.mx", "password": "Reserva2026*"}).json()["access_token"]
h = {"Authorization": f"Bearer {tok}"}
fila = next(x for x in c.get(f"/api/booking/reservations?slot_date={dia}", headers=h).json() if x["folio"] == folio)
det = c.get(f"/api/booking/reservations/{fila['id']}", headers=h).json()
check("Sin saldo en el tee sheet", float(det["balance"]) == 0.0, f"${det['balance']}")
check("Un solo cobro registrado", len(det["payments"]) == 1,
      f"{len(det['payments'])} pago(s) · ref {det['payments'][0]['reference']}")
caja = c.get("/api/treasury/cash/current", headers=h).json()
check("No entró a la caja del mostrador", caja.get("session_id") is None)

print("\n6. Stripe reintenta el aviso: no se cobra dos veces")
r = c.post("/api/public/stripe/webhook", content=b"{}", headers={"stripe-signature": "firma-buena"})
check("El repetido se reconoce", r.json().get("estado") == "ya_estaba", r.text[:70])
det = c.get(f"/api/booking/reservations/{fila['id']}", headers=h).json()
check("Sigue habiendo un solo cobro", len(det["payments"]) == 1, f"{len(det['payments'])} pago(s)")

print("\n7. Un pago que llega con la salida ya revendida se devuelve")
ap2 = apartar(correo="tarde@ejemplo.com")
from app.core.database import SessionLocal           # noqa: E402
from app.modules.booking.models import Reservation   # noqa: E402
with SessionLocal() as s:
    res = s.query(Reservation).filter(Reservation.folio == ap2["folio"]).first()
    res.hold_expires_at = datetime.utcnow() - timedelta(minutes=1)
    s.commit()
c.get(f"/api/public/disponibilidad?fecha={dia}")       # el barrido la cancela
check("El apartado venció", c.get(f"/api/public/reservas/{ap2['folio']}").json()["estado"] == "CANCELADA")

EVENTO.clear()
EVENTO.update({"type": "checkout.session.completed", "data": {"object": {
    "id": "cs_test_2", "metadata": {"folio": ap2["folio"]}, "payment_status": "paid",
    "amount_total": int(float(ap2["total"]) * 100), "payment_intent": "pi_test_2",
}}})
r = c.post("/api/public/stripe/webhook", content=b"{}", headers={"stripe-signature": "firma-buena"})
check("Se devuelve el dinero", r.json().get("estado") == "devuelto", r.text[:70])
check("La devolución se pidió a Stripe", "pi_test_2" in DEVUELTOS, str(DEVUELTOS))

print("\n8. Un pago a medias no confirma")
ap3 = apartar(correo="pendiente@ejemplo.com")
EVENTO.clear()
EVENTO.update({"type": "checkout.session.completed", "data": {"object": {
    "id": "cs_test_3", "metadata": {"folio": ap3["folio"]}, "payment_status": "unpaid",
    "amount_total": int(float(ap3["total"]) * 100), "payment_intent": "pi_test_3",
}}})
c.post("/api/public/stripe/webhook", content=b"{}", headers={"stripe-signature": "firma-buena"})
check("Sigue pendiente mientras el dinero no esté",
      c.get(f"/api/public/reservas/{ap3['folio']}").json()["estado"] == "PENDIENTE")

print("\n9. Con Stripe puesto, el simulador se niega")
r = c.post(f"/api/public/reservas/{ap3['folio']}/pago", json={
    "numero": "4242424242424242", "mes": 12, "anio": 2030, "cvv": "123", "nombre": "Turista de Prueba"})
check("El cobro de mentiras no corre", r.status_code == 409, r.json()["error"]["message"][:60])

print("\n" + "=" * 58)
if FALLOS:
    print(f"  {len(FALLOS)} FALLARON:")
    for f in FALLOS:
        print(f"    ✗ {f}")
else:
    print("  EL COBRO CON STRIPE ESTÁ BIEN AMARRADO")
print("=" * 58 + "\n")
raise SystemExit(1 if FALLOS else 0)
