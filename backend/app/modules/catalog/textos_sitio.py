"""Textos del sitio público que el administrador puede cambiar, en cada idioma.

Cada texto tiene dos ajustes independientes, uno en español y otro en inglés
(`sitio_texto_es_<clave>` y `sitio_texto_en_<clave>`). Si un ajuste está vacío,
el sitio usa el texto que trae de fábrica; así cambiar uno no mueve el otro.
"""

IDIOMAS = ("es", "en")

# Claves del diccionario del sitio (sitio/src/datos/textos.js) que se pueden
# editar desde Configuración. El texto por defecto vive en el sitio.
TEXTOS_EDITABLES = {
    "nav.campo": "Menú: Campo / Gallery",
    "nav.reservar": "Menú: Reservar tee time",
    "nav.evento": "Menú: Charter y torneos privados",
    "evento.titulo": "Título de la pantalla Charter y torneos privados",
    "evento.invitacion": "Frase de la pantalla Charter y torneos privados",
    "evento.boton": "Botón de contacto de Charter y torneos privados",
    "tarifas.practicaDetalle": "Zona de práctica: texto en la tabla de tarifas",
    "extra.PRACTICA.nota": "Zona de práctica: nota en la lista de extras ({fin} = precio vie a dom)",
    # La descripción en español de los paquetes ya se edita en «Paquetes y
    # servicios»; aquí solo se agrega la del inglés.
    "paquete.GRUPO.detalle": "Descripción del paquete En Grupo",
    "paquete.PARTIDA_ABIERTA.detalle": "Descripción del paquete Partida Abierta",
    "paquete.PRACTICA.detalle": "Descripción del paquete Práctica",
}

SOLO_INGLES = {k for k in TEXTOS_EDITABLES if k.startswith("paquete.")}


def idiomas_de(clave: str):
    return ("en",) if clave in SOLO_INGLES else IDIOMAS


def clave_ajuste(idioma: str, clave: str) -> str:
    return f"sitio_texto_{idioma}_{clave}"


def ajustes_editables() -> dict:
    """Entradas para `AJUSTES_EDITABLES`: una por texto y por idioma."""
    return {
        clave_ajuste(i, c): f"{etiqueta} ({'español' if i == 'es' else 'inglés'})"
        for c, etiqueta in TEXTOS_EDITABLES.items()
        for i in idiomas_de(c)
    }


def es_texto_del_sitio(key: str) -> bool:
    return key in ajustes_editables()
