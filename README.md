# Las Parotas · Sistema de Reservaciones y Operación

Sistema web para gestionar las reservas de un campo de golf y su relación con
los hoteles que tienen convenio: solicitud, validación, check-in, cobro
multimoneda, tarifas, beneficios PGA, eventos, finanzas, cierre de caja y
auditoría.

---

## Arranque rápido

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env

alembic upgrade head     # crea el esquema
python seed.py           # datos iniciales

uvicorn app.main:app --reload
```

API en `http://localhost:8000` · documentación interactiva en `/docs`.

> **En Windows**: `requirements.txt` incluye `tzdata` a propósito. Windows no
> trae la base de zonas horarias del sistema y sin ese paquete el backend no
> puede resolver `America/Mexico_City`, que es con la que decide si un tee time
> ya pasó. Si el backend arranca pero avisa que no encontró la zona horaria,
> corra `pip install tzdata`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Aplicación en `http://localhost:5173`. Vite reenvía `/api` al backend.

### Usuarios de prueba

La pantalla de acceso ya no los muestra: en producción la ve cualquiera que
abra la dirección. Están aquí.

Contraseña para todos: `Reserva2026*`

| Correo | Rol | Ve |
|---|---|---|
| `admin@lasparotas.mx` | Administración | Control del sistema · Inventario · Auditoría |
| `operaciones@lasparotas.mx` | Dirección de operaciones | Panel · Nueva reserva · Partidas & Hoteles · Check-In · Liquidaciones · Inventario · Precios (consulta) |
| `recepcion@lasparotas.mx` | Recepción | Solicitudes · Recepción & Check-In · Liquidaciones |
| `concierge@celeste.mx` | Hotel Celeste (comisión 5%) | Su panel · Nueva reserva |
| `concierge@barcelo.mx` | Hotel Barceló (sin comisión) | Su panel · Nueva reserva |

Cambie estas contraseñas desde **Control del sistema › Cuentas** antes de
operar de verdad.

### Datos del club

La base se llena con la información real del club:

- **Hoteles y tarifas** de la hoja *Costeo* del tarifario (`CAMPO_DE_GOLF_COSTEO.xlsx`):
  nueve convenios, cuatro con comisión del 5% (Celeste, Dreams, Secrets, Brisas)
  y cinco sin comisión. El green fee cambia de **lunes a jueves** contra
  **viernes a domingo**, y el sistema elige solo el que corresponde al día de
  la salida.
- **Productos del Pro-Shop** de `backend/data/inventario_inicial.tsv`: 73
  artículos con su costo. Entran con existencia en cero, porque todavía no hay
  conteo físico.

### Horarios

No se vende una salida que ya pasó, y después de la **hora límite del día**
(15:00 de fábrica) ya no se reserva para hoy. La hora se cambia desde Control
del sistema.

Para hacer pruebas a cualquier hora está la variable `RESPETAR_HORARIOS` en
`backend/.env` (se reinicia el backend después de cambiarla):

| Valor            | Comportamiento                                                       |
|------------------|----------------------------------------------------------------------|
| `true` (fábrica) | Funcionamiento real: no se reserva un horario que ya pasó ni el mismo día después de la hora límite. |
| `false`          | Modo pruebas: se puede elegir cualquier horario aunque ya haya pasado. |

En operación real debe quedar en `true`.

### Verificación

```bash
cd backend
python verificar.py               # flujo operativo completo
python verificar_tiempo_real.py   # difusión por WebSocket
python verificar_roles.py         # alcance de cada perfil
```

El primero recorre el flujo contra la API: login de los cuatro roles,
generación de franjas, cotización, reserva, rechazo de sobreventa, aislamiento
entre hoteles, confirmación, check-in con PGA, pago mixto MXN/USD,
inmutabilidad del histórico, cierre de caja con diferencia, liquidación,
bloqueo por evento, auditoría y precisión decimal.

El segundo levanta el servidor, conecta tres terminales por WebSocket y
comprueba que cada aviso llega a quien le toca: que Barceló no vea la
reserva de Celeste pero sí el cambio de cupo, que un hotel no reciba movimientos
de caja, y que una terminal caída no interrumpa la operación.

