# Puesta en producción

El sistema corre como **un solo contenedor**: el `Dockerfile` compila las
pantallas y la misma API las sirve. Por eso el tiempo real funciona sin
configurar nada aparte — navegador y API comparten origen.

| Pieza | Dónde | Plan |
|---|---|---|
| Aplicación (API + pantallas) | Railway | Free / Hobby |
| Base de datos PostgreSQL | Supabase | Free |
| Dominio y DNS | Cloudflare | `parotasgolf.com` |
| Correo | Google Workspace | `reservas@parotasgolf.com` |

---

## 1. Base de datos (Supabase)

1. Proyecto **parotas-golf**, región `us-east-1` (la más cercana con menos
   salto a Huatulco).
2. **Project Settings → Database → Connection string → Transaction pooler**
   (puerto `6543`). Se usa el *pooler*, no la conexión directa: la conexión
   directa de Supabase es solo IPv6 y Railway no la alcanza.
3. La URL se guarda en Railway como `DATABASE_URL`. Da igual si empieza con
   `postgresql://`: la aplicación le pone el driver correcto sola.

> **Cuidado con el plan gratuito.** El proyecto **se pausa a los 7 días sin
> actividad** y hay que despausarlo a mano desde el panel. Si el club lo usa a
> diario no pasa nada. Tampoco hay respaldos automáticos: conviene bajar un
> respaldo desde el panel de Supabase una vez por semana.

### Por qué el pooler necesita un ajuste

Un *pooler* reparte la misma conexión entre varias transacciones. Las
consultas preparadas de psycopg se quedan colgadas de una conexión que en la
siguiente transacción ya es de otro, y la aplicación truena al segundo
movimiento. Por eso `database.py` abre el motor con `prepare_threshold=None`
cuando la URL es PostgreSQL. No hay que hacer nada más.

---

## 2. Aplicación (Railway)

1. **New Project → Deploy from GitHub repo** y elegir el repositorio.
   Railway detecta el `Dockerfile` solo.
2. **Settings → Networking → Generate Domain** para tener una dirección
   provisional (`…up.railway.app`) y probar antes de conectar el dominio.
3. Variables (pestaña **Variables**): las de `.env.example.produccion`.

El esquema **se aplica solo al arrancar** (`MIGRAR_AL_ARRANCAR=true`). No hace
falta abrir una terminal: Alembic aplica lo que falte en cada despliegue, y si
la base está en blanco se siembran catálogos, tarifas, inventario y la cuenta
de administración con `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Esa siembra
corre una sola vez: si ya hay hoteles, no toca nada.

> Las cuentas de prueba (`admin@lasparotas.mx` y compañía, con la contraseña
> `Reserva2026*`) **no se crean en producción**. Solo existe la cuenta de
> administración que se configure, y desde Control del sistema se dan de alta
> las demás.

### Consumo en el plan Free

El plan Free de Railway da $1 de crédito al mes y este sistema gasta entre $2
y $3 si se queda encendido día y noche. Para pruebas alcanza; para operar de
verdad conviene Hobby ($5 al mes, con $5 de consumo incluidos). Con el plan
Free se puede activar **Settings → Serverless** para que el servicio duerma
cuando nadie lo usa y estirar el crédito.

---

## 3. Dominio (Cloudflare)

En Railway: **Settings → Networking → Custom Domain → `parotasgolf.com`**.
Railway devuelve un destino `…up.railway.app`.

En Cloudflare → `parotasgolf.com` → **DNS → Records**:

| Tipo | Nombre | Destino | Proxy |
|---|---|---|---|
| `CNAME` | `@` | el destino que dio Railway | **DNS only** (nube gris) |
| `CNAME` | `www` | `parotasgolf.com` | **DNS only** (nube gris) |

La nube tiene que quedar **gris**. Con el proxy de Cloudflare encendido hay
que ajustar el modo SSL a *Full (strict)* y, si queda en *Flexible*, el
sistema entra en un ciclo de redirecciones. En gris, Railway emite y renueva
el certificado solo.

Después, en Railway:

```
CORS_ORIGINS=https://parotasgolf.com,https://www.parotasgolf.com
QR_BASE_URL=https://parotasgolf.com/pase
```

Esas direcciones son también las únicas que el servidor reconoce como suyas
(`TrustedHost`): una petición con el `Host` falseado se rechaza.

---

## 4. Correo (Google Workspace)

El buzón `reservas@parotasgolf.com` ya existe. Para que el sistema pueda
enviar desde él:

1. Entrar a [myaccount.google.com](https://myaccount.google.com) con esa
   cuenta → **Seguridad → Verificación en dos pasos** (activarla).
2. Ya activada, buscar **Contraseñas de aplicación** y crear una con el
   nombre "Las Parotas". Google da 16 caracteres.
3. En Railway:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=reservas@parotasgolf.com
SMTP_PASSWORD=la-contraseña-de-aplicación
SMTP_FROM=reservas@parotasgolf.com
```

> **Hoy el sistema todavía no manda correos.** Las variables quedan puestas
> para cuando se conecte el envío del pase QR; el pase se imprime desde el
> mostrador mientras tanto.

Los registros MX del dominio los pide Google Workspace en su propio asistente
y se capturan igual en Cloudflare (DNS → Records).

---

## 5. Seguridad que ya trae puesta

| Qué | Para qué |
|---|---|
| `Strict-Transport-Security` | Obliga HTTPS: el token no viaja en claro en un wifi abierto |
| `Content-Security-Policy` | Solo corren los scripts propios; un XSS inyectado no ejecuta |
| `X-Frame-Options: DENY` | Nadie mete el sistema en un iframe para robar clics |
| `Cache-Control: no-store` en `/api` | Ningún intermediario guarda datos de huéspedes ni de caja |
| Límite de intentos | 10 intentos de contraseña por minuto y 200 peticiones por IP |
| Bitácora sin secretos | Contraseñas, tokens y la URL de la base salen como `***` |
| `X-Request-Id` | Cada petición trae número: un error reportado se encuentra en el log |
| Documentación de la API oculta | `/docs` y `/openapi.json` no existen en producción |

Lo que **hay que hacer a mano** después del primer arranque:

1. Entrar con la cuenta de administración y cambiar su contraseña.
2. Dar de alta las cuentas reales (operación, recepción, conserjerías) desde
   Control del sistema.
3. Revisar que `RESPETAR_HORARIOS` esté en `true`.

---

## 6. Verificación

1. `https://parotasgolf.com/health` → `{"status":"ok","database":"ok"}`
2. Entrar y ver el indicador de tiempo real en **Conectado**.
3. Crear una reserva de prueba desde un hotel y cobrarla en el mostrador.
4. `https://parotasgolf.com/docs` → debe dar 404 (en producción no se publica).
