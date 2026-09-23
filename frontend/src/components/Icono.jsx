/**
 * Iconos del sistema, dibujados en línea.
 *
 * Se usan SVG propios en vez de una fuente de iconos remota a propósito: el
 * sistema opera en la caseta del campo, donde la red puede fallar, y una
 * fuente que no carga deja la pantalla llena de palabras sueltas en lugar de
 * símbolos. Así el icono siempre se ve.
 */

const TRAZOS = {
  hotel: 'M3 18V6M3 10h12a3 3 0 0 1 3 3v5M3 18h18M7.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  add: 'M12 5v14M5 12h14',
  bandera: 'M5 21V4M5 4h11l-2 3.5L16 11H5',
  golf: 'M12 3v13M12 3l6 3-6 3M7 20h10',
  verificado: 'M9 12.5l2 2 4.5-4.5M12 3l2.4 1.7 2.9-.2.9 2.8 2.4 1.7-1 2.8 1 2.8-2.4 1.7-.9 2.8-2.9-.2L12 21l-2.4-1.7-2.9.2-.9-2.8L3.4 15l1-2.8-1-2.8 2.4-1.7.9-2.8 2.9.2Z',
  calendario: 'M7 3v3M17 3v3M3.5 9h17M4.5 6h15a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
  calendarioOk: 'M7 3v3M17 3v3M3.5 9h17M4.5 6h15a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM9 15l2 2 4-4',
  grupo: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM16 15c2.8 0 5.5 1.8 5.5 5',
  persona: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5',
  nodo: 'M12 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM19 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10.5 10.5 6.5 15M13.5 10.5l4 4.5',
  telefono: 'M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2C11 19.5 4.5 13 4.5 5.5a2 2 0 0 1 2-2Z',
  chat: 'M20 15a2 2 0 0 1-2 2H8l-4 3V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z',
  buscar: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  campana: 'M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9ZM10 18.5a2 2 0 0 0 4 0',
  desplegar: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  agenda: 'M7 3v3M17 3v3M3.5 9h17M4.5 6h15a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM8 13h3M8 17h8',
  masCirculo: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 8v8M8 12h8',
  registro: 'M4 20v-1.5C4 15.5 6.5 14 9.5 14s5.5 1.5 5.5 4.5V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16.5 12.5l2 2 4-4',
  pago: 'M3 9h18M4.5 6h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM7 14h3',
  ajustes:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.5 12c0-.6-.1-1.1-.2-1.6l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.8-1.6L13.8 2h-3.6l-.4 2.9c-1 .3-2 .9-2.8 1.6l-2.3-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3.2l-2 1.5 2 3.4 2.3-1c.8.7 1.8 1.3 2.8 1.6l.4 2.9h3.6l.4-2.9c1-.3 2-.9 2.8-1.6l2.3 1 2-3.4-2-1.5c.1-.5.2-1 .2-1.6Z',
  historial: 'M4 5v14h16V9l-4-4H4ZM15 5v4h4M7 13h8M7 16h6',
  martillo: 'M14.5 3.5 20 9M17 6l-9 9M6 21h9M4.5 15.5l3.5-3.5 2.5 2.5-3.5 3.5a1.8 1.8 0 0 1-2.5-2.5Z',
  enviar: 'M4 20l17-8L4 4l3 8-3 8ZM7 12h14',
  edificio: 'M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 11h5a1 1 0 0 1 1 1v9M4 21h18M7.5 8h3M7.5 12h3M7.5 16h3',
  escudo: 'M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3ZM9 12l2 2 4-4',
  cancelar: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 9l6 6M15 9l-6 6',
  check: 'M5 13l4 4L19 7',
  etiquetaPrecio:
    'M3 12.5V4.5a1 1 0 0 1 1-1h8l8.5 8.5a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0L3.5 13.2a1 1 0 0 1-.5-.7ZM7.5 8.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  arqueo: 'M3 20h18M5 20V9l7-5 7 5v11M9.5 20v-6h5v6M9 11.5h6',
  cajaFuerte:
    'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM11 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM11 12h.01M18 9v6',
  descarga: 'M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16',
  filtro: 'M4 5h16l-6.5 7.5V19l-3 2v-8.5L4 5Z',
  refrescar: 'M20 11a8 8 0 1 0-1.5 5.5M20 5v6h-6',
  llave: 'M14 10a4 4 0 1 0-3.5 4L12 15.5V18h2.5v2.5H17l1.5-1.5v-2.4l-4.3-4.3A4 4 0 0 0 14 10ZM15.5 7.5h.01',
  candado: 'M7 10V7.5a5 5 0 0 1 10 0V10M5.5 10h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM12 14v3',
  reloj: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2',
  tablero: 'M4 4h7v7H4V4ZM13 4h7v4h-7V4ZM13 10h7v10h-7V10ZM4 13h7v7H4v-7Z',
  correo: 'M3.5 6h17a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM3 7l9 6 9-6',
  qr: 'M4 4h6v6H4V4ZM14 4h6v6h-6V4ZM4 14h6v6H4v-6ZM14 14h3v3h-3v-3ZM20 17v3h-3',
  cerrarMenu: 'M4 6h16M4 12h10M4 18h16M19 9l-3 3 3 3',
  abrirMenu: 'M4 6h16M10 12h10M4 18h16M7 9l-3 3 3 3',
};

const ALIAS = {
  menu_open: 'cerrarMenu',
  menu: 'abrirMenu',
  account_balance_wallet: 'pago',
  dashboard_customize: 'tablero',
  download: 'descarga',
  filter_alt: 'filtro',
  key: 'llave',
  lock: 'candado',
  mail: 'correo',
  qr_code_2: 'qr',
  refresh: 'refrescar',
  savings: 'cajaFuerte',
  schedule: 'reloj',
  sell: 'etiquetaPrecio',
  storefront: 'arqueo',
  add: 'add',
  add_circle: 'masCirculo',
  apartment: 'edificio',
  calendar_month: 'agenda',
  calendar_today: 'calendario',
  call: 'telefono',
  chat: 'chat',
  check: 'check',
  event_available: 'calendarioOk',
  flag: 'bandera',
  gavel: 'martillo',
  golf_course: 'golf',
  groups: 'grupo',
  history_edu: 'historial',
  hotel: 'hotel',
  how_to_reg: 'registro',
  hub: 'nodo',
  notifications: 'campana',
  payments: 'pago',
  person: 'persona',
  phone_in_talk: 'telefono',
  search: 'buscar',
  send: 'enviar',
  settings_suggest: 'ajustes',
  sports_golf: 'golf',
  unfold_more: 'desplegar',
  verified: 'verificado',
  verified_user: 'escudo',
};

export default function Icono({ nombre, size = 18, className = '' }) {
  const trazo = TRAZOS[ALIAS[nombre] || nombre];
  if (!trazo) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d={trazo} />
    </svg>
  );
}
