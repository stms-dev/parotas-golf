"""Prueba del reenvío de pases y de la cuenta interna del sitio.

    python prueba_reenvio_y_cuenta_interna.py

Reenvío: el correo de destino se valida, cada reenvío queda en la bitácora y hay
un tope por reserva y por usuario. Cuenta interna: sitio@ tiene un rol sin
permisos, no entra, nadie la edita desde el panel y se corrige sola si alguien
la deja mal.
"""
import os
import subprocess
import sys
from datetime import date, timedelta

os.environ["PAGOS_SIMULADOS"] = "true"
if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")


def alembic(*args):
    subprocess.run([sys.executable, "-m", "alembic", *args], check=True, capture_output=True)


alembic("upgrade", "head")
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

from fastapi.testclient import TestClient            # noqa: E402
from app.core.config import settings                 # noqa: E402
settings.PAGOS_SIMULADOS = True
settings.PUBLICO_INTENTOS_POR_HORA = 200
from app.main import app                             # noqa: E402
from app.core.database import SessionLocal           # noqa: E402
from app.core.permissions import permissions_for     # noqa: E402
from app.modules.audit.models import AuditLog        # noqa: E402
from app.modules.identity.models import User         # noqa: E402
from app.modules.pagos.service import CUENTA_DEL_SITIO  # noqa: E402
from app.modules.mailing import service as mailing   # noqa: E402
from app.shared.enums import AuditAction, UserRole   # noqa: E402
from _cliente_publico import ClienteDelSitio         # noqa: E402

FALLOS = []


def check(label, condition, extra=""):
    print(f"  {'✓' if condition else '✗'} {label}" + (f" · {extra}" if extra else ""))
    if not condition:
        FALLOS.append(label)


c = ClienteDelSitio(app)
dia = (date.today() + timedelta(days=3)).isoformat()


