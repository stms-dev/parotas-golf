# Sitio público · Las Parotas

La página de presentación del club, con el formulario de reserva para el
público general. Vive aparte del sistema de operación a propósito (ver abajo).

## Correrlo en local

El sitio solo necesita el sistema para reservar. Para ver la presentación
basta con esto:

```bash
cd sitio
npm install
npm run dev
```

Se abre en <http://localhost:5180>. Si el sistema no está corriendo, todo se
ve igual y lo único que se apaga es el formulario, con un aviso.

**Para probar la reserva completa** hacen falta los dos, en dos terminales:

```bash
# terminal 1 — el sistema, con el cobro simulado prendido
cd backend
PAGOS_SIMULADOS=true uvicorn app.main:app --reload

# terminal 2 — el sitio
cd sitio
npm run dev
```

Tarjetas para probar el cobro:

| Número | Qué pasa |
| --- | --- |
| 4242 4242 4242 4242 | Aprobada |
| 5555 5555 5555 4444 | Aprobada (Mastercard) |
| 4000 0000 0000 0002 | Rechazada por el banco |
| 4000 0000 0000 9995 | Fondos insuficientes |

Son las mismas que publica Stripe, a propósito: el día que se conecte la
pasarela de verdad, nadie tiene que aprenderse otros números.

Para ver la versión compilada, como queda publicada:

```bash
npm run build
npm run preview
```

## Cómo se recorre

No hay secciones apiladas ni carrusel. Hay un campo dibujado y **cinco paradas
sobre el recorrido**: La salida, El campo, Tarifas, Reservar y Casa club. Al
elegir una, la bola viaja por el trazo hasta su hoyo y el panel cambia. También
se puede tocar cualquiera de los 18 hoyos, en el mapa o en la tarjeta, para
mirarlo sin perder el panel donde se iba. Con las flechas ← → se salta de
parada en parada.

La página nunca crece: lo que se desplaza es el panel, no el sitio.

## Qué es de verdad y qué todavía no

**De verdad:**

- Las tarifas: son las de la hoja de costeo del club.
- Las reglas de reserva: cuatro jugadores mínimo para tomar la salida completa,
  menos de cuatro entran a una partida abierta, twilight desde las 14:00,
  cierre de campo a las 18:00, y el caddie que **no cobra el club** porque se le
  paga directo a él.
- El horario: salidas de 7:00 a 15:00 cada media hora.

**Ya conectado al sistema:**

- Las salidas que se ofrecen salen del tee sheet de verdad. Si el campo tiene
  un torneo, o alguien acaba de reservar, aquí se ve.
- La reserva cae en el sistema con su folio, como "Público general" y sin
  comisión — igual que las que levanta recepción en el mostrador.
- Mientras el huésped teclea su tarjeta, la salida le queda **apartada** unos
  minutos, con el reloj a la vista. Si no paga, se cancela sola y el horario
  vuelve a la venta.

**Todavía no:**

- El cobro es simulado. Valida la tarjeta como lo haría una pasarela de
  verdad, pero no mueve un peso. Va apagado salvo que se prenda a mano.
- Solo está el español. El cambio a inglés está en el pie, apagado.
- No hay fotos del campo. Eso es a propósito mientras no haya material: el
  lugar donde van es la tarjeta de hoyos, una por hoyo, clavada donde
  pertenece.

## Dónde se conecta con el sistema

`src/datos/api.js` llama a las cinco rutas públicas del sistema — las únicas
que no piden sesión:

| Ruta | Para qué |
| --- | --- |
| `GET /api/public/campo` | horario, tarifas, servicios y reglas |
| `GET /api/public/disponibilidad?fecha=` | las salidas del día |
| `POST /api/public/reservas` | aparta la salida |
| `POST /api/public/reservas/{folio}/pago` | cobra |
| `GET /api/public/reservas/{folio}` | cómo va |

`src/datos/campo.js` se queda con lo que no cambia —el trazo de los 18 hoyos,
los textos— y con una copia de las tarifas que sirve de respaldo cuando el
sistema no contesta, para que la presentación no dependa de que el servidor
esté despierto.

Las reglas del negocio no se repiten en el sitio: el mínimo de cuatro, el cupo
de la partida abierta, el twilight y el caddie que no se cobra los aplica el
sistema al apartar. Aquí solo se explican.

## Por qué es un proyecto aparte

Aunque se despliegan juntos, el sitio y el sistema se compilan por separado, y
eso es lo que importa: el visitante que viene a ver el campo no carga las
pantallas de operación, que pesan tres veces más y no le sirven de nada.

También se ven distintos a propósito. El sistema se mira ocho horas al día en
la pantalla de una caseta y está hecho para no cansar; esto se mira dos minutos
desde un celular en un aeropuerto y tiene que dar ganas de jugar. Misma marca,
registros distintos.

Queda así:

```
parotasgolf.com            → este sitio
parotasgolf.com/sistema    → el sistema de operación
parotasgolf.com/api        → la API, que atiende a los dos
```

Son dos compilaciones distintas servidas por el mismo contenedor, no una sola
partida en dos: quien entra a ver el campo baja los 57 KB de este sitio y nada
más. El sistema pesa tres veces eso y no se carga hasta que alguien le pica a
Acceder.

Un solo dominio significa además que no hay peticiones entre orígenes
distintos: el formulario llama a `/api/public/...` y ya.

## El trazo del campo

Los 18 hoyos están en `HOYOS`, dentro de `src/datos/campo.js`: cada uno con su
salida, su green, una curva y su par. Suma par 72, que es el del campo. **El
trazo es una interpretación para la pantalla, no el plano topográfico.** Para
ajustarlo al real basta mover esas coordenadas: el mapa, los números, el viaje
de la bola y la tarjeta se recalculan solos.
