/**
 * Todo lo que el sitio sabe del campo, en un solo archivo.
 *
 * Hoy son datos escritos a mano para poder ver la página sin levantar nada
 * más. Cuando se conecte, **este es el único archivo que cambia**: las
 * tarifas salen de `/api/catalog/rates`, las salidas de
 * `/api/booking/availability`, y la reserva se manda a `/api/booking/...`.
 * Ninguna pantalla lee precios ni reglas por su cuenta, justamente para que
 * el sitio y el sistema nunca digan cosas distintas.
 */

// --------------------------------------------------------------- el recorrido
/**
 * El campo, trazado de la foto aérea del club.
 *
 * Esto ya no es una interpretación: la silueta, los cuerpos de agua y la
 * posición de los 18 hoyos salieron de la lámina oficial del campo, medidas
 * sobre la imagen. El sistema de coordenadas es el de esa lámina —de ahí los
 * números grandes— y el viewBox de abajo la encuadra.
 *
 * Es un campo largo y angosto, casi tres veces y media más alto que ancho:
 * sube por un cañón hasta la laguna del hoyo 4 y baja abriéndose en dos
 * dedos al sur. Por eso el mapa vive en una columna delgada, no en media
 * pantalla — estirarlo para llenar un hueco sería dibujar otro campo.
 */
export const VISTA = { x: 420, y: 70, ancho: 424, alto: 1396 };

/** El contorno del campo. */
export const SILUETA =
  "M565 88L536 105L524 130L533 215L515 288L520 318L562 405L563 423L543 435L519 472L513 513L535 543L578 563L622 632L622 647L576 680L558 712L558 761L568 791L587 816L587 830L551 835L524 860L516 877L520 930L504 971L509 1014L534 1036L578 1051L579 1067L465 1243L440 1319L437 1363L460 1415L491 1447L533 1439L551 1416L573 1359L609 1310L635 1214L650 1198L668 1197L686 1226L689 1388L714 1419L756 1439L817 1374L826 1319L817 1296L811 1196L792 1142L778 1064L751 988L723 957L748 849L727 724L748 676L754 512L731 469L665 430L663 397L641 343L637 288L687 188L684 154L667 130L626 102Z";

/** La laguna del 4 y los tres estanques de en medio. */
export const AGUA = [
  "M542 136L545 163L561 178L590 175L600 180L655 180L664 175L659 145L622 118L601 116L590 108L569 108L554 112Z",
  "M673 689L648 683L633 691L636 735L631 739L607 737L605 749L614 762L633 768L656 755Z",
  "M684 784L664 784L657 792L657 806L666 827L683 825L692 818L695 799Z",
  "M655 851L640 854L640 860L646 861L651 873L644 898L661 894L666 885L665 865Z",
];

/**
 * Los 18 hoyos en el orden en que se juegan, en su lugar real.
 *
 * El par de cada uno todavía no lo tenemos del club; la suma sí da 72, que es
 * la del campo. Cuando llegue la tarjeta buena se cambian estos números y
 * nada más se mueve.
 */
export const HOYOS = [
  { n: 1, par: 5, x: 720, y: 802 },
  { n: 2, par: 5, x: 712, y: 542 },
  { n: 3, par: 4, x: 556, y: 290 },
  { n: 4, par: 3, x: 610, y: 200 },
  { n: 5, par: 4, x: 622, y: 320 },
  { n: 6, par: 3, x: 562, y: 456 },
  { n: 7, par: 4, x: 624, y: 570 },
  { n: 8, par: 3, x: 604, y: 688 },
  { n: 9, par: 5, x: 626, y: 836 },
  { n: 10, par: 5, x: 614, y: 1076 },
  { n: 11, par: 4, x: 516, y: 1236 },
  { n: 12, par: 3, x: 488, y: 1394 },
  { n: 13, par: 4, x: 570, y: 1320 },
  { n: 14, par: 4, x: 654, y: 1156 },
  { n: 15, par: 3, x: 718, y: 1164 },
  { n: 16, par: 4, x: 716, y: 1292 },
  { n: 17, par: 5, x: 790, y: 1266 },
  { n: 18, par: 4, x: 750, y: 1064 },
];

/** La casa club: entre el 9 y el 10, que es donde está en la lámina. */
export const CASA_CLUB = [575, 980];

export const PAR_TOTAL = HOYOS.reduce((suma, h) => suma + h.par, 0); // 72

// ------------------------------------------------------------- las estaciones
/**
 * El sitio no tiene secciones apiladas: tiene paradas sobre el recorrido. Cada
 * una se ancla en un hoyo, y la bola viaja hasta ahí cuando se elige.
 */
/*
 * El nombre no vive aquí: vive en el diccionario. Si estuviera aquí, la barra
 * de arriba seguiría en español con la página en inglés —era justo lo que
 * pasaba—. Lo que se guarda es la clave con la que se busca.
 */
