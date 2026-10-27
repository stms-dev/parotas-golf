"""Prueba de los tokens de sesión (JWT).

    python prueba_tokens.py

Comprueba que la librería de tokens hace lo que el sistema necesita: los de
antes siguen valiendo (nadie pierde su sesión al actualizar), y los vencidos,
alterados, sin firma o firmados con otra llave se rechazan.
"""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time

os.environ["ENVIRONMENT"] = "development"
if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

from fastapi.testclient import TestClient            # noqa: E402
from app.core.config import settings                 # noqa: E402
from app.core.security import create_access_token, create_refresh_token, decode_token  # noqa: E402
from app.main import app                             # noqa: E402

FALLOS = []


def check(label, condition, extra=""):
    print(f"  {'✓' if condition else '✗'} {label}" + (f" · {extra}" if extra else ""))
    if not condition:
        FALLOS.append(label)


def b64(datos: bytes) -> str:
    return base64.urlsafe_b64encode(datos).rstrip(b"=").decode()


def firmar_a_mano(carga: dict, llave: str = None, alg: str = "HS256") -> str:
    """Un token armado sin librería, tal como lo habría hecho cualquier otra."""
    encabezado = b64(json.dumps({"alg": alg, "typ": "JWT"}, separators=(",", ":")).encode())
    cuerpo = b64(json.dumps(carga, separators=(",", ":")).encode())
    base = f"{encabezado}.{cuerpo}"
    if alg == "none":
        return base + "."
    firma = hmac.new((llave or settings.SECRET_KEY).encode(), base.encode(), hashlib.sha256).digest()
    return f"{base}.{b64(firma)}"


c = TestClient(app)
ahora = int(time.time())

print("\n1. Ida y vuelta")
t = create_access_token(7, {"role": "RECEPCION", "hotel_id": None})
p = decode_token(t)
check("Un token recién emitido se lee", p is not None)
check("Trae el sujeto como texto", p["sub"] == "7" and isinstance(p["sub"], str))
check("Trae el tipo, el rol y el vencimiento", p["type"] == "access" and p["role"] == "RECEPCION" and p["exp"] > ahora)
vence_en_h = (p["exp"] - ahora) / 3600
check("Dura la jornada configurada", abs(vence_en_h - settings.ACCESS_TOKEN_EXPIRE_MINUTES / 60) < 0.01, f"{vence_en_h:.1f} h")
check("El de renovación se distingue", decode_token(create_refresh_token(7))["type"] == "refresh")

print("\n2. Los tokens de antes siguen valiendo (nadie pierde su sesión al actualizar)")
viejo = firmar_a_mano({"sub": "1", "exp": ahora + 600, "type": "access", "role": "SUPER_ADMIN", "hotel_id": None})
check("Un token armado a mano con la misma llave se acepta", decode_token(viejo) is not None)
r = c.get("/api/auth/me", headers={"Authorization": f"Bearer {viejo}"})
check("Y abre la sesión en el sistema", r.status_code == 200 and r.json()["user"]["role"] == "SUPER_ADMIN", f"HTTP {r.status_code}")

print("\n3. Lo que se rechaza")
casos = {
    "vencido": firmar_a_mano({"sub": "1", "exp": ahora - 10, "type": "access"}),
    "sin vencimiento": firmar_a_mano({"sub": "1", "type": "access"}),
    "sin sujeto": firmar_a_mano({"exp": ahora + 600, "type": "access"}),
    "firmado con otra llave": firmar_a_mano({"sub": "1", "exp": ahora + 600, "type": "access"}, llave="otra-llave-distinta-" * 3),
    "sin firma (alg none)": firmar_a_mano({"sub": "1", "exp": ahora + 600, "type": "access"}, alg="none"),
    "firma alterada": viejo[:-4] + ("AAAA" if not viejo.endswith("AAAA") else "BBBB"),
    "contenido alterado": viejo.split(".")[0] + "." + b64(json.dumps({"sub": "1", "exp": ahora + 600, "type": "access", "role": "SUPER_ADMIN", "x": 1}).encode()) + "." + viejo.split(".")[2],
    "basura": "esto-no-es-un-token",
    "vacío": "",
}
for nombre, tok in casos.items():
    check(f"Se rechaza: {nombre}", decode_token(tok) is None)
    r = c.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    check(f"…y la API contesta 401 ({nombre})", r.status_code == 401, f"HTTP {r.status_code}")

print("\n4. Casos raros que antes podían romper el servidor")
raro = firmar_a_mano({"sub": "no-es-un-numero", "exp": ahora + 600, "type": "access"})
r = c.get("/api/auth/me", headers={"Authorization": f"Bearer {raro}"})
check("Un sujeto que no es número da 401, no error del servidor", r.status_code == 401, f"HTTP {r.status_code}")
r = c.get("/api/auth/me", headers={"Authorization": f"Bearer {create_refresh_token(1)}"})
check("El token de renovación no sirve como token de acceso", r.status_code == 401, f"HTTP {r.status_code}")

print("\n5. El inicio de sesión real")
r = c.post("/api/auth/login", json={"email": "admin@lasparotas.mx", "password": "Reserva2026*"})
acceso = r.json()["access_token"]
check("El login entrega un token que la API acepta",
      c.get("/api/auth/me", headers={"Authorization": f"Bearer {acceso}"}).status_code == 200)
check("El token es de tres partes y no lleva la contraseña", acceso.count(".") == 2 and "Reserva2026" not in acceso)

print("\n6. El canal en tiempo real usa el mismo token")
with c.websocket_connect(f"/api/ws?token={acceso}") as ws:
    ws.send_text("ping")
    # Primero llega el aviso de conexión establecida; luego, la respuesta al ping.
    bienvenida = ws.receive_text()
    check("Con token bueno entra", "conexion.establecida" in bienvenida)
    check("Y contesta al ping", '"pong"' in ws.receive_text())
for nombre in ("vencido", "firma alterada", "basura"):
    try:
        with c.websocket_connect(f"/api/ws?token={casos[nombre]}") as ws:
            ws.receive_text()
        entro = True
    except Exception:
        entro = False
    check(f"Con token {nombre} lo cierra", not entro)

print()
if FALLOS:
    print("=" * 60)
    print(f"  FALLARON {len(FALLOS)}: " + "; ".join(FALLOS))
    print("=" * 60)
    sys.exit(1)
print("=" * 60)
print("  LOS TOKENS DE SESIÓN ESTÁN BIEN AMARRADOS")
print("=" * 60)
