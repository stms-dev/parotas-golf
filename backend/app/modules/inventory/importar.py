"""Lectura de la lista de productos del Pro-Shop.

La lista llega como se exporta del punto de venta: código de barras,
descripción larga y precio de compra. La descripción trae metida la marca, el
modelo y la talla en un solo texto, con dos formatos distintos:

    "GUANTE MARCA: PING - SPORT N/A - TALLA: RH S"
    "PLAYERA POLO: CALLAWAY CABALLERO"

Aquí se separa en campos para poder buscar y filtrar. La descripción original
se conserva completa: si la separación se equivoca, el dato no se pierde.
"""
import csv
import html
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import List, Optional

# El primer término que aparece manda la categoría. El orden importa:
# "REPARADOR" va antes que "MARCADOR" porque el reparador de divots viene
# registrado como "MARCADOR MARCA: ... REPARADOR DE DIVOTS".
CATEGORIAS = [
    ("REPARADOR", "Accesorios"),
    ("MARCADOR", "Accesorios"),
    ("PELOTA", "Pelotas"),
    ("GUANTE", "Guantes"),
    ("GORRA", "Gorras"),
    ("PLAYERA", "Playeras"),
    ("BERMUDA", "Bermudas"),
    ("TOALLA", "Toallas"),
]


@dataclass
class Producto:
    codigo: str
    tiene_codigo: bool
    descripcion: str
    categoria: str
    marca: Optional[str]
    talla: Optional[str]
    precio_compra: Decimal


def _precio(texto: str) -> Decimal:
    """"1,114.00" → 1114.00. La coma es separador de miles, no decimal."""
    limpio = (texto or "").replace(",", "").replace("$", "").strip()
    try:
        return Decimal(limpio).quantize(Decimal("0.01"))
    except InvalidOperation:
        return Decimal("0.00")


def _categoria(descripcion: str) -> str:
    texto = descripcion.upper()
    for clave, nombre in CATEGORIAS:
        if clave in texto:
            return nombre
    return "Otros"


def _vacio(valor: Optional[str]) -> Optional[str]:
    """"N/A" y cadenas vacías cuentan como sin dato."""
    if valor is None:
        return None
    v = valor.strip(" -")
    return None if not v or v.upper() == "N/A" else v


def _marca_y_talla(descripcion: str):
    marca = talla = None
    m = re.search(r"MARCA:\s*(.+?)\s+-\s", descripcion + " - ", re.IGNORECASE)
    if m:
        marca = _vacio(m.group(1))
    t = re.search(r"TALLA:\s*(.+)$", descripcion, re.IGNORECASE)
    if t:
        talla = _vacio(t.group(1))
    return marca, talla


def leer(ruta: Path) -> List[Producto]:
    productos: List[Producto] = []
    sin_codigo = 0
    with open(ruta, encoding="utf-8") as f:
        filas = list(csv.reader(f, delimiter="\t"))
    for fila in filas[1:]:
        if len(fila) < 3 or not fila[1].strip():
            continue
        codigo = fila[0].strip()
        # La exportación trae entidades HTML: "&#43;" es un "+".
        descripcion = " ".join(html.unescape(fila[1]).split())
        tiene = bool(codigo)
        if not tiene:
            # Sin código de barras se le da uno interno para poder
            # identificarlo; queda marcado para que se le pegue etiqueta.
            sin_codigo += 1
            codigo = f"INT-{sin_codigo:03d}"
        marca, talla = _marca_y_talla(descripcion)
        productos.append(
            Producto(
                codigo=codigo,
                tiene_codigo=tiene,
                descripcion=descripcion,
                categoria=_categoria(descripcion),
                marca=marca,
                talla=talla,
                precio_compra=_precio(fila[2]),
            )
        )
    return productos
