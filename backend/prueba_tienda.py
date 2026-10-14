"""Prueba de la tienda de punta a punta.

    python prueba_tienda.py
"""
import os
import subprocess
import sys

if os.path.exists("las_parotas.db"):
    os.remove("las_parotas.db")
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True)
subprocess.run([sys.executable, "seed.py"], check=True, capture_output=True)

import logging
logging.disable(logging.INFO)
from decimal import Decimal
from fastapi.testclient import TestClient
from app.main import app

c = TestClient(app)
fallas = []


def check(nombre, ok, detalle=""):
    print(("  ✓ " if ok else "  ✗ ") + nombre + (f" · {detalle}" if detalle else ""))
    if not ok:
        fallas.append(nombre)


def token(correo):
    r = c.post("/api/auth/login", json={"email": correo, "password": "Reserva2026*"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


rec = token("recepcion@lasparotas.mx")
hotel = token("concierge@celeste.mx")
A = "Mora Prueba"

print("\n1. Permisos")
r = c.get("/api/tienda/productos", headers=hotel)
check("El hotel no entra a la tienda", r.status_code == 403, f"HTTP {r.status_code}")
r = c.get("/api/tienda/productos", headers=rec)
check("Recepción ve los productos", r.status_code == 200, f"{len(r.json())} productos")
productos = r.json()

print("\n2. Catálogo y precios")
res = c.get("/api/tienda/resumen", headers=rec).json()
check("Los productos importados traen precio y piezas de muestra", res["sin_precio"] == 0 and res["piezas_tienda"] > 0 and res["piezas_bodega"] > 0,
      f"tienda {res['piezas_tienda']} · bodega {res['piezas_bodega']}")
p0 = productos[0]
r = c.post("/api/tienda/ventas", json={"lineas": [{"producto_id": p0["id"], "cantidad": 1}],
           "pagos": [{"metodo": "EFECTIVO", "monto": 100}], "atendio": A}, headers=rec)
check("Sin caja abierta no se vende", r.status_code == 409, r.json().get("detail", "")[:60] if r.status_code != 201 else "")
r = c.post("/api/tienda/productos/precio-por-margen", json={"margen_pct": 80, "redondear_a": 10, "solo_sin_precio": False}, headers=rec)
check("Precio por margen a todos (80%)", r.status_code == 200 and r.json()["actualizados"] == res["productos"], str(r.json()))
r = c.post("/api/tienda/productos/precio-por-margen", json={"margen_pct": 60, "redondear_a": 10, "solo_sin_precio": False}, headers=rec)
p0 = c.get(f"/api/tienda/productos?q={p0['codigo']}", headers=rec).json()[0]
esperado = (Decimal(p0["costo"]) * Decimal("1.6") / 10).to_integral_value(rounding="ROUND_CEILING") * 10
check("El precio = costo +60% redondeado a 10", Decimal(p0["precio"]) == esperado, f"{p0['costo']} → {p0['precio']}")

r = c.post("/api/tienda/productos?atendio=" + A, json={
    "descripcion": "Tee de madera bolsa 50", "categoria": "Accesorios", "costo": 40, "precio": 90,
    "minimo": 5, "existencia_inicial": 20}, headers=rec)
tee = r.json()
check("Alta de producto sin código genera INT-", r.status_code == 201 and tee["codigo"].startswith("INT-"), tee.get("codigo"))
check("Con existencia inicial", tee["existencia"] == 20)
r = c.post("/api/tienda/productos?atendio=" + A, json={"codigo": tee["codigo"], "descripcion": "Otro",
           "categoria": "Accesorios", "costo": 1}, headers=rec)
check("No se repite un código", r.status_code == 409)

print("\n3. Inventario: tienda y bodega")
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "AJUSTE", "ubicacion": "TIENDA", "cantidad": 0, "atendio": A, "motivo": "Arranque"}, headers=rec)
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "AJUSTE", "ubicacion": "BODEGA", "cantidad": 0, "atendio": A, "motivo": "Arranque"}, headers=rec)
check("Producto en ceros en los dos lugares", r.json()["existencia_total"] == 0)
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "ENTRADA", "ubicacion": "BODEGA", "cantidad": 20, "atendio": A, "motivo": "Factura 123"}, headers=rec)
check("Entrada de 20 a bodega", r.status_code == 200 and r.json()["existencia_bodega"] == 20 and r.json()["existencia"] == 0)
check("Anaquel vacío con bodega → pasar a tienda", r.json()["pasar_a_tienda"] is True)
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "TRASPASO", "ubicacion": "TIENDA", "cantidad": 30, "atendio": A}, headers=rec)
check("No se traspasa más de lo que hay en bodega", r.status_code == 409)
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "TRASPASO", "ubicacion": "TIENDA", "cantidad": 12, "atendio": A}, headers=rec)
check("Traspaso de 12 bodega → tienda", r.status_code == 200 and r.json()["existencia"] == 12 and r.json()["existencia_bodega"] == 8)
r = c.patch(f"/api/tienda/productos/{p0['id']}", json={"minimo": 25, "maximo": 40}, headers=rec)
check("Mínimo 25 / máximo 40 → por surtir, comprar 20", r.json()["por_surtir"] and r.json()["compra_sugerida"] == 20, str(r.json()["compra_sugerida"]))
r = c.patch(f"/api/tienda/productos/{p0['id']}", json={"minimo": 0, "maximo": 0}, headers=rec)
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "TRASPASO", "ubicacion": "BODEGA", "cantidad": 8, "atendio": A}, headers=rec)
r = c.post("/api/tienda/productos/conteo", json={"filas": [{"producto_id": p0["id"], "contado": 16, "ubicacion": "BODEGA"}], "atendio": A}, headers=rec)
check("Conteo de bodega cuadra (sin ajuste)", r.json()["ajustados"] == 0, str(r.json()))
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "TRASPASO", "ubicacion": "TIENDA", "cantidad": 16, "atendio": A}, headers=rec)
check("Entrada + traspasos dejan 20 en tienda", r.json()["existencia"] == 20 and r.json()["existencia_bodega"] == 0)
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "AJUSTE", "cantidad": 18, "atendio": A, "motivo": "Conteo"}, headers=rec)
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "ENTRADA", "cantidad": 12, "atendio": A, "motivo": "Factura 124"}, headers=rec)
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "AJUSTE", "cantidad": 0, "atendio": A, "motivo": "x"}, headers=rec)
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "ENTRADA", "cantidad": 12, "atendio": A, "motivo": "Factura 125"}, headers=rec)
check("Entrada de 12 a tienda", r.status_code == 200 and r.json()["existencia"] == 12, str(r.json().get("existencia")))
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "AJUSTE", "cantidad": 10, "atendio": A}, headers=rec)
check("Ajuste sin motivo se rechaza", r.status_code == 409)
r = c.post(f"/api/tienda/productos/{p0['id']}/movimientos", json={"tipo": "AJUSTE", "cantidad": 10, "atendio": A, "motivo": "Conteo semanal"}, headers=rec)
check("Ajuste por conteo deja 10", r.json()["existencia"] == 10)
r = c.get(f"/api/tienda/productos/codigo/{p0['codigo']}", headers=rec)
check("Búsqueda exacta por código de barras", r.status_code == 200 and r.json()["id"] == p0["id"])

