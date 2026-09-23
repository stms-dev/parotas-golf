# Imagen única: compila el frontend y lo sirve desde el backend.
#
# Un solo contenedor atiende la API, los WebSockets y las pantallas. Así el
# navegador habla con el mismo origen y el tiempo real no necesita CORS ni
# certificados aparte.

# ----------------------------------------------------- 1. frontend compilado
FROM node:20-alpine AS frontend

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --------------------------------------------------------- 2. API de Python
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
# Las pantallas ya compiladas se sirven como archivos estáticos.
COPY --from=frontend /frontend/dist ./static

# Railway asigna el puerto en $PORT; en local vale 8000.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
