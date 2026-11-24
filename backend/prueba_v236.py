"""v23.6 · auditoría: monto del cobro, candado de pagos, tarjeta en segundo
plano, IP real, bloqueo de login por cuenta y tope de fechas.

    python prueba_v236.py
"""
import os
import subprocess
import sys
from datetime import date, timedelta

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
settings.PUBLICO_INTENTOS_POR_HORA = 500

EVENTO = {}
TARJETAS = []

def _leer_evento(cuerpo, firma):
    from stripe import _util
    return _util.convert_to_stripe_object(dict(EVENTO), "sk_test_doble", None)

def _tarjeta(pi):
    TARJETAS.append(pi)
    return {"marca": "visa", "ultimos4": "4242"}

stripe_gateway.crear_sesion = lambda **kw: {"id": "cs_x", "url": "https://checkout.stripe.com/c/pay/x"}
stripe_gateway.devolver = lambda pi, motivo="": "re_1"
stripe_gateway.leer_evento = _leer_evento
stripe_gateway.datos_de_tarjeta = _tarjeta

from app.main import app                             # noqa: E402
from app.shared import limites                       # noqa: E402
from _cliente_publico import ClienteDelSitio         # noqa: E402
c = ClienteDelSitio(app)
FALLOS = []

def check(etiqueta, ok, extra=""):
    print(f"  {'✓' if ok else '✗'} {etiqueta}" + (f" · {extra}" if extra else ""))
    if not ok:
        FALLOS.append(etiqueta)

dia = (date.today() + timedelta(days=5)).isoformat()
_usados = set()

def apartar(correo):
    salidas = c.get(f"/api/public/disponibilidad?fecha={dia}").json()["salidas"]
    libre = next(s for s in salidas if s["libres"] >= 1 and s["id"] not in _usados)
    _usados.add(libre["id"])
    return c.post("/api/public/reservas", json={
        "tee_slot_id": libre["id"], "fecha": dia, "modalidad": "PARTIDA_ABIERTA", "hoyos": 18,
        "jugadores": [{"nombre": "Turista A de Prueba", "edad": 35, "handicap": "14.2",
                       "pga": None, "bastones": "DIESTRO"}],
        "correo": correo, "telefono": "+1 555 000 0000",
    }).json()

def aviso(ap, centavos, pi, moneda="mxn"):
    EVENTO.clear()
    EVENTO.update({"type": "checkout.session.completed", "data": {"object": {
        "object": "checkout.session", "id": "cs_" + pi, "metadata": {"folio": ap["folio"]},
        "payment_status": "paid", "amount_total": centavos, "payment_intent": pi,
        "currency": moneda}}})
    return c.post("/api/public/stripe/webhook", content=b"{}", headers={"stripe-signature": "x"})

def estado(ap):
    return c.get(f"/api/public/reservas/{ap['folio']}").json()["estado"]

from app.core.database import SessionLocal           # noqa: E402
from app.modules.billing.models import Payment      # noqa: E402
from app.modules.booking.models import Reservation  # noqa: E402

print("\n1. Monto distinto: se registra, pero NO confirma")
ap = apartar("monto@ejemplo.com")
r = aviso(ap, int(float(ap["total"]) * 100) - 5000, "pi_monto")
check("El aviso se contesta 200", r.status_code == 200, r.text[:80])
check("Avisa 'monto_distinto'", r.json().get("estado") == "monto_distinto")
check("La reserva sigue pendiente", estado(ap) == "PENDIENTE", estado(ap))
with SessionLocal() as s:
    pago = s.query(Payment).filter(Payment.reference == "pi_monto").first()
    res = s.query(Reservation).filter(Reservation.folio == ap["folio"]).first()
    check("El pago quedó registrado con la marca REVISAR", pago is not None and "REVISAR" in (pago.notes or ""),
          (pago.notes or "")[:60] if pago else "sin pago")
    check("El apartado ya no vence solo (hay dinero cobrado)", res.hold_expires_at is None)

print("\n2. Moneda distinta a MXN: tampoco confirma")
ap2 = apartar("moneda@ejemplo.com")
r = aviso(ap2, int(float(ap2["total"]) * 100), "pi_moneda", moneda="cad")
check("Avisa 'monto_distinto'", r.json().get("estado") == "monto_distinto")
check("Sigue pendiente", estado(ap2) == "PENDIENTE")

print("\n3. Monto correcto: confirma y la tarjeta se anota después")
ap3 = apartar("bien@ejemplo.com")
r = aviso(ap3, int(float(ap3["total"]) * 100), "pi_bien")
check("Confirmada", r.json().get("estado") == "confirmada" and estado(ap3) == "CONFIRMADA")
check("Se pidió la tarjeta a Stripe", "pi_bien" in TARJETAS, str(TARJETAS))
with SessionLocal() as s:
    pago = s.query(Payment).filter(Payment.reference == "pi_bien").first()
    check("El pago dice 'visa ····4242'", "visa ····4242" in (pago.notes or ""), pago.notes)

print("\n4. Si la tarjeta no se puede leer, el pago y la reserva siguen firmes")
stripe_gateway.datos_de_tarjeta = lambda pi: {}
ap4 = apartar("sintarjeta@ejemplo.com")
r = aviso(ap4, int(float(ap4["total"]) * 100), "pi_sin")
check("Confirmada sin datos de tarjeta", estado(ap4) == "CONFIRMADA")
with SessionLocal() as s:
    pago = s.query(Payment).filter(Payment.reference == "pi_sin").first()
    check("El pago existe", pago is not None)