export const ESTACIONES = [
  { id: 'salida', hoyo: 1, clave: 'nav.inicio' },
  { id: 'campo', hoyo: 5, clave: 'nav.campo' },
  { id: 'tarifas', hoyo: 9, clave: 'nav.tarifas' },
  { id: 'reservar', hoyo: 14, clave: 'nav.reservar' },
  { id: 'casa', hoyo: 18, clave: 'nav.evento' },
];

// ----------------------------------------------------------------- el horario
export const HORARIO = {
  primera: '07:00',
  ultima: '15:00',
  intervalo: 30,
  cierre: '18:00',
  twilight: '14:00',
};

/** Las salidas del día, cada media hora de 7:00 a 3:00. */
export function salidasDelDia() {
  const lista = [];
  for (let minutos = 7 * 60; minutos <= 15 * 60; minutos += HORARIO.intervalo) {
    const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
    const mm = String(minutos % 60).padStart(2, '0');
    lista.push(`${hh}:${mm}`);
  }
  return lista;
}

export const esTwilight = (hora) => hora >= HORARIO.twilight;

// ----------------------------------------------------------------- las tarifas
/**
 * Las de la hoja de costeo del club. Entre semana es de lunes a jueves; de
 * viernes a domingo sube. Junior es menor de 16. Precios 2026.
 */
export const TARIFAS = {
  adulto18: { semana: 3600, fin: 4000 },
  adulto9: { semana: 2200, fin: 2500 },
  menor18: { semana: 1800, fin: 2000 },
  // Salidas de 2:00 a 3:00 pm, 18 hoyos.
  twilight18: { semana: 2700, fin: 3000 },
  // Vive en Huatulco y lo acredita con credencial. Solo entre semana: de
  // viernes a domingo paga como adulto.
  local18: { semana: 2500, fin: null },
};

export const EXTRAS = [
  {
    code: 'CADDIE',
    nombre: 'Caddie',
    precio: 600,
    // El club no lo cobra: el huésped le paga directo al caddie. El precio se
    // publica para que nadie llegue sin saber cuánto traer.
    pagoDirecto: true,
    nota: 'Se le paga directo al caddie. Hay dos por día y se asignan por orden de salida.',
  },
  {
    code: 'BASTONES',
    nombre: 'Renta de bastones',
    precio: 850,
    nota: 'Set básico de 10 bastones: putter, madera, driver y hierros. Uno por jugador.',
  },
  {
    code: 'ACOMPANANTE',
    nombre: 'Acompañante',
    precio: 800,
    nota: 'Para quien va en el carrito sin jugar.',
  },
  {
    code: 'PRACTICA',
    nombre: 'Zona de práctica',
    precio: 250,
    precioFin: 400,
    nota: '180 pelotas de práctica.',
  },
];

/** Lo que incluye el green fee. Las bebidas ya no van incluidas. */
export const INCLUIDO = ['Carrito compartido', 'Tarjeta de score', '10 tees', '50 pelotas de práctica'];

/**
 * Una lista escrita de verdad: comas y una conjunción antes del último.
 *
 * Unir con comas a secas daba «carrito compartido, agua, cerveza, refresco»,
 * que en una enumeración escrita se lee a medio terminar. La conjunción cambia
 * con el idioma —«y» o «and»—, así que viene de fuera.
 */