El tercero ataca los endpoints con cada perfil, que es lo que alguien
alcanzaría escribiendo la URL a mano: comprueba que un hotel reciba 403 en
finanzas, caja, auditoría y padrón PGA, que solo vea su propio hotel en el
catálogo, que no vea los convenios exclusivos de la competencia, y que
recepción y operaciones tampoco pasen de su alcance.

---

## Diseño

La interfaz sigue el sistema **Las Parotas Editorial SaaS** (`DESIGN.md`):
Playfair Display para títulos y cifras, Plus Jakarta Sans para datos y
formularios, pergamino cálido (`#F9F9F6`) como lienzo, verde césped
(`#16382C`) para navegación y acciones, y latón (`#725B38`) reservado para
marcas de distinción.

Los tokens viven en `frontend/tailwind.config.js` y salen tal cual del
documento: no se inventan colores ni tamaños en los componentes. La elevación
es por contorno de un píxel y tono, no por sombras pesadas; las esquinas son de
4px en controles y 8px en tarjetas, para conservar el aire de papelería de club
y no de aplicación móvil.

---

## Arquitectura

**Monolito modular**, no microservicios. La decisión es deliberada: con 8
hoteles, un campo y 16 franjas diarias no hay carga que justifique escalado
independiente, y la operación central —tomar el cupo, aplicar tarifas,
registrar el pago y escribir la auditoría— tiene que ser **atómica**. Partirla
en servicios obligaría a implementar sagas y compensaciones para resolver algo
que una transacción de base de datos resuelve gratis.

Lo que sí se conserva son las **fronteras**: cada módulo tiene su router,
servicio, repositorio y esquemas, y no se importan entre sí salvo por sus
interfaces públicas. El día que un módulo necesite salir, sale sin cirugía.

```
las-parotas/
├── backend/
│   ├── alembic/                    Migraciones versionadas
│   ├── app/
│   │   ├── core/                   config · database · security · deps · permissions · exceptions
│   │   ├── shared/                 enums · money (Decimal exacto)
│   │   ├── modules/
│   │   │   ├── identity/           autenticación, usuarios, RBAC
│   │   │   ├── catalog/            hoteles, tarifas, servicios, convenios, PGA, horarios, TC
│   │   │   ├── booking/            disponibilidad, reservas, jugadores, máquina de estados
│   │   │   ├── checkin/            llegadas, validación PGA, servicios, cobro
│   │   │   ├── billing/            pagos multimoneda
│   │   │   ├── treasury/           turnos de caja, arqueo, liquidaciones
│   │   │   ├── events/             eventos y bloqueos
│   │   │   └── audit/              bitácora y tablero
│   │   ├── realtime/               WebSocket: gestor, eventos y filtrado
│   │   ├── workers/                QR y correo (fuera del request)
│   │   ├── models.py               registro único de modelos
│   │   └── main.py
│   ├── seed.py
│   ├── verificar.py
│   ├── verificar_tiempo_real.py
│   └── verificar_roles.py
└── frontend/
    └── src/
        ├── api/                    cliente HTTP único
        ├── context/                sesión, permisos y canal de tiempo real
        ├── components/             UI base
        ├── layouts/                cascarón con menú por permisos
        ├── pages/                  una por pantalla
        ├── router/                 rutas con guards
        └── utils/                  formato de dinero y fechas
```

### SOLID, en la práctica

- **Responsabilidad única** — el router traduce HTTP, el servicio decide, el
  repositorio consulta. El router no sabe qué es SQLAlchemy; el servicio no
  sabe qué es una petición HTTP.
- **Abierto/cerrado** — agregar una modalidad de reserva o un método de pago es
  agregar un valor al enum y una fila de configuración, no editar condicionales.
- **Sustitución de Liskov** — `DecimalMoney` se comporta igual en SQLite que en
  PostgreSQL; cambiar de motor no cambia el código.
- **Segregación de interfaces** — `RequirePermission(...)` pide el permiso
  puntual, no un rol completo.
- **Inversión de dependencias** — los servicios reciben la sesión de base de
  datos por inyección; se pueden probar sin levantar la API.

---

## Decisiones que sostienen el sistema

### 1. El dinero es `Decimal`, nunca `float`

`0.1 + 0.2` en punto flotante da `0.30000000000000004`. En un arqueo eso se
convierte en diferencias de centavos que nadie puede explicar.