print("\n4. Caja")
r = c.post("/api/tienda/caja/abrir", json={"fondo_inicial": 500, "atendio": A}, headers=rec)
check("Abre caja con fondo $500", r.status_code == 200 and r.json()["estado"] == "ABIERTO")
r = c.post("/api/tienda/caja/abrir", json={"fondo_inicial": 0, "atendio": A}, headers=rec)
check("No se abren dos cajas", r.status_code == 409)

print("\n5. Ventas")
precio0 = Decimal(p0["precio"])
venta1 = {"lineas": [{"producto_id": p0["id"], "cantidad": 2}, {"producto_id": tee["id"], "cantidad": 3}],
          "pagos": [{"metodo": "EFECTIVO", "moneda": "MXN", "monto": 5000}], "atendio": A}
r = c.post("/api/tienda/ventas", json=venta1, headers=rec)
v1 = r.json()
total1 = precio0 * 2 + 270
check("Venta en efectivo con cambio", r.status_code == 201 and Decimal(v1["total"]) == total1, f"{v1.get('folio')} total {v1.get('total')} cambio {v1.get('cambio_mxn')}")
check("El cambio es lo que sobra", Decimal(v1["cambio_mxn"]) == 5000 - total1)
check("Folio PS-000001", v1["folio"] == "PS-000001")
check("Descuenta inventario", c.get(f"/api/tienda/productos?q={tee['codigo']}", headers=rec).json()[0]["existencia"] == 17)

