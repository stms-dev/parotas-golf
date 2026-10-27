"""Prueba de la vida de la sesión: 15 minutos sin uso, renovación y cierre.

    python prueba_sesiones.py
"""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time

if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

from fastapi.testclient import TestClient            # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402
from app.core.config import settings                 # noqa: E402
from app.core.security import decode_token          # noqa: E402
from app.main import app                             # noqa: E402

FALLOS = []


def check(label, condition, extra=""):
    print(f"  {'✓' if condition else '✗'} {label}" + (f" · {extra}" if extra else ""))
    if not condition:
        FALLOS.append(label)


def b64(d: bytes) -> str:
    return base64.urlsafe_b64encode(d).rstrip(b"=").decode()


def firmar(carga: dict) -> str:
    cab = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    cuerpo = b64(json.dumps(carga, separators=(",", ":")).encode())
    sig = hmac.new(settings.SECRET_KEY.encode(), f"{cab}.{cuerpo}".encode(), hashlib.sha256).digest()
    return f"{cab}.{cuerpo}.{b64(sig)}"


c = TestClient(app)
CLAVE = "Reserva2026*"


_n = [0]


def entrar(email, clave=CLAVE):
    # Cada inicio de sesión sale de una "conexión" distinta: la prueba entra
    # decenas de veces en segundos y chocaría con el tope de 10 por minuto.
    _n[0] += 1
    return c.post("/api/auth/login", json={"email": email, "password": clave},
                  headers={"X-Forwarded-For": f"10.9.{_n[0] // 250}.{_n[0] % 250}"})


def cab(token):
    return {"Authorization": f"Bearer {token}"}


def yo(token):
    return c.get("/api/auth/me", headers=cab(token)).status_code


print("\n1. El token dura 15 minutos y no hay renovación de larga vida")
r = entrar("recepcion@lasparotas.mx")
tok = r.json()["access_token"]
p = decode_token(tok)
minutos = (p["exp"] - time.time()) / 60
check("Vence en 15 minutos", 14.5 <= minutos <= 15.1, f"{minutos:.1f} min")
check("El login ya no entrega token de 7 días", "refresh_token" not in r.json())
check("Trae la versión de sesión", p.get("tv") == 0, f"tv={p.get('tv')}")

print("\n2. Renovar mientras se trabaja")
t0 = decode_token(tok)["exp"]
time.sleep(1.1)
r = c.post("/api/auth/refresh", headers=cab(tok))
nuevo = r.json().get("access_token")
check("Con la sesión vigente se renueva", r.status_code == 200 and nuevo)
check("El token nuevo vence más tarde", decode_token(nuevo)["exp"] > t0)
check("El token nuevo funciona", yo(nuevo) == 200)
vencido = firmar({"sub": "3", "exp": int(time.time()) - 5, "type": "access", "tv": 0})
check("Con la sesión vencida NO se puede renovar", c.post("/api/auth/refresh", headers=cab(vencido)).status_code == 401)
check("Sin token tampoco", c.post("/api/auth/refresh").status_code == 401)

print("\n3. Los tokens de antes de esta versión (sin contador) siguen valiendo")
sin_tv = firmar({"sub": "3", "exp": int(time.time()) + 600, "type": "access", "role": "RECEPCION", "hotel_id": None})
check("Se aceptan", yo(sin_tv) == 200)

print("\n4. Cambiar la contraseña cierra las sesiones abiertas")
admin = entrar("admin@lasparotas.mx").json()["access_token"]
rec_a = entrar("recepcion@lasparotas.mx").json()["access_token"]
rec_b = entrar("recepcion@lasparotas.mx").json()["access_token"]
check("Antes, las dos sesiones sirven", yo(rec_a) == 200 and yo(rec_b) == 200)
uid = c.get("/api/users", headers=cab(admin)).json()
rec_id = next(u["id"] for u in uid if u["email"] == "recepcion@lasparotas.mx")
r = c.patch(f"/api/users/{rec_id}", json={"password": "ClaveNueva2026*"}, headers=cab(admin))
check("La Administración cambia la contraseña", r.status_code == 200, f"HTTP {r.status_code}")
check("Las sesiones viejas dejan de servir", yo(rec_a) == 401 and yo(rec_b) == 401)
check("Y el token sin contador tampoco", yo(sin_tv) == 401)
check("La contraseña vieja ya no entra", entrar("recepcion@lasparotas.mx").status_code == 401)
r = entrar("recepcion@lasparotas.mx", "ClaveNueva2026*")
check("La nueva sí", r.status_code == 200)
rec = r.json()["access_token"]

print("\n5. Cerrar todas las sesiones")
otra = entrar("recepcion@lasparotas.mx", "ClaveNueva2026*").json()["access_token"]
r = c.post("/api/auth/logout-all", headers=cab(rec))
check("Quien lo pide cierra todas las suyas", r.status_code == 204, f"HTTP {r.status_code}")
check("Se cierran en todos sus equipos", yo(rec) == 401 and yo(otra) == 401)
rec = entrar("recepcion@lasparotas.mx", "ClaveNueva2026*").json()["access_token"]
check("Puede volver a entrar", yo(rec) == 200)
check("Las demás cuentas no se tocan", yo(admin) == 200)

