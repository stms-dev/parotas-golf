"""v23.8 · tope de 4 jugadores por horario en partida abierta + resumen ejecutivo.

    python prueba_v238.py
"""
import os, subprocess, sys
from datetime import date, timedelta

os.environ["STRIPE_SECRET_KEY"] = "sk_test_de_mentiras_para_la_prueba"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_de_mentiras"
os.environ["PAGOS_SIMULADOS"] = "false"
if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

from app.core.config import settings                 # noqa: E402
from app.modules.pagos import stripe_gateway         # noqa: E402
settings.STRIPE_SECRET_KEY = "sk_test_de_mentiras_para_la_prueba"
settings.PAGOS_SIMULADOS = False
settings.PUBLICO_INTENTOS_POR_HORA = 500
EVENTO = {}
def _leer_evento(cuerpo, firma):
    from stripe import _util
    return _util.convert_to_stripe_object(dict(EVENTO), "sk_test_doble", None)
stripe_gateway.leer_evento = _leer_evento
stripe_gateway.datos_de_tarjeta = lambda pi: {}
settings.STRIPE_WEBHOOK_SECRET = "whsec_de_mentiras"
stripe_gateway.crear_sesion = lambda **kw: {"id": "cs_x", "url": "https://checkout.stripe.com/c/pay/x"}

from app.main import app                             # noqa: E402
from _cliente_publico import ClienteDelSitio         # noqa: E402
c = ClienteDelSitio(app)
FALLOS = []
def check(e, ok, extra=""):
    print(f"  {'✓' if ok else '✗'} {e}" + (f" · {extra}" if extra else ""))
    if not ok: FALLOS.append(e)

dia = (date.today() + timedelta(days=6)).isoformat()
salidas = c.get(f"/api/public/disponibilidad?fecha={dia}").json()["salidas"]
libres = [s for s in salidas if s["libres"] >= 4]

def reservar(slot, n, correo, acomp=0):
    return c.post("/api/public/reservas", json={
        "tee_slot_id": slot["id"], "fecha": dia, "modalidad": "PARTIDA_ABIERTA", "hoyos": 18,
        "jugadores": [{"nombre": f"Jugador {i}", "edad": 35, "handicap": "14.2", "pga": None, "bastones": "DIESTRO"} for i in range(n)],
        "acompanantes": [{"nombre": f"Acomp {i}", "edad": 40} for i in range(acomp)],
        "correo": correo, "telefono": "+1 555 000 0000"})

print("\n1. 2 + 2 jugadores en el mismo horario: pasa")
s1 = libres[0]
check("Primera reserva de 2", reservar(s1, 2, "a@ejemplo.com").status_code in (200, 201))
check("Segunda reserva de 2", reservar(s1, 2, "b@ejemplo.com").status_code in (200, 201))
check("Una tercera de 1 ya no cabe", reservar(s1, 1, "c@ejemplo.com").status_code >= 400)

print("\n2. 3 y luego 3: la segunda se rechaza")
s2 = libres[1]
check("Primera reserva de 3", reservar(s2, 3, "d@ejemplo.com").status_code in (200, 201))
r = reservar(s2, 3, "e@ejemplo.com")
check("Segunda de 3 rechazada", r.status_code >= 400, r.text[:120])
check("La de 1 que sí cabe, pasa", reservar(s2, 1, "f@ejemplo.com").status_code in (200, 201))

print("\n3. Acompañantes no cuentan para el 4")
s3 = libres[2]
check("2 jugadores + 2 acompañantes", reservar(s3, 2, "g@ejemplo.com", acomp=2).status_code in (200, 201))
check("Otros 2 jugadores con 2 acompañantes más", reservar(s3, 2, "h@ejemplo.com", acomp=2).status_code in (200, 201))

print("\n4. Resumen ejecutivo: la cuenta de dirección ve solo eso")
def entrar(correo):
    r = c.post("/api/auth/login", json={"email": correo, "password": "Reserva2026*"})
    return r.json()
dir_ = entrar("direccion@lasparotas.mx")
check("Entra y aterriza en /resumen", dir_.get("home_route") == "/resumen", str(dir_.get("home_route")))
check("Solo tiene 2 permisos", sorted(dir_.get("permissions", [])) == ["finance:resumen", "screen:resumen"], str(dir_.get("permissions")))
H = {"Authorization": "Bearer " + dir_["access_token"]}
hoy_ = date.today().isoformat()
r = c.get(f"/api/treasury/executive-summary?start={hoy_}&end={hoy_}", headers=H)
check("El resumen contesta 200", r.status_code == 200, r.text[:100])
j = r.json()
check("Trae los 6 conceptos", [x["clave"] for x in j["conceptos"]] == ["CUPONERAS","RESERVAS_EN_LINEA","TRANSFERENCIAS","PRO_SHOP","ALIMENTOS_BEBIDAS","OTROS"])
check("Un renglón por día", len(j["dias"]) == 1)
for ruta in ("/api/treasury/sales-breakdown", "/api/booking/reservations", "/api/treasury/cash/current", "/api/users", "/api/cuponeras"):
    rr = c.get(ruta, headers=H)
    check(f"{ruta} le queda cerrado", rr.status_code in (401, 403), str(rr.status_code))
me = c.get("/api/auth/me", headers=H)
check("/auth/me le funciona (el front lo usa)", me.status_code == 200, str(me.status_code))

# Un pago en línea de verdad: 1 reserva de 2 jugadores
ap = reservar(libres[3], 2, "pago@ejemplo.com").json()
EVENTO.update({"type": "checkout.session.completed", "data": {"object": {
    "object": "checkout.session", "id": "cs_1", "metadata": {"folio": ap["folio"]},
    "payment_status": "paid", "amount_total": int(float(ap["total"]) * 100),
    "payment_intent": "pi_1", "currency": "mxn"}}})
rw = c.post("/api/public/stripe/webhook", content=b"{}", headers={"stripe-signature": "x"})
check("Webhook confirma", rw.json().get("estado") == "confirmada", rw.text[:80])
j = c.get(f"/api/treasury/executive-summary?start={hoy_}&end={hoy_}", headers=H).json()
fila = j["dias"][0]["por_concepto"]["RESERVAS_EN_LINEA"]
check("Reservas en línea suma el cobro sin decimales", fila["monto"] == round(float(ap["total"])), f"{fila} vs {ap['total']}")
check("Cuenta 1 partida", fila["partidas"] == 1 and j["totales"]["partidas"] == 1)
check("El total del día cuadra", j["dias"][0]["total"] == fila["monto"])

op = entrar("operaciones@lasparotas.mx")
rr = c.get(f"/api/treasury/executive-summary?start={hoy_}&end={hoy_}", headers={"Authorization": "Bearer " + op["access_token"]})
check("Operaciones también lo ve", rr.status_code == 200)
rec = entrar("recepcion@lasparotas.mx")
rr = c.get(f"/api/treasury/executive-summary?start={hoy_}&end={hoy_}", headers={"Authorization": "Bearer " + rec["access_token"]})
check("Recepción no lo ve", rr.status_code == 403, str(rr.status_code))

from app.modules.treasury.resumen import es_comida
check("Cerveza y agua son alimentos y bebidas", es_comida("Accesorios", "CERVEZA LATA") and es_comida("Accesorios", "AGUA MINERAL"))
check("Guante y polo son Pro Shop", not es_comida("Accesorios", "GUANTE CABALLERO") and not es_comida("Accesorios", "POLO CABALLERO LIGHT BLUE"))

print("\nFALLOS:", FALLOS if FALLOS else "ninguno")
sys.exit(1 if FALLOS else 0)
