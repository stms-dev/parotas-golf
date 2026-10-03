# Imagen única: compila las dos aplicaciones y las sirve desde el backend.
#
#   parotasgolf.com/          → el sitio del club, para el público
#   parotasgolf.com/sistema   → el sistema de operación, para hoteles y campo
#   parotasgolf.com/api       → la API, para los dos
#
# Un solo contenedor, un solo dominio, un solo despliegue. Al compartir origen
# no hay CORS que configurar ni certificados aparte, y el tiempo real funciona
# sin apuntar a ningún lado.
#
# Son dos compilaciones separadas, no una sola partida en dos: quien entra a
# ver el campo baja el sitio y nada más. El sistema pesa tres veces más y no
# se carga hasta que alguien le pica a Acceder.

# ----------------------------------------- 1. el sistema de operación
FROM node:20-alpine AS sistema

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./

# Vite congela las variables al compilar, no al arrancar: si esto no se pasa
# aquí, el login se queda con la liga de regreso apuntando a localhost. El
# valor por omisión es el bueno, y Railway puede sobrescribirlo.
ARG VITE_SITIO_PUBLICO=/
ENV VITE_SITIO_PUBLICO=$VITE_SITIO_PUBLICO

RUN npm run build

# ------------------------------------------- 2. el sitio público del club
FROM node:20-alpine AS sitio

WORKDIR /sitio
COPY sitio/package*.json ./
RUN npm ci
COPY sitio/ ./
RUN npm run build

# --------------------------------------------------------- 3. API de Python
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
# Las dos aplicaciones ya compiladas, cada una en su carpeta. El servidor sabe
# cuál entregar según la dirección que pidan.
COPY --from=sistema /frontend/dist ./static
COPY --from=sitio   /sitio/dist    ./sitio

# Railway asigna el puerto en $PORT; en local vale 8000.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