Se usa `Decimal` de Python con `Numeric(12,2)` en la base. En PostgreSQL es
`NUMERIC` nativo; en SQLite, que no tiene ese tipo, un `TypeDecorator` lo
guarda como texto y lo devuelve como `Decimal`. La aritmética siempre ocurre en
Python con precisión exacta. `app/shared/money.py`.

### 2. El cupo se protege en la base, no solo en el código

Dos hoteles pidiendo el último lugar de las 10:30 al mismo tiempo es un
escenario real. La defensa son dos cosas juntas:

- `UNIQUE (slot_date, tee, slot_time)` en `tee_slots`.
- La verificación de cupo y la creación de la reserva dentro de **una sola
  transacción**, con `SELECT ... FOR UPDATE` donde el motor lo soporta.

Validar solo en la capa de aplicación no basta.

### 3. Las operaciones históricas no se recalculan

Cada reserva guarda copia del **tipo de cambio** y de la **comisión del hotel**
vigentes al momento de crearse. Cada pago guarda su propio TC. Cada jugador
guarda la tarifa que se le aplicó.

Si mañana el TC pasa de 17.20 a 19.50, una operación de hoy sigue valiendo lo
que valió hoy. El tipo de cambio nunca se edita: se inserta un registro nuevo y
el anterior queda en el histórico.

### 4. El beneficio PGA es del jugador, no de la reserva

PGA no es un código promocional: es una acreditación profesional. Por eso vive
en sus propias tablas (`pga_credentials`, `pga_benefit_config`) y no junto a
`HOTELVIP` o `CONVENIO_EMPRESA`.

En la interfaz **solo aparece en la pantalla de check-in**. Recepción valida la
credencial contra el padrón y el descuento cae únicamente sobre la tarifa del
portador:

```
Partida de 4 jugadores · tarifa $2,064 c/u

Roberto  → PGA-00123 válido → −$412.80 → $1,651.20
Elena    → sin PGA          →           $2,064.00
Fernando → sin PGA          →           $2,064.00
Mateo    → infantil         →           $1,032.00
```

### 5. El cierre de caja es un turno, no un horario

Las 22:00 es cuando la caja deja de admitir cobros, pero el arqueo necesita un
**turno**: apertura, fondo inicial, responsable, cierre. Sin eso, una diferencia
en el conteo no tiene a quién responsabilizarse ni a qué corte pertenece cada
pago.

### 6. El tiempo real difunde; REST sigue escribiendo

Los WebSockets se montan **encima** de la API, no la reemplazan. Crear una
reserva sigue siendo un `POST` que responde éxito o error, porque el cliente
necesita saber si el cupo se tomó o si alguien se le adelantó. Mandar eso por
socket significaría perder el código de error, el reintento y la transacción
con respuesta.

El socket sirve para lo otro: avisarle a los demás que algo cambió.

```
Celeste reserva       ──POST──▶  transacción: cupo + tarifas + auditoría
                                              │
                                           commit
                                              │
                                        ──WS──▶  Barceló ve la franja
                                                 pasar de 4 a 2 lugares
```

Tres reglas sostienen esto:

- **Se publica después del commit, nunca antes.** Avisar dentro de la
  transacción significaría difundir un cambio que puede hacer rollback: las
  pantallas mostrarían una reserva que no existe.
- **El filtrado es el mismo que en la API.** Un usuario de hotel no recibe
  eventos de otro hotel, y los movimientos de caja solo llegan a quien tiene
  permiso financiero. La disponibilidad es la excepción deliberada: que una
  franja se libere le importa a los nueve hoteles.
- **Si el socket falla, la operación no.** La difusión nunca lanza excepciones
  hacia el servicio. Una terminal con la pestaña cerrada se descarta sola y el
  resto sigue recibiendo.

En el cliente hay **una sola conexión por sesión**, compartida por todas las
pantallas mediante `RealtimeContext`. Reconecta sola con espera creciente (1s,
2s, 4s… hasta 30s), manda un ping cada 25 segundos para sobrevivir a proxies
que cierran sockets inactivos, y muestra un indicador de estado en la barra
superior: que la pantalla se mueva sola sin explicar por qué desconcierta.

Cada pantalla decide cómo reacciona. El tee sheet corrige la franja afectada en
memoria en vez de recargar todo; el panel, que son cifras agregadas, recarga sin
spinner. En la pantalla de nueva reserva, si alguien toma el cupo que tenías
seleccionado, se te avisa y se te regresa al paso de horarios antes de que
llenes el formulario completo para nada.