r = c.post("/api/tienda/ventas", json={"lineas": [{"producto_id": tee["id"], "cantidad": 1}],
           "pagos": [{"metodo": "TARJETA", "monto": 100}], "atendio": A}, headers=rec)
check("Tarjeta de más se rechaza", r.status_code == 409)
r = c.post("/api/tienda/ventas", json={"lineas": [{"producto_id": tee["id"], "cantidad": 1}],
           "pagos": [{"metodo": "TARJETA", "monto": 50}], "atendio": A}, headers=rec)
check("Pago incompleto se rechaza", r.status_code == 409, r.json().get("detail", "")[:50])
r = c.post("/api/tienda/ventas", json={"lineas": [{"producto_id": tee["id"], "cantidad": 99}],
           "pagos": [{"metodo": "EFECTIVO", "monto": 99999}], "atendio": A}, headers=rec)
check("No vende más de lo que hay", r.status_code == 409, r.json().get("detail", "")[:60])
r = c.post("/api/tienda/ventas", json={"lineas": [{"producto_id": tee["id"], "cantidad": 2}],
           "pagos": [{"metodo": "EFECTIVO", "monto": 180}], "descuento": 20, "atendio": A}, headers=rec)
check("Descuento sin motivo se rechaza", r.status_code == 409)
tc = Decimal(c.get("/api/catalog/exchange-rate", headers=rec).json()["rate"])
r = c.post("/api/tienda/ventas", json={"lineas": [{"producto_id": tee["id"], "cantidad": 2}],
           "pagos": [{"metodo": "TARJETA", "monto": 100}, {"metodo": "EFECTIVO", "moneda": "USD", "monto": 10}],
           "descuento": 20, "descuento_motivo": "Cliente frecuente", "cliente": "Juan Pérez", "atendio": A}, headers=rec)
v2 = r.json()
check("Pago mixto tarjeta + dólares con descuento", r.status_code == 201 and Decimal(v2["total"]) == 160, f"total {v2.get('total')} cambio {v2.get('cambio_mxn')}")
check("El cambio de los dólares sale en pesos", Decimal(v2["cambio_mxn"]) == (100 + 10 * tc - 160).quantize(Decimal("0.01")))

r = c.post("/api/tienda/ventas", json={"lineas": [{"producto_id": tee["id"], "cantidad": 1}],
           "pagos": [{"metodo": "TRANSFERENCIA", "monto": 90, "referencia": "SPEI 99"}], "atendio": A}, headers=rec)
v3 = r.json()
check("Transferencia exacta", r.status_code == 201)

print("\n6. Cancelación")
r = c.post(f"/api/tienda/ventas/{v3['id']}/cancelar", json={"motivo": "Se equivocó de talla", "atendio": A}, headers=rec)
check("Cancela y regresa la pieza", r.status_code == 200 and r.json()["estado"] == "CANCELADA")
check("Existencia restaurada", c.get(f"/api/tienda/productos?q={tee['codigo']}", headers=rec).json()[0]["existencia"] == 15)
r = c.post(f"/api/tienda/ventas/{v3['id']}/cancelar", json={"motivo": "otra vez", "atendio": A}, headers=rec)
check("No se cancela dos veces", r.status_code == 409)
movs = c.get(f"/api/tienda/movimientos?producto_id={tee['id']}", headers=rec).json()
check("Kardex completo del producto", [m["tipo"] for m in movs][:2] == ["CANCELACION", "VENTA"] and movs[0]["venta_folio"] == v3["folio"],
      ", ".join(f"{m['tipo']} {m['cantidad']:+d}" for m in movs))

