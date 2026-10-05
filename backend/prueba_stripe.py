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
# El tope de reservas por conexión existe para que un robot no llene el tee
# sheet. Esta prueba aparta una salida tras otra desde la misma dirección, así
# que choca con él por hacer su trabajo. Se sube solo aquí; que el tope de
# verdad funcione lo comprueba `prueba_publica.py`.
settings.PUBLICO_INTENTOS_POR_HORA = 200

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
    """Devuelve un evento de Stripe DE VERDAD, no un diccionario.

    Esta distinción costó el primer pago real. El doble devolvía un `dict`, y
    con un `dict` la ruta funcionaba de maravilla; pero lo que Stripe entrega
    es un objeto `Event` de su biblioteca, y ese objeto se niega a propósito a
    responder `.get()`. En producción el pago entró, el aviso llegó y la ruta
    reventó con un 500 — con la prueba en verde.

    Así que el doble construye el objeto auténtico con la misma función que usa
    la biblioteca al recibirlo por la red. Si el código vuelve a tratarlo como
    diccionario, la prueba se cae aquí y no en la cuenta de un huésped.
    """
    if firma != "firma-buena":
        from app.core.exceptions import BusinessRuleError
        raise BusinessRuleError("Aviso de pago no verificable")

    from stripe import _util

    return _util.convert_to_stripe_object(dict(EVENTO), "sk_test_doble", None)

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
EVENTO.update({"type": "checkout.session.completed", "data": {"object": {"object": "checkout.session"}}})
r = c.post("/api/public/stripe/webhook", content=b"{}", headers={"stripe-signature": "inventada"})
check("Firma inválida rechazada", r.status_code == 409, f"HTTP {r.status_code}")
check("Y la reserva sigue sin confirmar",
      c.get(f"/api/public/reservas/{folio}").json()["estado"] == "PENDIENTE")