def sesion(email):
    r = c.post("/api/auth/login", json={"email": email, "password": "Reserva2026*"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def reserva_pagada(correo):
    """Una reserva hecha en el sitio y pagada, ya confirmada en el sistema."""
    salida = next(s for s in c.get(f"/api/public/disponibilidad?fecha={dia}").json()["salidas"]
                  if s["libres"] >= 2)
    ap = c.post("/api/public/reservas", json={
        "tee_slot_id": salida["id"], "fecha": dia, "modalidad": "PARTIDA_ABIERTA", "hoyos": 18,
        "jugadores": [{"nombre": f"Jugador {i} de Prueba", "edad": 35} for i in range(2)],
        "correo": correo, "telefono": "+52 55 1234 5678"}).json()
    r = c.post(f"/api/public/reservas/{ap['folio']}/pago", json={
        "numero": "4242 4242 4242 4242", "mes": 12, "anio": 2030, "cvv": "123", "nombre": "Turista de Prueba"})
    assert r.status_code == 200 and r.json()["aprobado"], r.text
    h = sesion("operaciones@lasparotas.mx")
    fila = next(x for x in c.get(f"/api/booking/reservations?slot_date={dia}", headers=h).json()
                if x["folio"] == ap["folio"])
    return fila["id"]


recepcion = sesion("recepcion@lasparotas.mx")
admin = sesion("admin@lasparotas.mx")
rid = reserva_pagada("titular@ejemplo.com")

print("\n1. El correo de destino se valida")
url = f"/api/correos/reserva/{rid}/pase"
for malo in ("no-es-un-correo", "a@ejemplo.com,b@ejemplo.com", "a@ejemplo.com\nBcc: x@y.com", "@sinusuario.com"):
    r = c.post(url, params={"destino": malo}, headers=recepcion)
    check(f"Se rechaza {malo!r}".replace("\n", "\\n"), r.status_code in (400, 422), f"HTTP {r.status_code}")
r = c.post(url, params={"destino": " OtroHuesped@Ejemplo.com "}, headers=recepcion)
check("Un correo bueno pasa (y se limpia)", r.status_code == 200 and r.json()["to_email"].lower() == "otrohuesped@ejemplo.com",
      r.json().get("to_email", r.text[:80]))
r = c.post(url, headers=recepcion)
check("Sin destino va al titular", r.status_code == 200 and r.json()["to_email"] == "titular@ejemplo.com", r.json().get("to_email"))

print("\n2. Cada reenvío deja rastro")
with SessionLocal() as s:
    filas = s.query(AuditLog).filter(AuditLog.module == "mailing", AuditLog.action == AuditAction.REENVIAR,
                                      AuditLog.entity_id == rid).all()
    textos = [f.description for f in filas]
check("Hay una entrada por reenvío exitoso", len(filas) == 2, f"{len(filas)} entradas")
check("Se anota el correo y que no era el del titular",
      any("otrohuesped@ejemplo.com" in t.lower() and "distinto" in t for t in textos), "; ".join(textos)[:110])
check("El reenvío al titular no se marca como distinto",
      any("titular@ejemplo.com" in t and "distinto" not in t for t in textos))
check("Se sabe quién lo hizo", all(f.user_id for f in filas))

print("\n3. Tope por reserva")
for _ in range(3):
    c.post(url, headers=recepcion)     # llegan a 5
r = c.post(url, headers=recepcion)
check("El sexto reenvío en una hora se frena", r.status_code in (400, 409, 422, 429), f"HTTP {r.status_code} · {r.json()['error']['message'][:60]}")
with SessionLocal() as s:
    n = s.query(AuditLog).filter(AuditLog.action == AuditAction.REENVIAR, AuditLog.entity_id == rid).count()
check("Lo frenado no queda como enviado", n == mailing.MAX_REENVIOS_POR_RESERVA, f"{n} reenvíos anotados")

print("\n4. Tope por usuario")
mailing.MAX_REENVIOS_POR_RESERVA = 100
mailing.MAX_REENVIOS_POR_USUARIO = 8       # ya lleva 5 hechos con recepción en esta hora
for _ in range(3):
    c.post(url, headers=recepcion)
r = c.post(url, headers=recepcion)
check("Una cuenta que manda demasiados se frena aunque sea la misma reserva o no", r.status_code in (400, 409, 422, 429), f"HTTP {r.status_code}")
r = c.post(url, headers=admin)
check("Otro usuario no sufre el tope de recepción", r.status_code == 200, f"HTTP {r.status_code}")

print("\n5. La cuenta interna del sitio no tiene permisos")
with SessionLocal() as s:
    cuenta = s.query(User).filter(User.email == CUENTA_DEL_SITIO).first()
    rol, activa, cuenta_id = str(cuenta.role), cuenta.is_active, cuenta.id
check("Su rol es SISTEMA", rol == "SISTEMA", rol)
check("Sigue desactivada", activa is False)
check("El rol no tiene ni un permiso", permissions_for(UserRole.SISTEMA) == [])
r = c.post("/api/auth/login", json={"email": CUENTA_DEL_SITIO, "password": "cualquiera"})
check("No puede iniciar sesión", r.status_code in (401, 403), f"HTTP {r.status_code}")

print("\n6. Nadie la toca desde el panel")
r = c.patch(f"/api/users/{cuenta_id}", json={"is_active": True}, headers=admin)
check("El administrador no puede activarla", r.status_code in (400, 422), f"HTTP {r.status_code}")
r = c.patch(f"/api/users/{cuenta_id}", json={"role": "SUPER_ADMIN"}, headers=admin)
check("Ni cambiarle el rol", r.status_code in (400, 422), f"HTTP {r.status_code}")
r = c.post("/api/users", json={"email": "otra@ejemplo.com", "full_name": "Otra Cuenta", "password": "Clave12345*", "role": "SISTEMA"}, headers=admin)
check("No se pueden crear personas con rol SISTEMA", r.status_code in (400, 422), f"HTTP {r.status_code}")

print("\n7. Si alguien la deja mal, se corrige sola")
with SessionLocal() as s:
    cuenta = s.query(User).filter(User.id == cuenta_id).first()
    cuenta.role = UserRole.RECEPCION
    cuenta.is_active = True
    s.commit()
reserva_pagada("segunda@ejemplo.com")      # una reserva del sitio la revisa
with SessionLocal() as s:
    cuenta = s.query(User).filter(User.id == cuenta_id).first()
    check("Vuelve a SISTEMA y desactivada", str(cuenta.role) == "SISTEMA" and cuenta.is_active is False,
          f"{cuenta.role} · activa={cuenta.is_active}")

print("\n8. La migración arregla una base que ya tenía la cuenta como Recepción")
alembic("downgrade", "b3d5f7a9c1e2")      # justo antes de la migración de la cuenta del sitio
from sqlalchemy import text                          # noqa: E402
with SessionLocal() as s:
    # SQL directo: con la base "vieja" el modelo actual ya no coincide con las columnas.
    antes = s.execute(text("SELECT role FROM users WHERE id = :i"), {"i": cuenta_id}).scalar_one()
alembic("upgrade", "head")
with SessionLocal() as s:
    cuenta = s.query(User).filter(User.id == cuenta_id).first()
    despues, activa = str(cuenta.role), cuenta.is_active
check("Al bajar la migración vuelve a Recepción", antes == "RECEPCION", antes)
check("Al subirla queda SISTEMA y desactivada", despues == "SISTEMA" and activa is False, f"{despues} · activa={activa}")

print()
if FALLOS:
    print("=" * 60)
    print(f"  FALLARON {len(FALLOS)}: " + "; ".join(FALLOS))
    print("=" * 60)
    sys.exit(1)
print("=" * 60)
print("  EL REENVÍO Y LA CUENTA INTERNA ESTÁN BIEN AMARRADOS")
print("=" * 60)