**Eventos que se difunden:** `reserva.creada`, `reserva.actualizada`,
`reserva.cancelada`, `disponibilidad.cambiada`, `checkin.registrado`,
`pago.registrado`, `caja.actualizada`, `caja.cerrada`,
`tipo_cambio.actualizado`, `evento.creado`, `evento.liberado`.

> **Al escalar a varios procesos.** El gestor de conexiones vive en memoria del
> proceso. Con `uvicorn` de un solo trabajador funciona tal cual; con
> `--workers 4`, cada trabajador tendría sus propias conexiones y un aviso no
> cruzaría entre ellos. La solución es sustituir el `broadcast` de
> `app/realtime/manager.py` por un canal de Redis pub/sub. El resto del código
> no se entera, porque todos publican a través de `publish()`.

### 7. Cada pantalla muestra lo que ese perfil necesita, y nada más

El hotel solicita salidas; el campo cobra y administra. Esa frontera define
qué aparece en cada pantalla:

**Panel del hotel** — la rejilla de horarios del día (libre · su hotel ·
partida abierta · ocupado) y sus salidas de la semana. No hay ventas ni cobros,
porque el hotel no cobra; no hay expediente de huéspedes, porque esos datos los
lleva el hotel en su propio sistema; y de una salida ajena solo se sabe que está
ocupada, nunca de quién es.

**Nueva reserva** — paquete con su precio por jugador, recorrido, horario,
titular y jugadores. Fuera quedan los servicios adicionales, los convenios y la
facturación: todo eso se resuelve en el mostrador, donde se cobra. El código
PGA sí se captura, pero es opcional y no es un código promocional: es el
identificador del jugador profesional, que recepción valida contra el padrón.

**Panel & Agenda** — el tee sheet cronológico del día, con el resumen de
salidas, la caja del turno, el pool de partidas abiertas y el alta de eventos o
bloqueos. Es la pantalla desde la que se opera el campo.

**Validación de Cupos** — la lista de reservas con su estado; el número que
aparece junto al menú son las que siguen pendientes de validar.

**Recepción & Check-In** — la única pantalla donde existe el PGA. Se identifica
la partida por folio o por el pase QR, se marca quién llegó, se valida la
credencial contra el padrón, se agregan amenidades y se cobra en MXN o USD.

**Dashboard Hoteles** — la contraparte del panel del hotel: comisión pactada,
venta generada y lo que queda por liquidar de cada convenio.

**Liquidaciones (Finanzas y Cierre)** — venta bruta, comisión hotelera, ingreso
neto, distribución de cobros, arqueo y la auditoría de cada bonificación PGA.
Recepción entra a la misma ruta pero solo ve su turno de caja: la consolidación
del club exige `finance:view_global`, que su perfil no tiene.

**Precios & Tarifas** — alta y edición de green fees, servicios y convenios.
Separada de Configuración a propósito: consultar el cuadro de precios es cosa
de todos los días, modificarlo no.

**Configuración Sistema** — tarifas vigentes, monedas y tipo de cambio,
convenios, padrón PGA, generador de horarios, servicios y la bitácora de
cambios, en una sola pantalla.

### 8. Cada perfil ve solo lo suyo, y eso se valida en el servidor

| Perfil | Pantallas |
|---|---|
| Administrador general | Todas, incluida la configuración financiera y los usuarios |
| Dirección de operaciones | Todas; tarifas, tipo de cambio, convenios y PGA en **consulta** |
| Recepción | Solicitudes del día · Recepción & Check-In · Liquidaciones (solo su turno de caja) |
| Hotel | Panel del Hotel · Nueva reserva |

El menú se arma desde permisos de pantalla (`screen:…`) que manda el backend
en `/api/auth/me`, y cada ruta del frontend lleva guard. Pero eso es solo
presentación: **esconder un enlace no protege nada**. La defensa real son tres
capas en el servidor:

1. **`RequirePermission` en cada endpoint.** Un hotel que escriba
   `/api/treasury/summary` a mano recibe 403, no datos.
2. **Filtro por hotel en el repositorio, no en el router.** Así un endpoint
   nuevo no puede olvidarse de restringir el alcance: la consulta ya sale
   limitada de origen.
