"""Prueba de la merma de la tienda: se solicita, la Administración autoriza.

    python prueba_merma.py
"""
import base64
import os
import subprocess
import sys

if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

import logging
logging.disable(logging.INFO)
from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

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
               headers={"X-Forwarded-For": f"10.7.0.{_n[0]}"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


adm = entrar("admin@lasparotas.mx")
rec = entrar("recepcion@lasparotas.mx")
hotel = entrar("concierge@celeste.mx")

# Un PNG mínimo válido (1x1) para la evidencia.
PNG = base64.b64encode(base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)).decode()

print("\n1. Preparar un producto con piezas en tienda y en bodega")
prods = c.get("/api/tienda/productos", headers=rec).json()
p = prods[0]
c.post(f"/api/tienda/productos/{p['id']}/movimientos",
       json={"tipo": "ENTRADA", "ubicacion": "TIENDA", "cantidad": 10, "atendio": "Prueba Merma"}, headers=adm)
c.post(f"/api/tienda/productos/{p['id']}/movimientos",
       json={"tipo": "ENTRADA", "ubicacion": "BODEGA", "cantidad": 5, "atendio": "Prueba Merma"}, headers=adm)


def prod():
    return next(x for x in c.get("/api/tienda/productos", headers=rec).json() if x["id"] == p["id"])


antes = prod()
base_t, base_b, base_total, base_merma = antes["existencia"], antes["existencia_bodega"], antes["existencia_total"], antes["merma_total"]
check("Hay piezas en tienda y bodega", base_t >= 10 and base_b >= 5, f"{base_t}/{base_b}")


def pedir(**extra):
    cuerpo = {"producto_id": p["id"], "cantidad": 2, "motivo_tipo": "DANADO",
              "justificacion": "Se cayó del exhibidor y se rompió", "atendio": "Ana Recepción"}
    cuerpo.update(extra)
    return c.post("/api/tienda/mermas", json=cuerpo, headers=rec)


print("\n2. Solicitar: no mueve inventario")
r = pedir()
check("Recepción solicita una merma", r.status_code == 201, r.text[:120])
m1 = r.json()
check("Queda pendiente con folio", m1["estado"] == "PENDIENTE" and m1["folio"].startswith("MR-"), m1["folio"])
check("El inventario no se mueve al solicitar", prod()["existencia"] == base_t)
r = c.post("/api/tienda/mermas", json={"producto_id": p["id"], "cantidad": 1, "motivo_tipo": "DANADO",
           "justificacion": "x", "atendio": "Ana"}, headers=rec)
check("La justificación es obligatoria", r.status_code == 422, f"HTTP {r.status_code}")
r = pedir(cantidad=9999)
check("No se puede pedir más de lo que hay", r.status_code == 409, r.text[:100])
r = pedir(ubicacion="BODEGA", cantidad=base_b + 1)
check("Ni más de lo que hay en el lugar elegido", r.status_code == 409, r.text[:100])
r = c.post("/api/tienda/mermas", json={"producto_id": p["id"], "cantidad": 1, "motivo_tipo": "DANADO",
           "justificacion": "Sin nombre de quien atiende", "atendio": ""}, headers=rec)
check("Hay que escribir quién atiende", r.status_code == 422, f"HTTP {r.status_code}")
r = c.post("/api/tienda/mermas", json={"producto_id": p["id"], "cantidad": 1, "motivo_tipo": "DANADO",
           "justificacion": "Prueba con hotel", "atendio": "Hotel"}, headers=hotel)
check("Un hotel no puede solicitar", r.status_code == 403, f"HTTP {r.status_code}")

print("\n3. Evidencia")
r = pedir(motivo_tipo="ROBO", justificacion="Faltó en el conteo del turno")
check("Robo o extravío exige evidencia", r.status_code == 422, r.text[:100])
r = pedir(motivo_tipo="ROBO", justificacion="Faltó en el conteo del turno", evidencia_base64=PNG, evidencia_nombre="foto.png")
check("Con una foto se acepta", r.status_code == 201 and r.json()["tiene_evidencia"] is True, r.text[:100])
m_robo = r.json()
r = pedir(evidencia_base64=base64.b64encode(b"esto es texto, no una foto").decode())
check("Un archivo que no es foto ni PDF se rechaza", r.status_code == 422, r.text[:100])
r = pedir(evidencia_base64="%%%no-es-base64%%%")
check("Un base64 dañado se rechaza", r.status_code == 422, r.text[:100])
grande = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * (3 * 1024 * 1024 + 10)).decode()
r = pedir(evidencia_base64=grande)
check("Más de 3 MB se rechaza", r.status_code == 422, r.text[:100])
r = c.get(f"/api/tienda/mermas/{m_robo['id']}/evidencia", headers=rec)
check("La evidencia se descarga con su tipo", r.status_code == 200 and r.headers["content-type"] == "image/png"
      and r.headers.get("x-content-type-options") == "nosniff", r.headers.get("content-type"))
r = c.get(f"/api/tienda/mermas/{m1['id']}/evidencia", headers=rec)
check("Sin evidencia responde 404", r.status_code == 404)

