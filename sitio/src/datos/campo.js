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
  { n: 1, par: 4, x: 720, y: 802 },
  { n: 2, par: 4, x: 712, y: 542 },
  { n: 3, par: 3, x: 556, y: 290 },
  { n: 4, par: 4, x: 610, y: 200 },
  { n: 5, par: 4, x: 622, y: 320 },
  { n: 6, par: 5, x: 562, y: 456 },
  { n: 7, par: 3, x: 624, y: 570 },
  { n: 8, par: 4, x: 604, y: 688 },
  { n: 9, par: 5, x: 626, y: 836 },
  { n: 10, par: 4, x: 614, y: 1076 },
  { n: 11, par: 4, x: 516, y: 1236 },
  { n: 12, par: 3, x: 488, y: 1394 },
  { n: 13, par: 5, x: 570, y: 1320 },
  { n: 14, par: 4, x: 654, y: 1156 },
  { n: 15, par: 4, x: 718, y: 1164 },
  { n: 16, par: 5, x: 716, y: 1292 },
  { n: 17, par: 3, x: 790, y: 1266 },
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
export const ESTACIONES = [
  { id: 'salida', hoyo: 1, nombre: 'Inicio', pie: 'Hoyo 1' },
  { id: 'campo', hoyo: 5, nombre: 'El campo', pie: 'Hoyo 5' },
  { id: 'tarifas', hoyo: 9, nombre: 'Tarifas', pie: 'La vuelta' },
  { id: 'reservar', hoyo: 14, nombre: 'Reservar', pie: 'Hoyo 14' },
  { id: 'casa', hoyo: 18, nombre: 'Casa club', pie: 'Hoyo 18' },
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
 * viernes a domingo sube. El menor es hasta 15 años.
 */
export const TARIFAS = {
  adulto18: { semana: 2800, fin: 4000 },
  adulto9: { semana: 1700, fin: 2200 },
  menor18: { semana: 1200, fin: 1500 },
  // El twilight todavía no tiene precio: el club lo está decidiendo. Mientras
  // no exista, esas salidas cobran la tarifa normal.
  twilight18: null,
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
    nota: 'Set básico: putter, madera, driver y hierros. Uno por jugador.',
  },
  {
    code: 'ACOMPANANTE',
    nombre: 'Acompañante',
    precio: 800,
    nota: 'Para quien va en el carrito sin jugar.',
  },
];

/** Carrito, agua, cerveza y refresco van incluidos en el green fee. */
export const INCLUIDO = ['Carrito compartido', 'Agua', 'Cerveza', 'Refresco'];

/**
 * Una lista en español de verdad: comas y una «y» antes del último.
 *
 * Unir con comas a secas daba «carrito compartido, agua, cerveza, refresco»,
 * que en una enumeración escrita se lee a medio terminar.
 */
export const enLista = (cosas) => {
  const partes = cosas.map((c) => c.toLowerCase());
  if (partes.length < 2) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
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
 * El nombre y la explicación viven aquí porque son texto del sitio; los
 * límites de gente los manda el servidor en /campo, para que el día que el
 * club cambie el mínimo de un grupo no haya que tocar dos lados. Lo que está
 * abajo es el respaldo para cuando el sistema no contesta.
 */
export const PAQUETES = [
  {
    modalidad: 'GRUPO',
    nombre: 'En Grupo',
    detalle: 'La salida es suya: arma su propio grupo y nadie más se les junta.',
    minimo: 4,
    maximo: 8,
  },
  {
    modalidad: 'PARTIDA_ABIERTA',
    nombre: 'Partida Abierta',
    detalle: 'Sale con los que se junten, hasta llegar a cuatro. Para cuando van menos.',
    minimo: 1,
    maximo: 4,
  },
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
const FONDOS_N = 19;
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