3. **Filtrado de listados que parecen inocentes.** El catálogo de hoteles trae
   la participación negociada con cada entidad, y los convenios pueden ser
   exclusivos de uno: a un usuario de hotel se le devuelve solo su propia
   entidad y los convenios generales más los suyos. El padrón PGA es una lista
   de personas identificables, así que se restringe a quien valida en mostrador
   o lo administra.

Cambiar el alcance de un rol se hace en **un solo archivo**,
`app/core/permissions.py`; el menú, los guards y los endpoints se ajustan
solos. `verificar_roles.py` comprueba las tres capas atacando los endpoints
con cada perfil.

---

## Modelo de datos

**catalog** · `hotels` (comisión por hotel, no global) · `rate_plans` (con
vigencia) · `additional_services` · `discount_codes` · `pga_benefit_config` ·
`pga_credentials` · `course_schedule_config` · `exchange_rates` (histórico
inmutable) · `system_settings`

**booking** · `tee_slots` (UNIQUE de franja) · `reservations` (TC y comisión
congelados) · `reservation_players` (PGA y llegada por jugador) ·
`reservation_companions` (no consumen cupo) · `reservation_services`

**billing** · `payments` (moneda, monto original, TC aplicado, equivalente MXN)

**treasury** · `cash_sessions` · `hotel_settlements`

**events** · `course_events` · **audit** · `audit_logs` · **identity** · `users`

### Estados de la reserva

```
PENDIENTE → CONFIRMADA → CHECK_IN → EN_JUEGO → COMPLETADA
    ↓           ↓            ↓
CANCELADA   CANCELADA    CANCELADA
    ↓           ↓
 NO_SHOW     NO_SHOW
```

Las transiciones viven en `booking/state_machine.py`. Ningún servicio cambia el
estado a mano. `VALIDATED` y `CONFIRMED` del README original se colapsaron en
`CONFIRMADA`: no había un paso operativo real entre ambos.

En el mostrador, al quedar pagada la cuenta completa, la partida pasa sola a
`EN_JUEGO` y ya no se modifica (llegadas, PGA y servicios quedan bloqueados).
El último paso es **Salida del campo**, con dos caminos: *Finalizar*
(`COMPLETADA`, se muestra como "Finalizado") o *Replay*.

**Lo que ve el hotel.** Solo cuatro estados, traducidos en el servidor:

| Estado real                         | El hotel ve     |
|-------------------------------------|-----------------|
| PENDIENTE, CONFIRMADA, CHECK_IN     | Pendiente       |
| EN_JUEGO, COMPLETADA                | Confirmada      |
| CANCELADA                           | Cancelada       |
| NO_SHOW                             | No se presentó  |

**Replay.** Es un segundo ticket del mismo folio (`replay_tickets`), cobrado
exacto a un precio fijo por partida ($1,200), sin PGA ni descuentos. Al pedirlo se
elige la salida: solo se ofrecen horarios de ese mismo día, posteriores a la
partida y completamente libres (con `RESPETAR_HORARIOS=true`, además, que no
hayan pasado). La salida elegida queda ocupada por el replay. Si ya no queda
ninguna, el replay no se puede jugar.

**Cobro y cambio.** Nunca se cobra de menos. Tarjeta y transferencia se cobran
exactas; en efectivo se puede recibir de más y el sistema calcula el cambio.
El pago guarda lo recibido (`amount_mxn`) y el cambio entregado (`change_mxn`);
lo que se aplica a la cuenta es la diferencia, y la caja descuenta el cambio
del efectivo. Recibo y ticket imprimen las dos cifras.

**PGA.** El descuento se aplica solo a la tarifa de la persona con credencial,
nunca al total del ticket. El porcentaje (75% de fábrica) se cambia desde
Control del sistema → Beneficio PGA.

**IVA.** Los precios del catálogo ya lo traen incluido. Solo se desglosa en el
ticket y el recibo del mostrador (subtotal sin IVA + IVA 16%); el hotel ve el
total general y el ticket del replay no lo desglosa.

**Los horarios se abren en orden.** Solo se vende la salida más próxima con
lugar. Cuando se llena —o cuando pasa su hora— se abre la siguiente, así que
el campo se ocupa de corrido y no quedan huecos. Las demás salidas aparecen
como "espera su turno". Con `RESPETAR_HORARIOS=false` también se ofrecen las
que ya pasaron.

