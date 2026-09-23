/**
 * Cliente HTTP único.
 *
 * Todo pasa por aquí: el token, el manejo de errores del backend y la
 * expiración de sesión. Ningún componente hace fetch por su cuenta.
 */

const BASE_URL = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'las_parotas_token';
const USER_KEY = 'las_parotas_user';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  getUser: () => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  setUser: (user) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
};

/** Error con el mensaje que mandó el backend, no uno genérico. */
export class ApiError extends Error {
  constructor(message, status, code, detail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Nombre legible de cada campo que el servidor puede rechazar. Sin esto el
 * aviso diría "holder_email", que no le dice nada a quien está en el mostrador.
 */
const CAMPOS = {
  holder_email: 'el correo del titular',
  holder_name: 'el nombre del titular',
  holder_phone: 'el teléfono del titular',
  holder_room: 'la habitación',
  invoice_contact_email: 'el correo para la factura',
  full_name: 'el nombre del jugador',
  age: 'la edad',
  email: 'el correo',
  password: 'la contraseña',
  amount: 'el monto',
  quantity: 'la cantidad',
  players: 'los jugadores',
  companions: 'los acompañantes',
  tee_slot_id: 'el horario de salida',
  holes: 'los hoyos',
};

/** Lo que suele fallar, dicho en palabras de todos los días. */
const MOTIVOS = [
  [/valid email address/i, 'no tiene un formato válido'],
  [/string_too_short|at least (\d+) characters|too_short/i, 'es demasiado corto'],
  [/string_too_long|at most (\d+) characters|too_long/i, 'es demasiado largo'],
  [/field required|missing/i, 'hace falta'],
  [/greater than or equal|greater_than/i, 'es menor al mínimo permitido'],
  [/less than or equal|less_than/i, 'supera el máximo permitido'],
  [/not a valid integer|int_parsing/i, 'debe ser un número entero'],
  [/not a valid (number|decimal)|float_parsing|decimal_parsing/i, 'debe ser un número'],
];

/**
 * Traduce el 422 de Pydantic, que llega como una lista de objetos, a una frase.
 * Sin esto el aviso terminaba mostrando "[object Object]" y había que abrir la
 * consola para saber qué campo venía mal.
 */
function mensajeDeValidacion(detail) {
  if (!detail) return null;
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return null;

  const frases = detail.slice(0, 3).map((item) => {
    // loc viene como ['body', 'players', 0, 'full_name']: interesa el último
    // nombre de campo y, si lo hay, la posición dentro de la lista.
    const ruta = Array.isArray(item.loc) ? item.loc.filter((x) => x !== 'body') : [];
    const campo = [...ruta].reverse().find((x) => typeof x === 'string');
    const indice = ruta.find((x) => typeof x === 'number');

    const nombre = CAMPOS[campo] || (campo ? `el campo ${campo}` : 'un dato');
    const motivo = MOTIVOS.find(([patron]) => patron.test(item.msg || ''))?.[1];
    const posicion = indice !== undefined ? ` (${indice + 1}º)` : '';

    return motivo
      ? `Revise ${nombre}${posicion}: ${motivo}.`
      : `Revise ${nombre}${posicion}.`;
  });

  return [...new Set(frases)].join(' ');
}

async function request(path, { method = 'GET', body, params, auth = true } = {}) {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, value);
      }
    });
  }

  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(url.pathname + url.search, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch solo lanza cuando no hubo respuesta: el backend está apagado o
    // inalcanzable. Decirlo así ahorra media hora de buscar en el lugar
    // equivocado, que es lo que pasa con un "error inesperado" a secas.
    throw new ApiError(
      'No hay respuesta del servidor. Verifique que el backend esté corriendo ' +
        'en el puerto 8000.',
      0,
      'SIN_CONEXION',
    );
  }

  // Un 502/504 del proxy tampoco trae el JSON de la API: es el mismo caso.
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new ApiError(
      'El servidor no está respondiendo. Verifique que el backend esté corriendo.',
      response.status,
      'SIN_CONEXION',
    );
  }

  if (response.status === 401 && auth) {
    tokenStore.clear();
    window.location.href = '/login';
    throw new ApiError('Sesión expirada', 401, 'NO_AUTENTICADO');
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = payload.error || {};
    throw new ApiError(
      error.message || mensajeDeValidacion(payload.detail) || 'Ocurrió un error inesperado',
      response.status,
      error.code,
      error.detail,
    );
  }

  return payload;
}

/**
 * Descarga un archivo de la API (el PNG del pase) y devuelve una dirección
 * temporal para el <img>. No se puede poner la URL directa en el src: el
 * navegador no manda ahí el token de la sesión y la API respondería 401.
 */
async function descargar(path) {
  const token = tokenStore.get();
  const respuesta = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!respuesta.ok) throw new ApiError('No se pudo obtener el archivo', respuesta.status);
  return URL.createObjectURL(await respuesta.blob());
}

export const api = {
  get: (path, params) => request(path, { params }),
  post: (path, body, options) => request(path, { method: 'POST', body, ...options }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

// -------------------------------------------------------------- endpoints
export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }, { auth: false }),
  me: () => api.get('/auth/me'),
};

