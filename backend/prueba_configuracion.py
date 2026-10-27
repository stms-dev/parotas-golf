"""Prueba de la validación de configuración al arrancar.

Comprueba que en producción el servidor se niegue a encender con la llave de
ejemplo o con una llave corta, que arranque normal con una llave buena, que
en desarrollo no estorbe, y que el mensaje de error no escriba ningún secreto.

    python prueba_configuracion.py

Cada caso corre en un proceso aparte: la configuración se lee una sola vez al
importar, así que es la única forma de probar combinaciones distintas.
"""
import os
import subprocess
import sys

FALLOS = []

LLAVE_BUENA = "a3f1c9e07b4d58126e9f0b7c3d2a1e45f8c6b9d0a7e3f2c1b4d5e6f708192a3b"
CLAVE_BD = "ContrasenaSuperSecretaDeLaBD"
URL_BD = f"postgresql://postgres.ref:{CLAVE_BD}@host.example.com:6543/postgres"


def check(label: str, condition: bool, extra: str = ""):
    marca = "✓" if condition else "✗"
    print(f"  {marca} {label}" + (f" · {extra}" if extra else ""))
    if not condition:
        FALLOS.append(label)


def arrancar(**variables):
    """Importa la configuración en un proceso limpio con esas variables."""
    entorno = {k: v for k, v in os.environ.items()
               if k not in ("SECRET_KEY", "ENVIRONMENT", "DATABASE_URL", "DEBUG")}
    entorno.update(variables)
    return subprocess.run(
        [sys.executable, "-c", "from app.core.config import settings; print('ARRANCO')"],
        capture_output=True, text=True, env=entorno,
        cwd=os.path.dirname(os.path.abspath(__file__)),
    )


print("\nProducción")
r = arrancar(ENVIRONMENT="production", DATABASE_URL=URL_BD)
check("Con la llave de ejemplo (sin definirla) NO arranca", r.returncode != 0 and "ARRANCO" not in r.stdout)
check("El mensaje nombra la variable SECRET_KEY", "SECRET_KEY" in r.stderr)
check("El mensaje no escribe la contraseña de la base", CLAVE_BD not in r.stderr and CLAVE_BD not in r.stdout)

r = arrancar(ENVIRONMENT="production", DATABASE_URL=URL_BD,
             SECRET_KEY="CAMBIAR-ESTA-LLAVE-EN-PRODUCCION-openssl-rand-hex-32")
check("Con la llave de ejemplo escrita a mano NO arranca", r.returncode != 0)

r = arrancar(ENVIRONMENT="production", DATABASE_URL=URL_BD, SECRET_KEY="corta123")
check("Con una llave corta NO arranca", r.returncode != 0)
check("El mensaje no repite la llave corta", "corta123" not in r.stderr)

r = arrancar(ENVIRONMENT="  Production ", DATABASE_URL=URL_BD, SECRET_KEY="corta123")
check("Mayúsculas y espacios en ENVIRONMENT no la evitan", r.returncode != 0)

r = arrancar(ENVIRONMENT="production", DATABASE_URL=URL_BD, SECRET_KEY=LLAVE_BUENA)
check("Con una llave buena SÍ arranca", r.returncode == 0 and "ARRANCO" in r.stdout, r.stderr[-200:])

print("\nDesarrollo")
r = arrancar(ENVIRONMENT="development")
check("Con la llave de ejemplo arranca (no estorba al desarrollar)", r.returncode == 0 and "ARRANCO" in r.stdout)

r = arrancar()
check("Sin ninguna variable arranca (valores de desarrollo)", r.returncode == 0 and "ARRANCO" in r.stdout)

print()
if FALLOS:
    print("=" * 60)
    print(f"  FALLARON {len(FALLOS)}: " + "; ".join(FALLOS))
    print("=" * 60)
    sys.exit(1)

print("=" * 60)
print("  LA CONFIGURACIÓN DE ARRANQUE ESTÁ BIEN AMARRADA")
print("=" * 60)
