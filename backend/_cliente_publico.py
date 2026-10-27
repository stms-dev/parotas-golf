"""Cliente de pruebas que se comporta como el sitio del club.

El sitio guarda el token que recibe al apartar y lo manda en cada llamada de esa
reserva. Este cliente hace lo mismo para que las pruebas del flujo normal no
tengan que cargar el token a mano. Para probar lo que pasa SIN token se usa un
`TestClient` común.
"""
import re

from fastapi.testclient import TestClient

_RUTA = re.compile(r"^/api/public/reservas/([^/?]+)")


class ClienteDelSitio(TestClient):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.tokens = {}

    def request(self, method, url, **kw):
        coincide = _RUTA.match(str(url))
        if coincide and coincide.group(1) in self.tokens:
            cabeceras = dict(kw.get("headers") or {})
            cabeceras.setdefault("X-Reserva-Token", self.tokens[coincide.group(1)])
            kw["headers"] = cabeceras
        r = super().request(method, url, **kw)
        if (method.upper() == "POST" and str(url).rstrip("/") == "/api/public/reservas"
                and r.status_code == 201):
            cuerpo = r.json()
            self.tokens[cuerpo["folio"]] = cuerpo["token"]
        return r