export const enLista = (cosas, union = 'y') => {
  const partes = cosas.map((c) => c.toLowerCase());
  if (partes.length < 2) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} ${union} ${partes[partes.length - 1]}`;
};

export const esFinDeSemana = (iso) => {
  const dia = new Date(`${iso}T12:00:00`).getDay(); // 0 domingo … 6 sábado
  return dia === 0 || dia === 5 || dia === 6;       // viernes a domingo
};

/** Green fee de un jugador, según el día y si es menor. */
export function greenFee({ fecha, hoyos = 18, menor = false }) {
  const col = esFinDeSemana(fecha) ? 'fin' : 'semana';
  if (menor) return hoyos === 18 ? TARIFAS.menor18[col] : null;
  return hoyos === 18 ? TARIFAS.adulto18[col] : TARIFAS.adulto9[col];
}

// ---------------------------------------------------------------- las reglas
/**
 * Las mismas que aplica el sistema. Se repiten aquí para poder enseñar la
 * página sin backend; al conectar, se leen de la API y esta copia se borra.
 */
export const REGLAS = {
  minimoGrupo: 4,
  cupoPartidaAbierta: 4,
  /** Quien va solo o de a tres entra a una partida abierta; de 4 en adelante,
   *  la salida es suya. El huésped no tiene que aprenderse estos nombres: la
   *  pantalla se lo dice en palabras. */
  modalidadPara: (jugadores) =>
    jugadores >= 4 ? 'GRUPO' : 'PARTIDA_ABIERTA',
};

/**
 * Los dos paquetes que se venden, con las mismas palabras que usa el
 * mostrador. Individual ya no se ofrece.
 *
 * El nombre y la explicación ya no viven aquí: están en el diccionario, bajo
 * `paquete.GRUPO` y `paquete.GRUPO.detalle`, porque son texto del sitio y el
 * sitio habla dos idiomas. Lo que queda es la `modalidad` —que es la palabra
 * que entiende el servidor, y esa no se traduce— y los límites de gente.
 *
 * Los límites los manda el servidor en /campo, para que el día que el club
 * cambie el mínimo de un grupo no haya que tocar dos lados. Lo que está abajo
 * es el respaldo para cuando el sistema no contesta.
 */
export const PAQUETES = [
  { modalidad: 'GRUPO', minimo: 4, maximo: 8 },
  { modalidad: 'PARTIDA_ABIERTA', minimo: 1, maximo: 4 },
];

export const CONTACTO = {
  telefono: '+52 958 583 0000',
  correo: 'reservas@parotasgolf.com',
  domicilio: 'Bahías de Huatulco, Oaxaca',
  // El sistema de reservas: hoteles con convenio y personal del club. Cuelga
  // del mismo dominio, así que basta la ruta: en producción el sitio y el
  // sistema los sirve el mismo servidor. En desarrollo se apunta al Vite del
  // sistema con VITE_SISTEMA=http://localhost:5173/sistema.
  acceso: import.meta.env.VITE_SISTEMA || '/sistema',
};

/** 1 USD = X MXN. En el sitio conectado sale de /api/catalog/exchange-rate. */
export const TIPO_CAMBIO = 17.2;

export const enDolares = (mxn) => Math.round(mxn / TIPO_CAMBIO);

export const pesos = (n) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

// ------------------------------------------------------------------ las fotos
/**
 * Las fotos del campo, tomadas por el fotógrafo del club.
 *
 * Están partidas en dos grupos porque cumplen dos oficios distintos:
 *
 * · **FONDOS** van detrás del contenido, difuminadas y oscurecidas. Nadie las
 *   mira de frente: dan atmósfera y tienen que dejar leer encima. Por eso
 *   pesan poco — el desenfoque se come cualquier detalle que tuvieran.
 * · **POR_HOYO** son la foto que se enseña al tocar un hoyo. Esas sí se miran,
 *   así que van a más resolución.
 *
 * El reparto de POR_HOYO es provisional: una foto por hoyo, en el orden en que
 * vinieron. Cuando el club las entregue identificadas, se reacomodan aquí y
 * ninguna pantalla se entera.
 */
const FONDOS_N = 49;
const HOYOS_N = 18;

export const FONDOS = Array.from(
  { length: FONDOS_N },
  (_, i) => `/fotos/fondo/${String(i + 1).padStart(2, '0')}.webp`,
);

export const POR_HOYO = Array.from(
  { length: HOYOS_N },
  (_, i) => `/fotos/hoyo/${String(i + 1).padStart(2, '0')}.webp`,
);

/** La foto que le toca a un hoyo. Siempre la misma para el mismo hoyo. */
export const fotoDelHoyo = (n) => POR_HOYO[(n - 1) % POR_HOYO.length];

/**
 * Las fotos que se enseñan de cada hoyo en la vista de El Campo.
 *
 * Cada hoyo tenía de dos a cuatro fotos en el paquete original; la primera fue
 * a `hoyo/` y las demás a `fondo/`. Este mapeo las reúne para que El Campo
 * pueda enseñar tres a la vez. El orden dentro de cada arreglo es el del
 * fotógrafo: la primera es la principal y las otras dos son los ángulos.
 *
 * Los hoyos 14 y 18 solo tienen dos fotos; ahí se repite la principal.
 */
const f = (n) => `/fotos/fondo/${String(n).padStart(2, '0')}.webp`;
const h = (n) => `/fotos/hoyo/${String(n).padStart(2, '0')}.webp`;

export const GALERIA_HOYO = {
  1:  [h(1),  f(1),  f(2)],
  2:  [h(2),  f(4),  f(5)],
  3:  [h(3),  f(7),  f(8)],
  4:  [h(4),  f(10), f(11)],
  5:  [h(5),  f(13), f(14)],
  6:  [h(6),  f(16), f(17)],
  7:  [h(7),  f(19), f(20)],
  8:  [h(8),  f(22), f(23)],
  9:  [h(9),  f(25), f(26)],
  10: [h(10), f(28), f(29)],
  11: [h(11), f(31), f(32)],
  12: [h(12), f(34), f(35)],
  13: [h(13), f(37), f(38)],
  14: [h(14), f(40), h(14)],  // solo dos fotos
  15: [h(15), f(41), f(42)],
  16: [h(16), f(44), f(45)],
  17: [h(17), f(46), f(47)],
  18: [h(18), f(49), h(18)],  // solo dos fotos
};

/**
 * Las cuatro fotos de portada.
 *
 * Ivan las eligió: hoyo 8 foto 2, hoyo 9 foto 3, hoyo 15 fotos 3 y 4. Son las
 * que más campo enseñan sin gente ni equipo en cuadro. Se muestran nítidas —sin
 * el desenfoque que llevan las demás— con un velo oscuro encima para que el
 * título se lea.
 */
export const FOTOS_HERO = [f(22), f(26), f(42), f(43)];
