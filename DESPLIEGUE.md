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

> **El pooler de este proyecto es `aws-0-us-east-1`**, no `aws-1`. Los dos
> nombres existen y los dos aceptan la conexión, pero solo uno tiene el
> proyecto. Si se usa el equivocado, el error es
> `FATAL: (ENOTFOUND) tenant/user postgres.<referencia> not found`: eso no es
> contraseña mala ni red caída, es el servidor equivocado. Se copia el
> nombre exacto del panel de Supabase.

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
   El puerto del dominio tiene que ser el que Railway inyecta en `$PORT`
   (hoy `8080`), no el `8000` del `Dockerfile`. Si no coinciden, el sitio
   responde `502 connection refused` aunque el contenedor esté sano y
   sirviendo: nadie está escuchando en el puerto al que apunta el dominio.
3. Variables (pestaña **Variables**): las de `.env.example.produccion`.

> **`CORS_ORIGINS` admite las dos formas** —
> `https://a.com,https://b.com` o `["https://a.com","https://b.com"]`— gracias
> al `NoDecode` de `config.py`. Sin ese ajuste, pydantic intenta leer la lista
> como JSON *antes* de que corra el validador y la aplicación ni arranca:
> `error parsing value for field "CORS_ORIGINS"`.

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

## 4. Correo (Resend)

El buzón `reservas@parotasgolf.com` vive en Google Workspace y ahí se sigue
**recibiendo**. Lo que cambia es por dónde **sale** lo que manda el sistema.

### Por qué no se manda por SMTP

Railway bloquea los puertos de SMTP en sus planes Free, Trial y Hobby, y lo
dice en su documentación: *"SMTP is only available on the Pro plan and above"*.
No es una falla que se pueda rodear — el intento de conexión ni sale del
contenedor, da `Network is unreachable`. Casi todo servidor administrado hace
lo mismo, para que nadie monte una máquina de spam encima.

La salida es un servicio de correo que hable por **HTTPS**, que es el mismo
puerto de cualquier página y ese no se bloquea nunca. Se usa **Resend**, que es
el que el propio Railway recomienda: gratis hasta 3,000 correos al mes, y los
correos siguen saliendo desde `reservas@parotasgolf.com`.

### Qué hay que configurar

1. Cuenta en [resend.com](https://resend.com).
2. **Domains → Add Domain → `parotasgolf.com`**. Resend entrega tres registros
   (SPF, DKIM y uno de MX para los rebotes) que se capturan en Cloudflare. Van
   en un subdominio propio, así que **no tocan el correo de Workspace**: los MX
   del dominio siguen apuntando a Google y el buzón sigue recibiendo igual.
3. **API Keys → Create API Key**, y esa llave va a Railway:

```
RESEND_API_KEY=re_la-llave-que-da-resend
MAIL_FROM=reservas@parotasgolf.com
MAIL_FROM_NAME=Las Parotas Club de Golf
```

Las variables `SMTP_*` quedan de alternativa por si algún día el sistema corre
en un servidor que sí permita SMTP; con `RESEND_API_KEY` puesta, no se usan.

### Qué manda el sistema

| Correo | A quién | Cuándo |
|---|---|---|
| **Pase de la partida** con el QR pegado | Al titular de la reserva | Al crearse la reserva, la mande el hotel o el mostrador |
| **Recibo del cobro** | Al titular | Al quedar pagada la cuenta en recepción |

Los dos salen **solos**, sin que nadie apriete nada. El pase se puede volver a
mandar desde el detalle de la reserva, y a otra dirección si el concierge se
equivocó al capturarla.

### Cómo se manda (y por qué así)

Todo correo se escribe primero en una **bandeja de salida** y se intenta
entregar en ese mismo momento. Encolar no es aplazar: lo normal es que el
huésped lo reciba en segundos. Lo que da la bandeja son dos cosas:

1. Una reserva no se pierde porque el proveedor tardó o no contestó. Si la
   entrega falla, el correo se queda pendiente y un repartidor en segundo plano
   lo reintenta cada minuto, hasta tres veces.
2. Cuando el hotel pregunta "¿le llegó el pase al huésped?", hay una respuesta:
   en **Control del sistema → Correos del sistema** se ve a quién se mandó, si
   salió, cuándo, y si falló, con qué error. Desde ahí se reintenta a mano.

Mientras no haya proveedor configurado, los correos se acumulan en la bandeja
sin perderse: el día que se configure, salen.

El QR viaja **pegado** al correo, no como liga a otro servidor: casi todos los
clientes de correo bloquean imágenes remotas, y un pase en blanco no sirve.
También va como archivo adjunto para imprimirlo, y aparece en la responsiva que
entrega el mostrador.

### Que los correos no caigan en spam

Los registros que pide Resend al verificar el dominio (SPF y DKIM) son
justamente los que evitan el spam. Sin ellos, buena parte de los correos se va
a la carpeta de no deseados. Conviene agregar además, en Cloudflare:

| Tipo | Nombre | Contenido |
|---|---|---|
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:reservas@parotasgolf.com` |

---

## 4 bis. El pase QR

El QR del pase lleva a `https://parotasgolf.com/pase/<token>`, una página
**pública**: el huésped no tiene cuenta en el sistema y no debería necesitarla.

Esa página no enseña nada de la partida. Lo único que hace es avisarle al
sistema que ese pase se escaneó, y el aviso llega por tiempo real a la
computadora de recepción, que sí está autenticada: ahí se abre la partida con
su lista de jugadores. Si alguien fotografía un pase ajeno y lo abre, no se
lleva ni un nombre.

El token es largo y aleatorio, no se puede adivinar, y se puede regenerar.

Para el mostrador hay dos caminos más, por si el celular no está a la mano: se
puede teclear el folio, o pasar el pase por un lector de mano — el lector
teclea la dirección completa y el sistema se queda solo con el token.

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