**Carritos y caddies.** El club tiene 20 carritos de dos personas y 2 caddies
(se cambian en Control del sistema). El carrito no se elige: sale de cuánta
gente va, contando acompañantes, y aparece en el ticket como incluido. Si un
día se acaban los carritos, ese día deja de recibir reservas; si se acaban los
caddies, las siguientes partidas salen sin caddie. Los dos se liberan cuando
la partida que los tiene se marca como finalizada.

**Duración de la partida.** Se mide del pago (cuando sale al campo) al cierre.
El promedio aparece en el panel del campo, en Finanzas y en Solicitudes.

**Solicitudes del día.** Pantalla del mostrador con lo que mandaron los
hoteles. Pasada la hora de salida, desde ahí se marca "no se presentó" o se
cancela, para que el hotel deje de verla pendiente. Antes de su hora el
servidor rechaza esa marca. Sus pagos llevan `replay_id`, así que
no tocan el total ni el saldo del ticket original. Entra a la caja del día y a
la venta total del campo, pero no a la venta de ningún hotel: no genera
comisión y el hotel no lo ve.

**Acompañantes.** No juegan, pero pagan $800 cada uno. El cargo se genera solo
desde la reserva del hotel (servicio `ACOMPANANTE`) y se muestra junto a los
jugadores, no como servicio del mostrador. En el mostrador su llegada se marca
igual que la de un jugador: quien no llega no se cobra.

**Comisión.** Se calcula solo sobre el green fee (ya con PGA y convenio):
`total − servicios`. Caddies, bastones y acompañantes pasan completos al campo,
como indica la hoja de costeo.

### Reglas de modalidad y cupo

| Paquete | Jugadores | Cómo ocupa la salida |
|---|---|---|
| Individual | 1 | Toma la salida completa |
| Grupo | 2 a 4 | Toma la salida completa |
| Partida abierta | 1 a 4 | Comparte salida con otras partidas abiertas |

**Una salida la toma una sola partida.** Si un hotel reserva las 10:30, ese
horario deja de ofrecerse a los demás aunque vayan dos jugadores y el campo
admita cuatro: el club no junta grupos que no se conocen en el mismo tee time.
La partida abierta es la excepción y existe justamente para emparejar
jugadores de distintos hoteles.

Un solo campo: **9 o 18 hoyos es una opción de la reserva**, no una salida
distinta. Los acompañantes no ocupan lugar ni pagan green fee, y los menores de
16 años toman tarifa infantil automáticamente aunque el hotel los registre como
adultos.

---

## API

Documentación interactiva en `/docs` (Swagger) y `/redoc`.

| Prefijo | Contenido |
|---|---|
| `/api/auth` | Login y sesión |
| `/api/users` | Gestión de usuarios |
| `/api/catalog` | Hoteles, tarifas, servicios, convenios, PGA, horarios, TC |
| `/api/booking` | Disponibilidad, cotización, reservas y transiciones |
| `/api/checkin` | Identificación y check-in con cobro |
| `/api/treasury` | Caja, arqueo, liquidaciones, resumen financiero y auditoría PGA |
| `/api/events` | Eventos y bloqueos |
| `/api/audit` | Bitácora |
| `/api/dashboard` | Indicadores operativos |
| `/api/ws` | Canal WebSocket (token por query string) |
| `/api/realtime/status` | Diagnóstico de conexiones activas |

---

## Enseñar el sistema por un túnel (ngrok)

Para que alguien de fuera entre al sistema que corre en su máquina, **basta con
un túnel al 5173**. El navegador nunca habla directo con el backend: pide
`/api` al mismo dominio y Vite lo reenvía al 8000 desde el servidor. Por eso no
hace falta publicar el backend ni pelear con CORS.

**1. Decirle a Vite cuál es el dominio.** En `frontend/.env`:

```bash
VITE_PUBLIC_HOST=su-dominio.ngrok.app
```

Sin esto Vite responde `Blocked request. This host is not allowed.` — rechaza
a propósito todo encabezado `Host` que no reconoce, para que un sitio ajeno no
pueda apuntar a su servidor local. La misma variable arregla el recargado en
caliente, que si no intenta abrir `ws://su-dominio:5173` y deja la página
recargándose sola.

**2. Instalar ngrok**, si no está.

La forma que menos problemas da es bajar el ejecutable de
`https://ngrok.com/download` y dejar el `ngrok.exe` en la raíz del proyecto.
No instala nada, no toca el `PATH` y se invoca con `.\ngrok.exe`. Además así se
obtiene la versión actual.