stripe_gateway.datos_de_tarjeta = _tarjeta

print("\n5. Candado en la base: el mismo pago en línea no entra dos veces")
from sqlalchemy.exc import IntegrityError           # noqa: E402
from decimal import Decimal                          # noqa: E402
with SessionLocal() as s:
    p = s.query(Payment).filter(Payment.reference == "pi_bien").first()
    clon = Payment(reservation_id=p.reservation_id, currency=p.currency, amount=p.amount,
                   exchange_rate_applied=p.exchange_rate_applied, amount_mxn=p.amount_mxn,
                   change_mxn=Decimal("0"), method=p.method, reference=p.reference,
                   received_by_id=p.received_by_id)
    s.add(clon)
    try:
        s.commit(); rechazado = False
    except IntegrityError:
        s.rollback(); rechazado = True
check("La base rechaza el duplicado", rechazado)
r = aviso(ap3, int(float(ap3["total"]) * 100), "pi_bien")
check("El aviso repetido sigue contestando 'ya_estaba'", r.json().get("estado") == "ya_estaba")

print("\n6. La IP del límite no se puede falsificar")
from app.core.ip import ip_del_cliente              # noqa: E402
class _Req:
    def __init__(s, xff): s.headers = {"x-forwarded-for": xff} if xff else {}; s.client = None
check("Toma lo que agregó el proxy (derecha), no lo que escribió el visitante",
      ip_del_cliente(_Req("6.6.6.6, 201.1.2.3")) == "201.1.2.3")
check("Sin cabecera, no truena", ip_del_cliente(_Req("")) == "desconocida")

print("\n7. Bloqueo de login por cuenta, aunque cambien de IP")
limites.olvidar_todo()
malos = []
for i in range(settings.LOGIN_FALLOS_POR_CUENTA):
    r = c.post("/api/auth/login", json={"email": "operaciones@lasparotas.mx", "password": "mala"},
               headers={"X-Forwarded-For": f"10.0.0.{i}, 203.0.113.{i + 1}"})
    malos.append(r.status_code)
check("Los fallos devuelven 401", all(x == 401 for x in malos), str(malos))
r = c.post("/api/auth/login", json={"email": "operaciones@lasparotas.mx", "password": "Reserva2026*"},
           headers={"X-Forwarded-For": "10.0.0.99, 203.0.113.99"})
check("Con la cuenta bloqueada ni la contraseña buena entra (desde otra IP)", r.status_code == 401,
      f"HTTP {r.status_code}")
check("El mensaje no dice si el correo existe", "Correo" not in r.text and "inexistente" not in r.text)
r = c.post("/api/auth/login", json={"email": "otra.cuenta@lasparotas.mx", "password": "x"},
           headers={"X-Forwarded-For": "10.0.0.50, 203.0.113.50"})
check("Otra cuenta no se ve afectada (responde fallo normal)", r.status_code == 401 and "Demasiados" not in r.text)
limites.olvidar_todo()
r = c.post("/api/auth/login", json={"email": "operaciones@lasparotas.mx", "password": "Reserva2026*"},
           headers={"X-Forwarded-For": "10.0.0.7, 203.0.113.7"})
check("Pasado el bloqueo, entra", r.status_code == 200, f"HTTP {r.status_code}")

print("\n8. Un acceso bueno limpia los fallos de esa cuenta")
limites.olvidar_todo()
for i in range(3):
    c.post("/api/auth/login", json={"email": "operaciones@lasparotas.mx", "password": "mala"},
           headers={"X-Forwarded-For": f"1.1.1.{i}, 198.51.100.{i + 1}"})
c.post("/api/auth/login", json={"email": "operaciones@lasparotas.mx", "password": "Reserva2026*"},
       headers={"X-Forwarded-For": "1.1.1.9, 198.51.100.9"})
for i in range(3):
    r = c.post("/api/auth/login", json={"email": "operaciones@lasparotas.mx", "password": "mala"},
               headers={"X-Forwarded-For": f"2.2.2.{i}, 198.51.100.{20 + i}"})
check("Tras entrar bien, 3 fallos más NO bloquean", r.status_code == 401 and "Demasiados" not in r.text)

print("\n9. Tope de fechas en el sitio")
lejos = (date.today() + timedelta(days=settings.DISPONIBILIDAD_DIAS_MAX + 30)).isoformat()
r = c.get(f"/api/public/disponibilidad?fecha={lejos}")
check("Una fecha demasiado lejana se rechaza", r.status_code == 409, f"HTTP {r.status_code} · {r.text[:70]}")
cerca = (date.today() + timedelta(days=settings.DISPONIBILIDAD_DIAS_MAX - 5)).isoformat()
r = c.get(f"/api/public/disponibilidad?fecha={cerca}")
check("Una fecha dentro del tope sí responde", r.status_code == 200, f"HTTP {r.status_code}")

print("\n" + "=" * 58)
if FALLOS:
    print(f"  {len(FALLOS)} FALLARON:")
    for f in FALLOS:
        print(f"    ✗ {f}")
else:
    print("  v23.6 · TODO EN ORDEN")
print("=" * 58 + "\n")
raise SystemExit(1 if FALLOS else 0)
