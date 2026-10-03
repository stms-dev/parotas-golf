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
 * Los 18 hoyos como una ruta: cada uno va de su salida a su green, y entre el
 * green de uno y la salida del siguiente hay una caminata.
 *
 * El trazo es una interpretación para la pantalla, no el plano topográfico del
 * campo. Suma par 72, que es el del campo de verdad. Para ajustarlo al trazo
 * real basta mover estas coordenadas: el mapa, los números y el viaje de la
 * bola se recalculan solos.
 */
export const HOYOS = [
  // Ida: sale a la izquierda, sube por la ladera y vuelve por en medio.
  { n: 1, par: 4, salida: [470, 604], green: [368, 528], curva: [416, 548] },
  { n: 2, par: 4, salida: [348, 512], green: [198, 452], curva: [262, 478] },
  { n: 3, par: 3, salida: [180, 436], green: [132, 372], curva: [146, 404] },
  { n: 4, par: 4, salida: [126, 352], green: [172, 252], curva: [112, 298] },
  { n: 5, par: 4, salida: [190, 234], green: [310, 198], curva: [242, 196] },
  { n: 6, par: 5, salida: [330, 186], green: [470, 150], curva: [398, 152] },
  { n: 7, par: 3, salida: [492, 160], green: [528, 232], curva: [530, 188] },
  { n: 8, par: 4, salida: [516, 252], green: [416, 318], curva: [474, 306] },
  { n: 9, par: 5, salida: [400, 338], green: [462, 566], curva: [396, 470] },
  // Vuelta: abre a la derecha, sube al punto más alto y baja de frente.
  { n: 10, par: 4, salida: [524, 592], green: [640, 548], curva: [578, 580] },
  { n: 11, par: 4, salida: [662, 536], green: [762, 476], curva: [722, 520] },
  { n: 12, par: 3, salida: [782, 460], green: [836, 392], curva: [828, 434] },
  { n: 13, par: 5, salida: [850, 374], green: [820, 236], curva: [876, 306] },
  { n: 14, par: 4, salida: [804, 218], green: [690, 190], curva: [744, 190] },
  { n: 15, par: 4, salida: [668, 180], green: [588, 128], curva: [612, 142] },
  { n: 16, par: 5, salida: [570, 120], green: [628, 290], curva: [592, 206] },
  { n: 17, par: 3, salida: [636, 312], green: [580, 364], curva: [616, 350] },
  { n: 18, par: 4, salida: [562, 384], green: [508, 576], curva: [568, 482] },
];

/** La casa club, donde empieza y termina la vuelta. */
export const CASA_CLUB = [492, 614];

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

/** Carrito, aguas, cerveza y refresco van incluidos en el green fee. */
export const INCLUIDO = ['Carrito compartido', 'Agua', 'Cerveza', 'Refresco'];

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
    detalle: 'Sale con los que se junten, hasta llegar a cuatro. Van menos de cuatro.',
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