export const catalogApi = {
  hotels: (params) => api.get('/catalog/hotels', params),
  createHotel: (body) => api.post('/catalog/hotels', body),
  updateHotel: (id, body) => api.patch(`/catalog/hotels/${id}`, body),

  rates: (params) => api.get('/catalog/rates', params),
  createRate: (body) => api.post('/catalog/rates', body),
  updateRate: (id, body) => api.patch(`/catalog/rates/${id}`, body),

  services: (params) => api.get('/catalog/services', params),
  createService: (body) => api.post('/catalog/services', body),
  updateService: (id, body) => api.patch(`/catalog/services/${id}`, body),

  discounts: (params) => api.get('/catalog/discounts', params),
  createDiscount: (body) => api.post('/catalog/discounts', body),

  pgaConfig: () => api.get('/catalog/pga/config'),
  setPgaConfig: (body) => api.put('/catalog/pga/config', body),
  pgaCredentials: (params) => api.get('/catalog/pga/credentials', params),
  createPgaCredential: (body) => api.post('/catalog/pga/credentials', body),
  validatePga: (params) => api.get('/catalog/pga/validate', params),

  exchangeRate: () => api.get('/catalog/exchange-rate'),
  exchangeRateHistory: (params) => api.get('/catalog/exchange-rate/history', params),
  setExchangeRate: (body) => api.post('/catalog/exchange-rate', body),

  schedule: () => api.get('/catalog/schedule'),
  createSchedule: (body) => api.post('/catalog/schedule', body),
  updateSchedule: (id, body) => api.patch(`/catalog/schedule/${id}`, body),

  settings: () => api.get('/catalog/settings'),
  updateSetting: (key, value) => api.put(`/catalog/settings/${key}`, { value }),
};

export const bookingApi = {
  availability: (params) => api.get('/booking/availability', params),
  recursos: (params) => api.get('/booking/recursos', params),
  availabilityRange: (params) => api.get('/booking/availability/range', params),

  quote: (body) => api.post('/booking/reservations/quote', body),
  create: (body) => api.post('/booking/reservations', body),
  list: (params) => api.get('/booking/reservations', params),
  get: (id) => api.get(`/booking/reservations/${id}`),
  getByFolio: (folio) => api.get(`/booking/reservations/folio/${folio}`),
  getByQr: (token) => api.get(`/booking/reservations/qr/${token}`),
  update: (id, body) => api.patch(`/booking/reservations/${id}`, body),

  confirm: (id) => api.post(`/booking/reservations/${id}/confirm`),
  cancel: (id, reason) => api.post(`/booking/reservations/${id}/cancel`, { reason }),
  noShow: (id) => api.post(`/booking/reservations/${id}/no-show`),
  start: (id) => api.post(`/booking/reservations/${id}/start`),
  complete: (id) => api.post(`/booking/reservations/${id}/complete`),
};

export const checkinApi = {
  lookup: (params) => api.get('/checkin/lookup', params),
  perform: (id, body) => api.post(`/checkin/${id}`, body),
  replay: (id, body) => api.post(`/checkin/${id}/replay`, body),
  replaySlots: (id) => api.get(`/checkin/${id}/replay-slots`),
  enviarRecibo: (id, destino) =>
    api.post(`/correos/reserva/${id}/recibo${destino ? `?destino=${encodeURIComponent(destino)}` : ''}`),
};

export const treasuryApi = {
  currentCash: () => api.get('/treasury/cash/current'),
  openCash: (body) => api.post('/treasury/cash/open', body),
  closeCash: (id, body) => api.post(`/treasury/cash/${id}/close`, body),
  cashSessions: (params) => api.get('/treasury/cash', params),

  settlementPreview: (params) => api.get('/treasury/settlements/preview', params),
  settlements: (params) => api.get('/treasury/settlements', params),
  generateSettlement: (params) => api.post(`/treasury/settlements?hotel_id=${params.hotel_id}&start=${params.start}&end=${params.end}`),
  settle: (id) => api.post(`/treasury/settlements/${id}/settle`),

  summary: (params) => api.get('/treasury/summary', params),
  pgaBenefits: (params) => api.get('/treasury/pga-benefits', params),
};

export const eventsApi = {
  list: (params) => api.get('/events', params),
  create: (body) => api.post('/events', body),
  release: (id) => api.post(`/events/${id}/release`),
};

export const inventoryApi = {
  items: (params) => api.get('/inventory/items', params),
  summary: () => api.get('/inventory/summary'),
  create: (body) => api.post('/inventory/items', body),
  update: (id, body) => api.patch(`/inventory/items/${id}`, body),
  move: (id, body) => api.post(`/inventory/items/${id}/movements`, body),
  movements: (id) => api.get(`/inventory/items/${id}/movements`),
};

export const auditApi = {
  list: (params) => api.get('/audit', params),
};

export const dashboardApi = {
  get: (params) => api.get('/dashboard', params),
};

export const usersApi = {
  list: (params) => api.get('/users', params),
  create: (body) => api.post('/users', body),
  update: (id, body) => api.patch(`/users/${id}`, body),
};

/** Correos que manda el club: el pase con QR y el recibo del cobro. */
export const correosApi = {
  bandeja: (params) => api.get('/correos', params),
  deLaReserva: (id) => api.get(`/correos/reserva/${id}`),
  reenviarPase: (id, destino) =>
    api.post(`/correos/reserva/${id}/pase${destino ? `?destino=${encodeURIComponent(destino)}` : ''}`),
  enviarRecibo: (id, destino) =>
    api.post(`/correos/reserva/${id}/recibo${destino ? `?destino=${encodeURIComponent(destino)}` : ''}`),
  reintentar: (correoId) => api.post(`/correos/${correoId}/reintentar`),
  /** Imagen del pase, ya autenticada, lista para un <img src>. */
  qr: (reservationId) => descargar(`/correos/reserva/${reservationId}/qr.png`),
};