También existe `winget install ngrok.ngrok`, pero reparte una versión vieja
(3.3.x) y avisa —en una línea fácil de pasar por alto— que hay que **cerrar y
volver a abrir la terminal** para que reconozca el comando: el `PATH` de una
ventana ya abierta no se actualiza sola. En macOS: `brew install ngrok`.

Conviene comprobar qué versión quedó, porque de eso depende la sintaxis del
archivo de configuración del paso siguiente:

```powershell
ngrok version
```

**3. Registrar la llave**, una sola vez por equipo:

```powershell
ngrok config add-authtoken SU-AUTHTOKEN
```

**4. Levantar las tres piezas**, cada una en su terminal:

```powershell
cd backend  ; uvicorn app.main:app --reload     # 8000
cd frontend ; npm run dev                       # 5173
ngrok http --domain=su-dominio.ngrok.app 5173
```

Eso es todo: el `ngrok.example.yml` de la raíz es opcional, para no repetir
banderas. Si se usa, se copia como `ngrok.yml` —está en `.gitignore` porque
lleva la llave— y se arranca **desde la raíz del proyecto**, no desde
`frontend/`:

```powershell
ngrok start --config ngrok.yml las-parotas
```

El ejemplo trae el formato clásico (`version: "2"` con `tunnels:`), que
entienden todos los agentes de la serie 3. Si su versión es 3.19 o más nueva
puede usar el formato con `endpoints:` que viene comentado al final del mismo
archivo; si usa el nuevo con un agente viejo, el arranque falla con un error
de parseo del YAML.

**Si los correos con QR van a salir**, en `backend/.env`:

```bash
QR_BASE_URL=https://su-dominio.ngrok.app/pase
```

Si no, el huésped recibe un enlace que apunta a la computadora de usted.

**Esto es para enseñar el sistema, no para operarlo.** El túnel vive mientras
la máquina esté encendida, y `npm run dev` es el servidor de desarrollo: sin
compilar, sin caché y sin límites de petición. Para operación real va lo de la
siguiente sección.

---

## Despliegue

El sistema está construido para desplegarse sin reescribir nada.

**Base de datos.** Cambiar `DATABASE_URL` a
`postgresql+psycopg://usuario:clave@host:5432/las_parotas`, descomentar
`psycopg` en `requirements.txt` y correr `alembic upgrade head`. No se toca
código: `DecimalMoney` pasa a `NUMERIC` nativo y `SELECT ... FOR UPDATE` se
activa solo.

**Backend.**

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Un solo trabajador por ahora: con `--workers` los avisos de tiempo real no
cruzarían entre procesos (ver la sección de tiempo real). Para este volumen un
proceso sobra; cuando haga falta más, primero va el canal de Redis.

El proxy inverso tiene que reenviar WebSockets. En Nginx:

```nginx
location /api/ws {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

**Frontend.**

```bash
npm run build     # genera dist/, servible desde cualquier CDN o Nginx
```

**Antes de salir a producción**

- [ ] `SECRET_KEY` nueva: `openssl rand -hex 32`
- [ ] `DEBUG=false` y `ENVIRONMENT=production`
- [ ] `CORS_ORIGINS` con el dominio real
- [ ] Cambiar las contraseñas sembradas
- [ ] HTTPS y proxy inverso
- [ ] SMTP configurado para el envío de pases
- [ ] Respaldos programados de la base
- [ ] Proxy inverso configurado para WebSockets (`Upgrade` y `Connection`)

---

## Lo que queda pendiente

Decisiones tomadas para esta versión, listas para retomarse:

- **Facturación.** Hoy es una bandera `¿desea factura? sí/no` con correo de
  contacto. El módulo queda preparado para CFDI 4.0 (RFC, régimen fiscal, uso
  de CFDI, código postal y timbrado con un PAC), pero no implementado.
- **Pase QR.** Es por partida: un escaneo trae la lista completa de jugadores y
  recepción marca quién llegó. Si más adelante se quiere un pase por persona, el
  modelo ya lo soporta (`reservation_players.arrived` es individual).
- **Correo.** El worker está escrito y probado; solo falta configurar SMTP.
- **Autenticación empresarial.** El módulo `identity` está aislado para que
  meter OIDC o SAML sea reemplazar su implementación, no reescribir permisos.
