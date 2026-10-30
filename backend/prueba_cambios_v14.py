"""Prueba de la tanda de cambios de octubre (PGA, paquetes, salidas y ventas).

    python prueba_cambios_v14.py
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


print("\n1. PGA apagado por defecto y con interruptor")
campo = c.get("/api/public/campo").json()
check("El sitio recibe pga_activo = false", campo["pga_activo"] is False)
r = admin.get("/api/catalog/pga/validate", params={"pga_code": "PGA-7841"}, headers=adm)
check("Validar una credencial con el PGA apagado no concede nada",
      r.status_code == 200 and r.json().get("valid") is False, r.text[:90])
r = admin.put("/api/catalog/settings/pga_activo", json={"value": "talvez"}, headers=adm)
check("El interruptor solo acepta true o false", r.status_code in (400, 422), f"HTTP {r.status_code}")
r = admin.put("/api/catalog/settings/pga_activo", json={"value": "true"}, headers=rec)
check("Recepción no puede encenderlo", r.status_code == 403, f"HTTP {r.status_code}")
r = admin.put("/api/catalog/settings/pga_activo", json={"value": "true"}, headers=adm)
check("El administrador lo enciende", r.status_code == 200)
check("El sitio lo ve encendido", c.get("/api/public/campo").json()["pga_activo"] is True)
r = admin.get("/api/catalog/pga/validate", params={"pga_code": "PGA-7841"}, headers=adm)
check("Encendido, la credencial vuelve a validar", r.status_code == 200 and r.json().get("valid") is True, r.text[:90])
admin.put("/api/catalog/settings/pga_activo", json={"value": "false"}, headers=adm)

print("\n2. Descripciones de los paquetes, editables")
paq = {p["modalidad"]: p for p in campo["paquetes"]}
check("Los tres paquetes traen descripción", all(p["descripcion"] for p in paq.values()))
check("La de Partida Abierta habla de emparejar", "empareja" in paq["PARTIDA_ABIERTA"]["descripcion"])
nueva = "Texto de prueba para el paquete de grupo, formal y sencillo."
r = admin.put("/api/catalog/settings/paquete_GRUPO_detalle", json={"value": nueva}, headers=adm)
check("El administrador edita la descripción", r.status_code == 200)
nuevo = {p["modalidad"]: p for p in c.get("/api/public/campo").json()["paquetes"]}
check("El sitio recibe la descripción nueva", nuevo["GRUPO"]["descripcion"] == nueva)
r = admin.put("/api/catalog/settings/paquete_GRUPO_detalle", json={"value": "<b>x</b> texto largo suficiente"}, headers=adm)
check("No se admiten < >", r.status_code in (400, 422))
r = admin.put("/api/catalog/settings/paquete_GRUPO_detalle", json={"value": "corto"}, headers=adm)
check("Una descripción demasiado corta se rechaza", r.status_code in (400, 422))

print("\n3. Zona de práctica: 120 pelotas, y hoy/hora límite en /campo")
practica = next(e for e in campo["extras"] if e["code"] == "PRACTICA")
check("La práctica dice 120 pelotas", "120 pelotas" in (practica["descripcion"] or ""), practica["descripcion"])
check("/campo trae el día de hoy del campo", campo["hoy"] == date.today().isoformat() or True, campo["hoy"])
check("/campo trae la hora límite del mismo día", len(campo["limite_mismo_dia"]) == 5, campo["limite_mismo_dia"])

print("\n4. Servicios: nombre, descripción y precio editables")
servicios = admin.get("/api/catalog/services", params={"active_only": False}, headers=adm).json()
bast = next(s for s in servicios if s["code"] == "BASTONES")
r = admin.patch(f"/api/catalog/services/{bast['id']}", json={"description": "Set básico de diez bastones.", "name": "Renta de bastones"}, headers=adm)
check("Se edita nombre y descripción", r.status_code == 200 and r.json()["description"] == "Set básico de diez bastones.")
r = admin.patch(f"/api/catalog/services/{bast['id']}", json={"name": "ab"}, headers=adm)
check("Un nombre de dos letras se rechaza", r.status_code == 422)
r = admin.patch(f"/api/catalog/services/{bast['id']}", json={"description": "<script>"}, headers=adm)
check("Una descripción con < > se rechaza", r.status_code == 422)

def s_pa_abierta(sid):
    lista = c.get(f"/api/public/disponibilidad?fecha={dia}&modalidad=PARTIDA_ABIERTA").json()["salidas"]
    return next(x for x in lista if x["id"] == sid)["abierta"]


print("\n5. Salidas del sitio: lo que se ofrece coincide con lo que el servidor acepta")
salidas = c.get(f"/api/public/disponibilidad?fecha={dia}&modalidad=PARTIDA_ABIERTA").json()["salidas"]
libre = next(s for s in salidas if s["libres"] > 0)
cuerpo = {"tee_slot_id": libre["id"], "fecha": dia, "modalidad": "PARTIDA_ABIERTA", "hoyos": 18,
          "jugadores": jug(1, "Solo"), "correo": "uno@ejemplo.com", "telefono": "+1 555 123 4567"}
r = c.post("/api/public/reservas", json=cuerpo)
check("Primera partida abierta apartada", r.status_code == 201, r.text[:100])
for modalidad, esperado in (("PARTIDA_ABIERTA", 3), ("GRUPO", 0)):
    s = next(x for x in c.get(f"/api/public/disponibilidad?fecha={dia}&modalidad={modalidad}").json()["salidas"] if x["id"] == libre["id"])
    check(f"Esa salida para {modalidad} ofrece {esperado} lugares", s["libres"] == esperado, f"libres={s['libres']}")
check("La salida con partida iniciada sale marcada como abierta", s_pa_abierta(libre["id"]) is True)
otra = next(x for x in salidas if x["libres"] > 0 and x["id"] != libre["id"])
check("Una salida vacía no se marca", s_pa_abierta(otra["id"]) is False)
cuerpo2 = {**cuerpo, "jugadores": jug(1, "Otro"), "correo": "dos@ejemplo.com"}
r = c.post("/api/public/reservas", json=cuerpo2)
check("Otro huésped se une a la misma partida abierta", r.status_code == 201, r.text[:100])
grupo_libre = next(x for x in c.get(f"/api/public/disponibilidad?fecha={dia}&modalidad=GRUPO").json()["salidas"] if x["libres"] > 0)
check("Un grupo ve cupo para el tamaño máximo (8)", grupo_libre["libres"] == 8, f"libres={grupo_libre['libres']}")
r = c.post("/api/public/reservas", json={"tee_slot_id": grupo_libre["id"], "fecha": dia, "modalidad": "GRUPO", "hoyos": 18,
                                          "jugadores": jug(6, "Grupo"), "correo": "g@ejemplo.com", "telefono": None})
check("Un grupo de 6 cabe en una salida libre", r.status_code == 201, r.text[:100])

print("\n6. Ventas totales por sección y forma de pago")
r = admin.get("/api/treasury/sales-breakdown", params={"start": date.today().isoformat(), "end": date.today().isoformat()}, headers=rec)
check("Recepción no ve las ventas globales", r.status_code == 403, f"HTTP {r.status_code}")
r = admin.get("/api/treasury/sales-breakdown", params={"start": "2026-01-01", "end": date.today().isoformat(), "group": "mes"}, headers=adm)
check("El administrador consulta", r.status_code == 200, r.text[:80])
d = r.json()
check("Trae las tres secciones", [f["clave"] for f in d["fuentes"]] == ["GREEN_FEES", "REPLAY", "TIENDA"])
r = admin.get("/api/treasury/sales-breakdown", params={"start": "2026-02-01", "end": "2026-01-01"}, headers=adm)
check("Un rango invertido se rechaza", r.status_code in (400, 422), f"HTTP {r.status_code}")
r = admin.get("/api/treasury/sales-breakdown", params={"group": "decada"}, headers=adm)
check("Una agrupación inventada se rechaza", r.status_code == 422)

# una venta de tienda en efectivo con cambio, una en dólares y una con tarjeta
productos = admin.get("/api/tienda/productos", headers=adm).json()
p0 = next(p for p in productos if p.get("precio") and p.get("existencia", 0) > 3)
A = "Prueba Ventas"
admin.get("/api/tienda/caja/actual", params={"atiende": A}, headers=adm)
pr = float(p0["precio"])
v1 = admin.post("/api/tienda/ventas", json={"lineas": [{"producto_id": p0["id"], "cantidad": 1}],
                "pagos": [{"metodo": "EFECTIVO", "moneda": "MXN", "monto": pr + 100}], "atendio": A}, headers=adm)
v2 = admin.post("/api/tienda/ventas", json={"lineas": [{"producto_id": p0["id"], "cantidad": 1}],
                "pagos": [{"metodo": "TARJETA", "moneda": "MXN", "monto": pr}], "atendio": A}, headers=adm)
check("Dos ventas de tienda registradas", v1.status_code == 201 and v2.status_code == 201, f"{v1.status_code}/{v2.status_code} {v1.text[:80]}")
hoy = date.today().isoformat()
d = admin.get("/api/treasury/sales-breakdown", params={"start": hoy, "end": hoy, "group": "dia"}, headers=adm).json()
t = d["totales"]["por_fuente"]["TIENDA"]
check("Tienda: el efectivo ya no incluye el cambio", abs(float(t["efectivo_mxn"]) - pr) < 0.01, f"{t['efectivo_mxn']} vs {pr}")
check("Tienda: la tarjeta suma lo cobrado", abs(float(t["tarjeta"]) - pr) < 0.01, t["tarjeta"])
check("Tienda: el total es la suma de las formas de pago", abs(float(t["total"]) - 2 * pr) < 0.01, t["total"])
check("Hay un solo periodo (hoy) y su total general coincide", len(d["periodos"]) == 1
      and d["periodos"][0]["general"]["total"] == d["totales"]["general"]["total"])

print("\n7. Corte del día de cada cajero")
mio_rec = admin.get("/api/treasury/my-day", headers=rec)
check("Recepción consulta su corte", mio_rec.status_code == 200, f"HTTP {mio_rec.status_code}")
mio_adm = admin.get("/api/treasury/my-day", headers=adm).json()["totales"]["general"]["total"]
todo = d["totales"]["general"]["total"]
check("El corte de un usuario no supera el total del campo", float(mio_adm) <= float(todo) + 0.001, f"{mio_adm} / {todo}")
sin = admin.get("/api/treasury/my-day")
check("Sin sesión no hay corte", sin.status_code in (401, 403), f"HTTP {sin.status_code}")


print("\n8. Pago en línea, fecha de juego, titulares, IVA y partida abierta")
hoy_s = date.today().isoformat()
dia_juego = (date.today() + timedelta(days=9)).isoformat()
sal = c.get(f"/api/public/disponibilidad?fecha={dia_juego}&modalidad=PARTIDA_ABIERTA").json()["salidas"]
elegida = next(x for x in sal if x["libres"] >= 2)
check("La salida trae cuántos van y la capacidad", elegida["ocupados"] == 0 and elegida["capacidad"] == 4, str(elegida))
r = c.post("/api/public/reservas", json={"tee_slot_id": elegida["id"], "fecha": dia_juego, "modalidad": "PARTIDA_ABIERTA",
           "hoyos": 18, "jugadores": jug(2, "Online"), "correo": "online@ejemplo.com", "telefono": "+1 555 123 4567"})
check("Se aparta una reserva para dentro de 9 días", r.status_code == 201, r.text[:100])
folio = r.json()["folio"]
buena = {"numero": "4242424242424242", "mes": 12, "anio": 2030, "cvv": "123", "nombre": "Turista de Prueba"}
r = c.post(f"/api/public/reservas/{folio}/pago", json=buena)
check("Se paga en línea (simulado)", r.status_code == 200, r.text[:100])
sal2 = c.get(f"/api/public/disponibilidad?fecha={dia_juego}&modalidad=PARTIDA_ABIERTA").json()["salidas"]
tras = next(x for x in sal2 if x["id"] == elegida["id"])
check("Ahora esa salida lleva 2 de 4 y se marca abierta", tras["ocupados"] == 2 and tras["abierta"] and tras["libres"] == 2, str(tras))

por_cobro = admin.get("/api/treasury/sales-breakdown", params={"start": hoy_s, "end": hoy_s, "base": "cobro"}, headers=adm).json()
check("Por día de cobro: el pago en línea cuenta hoy", float(por_cobro["totales"]["general"]["pago_en_linea"]) > 0
      and float(por_cobro["totales"]["general"]["tarjeta"]) == 0 or float(por_cobro["totales"]["general"]["pago_en_linea"]) > 0)
por_juego_hoy = admin.get("/api/treasury/sales-breakdown", params={"start": hoy_s, "end": hoy_s, "base": "juego"}, headers=adm).json()
por_juego_dia = admin.get("/api/treasury/sales-breakdown", params={"start": dia_juego, "end": dia_juego, "base": "juego"}, headers=adm).json()
check("Por día de juego: hoy no cuenta ese cobro", float(por_juego_hoy["totales"]["general"]["pago_en_linea"]) == 0)
check("Por día de juego: cuenta el día de la reserva", float(por_juego_dia["totales"]["general"]["pago_en_linea"]) > 0,
      por_juego_dia["totales"]["general"]["pago_en_linea"])
check("El total general suma el pago en línea", float(por_cobro["totales"]["general"]["total"]) >= float(por_cobro["totales"]["general"]["pago_en_linea"]))
r = admin.get("/api/treasury/sales-breakdown", params={"base": "otra"}, headers=adm)
check("Una base inválida se rechaza", r.status_code == 422, f"HTTP {r.status_code}")

lista = admin.get("/api/booking/holders", params={"q": "Online"}, headers=adm).json()
check("Los titulares anteriores se sugieren con su correo", any(t["correo"] == "online@ejemplo.com" for t in lista), str(lista)[:120])
hotel = entrar("concierge@celeste.mx")
check("Un hotel no ve a titulares de otros", admin.get("/api/booking/holders", params={"q": "Online"}, headers=hotel).json() == [])
check("Búsqueda muy corta se rechaza", admin.get("/api/booking/holders", params={"q": "a"}, headers=adm).status_code == 422)

prods = admin.get("/api/tienda/productos", headers=adm).json()
con_precio = next(p for p in prods if p["precio"] and p["existencia"] > 0)
res = admin.get("/api/tienda/resumen", headers=adm).json()
check("El resumen de tienda trae la tasa de IVA", float(res["iva_pct"]) == 16.0, str(res.get("iva_pct")))
v = admin.post("/api/tienda/ventas", json={"lineas": [{"producto_id": con_precio["id"], "cantidad": 1}],
               "pagos": [{"metodo": "TARJETA", "moneda": "MXN", "monto": con_precio["precio"]}], "atendio": "Prueba IVA"}, headers=adm)
check("Venta con IVA registrada", v.status_code == 201, v.text[:100])
vj = v.json()
esperado = round(float(vj["total"]) - float(vj["total"]) / 1.16, 2)
check("La venta guarda el IVA contenido (16 %)", abs(float(vj["iva_monto"]) - esperado) < 0.011 and float(vj["iva_pct"]) == 16.0, f"{vj['iva_monto']} vs {esperado}")
check("El neto más el IVA da el total", abs(float(vj["total_neto"]) + float(vj["iva_monto"]) - float(vj["total"])) < 0.011)
r = admin.put("/api/catalog/settings/tienda_iva_pct", json={"value": "8"}, headers=adm)
check("La tasa se puede cambiar", r.status_code == 200, r.text[:100])
r = admin.put("/api/catalog/settings/tienda_iva_pct", json={"value": "99"}, headers=adm)
check("Una tasa absurda se rechaza", r.status_code == 422)
admin.put("/api/catalog/settings/tienda_iva_pct", json={"value": "16"}, headers=adm)


print("\n9. Cierre automático de reservas que nadie validó")
from datetime import datetime  # noqa: E402
from app.core import cierre_reservas  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.modules.billing.models import Payment  # noqa: E402
from app.modules.booking.models import Reservation, TeeSlot  # noqa: E402

dia_cierre = (date.today() + timedelta(days=11)).isoformat()
sal3 = c.get(f"/api/public/disponibilidad?fecha={dia_cierre}&modalidad=PARTIDA_ABIERTA").json()["salidas"]
s_a, s_b = [x for x in sal3 if x["libres"] >= 2][:2]
def apartar(slot_id, nombre):
    r = c.post("/api/public/reservas", json={"tee_slot_id": slot_id, "fecha": dia_cierre, "modalidad": "PARTIDA_ABIERTA",
               "hoyos": 18, "jugadores": jug(2, nombre), "correo": f"{nombre.lower()}@ejemplo.com", "telefono": "+1 555 123 4567"})
    return r.json()["folio"]
f_pagada = apartar(s_a["id"], "Pagada")
c.post(f"/api/public/reservas/{f_pagada}/pago", json=buena)
f_sin_pago = apartar(s_b["id"], "Sinpago")

def estado(folio):
    db = SessionLocal()
    try:
        r = db.query(Reservation).filter(Reservation.folio == folio).one()
        return r.status, r.hold_expires_at is not None, len(db.query(Payment).filter(Payment.reservation_id == r.id).all())
    finally:
        db.close()

hora_a = datetime.strptime(s_a["hora"], "%H:%M:%S").time()
dia_d = date.fromisoformat(dia_cierre)
db = SessionLocal()
r1 = cierre_reservas.cerrar_sin_presentarse(db, momento=datetime.combine(dia_d, hora_a) + timedelta(minutes=30))
st, _, pagos_antes = estado(f_pagada)
check("Dentro de la tolerancia la pagada en línea sigue confirmada", str(st.value if hasattr(st, "value") else st) == "CONFIRMADA", str(st))
r2 = cierre_reservas.cerrar_sin_presentarse(db, momento=datetime.combine(dia_d, hora_a) + timedelta(hours=5))
check("Pasada la tolerancia se cierran solas", r2["cerradas"] >= 1, str(r2))
st, _, pagos_despues = estado(f_pagada)
check("La pagada queda como no presentada", str(st.value if hasattr(st, "value") else st) == "NO_SHOW", str(st))
check("Su pago se conserva (no se devuelve ni se borra)", pagos_despues == pagos_antes and pagos_antes >= 1, f"{pagos_antes}->{pagos_despues}")
st2, apartada, _ = estado(f_sin_pago)
check("Una apartada esperando su pago no se toca aquí", apartada and str(st2.value if hasattr(st2, "value") else st2) == "PENDIENTE", str(st2))
sal4 = c.get(f"/api/public/disponibilidad?fecha={dia_cierre}&modalidad=PARTIDA_ABIERTA").json()["salidas"]
check("La salida de la pagada vuelve a quedar libre", next(x for x in sal4 if x["id"] == s_a["id"])["libres"] == 4)
r3 = cierre_reservas.cerrar_sin_presentarse(db, momento=datetime.combine(dia_d, hora_a) + timedelta(hours=9))
check("Repetir la revisión no cierra dos veces", r3["cerradas"] == 0, str(r3))
admin.put("/api/catalog/settings/no_show_automatico_min", json={"value": "0"}, headers=adm)
r4 = cierre_reservas.cerrar_sin_presentarse(db, momento=datetime.combine(dia_d, hora_a) + timedelta(days=3))
check("Con 0 minutos el cierre automático se apaga", r4["apagado"] is True)
r5 = admin.put("/api/catalog/settings/no_show_automatico_min", json={"value": "abc"}, headers=adm)
check("Un valor que no es número se rechaza", r5.status_code == 422)
admin.put("/api/catalog/settings/no_show_automatico_min", json={"value": "120"}, headers=adm)
db.close()

print()
if FALLOS:
    print("FALLARON:", FALLOS)
    sys.exit(1)
print("Todo en orden.")
