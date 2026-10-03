/**
 * Lo que el sitio le pregunta al sistema.
 *
 * Son cinco rutas públicas, las únicas del sistema que no piden sesión:
 * el catálogo del campo, las salidas de un día, apartar, pagar y consultar.
 *
 * Si el sistema no responde, el sitio **no se cae**: la presentación, las
 * tarifas y el recorrido siguen funcionando con los datos de `campo.js`, y lo
 * único que se apaga es el formulario, con un aviso de que hay que llamar al
 * club. Un sitio que se queda en blanco porque el backend está dormido es peor
 * que uno que no deja reservar en ese momento.
 */
// Mismo dominio que el sistema: el servidor que entrega esta página es el
// que atiende la API, así que la ruta relativa basta y no hay nada que
// configurar al desplegar. En desarrollo, donde el sitio corre en su propio
// puerto, se apunta al backend con VITE_API=http://localhost:8000/api.
const BASE = import.meta.env.VITE_API || '/api';

class ErrorDelSistema extends Error {
  constructor(mensaje, { estado = 0, sinConexion = false } = {}) {
    super(mensaje);
    this.estado = estado;
    this.sinConexion = sinConexion;
  }
}

async function pedir(ruta, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opciones,
    });
  } catch {
    throw new ErrorDelSistema(
      'No pudimos conectar con el sistema de reservas.',
      { sinConexion: true },
    );
  }

  let cuerpo = null;
  try {
    cuerpo = await respuesta.json();
  } catch {
    cuerpo = null;
  }

  if (!respuesta.ok) {
    // El sistema contesta los errores de negocio con un mensaje escrito para
    // leerse tal cual; se respeta en vez de inventar otro aquí.
    const mensaje =
      cuerpo?.error?.message ||
      cuerpo?.detail?.[0]?.msg ||
      cuerpo?.detail ||
      'No se pudo completar la operación.';
    throw new ErrorDelSistema(mensaje, { estado: respuesta.status });
  }
  return cuerpo;
}

export const api = {
  /** Horario, tarifas, servicios y reglas. Se pide una vez al abrir. */
  campo: () => pedir('/public/campo'),

  /** Las salidas de un día. De las ocupadas solo se sabe que lo están. */
  disponibilidad: (fecha) => pedir(`/public/disponibilidad?fecha=${fecha}`),

  /** Lo que va a costar. Lo calcula el servidor, no esta pantalla.
   *
   * La tarifa que aplica sale de una cascada —franja de twilight, día de la
   * semana, modalidad, edad— y copiarla aquí en JavaScript significaría que el
   * día que el club mueva un precio, el sitio enseñaría uno y Stripe cobraría
   * otro. Así que se pregunta y se pinta la respuesta.
   */
  cotizar: (cuerpo) =>
    pedir('/public/cotizacion', { method: 'POST', body: JSON.stringify(cuerpo) }),

  /** Aparta la salida mientras el huésped paga. Devuelve folio y vencimiento. */
  apartar: (cuerpo) =>
    pedir('/public/reservas', { method: 'POST', body: JSON.stringify(cuerpo) }),

  /** Abre la página de pago de Stripe. Devuelve a dónde mandar al huésped. */
  checkout: (folio) =>
    pedir(`/public/reservas/${folio}/checkout`, { method: 'POST' }),

  /** El cobro de mentiras, solo para desarrollar sin Stripe configurado. */
  pagarSimulado: (folio, tarjeta) =>
    pedir(`/public/reservas/${folio}/pago`, {
      method: 'POST',
      body: JSON.stringify(tarjeta),
    }),

  estado: (folio) => pedir(`/public/reservas/${folio}`),
};

export { ErrorDelSistema };
