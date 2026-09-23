/** Formateo de dinero, fechas y etiquetas. */

export function mxn(value) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(number);
}

export function usd(value) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(number);
}

/** Convierte MXN a USD con el TC operativo, solo para mostrar equivalencia. */
export function toUsd(amountMxn, rate) {
  if (!rate || Number(rate) === 0) return usd(0);
  return usd(Number(amountMxn) / Number(rate));
}

/**
 * Una fecha sola ("2026-09-20") se lee en la zona del navegador y no en UTC,
 * porque si no, en México se vería el día anterior. Una fecha CON hora ya trae
 * su propio instante y se usa tal cual: pegarle "T00:00:00" la rompía.
 */
function aFecha(value) {
  if (typeof value !== 'string') return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : aInstante(value);
}

/**
 * Una fecha con hora que manda el servidor está en UTC aunque no lo diga: la
 * base la guarda así y la API la envía sin zona horaria. Si se lee tal cual,
 * el navegador la toma como hora de México y todo sale seis horas corrido
 * (un movimiento de las 8:29 p.m. aparecía a las 2:29 a.m. del día siguiente).
 * Aquí se le pone la "Z" que le falta; si ya trae zona, se respeta.
 */
function aInstante(value) {
  if (typeof value !== 'string') return new Date(value);
  const conHora = /\d{2}:\d{2}/.test(value);
  const conZona = /(Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
  if (!conHora || conZona) return new Date(value);
  return new Date(`${value.trim().replace(' ', 'T')}Z`);
}

export function fecha(value) {
  if (!value) return '—';
  const date = aFecha(value);
  if (Number.isNaN(date?.getTime?.())) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function fechaCorta(value) {
  if (!value) return '—';
  const date = aFecha(value);
  if (Number.isNaN(date?.getTime?.())) return '—';
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' }).format(date);
}

export function fechaHora(value) {
  if (!value) return '—';
  const date = aInstante(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function hora(value) {
  if (!value) return '—';
  return String(value).slice(0, 5);
}

/**
 * Una fecha como "2026-09-21" en la hora del navegador. toISOString() la da en
 * UTC, y en México a partir de las 6 de la tarde eso ya es el día siguiente:
 * "hoy" terminaba mostrando lo de mañana.
 */
export function fechaLocal(d = new Date()) {
  const dia = new Date(d);
  const m = String(dia.getMonth() + 1).padStart(2, '0');
  const n = String(dia.getDate()).padStart(2, '0');
  return `${dia.getFullYear()}-${m}-${n}`;
}

export function hoy() {
  return fechaLocal();
}

/** Estados de reserva con la variante de etiqueta que define DESIGN.md. */
export const ESTADO_RESERVA = {
  PENDIENTE: { label: 'Pendiente', variant: 'pendiente' },
  CONFIRMADA: { label: 'Confirmada', variant: 'ok' },
  CHECK_IN: { label: 'En mostrador', variant: 'recibido' },
  EN_JUEGO: { label: 'En juego', variant: 'ok' },
  COMPLETADA: { label: 'Finalizado', variant: 'final' },
  CANCELADA: { label: 'Cancelada', variant: 'cancelado' },
  NO_SHOW: { label: 'No se presentó', variant: 'pendiente' },
};

/** Los tres paquetes del club. */
export const MODALIDAD = {
  INDIVIDUAL: 'Individual',
  GRUPO: 'Grupo',
  PARTIDA_ABIERTA: 'Partida abierta',
};

export const ROL = {
  SUPER_ADMIN: 'Administrador General',
  ADMIN_OPERACIONES: 'Dirección de Operaciones',
  RECEPCION: 'Recepción',
  HOTEL: 'Hotel Asociado',
};

export const METODO_PAGO = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
};

/**
 * IVA. Los precios del catálogo ya lo traen incluido: aquí solo se desglosa,
 * y únicamente en el ticket y el recibo del mostrador. El hotel ve el total
 * general y el replay no lleva desglose.
 */
export const TASA_IVA = 16;

export function desgloseIva(total) {
  const bruto = Number(total) || 0;
  const base = Number((bruto / (1 + TASA_IVA / 100)).toFixed(2));
  return { base, iva: Number((bruto - base).toFixed(2)) };
}