print("\n7. Corte")
caja = c.get("/api/tienda/caja/actual", headers=rec).json()["corte"]
efectivo_esp = Decimal(500) + total1 + (10 * tc - Decimal(v2["cambio_mxn"]))
check("Caja: 2 ventas, 1 cancelada", caja["ventas_cuenta"] == 2 and caja["canceladas"] == 1)
check("Efectivo esperado = fondo + efectivo neto", Decimal(caja["efectivo_esperado"]) == efectivo_esp.quantize(Decimal("0.01")), f"${caja['efectivo_esperado']}")
check("Tarjeta $100", Decimal(caja["tarjeta_total"]) == 100)
r = c.post("/api/tienda/caja/cerrar", json={"efectivo_contado": float(efectivo_esp) - 10, "atendio": A}, headers=rec)
check("Cierra con faltante de $10", r.status_code == 200 and Decimal(r.json()["diferencia"]) == -10, f"diferencia {r.json().get('diferencia')}")
r = c.post(f"/api/tienda/ventas/{v2['id']}/cancelar", json={"motivo": "tarde", "atendio": A}, headers=rec)
check("No se cancela una venta de caja cerrada", r.status_code == 409)

print("\n8. Reportes")
rep = c.get("/api/tienda/reportes", headers=rec).json()
check("Total del reporte", Decimal(rep["total"]) == total1 + 160, f"${rep['total']} · {rep['ventas']} ventas · utilidad ${rep['utilidad']} ({rep['margen_pct']}%)")
check("Más vendido", rep["top_productos"][0]["piezas"] >= 2, rep["top_productos"][0]["descripcion"][:40])
check("Desglose por método", {m["metodo"] for m in rep["por_metodo"]} == {"EFECTIVO", "TARJETA", "TRANSFERENCIA"})
check("Cancelaciones contadas", rep["canceladas"] == 1)
check("Historial de cortes", len(c.get("/api/tienda/caja/cortes", headers=rec).json()) == 1)
check("Resumen separa tienda y bodega", "piezas_bodega" in c.get("/api/tienda/resumen", headers=rec).json())

print("\n9. Cierre automático de cajas")
from datetime import timedelta
from app.core.cierre_cajas import cerrar_vencidas
from app.core.database import SessionLocal
from app.shared.tiempo import ahora

r = c.post("/api/tienda/caja/abrir", json={"fondo_inicial": 300, "atendio": A}, headers=rec)
corte_auto = r.json()["id"]
r = c.post("/api/treasury/cash/open", json={"opening_balance": 0}, headers=token("operaciones@lasparotas.mx"))
check("Caja de green fees abierta", r.status_code in (200, 201), r.text[:80])
db = SessionLocal()
check("Antes de la hora no cierra nada", cerrar_vencidas(db, ahora() - timedelta(days=1)) == {"green_fees": 0, "tienda": 0})
res_auto = cerrar_vencidas(db, ahora() + timedelta(days=1))
db.close()
check("Pasada la hora se cierran las dos", res_auto == {"green_fees": 1, "tienda": 1}, str(res_auto))
r = c.get("/api/tienda/caja/actual", headers=rec).json()
check("La tienda queda sin caja abierta", r["abierta"] is False)
corte = c.get(f"/api/tienda/caja/cortes/{corte_auto}", headers=rec).json()
check("El corte queda pendiente de arqueo", corte["pendiente_arqueo"] and corte["cerrado_por_nombre"] == "Cierre automático")
r = c.post(f"/api/tienda/caja/cortes/{corte_auto}/arqueo", json={"efectivo_contado": 300, "atendio": A}, headers=rec)
check("Arqueo posterior cuadra", r.status_code == 200 and Decimal(r.json()["diferencia"]) == 0, r.text[:100])
r = c.post(f"/api/tienda/caja/cortes/{corte_auto}/arqueo", json={"efectivo_contado": 300, "atendio": A}, headers=rec)
check("No se arquea dos veces", r.status_code == 409)
ses = c.get("/api/treasury/cash", headers=token("operaciones@lasparotas.mx")).json()
check("Green fees en CIERRE_AUTOMATICO", ses[0]["status"] == "CIERRE_AUTOMATICO", ses[0]["status"])

print("\n" + ("TODO OK" if not fallas else f"{len(fallas)} FALLAS: {fallas}"))
sys.exit(1 if fallas else 0)