print("\n6. La Administración cierra las sesiones de otra cuenta")
r = c.post(f"/api/users/{rec_id}/revoke-sessions", headers=cab(rec))
check("Recepción no puede hacerlo", r.status_code == 403, f"HTTP {r.status_code}")
check("…y su sesión sigue", yo(rec) == 200)
r = c.post(f"/api/users/{rec_id}/revoke-sessions", headers=cab(admin))
check("La Administración sí", r.status_code == 204, f"HTTP {r.status_code}")
check("La sesión de esa cuenta se cae", yo(rec) == 401)
r = c.post("/api/users/99999/revoke-sessions", headers=cab(admin))
check("Una cuenta que no existe da 404", r.status_code == 404, f"HTTP {r.status_code}")

print("\n7. Dar de baja o cambiar de rol también cierra la sesión")
rec = entrar("recepcion@lasparotas.mx", "ClaveNueva2026*").json()["access_token"]
c.patch(f"/api/users/{rec_id}", json={"is_active": False}, headers=cab(admin))
check("De baja: la sesión abierta se cae", yo(rec) == 401)
c.patch(f"/api/users/{rec_id}", json={"is_active": True}, headers=cab(admin))
check("Reactivada: la sesión vieja NO revive", yo(rec) == 401)
rec = entrar("recepcion@lasparotas.mx", "ClaveNueva2026*").json()["access_token"]
c.patch(f"/api/users/{rec_id}", json={"role": "ADMIN_OPERACIONES"}, headers=cab(admin))
check("Cambio de rol: la sesión vieja se cae", yo(rec) == 401)
c.patch(f"/api/users/{rec_id}", json={"role": "RECEPCION"}, headers=cab(admin))

print("\n8. El canal en tiempo real respeta el vencimiento")
corto = firmar({"sub": "1", "exp": int(time.time()) + 3, "type": "access", "tv": 0})
cerro = False
inicio = time.time()
try:
    with c.websocket_connect(f"/api/ws?token={corto}") as ws:
        ws.receive_text()                      # conexión establecida
        ws.receive_text()                      # se queda esperando: debe cerrarse solo
except WebSocketDisconnect as e:
    cerro = e.code == 4001
check("Un canal con token por vencer se cierra solo (código 4001)", cerro, f"a los {time.time() - inicio:.1f} s")

corto = firmar({"sub": "1", "exp": int(time.time()) + 3, "type": "access", "tv": 0})
larga = entrar("admin@lasparotas.mx").json()["access_token"]
with c.websocket_connect(f"/api/ws?token={corto}") as ws:
    ws.receive_text()
    ws.send_text("token:" + larga)             # el panel avisa que renovó la sesión
    time.sleep(4)                              # pasa la hora del token viejo
    ws.send_text("ping")
    check("Renovado desde el panel, el canal sigue vivo", '"pong"' in ws.receive_text())

otro = entrar("operaciones@lasparotas.mx").json()["access_token"]
corto = firmar({"sub": "1", "exp": int(time.time()) + 3, "type": "access", "tv": 0})
cerro = False
try:
    with c.websocket_connect(f"/api/ws?token={corto}") as ws:
        ws.receive_text()
        ws.send_text("token:" + otro)          # un token de OTRA persona no sirve para renovar
        ws.receive_text()
except WebSocketDisconnect as e:
    cerro = e.code == 4001
check("No se renueva con el token de otra persona", cerro)

cerrada = entrar("admin@lasparotas.mx").json()["access_token"]
c.post("/api/auth/logout-all", headers=cab(cerrada))
cerro = False
try:
    with c.websocket_connect(f"/api/ws?token={cerrada}") as ws:
        ws.receive_text()
except WebSocketDisconnect as e:
    cerro = e.code == 4001
check("Con la sesión cerrada ni siquiera abre el canal", cerro)

# Deja la base como la encontró: otras pruebas entran con la contraseña de siempre.
from app.core.database import SessionLocal           # noqa: E402
from app.core.security import hash_password          # noqa: E402
from app.modules.identity.models import User         # noqa: E402
with SessionLocal() as s:
    for u in s.query(User).filter(User.email == "recepcion@lasparotas.mx"):
        u.hashed_password = hash_password(CLAVE)
        u.role, u.is_active = "RECEPCION", True
    s.commit()

print()
if FALLOS:
    print("=" * 60)
    print(f"  FALLARON {len(FALLOS)}: " + "; ".join(FALLOS))
    print("=" * 60)
    sys.exit(1)
print("=" * 60)
print("  LA VIDA DE LA SESIÓN ESTÁ BIEN AMARRADA")
print("=" * 60)