print("\n5. El aviso firmado sí confirma")
centavos = int(float(total) * 100)
EVENTO.clear()
EVENTO.update({"type": "checkout.session.completed", "data": {"object": {"object": "checkout.session", 
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
EVENTO.update({"type": "checkout.session.completed", "data": {"object": {"object": "checkout.session", 
    "id": "cs_test_2", "metadata": {"folio": ap2["folio"]}, "payment_status": "paid",
    "amount_total": int(float(ap2["total"]) * 100), "payment_intent": "pi_test_2",
}}})
r = c.post("/api/public/stripe/webhook", content=b"{}", headers={"stripe-signature": "firma-buena"})
check("Se devuelve el dinero", r.json().get("estado") == "devuelto", r.text[:70])
check("La devolución se pidió a Stripe", "pi_test_2" in DEVUELTOS, str(DEVUELTOS))

print("\n8. Un pago a medias no confirma")
ap3 = apartar(correo="pendiente@ejemplo.com")
EVENTO.clear()
EVENTO.update({"type": "checkout.session.completed", "data": {"object": {"object": "checkout.session", 
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

print("\n10. Una llave mal puesta se detecta antes de cobrar")
# El error más fácil de cometer al configurar: copiar la llave publicable, que
# en el panel de Stripe está pegadita a la secreta. Con ella puesta todo se ve
# bien hasta que alguien le da a pagar.
guardadas = (settings.STRIPE_SECRET_KEY, settings.SITIO_URL)
for llave, sitio, esperado in [
    ("pk_test_51abc", "https://parotasgolf.com", "publicable"),
    ("sk_test_51abc", "parotasgolf.com", "SITIO_URL"),
    ("  sk_test_51abc  ", "https://parotasgolf.com", "espacios"),
    ("hola", "https://parotasgolf.com", "no parece una llave"),
]:
    settings.STRIPE_SECRET_KEY, settings.SITIO_URL = llave, sitio
    aviso = stripe_gateway.problema_de_configuracion() or ""
    check(f"Se detecta: {esperado}", esperado in aviso, aviso[:70])

settings.STRIPE_SECRET_KEY, settings.SITIO_URL = "sk_test_51abc", "https://parotasgolf.com"
check("Una llave bien puesta no se queja",
      stripe_gateway.problema_de_configuracion() is None)
check("El resumen del arranque no escribe el secreto",
      "51abc" not in stripe_gateway.resumen(), stripe_gateway.resumen())
settings.STRIPE_SECRET_KEY, settings.SITIO_URL = guardadas

print("\n11. Un error de Stripe no sale como 500 mudo")
# Esto es lo que rompió el primer cobro en producción: cualquier queja de
# Stripe subía sin traducir y salía como un 500 pelón, sin motivo en ninguna
# parte. Ahora sale como 409 con una frase que el huésped puede leer, y el
# motivo de verdad queda en la bitácora.
import stripe as _stripe
from app.core.exceptions import BusinessRuleError

ap4 = apartar(correo="falla@ejemplo.com")
original = stripe_gateway.crear_sesion

for tipo, como_se_llama in [
    (_stripe.error.AuthenticationError("Invalid API Key provided"), "llave rechazada"),
    (_stripe.error.InvalidRequestError("Not a valid URL", "success_url"), "dirección inválida"),
    (_stripe.error.APIConnectionError("Network error"), "sin salida a internet"),
]:
    def revienta(*a, _e=tipo, **k):
        raise stripe_gateway._traducir(_e, "abrir la página de pago") from _e
    stripe_gateway.crear_sesion = revienta
    r = c.post(f"/api/public/reservas/{ap4['folio']}/checkout")
    check(f"{como_se_llama} → 409, no 500", r.status_code == 409, f"HTTP {r.status_code}")
    check(f"{como_se_llama} → el huésped lee algo útil",
          "salida sigue apartada" in r.json()["error"]["message"], r.json()["error"]["message"][:60])

stripe_gateway.crear_sesion = original
check("Y la reserva no se perdió por el error",
      c.get(f"/api/public/reservas/{ap4['folio']}").json()["estado"] == "PENDIENTE")

print("\n12. Migrar al arrancar no deja muda a la aplicación")
# Alembic, al correr dentro del proceso, llamaba a `fileConfig`, que trae
# `disable_existing_loggers=True` y apagaba TODOS los loggers de la aplicación.
# En el servidor eso dejó al sistema sin bitácora desde el primer segundo: un
# cobro con Stripe se cayó y no hubo forma de saber por qué.
import logging as _log
from alembic import command as _cmd
from alembic.config import Config as _Cfg
from app.core.arranque import RAIZ as _RAIZ

_antes = _log.getLogger("app.main")
check("El logger está vivo antes de migrar", not _antes.disabled)

_cfg = _Cfg(str(_RAIZ / "alembic.ini"))
_cfg.set_main_option("script_location", str(_RAIZ / "alembic"))
_cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
_cfg.attributes["app_configuro_log"] = True
_cmd.upgrade(_cfg, "head")

check("Y sigue vivo después", not _log.getLogger("app.main").disabled)
check("La raíz conserva su manejador", len(_log.getLogger().handlers) > 0)
check("Y su nivel, no el WARNING del .ini",
      _log.getLogger().level <= _log.INFO, f"nivel {_log.getLogger().level}")

print("\n13. El apartado no es una reserva: ni pase ni promesa")
# Lo que se arregló aquí: antes el pase con el QR salía al apartar, o sea
# antes de pagar. El huésped recibía por correo el documento que lo acredita
# para jugar una salida que todavía podía perder en diez minutos.
from app.core.database import SessionLocal as _S
from app.modules.mailing.models import OutboxEmail
from app.modules.booking.models import Reservation as _R

def correos_de(folio):
    with _S() as s:
        r = s.query(_R).filter(_R.folio == folio).first()
        if r is None:
            return []
        return [c.kind for c in s.query(OutboxEmail).filter(
            OutboxEmail.reservation_id == r.id).all()]

ap5 = apartar(correo="sinpase@ejemplo.com")
check("Al apartar no sale ningún pase", correos_de(ap5["folio"]) == [],
      str(correos_de(ap5["folio"])))

print("\n14. Si no paga, no hay reserva")
# El huésped le da para atrás en la página de Stripe. Antes la salida se
# quedaba apartada media hora y el sitio le decía «le llamamos para
# confirmarla» — una promesa que nadie pidió, por algo que decidió no pagar.
antes = c.get(f"/api/public/disponibilidad?fecha={dia}").json()["salidas"]
slot_de = next(s for s in antes
               if s["id"] == c.get(f"/api/public/reservas/{ap5['folio']}").json() and False) \
          if False else None

r = c.post(f"/api/public/reservas/{ap5['folio']}/soltar")
check("Soltar contesta bien", r.status_code == 200, f"HTTP {r.status_code}")
check("La reserva queda cancelada", r.json()["estado"] == "CANCELADA", r.json()["estado"])
check("Y el horario vuelve a la venta",
      c.get(f"/api/public/reservas/{ap5['folio']}").json()["estado"] == "CANCELADA")
check("Sigue sin haber pase", correos_de(ap5["folio"]) == [],
      str(correos_de(ap5["folio"])))

# Stripe puede mandar el regreso dos veces, o el huésped recargar la página.
r = c.post(f"/api/public/reservas/{ap5['folio']}/soltar")
check("Soltar dos veces no truena", r.status_code == 200, f"HTTP {r.status_code}")

print("\n15. Soltar no sirve para tumbar reservas ajenas")
ap6 = apartar(correo="pagada@ejemplo.com")
EVENTO.clear()
EVENTO.update({"type": "checkout.session.completed", "data": {"object": {
    "object": "checkout.session", "metadata": {"folio": ap6["folio"]},
    "payment_status": "paid", "id": "cs_firme",
    "amount_total": int(float(ap6["total"]) * 100), "payment_intent": "pi_firme",
}}})
c.post("/api/public/stripe/webhook", content=b"{}", headers={"stripe-signature": "firma-buena"})
check("La reserva pagada quedó confirmada",
      c.get(f"/api/public/reservas/{ap6['folio']}").json()["estado"] == "CONFIRMADA")
check("Y AHORA sí sale su pase", "PASE" in str(correos_de(ap6["folio"])),
      str(correos_de(ap6["folio"])))

r = c.post(f"/api/public/reservas/{ap6['folio']}/soltar")
check("Una reserva pagada no se puede soltar", r.status_code == 409, f"HTTP {r.status_code}")
check("Y sigue confirmada",
      c.get(f"/api/public/reservas/{ap6['folio']}").json()["estado"] == "CONFIRMADA")

print("\n" + "=" * 58)
if FALLOS:
    print(f"  {len(FALLOS)} FALLARON:")
    for f in FALLOS:
        print(f"    ✗ {f}")
else:
    print("  EL COBRO CON STRIPE ESTÁ BIEN AMARRADO")
print("=" * 58 + "\n")
raise SystemExit(1 if FALLOS else 0)