print("\n4. Autorizar: solo la Administración")
r = c.post(f"/api/tienda/mermas/{m1['id']}/autorizar", json={}, headers=rec)
check("Recepción no puede autorizar", r.status_code == 403, f"HTTP {r.status_code}")
ops = entrar("operaciones@lasparotas.mx")
r = c.post(f"/api/tienda/mermas/{m1['id']}/autorizar", json={}, headers=ops)
check("Operaciones tampoco puede autorizar", r.status_code == 403, f"HTTP {r.status_code}")
r = c.post(f"/api/tienda/mermas/{m1['id']}/rechazar", json={"nota": "no"}, headers=ops)
check("Operaciones tampoco puede rechazar", r.status_code == 403, f"HTTP {r.status_code}")
r = c.post(f"/api/tienda/mermas/{m1['id']}/autorizar", json={"nota": "Visto en el exhibidor"}, headers=adm)
check("La Administración autoriza", r.status_code == 200 and r.json()["estado"] == "AUTORIZADA", r.text[:120])
a = r.json()
check("Queda quién autorizó y cuándo", a["resolvio_nombre"] and a["resuelta_en"], str(a["resolvio_nombre"]))
check("Congela el costo del momento", a["costo_unitario"] is not None and float(a["costo_total"]) == float(a["costo_unitario"]) * 2)
despues = prod()
check("Baja la existencia en tienda", despues["existencia"] == base_t - 2, f"{despues['existencia']}")
check("Sube la merma del producto", despues["merma_total"] == base_merma + 2)
check("El total (tienda + bodega + merma) no se mueve", despues["existencia_total"] == base_total, f"{despues['existencia_total']} vs {base_total}")
check("Lo físico sí baja", despues["existencia_fisica"] == base_t + base_b - 2)
movs = c.get("/api/tienda/movimientos", params={"producto_id": p["id"], "tipo": "MERMA"}, headers=adm).json()
check("Queda el movimiento MERMA en el kardex", any(x["cantidad"] == -2 for x in movs), str(len(movs)))
r = c.post(f"/api/tienda/mermas/{m1['id']}/autorizar", json={}, headers=adm)
check("No se autoriza dos veces", r.status_code == 409, f"HTTP {r.status_code}")

print("\n5. Sin lugar: primero tienda y luego bodega; con lugar: ese lugar")
t_ahora = prod()["existencia"]
r = pedir(cantidad=t_ahora + 3, justificacion="Caducó un lote completo")
m_g = r.json()
r = c.post(f"/api/tienda/mermas/{m_g['id']}/autorizar", json={}, headers=adm)
g = r.json()
check("Saca todo lo de tienda y lo que falta de bodega", g["de_tienda"] == t_ahora and g["de_bodega"] == 3, f"{g.get('de_tienda')}/{g.get('de_bodega')}")
x = prod()
check("Tienda en cero y bodega con 3 menos", x["existencia"] == 0 and x["existencia_bodega"] == base_b - 3, f"{x['existencia']}/{x['existencia_bodega']}")
r = pedir(ubicacion="BODEGA", cantidad=1, justificacion="Dañado en bodega")
m_b = r.json()
r = c.post(f"/api/tienda/mermas/{m_b['id']}/autorizar", json={}, headers=adm)
check("Con lugar BODEGA sale de bodega", r.json()["de_bodega"] == 1 and r.json()["de_tienda"] == 0)

print("\n6. Rechazar y cancelar")
r = c.post(f"/api/tienda/mermas/{m_robo['id']}/rechazar", json={}, headers=adm)
check("Rechazar pide el motivo", r.status_code == 422, f"HTTP {r.status_code}")
antes_r = prod()
r = c.post(f"/api/tienda/mermas/{m_robo['id']}/rechazar", json={"nota": "Revisar cámaras primero"}, headers=adm)
check("La Administración rechaza", r.status_code == 200 and r.json()["estado"] == "RECHAZADA", r.text[:100])
check("Rechazar no toca el inventario", prod() == antes_r)
r = c.post(f"/api/tienda/mermas/{g['id']}/cancelar", json={"nota": "Se capturó mal la cantidad"}, headers=rec)
check("Recepción no puede cancelar", r.status_code == 403, f"HTTP {r.status_code}")
r = c.post(f"/api/tienda/mermas/{g['id']}/cancelar", json={"nota": "Se capturó mal la cantidad"}, headers=adm)
check("La Administración cancela una autorizada", r.status_code == 200 and r.json()["estado"] == "CANCELADA", r.text[:100])
y = prod()
check("Las piezas vuelven a donde salieron", y["existencia"] == t_ahora and y["existencia_bodega"] == base_b - 1, f"{y['existencia']}/{y['existencia_bodega']}")
check("La merma del producto se corrige", y["merma_total"] == base_merma + 2 + 1)
r = c.post(f"/api/tienda/mermas/{g['id']}/cancelar", json={"nota": "otra vez por error"}, headers=adm)
check("No se cancela dos veces", r.status_code == 409)
r = c.post(f"/api/tienda/mermas/{m_g['id'] + 99}/autorizar", json={}, headers=adm)
check("Una merma que no existe da 404", r.status_code == 404)

print("\n7. Listado, resumen y reporte")
todas = c.get("/api/tienda/mermas", headers=rec).json()
check("Se listan con producto y motivo", len(todas) >= 4 and all(x["producto_codigo"] and x["motivo_nombre"] for x in todas), str(len(todas)))
pend = c.get("/api/tienda/mermas", params={"estado": "PENDIENTE"}, headers=rec).json()
check("Se filtran por estado", all(x["estado"] == "PENDIENTE" for x in pend))
res = c.get("/api/tienda/resumen", headers=rec).json()
check("El resumen cuenta las piezas de merma", res["piezas_merma"] >= 3, str(res["piezas_merma"]))
rep = c.get("/api/tienda/reportes", headers=adm).json()
check("El reporte trae la merma autorizada y su costo", rep["merma"]["piezas"] >= 3 and float(rep["merma"]["costo"]) > 0, str(rep["merma"]))
check("Y por motivo", any(f["motivo"] == "DANADO" for f in rep["merma"]["por_motivo"]))

print()
if fallas:
    print("FALLARON:", fallas)
    sys.exit(1)
print("Todo en orden.")
