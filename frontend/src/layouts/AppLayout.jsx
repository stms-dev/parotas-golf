/**
 * Cascarón institucional: barra lateral de 276px y navbar superior con
 * buscador, como en los mockups del sistema.
 */
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { EVENTOS, useRealtime, useRealtimeEvent } from '../context/RealtimeContext';
import { RealtimeIndicator, RealtimeToasts } from '../components/RealtimeIndicator';
import Icono from '../components/Icono';
import Logo from '../components/Logo';
import { bookingApi, catalogApi } from '../api/client';
import { ROL, fechaHora, hora, hoy } from '../utils/format';

/**
 * Menú lateral, con los nombres de los mockups. Un hotel solo ve las dos
 * primeras entradas porque son las únicas para las que tiene permiso.
 */
const NAV = [
  { to: '/', label: 'Panel & Agenda', icono: 'calendar_month', exact: true, permission: 'screen:panel' },
  { to: '/reservas/nueva', label: 'Nueva Reserva', icono: 'add_circle', permission: 'screen:new_reservation' },
  // Partidas se quedó también con el tablero de hoteles: era la misma lista
  // de reservas contada de otra forma.
  { to: '/reservas', label: 'Partidas & Hoteles', icono: 'historial', permission: 'screen:reservations' },
  { to: '/solicitudes', label: 'Solicitudes del día', icono: 'registro', permission: 'screen:requests' },
  { to: '/recepcion', label: 'Recepción & Check-In', icono: 'how_to_reg', permission: 'screen:checkin' },
  { to: '/finanzas', label: 'Liquidaciones', icono: 'payments', permission: 'screen:finance' },
  { to: '/inventario', label: 'Inventario', icono: 'storefront', permission: 'screen:inventory' },
  // Precios y Configuración eran dos pantallas con los mismos catálogos.
  { to: '/precios', label: 'Precios & Configuración', icono: 'sell', permission: 'screen:settings' },
];

/**
 * La Administración no trabaja el día: manipula el sistema. Su menú es otro,
 * corto a propósito, y no se mezcla con el de operación.
 */
const NAV_ADMIN = [
  { to: '/control', label: 'Control del sistema', icono: 'ajustes', exact: true },
  { to: '/inventario', label: 'Inventario', icono: 'storefront', permission: 'screen:inventory' },
  { to: '/auditoria', label: 'Auditoría', icono: 'history_edu', permission: 'screen:audit' },
];

export default function AppLayout() {
  const { user, logout, can, isHotel, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [rate, setRate] = useState(null);
  // El menú plegado se recuerda: quien trabaja con el tee sheet abierto no
  // quiere volver a cerrarlo en cada pantalla.
  const [plegado, setPlegado] = useState(
    () => localStorage.getItem('menu_plegado') === '1',
  );
  const [porLlegar, setPorLlegar] = useState(0);
  const [primeraSalida, setPrimeraSalida] = useState(null);

  /**
   * Partidas de hoy que todavía no pasan por el mostrador. Ya no se valida
   * nada a mano, así que el número del menú es el de gente por atender.
   */
  function contarPendientes() {
    if (!can('screen:reservations')) return;
    bookingApi
      .list({ slot_date: hoy(), limit: 200 })
      .then((lista) =>
        setPorLlegar(
          lista.filter((r) => ['PENDIENTE', 'CONFIRMADA'].includes(r.status)).length,
        ),
      )
      .catch(() => setPorLlegar(0));
  }

  useEffect(() => {
    if (isHotel) return;
    catalogApi.exchangeRate().then(setRate).catch(() => setRate(null));
    contarPendientes();
    bookingApi
      .availability({ slot_date: hoy() })
      .then((dia) => setPrimeraSalida(dia.slots[0]?.slot_time || null))
      .catch(() => setPrimeraSalida(null));
  }, [isHotel]);

  useRealtimeEvent([EVENTOS.TIPO_CAMBIO_ACTUALIZADO], (mensaje) => {
    if (isHotel) return;
    setRate((actual) => ({ ...(actual || {}), rate: mensaje.payload.nuevo }));
  });

  useRealtimeEvent(
    [
      EVENTOS.RESERVA_CREADA,
      EVENTOS.RESERVA_ACTUALIZADA,
      EVENTOS.RESERVA_CANCELADA,
      EVENTOS.CHECKIN_REGISTRADO,
    ],
    () => contarPendientes(),
  );

  function alternarMenu() {
    setPlegado((actual) => {
      localStorage.setItem('menu_plegado', actual ? '0' : '1');
      return !actual;
    });
  }

  const items = (isAdmin ? NAV_ADMIN : NAV)
    .filter((item) => !item.permission || can(item.permission))
    .map((item) =>
      item.to === '/' && isHotel ? { ...item, label: 'Panel del Hotel', icono: 'apartment' } : item,
    );

  return (
    <div className="flex min-h-screen">
      {/* ------------------------------------------------- barra lateral */}
      <aside
        className={`hidden shrink-0 flex-col border-r border-outline-variant/50 bg-surface-container-lowest transition-[width] duration-200 lg:flex ${
          plegado ? 'w-[68px]' : 'w-[276px]'
        }`}
      >
        <div
          className={`flex h-20 items-center gap-2 border-b border-outline-variant/40 ${
            plegado ? 'flex-col justify-center gap-1.5 px-1 py-2' : 'px-5'
          }`}
        >
          {/* Plegado el menú mide 68px: el árbol a 22px de alto ocupa unos 53
              de ancho y entra sin apretarse contra el botón. */}
          {plegado ? <Logo soloArbol alto={22} /> : <Logo alto={50} />}
          <button
            onClick={alternarMenu}
            title={plegado ? 'Expandir menú' : 'Contraer menú'}
            aria-label={plegado ? 'Expandir menú' : 'Contraer menú'}
            className="shrink-0 rounded border border-outline-variant p-1.5 text-outline transition hover:bg-surface-container-low hover:text-on-surface"
          >
            <Icono nombre={plegado ? 'abrirMenu' : 'cerrarMenu'} size={17} />
          </button>
        </div>

        {!plegado && (
          <div className="px-5 py-4">
            <div className="flex items-center justify-between rounded border border-outline-variant/50 bg-surface-container-low px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-label-sm uppercase tracking-wider text-outline">Portal</p>
                <p className="truncate text-title-md text-primary">
                  {isHotel ? 'Hotel Asociado' : ROL[user?.role] || user?.role}
                </p>
                {user?.hotel_name && (
                  <p className="truncate text-body-md text-on-surface-variant">{user.hotel_name}</p>
                )}
              </div>
              <Icono nombre="unfold_more" size={16} className="shrink-0 text-outline" />
            </div>
          </div>
        )}

        <nav className={`space-y-1 pb-6 ${plegado ? 'px-2 pt-3' : 'px-3'}`}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              // Plegado, el nombre vive en el title: es lo único que queda
              // para saber a dónde lleva cada icono.
              title={plegado ? item.label : undefined}
              className={({ isActive }) =>
                `relative flex items-center gap-3 rounded py-2.5 text-body-lg transition ${
                  plegado ? 'justify-center px-2' : 'px-3'
                } ${
                  isActive
                    ? 'bg-primary-container text-on-primary shadow-card'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icono
                    nombre={item.icono}
                    size={19}
                    className={isActive ? 'text-secondary-fixed' : 'text-outline'}
                  />
                  {!plegado && <span className="flex-1 whitespace-nowrap">{item.label}</span>}
                  {item.to === '/reservas' && porLlegar > 0 && (
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-label-sm ${
                        plegado
                          ? 'absolute -right-0.5 -top-0.5 bg-estado-pend-text text-white'
                          : isActive
                            ? 'bg-secondary-fixed text-primary'
                            : 'bg-estado-pend-bg text-estado-pend-text'
                      }`}
                    >
                      {porLlegar}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Pie del menú: a qué hora sale la primera partida del día. */}
        {!isHotel && !plegado && (
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-outline-variant/40 px-5 py-4 text-label-sm uppercase tracking-wider text-outline">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-estado-ok-text" /> Caddie master
            </span>
            <span className="font-mono text-on-surface-variant">
              {primeraSalida ? `${hora(primeraSalida)} tee` : '— tee'}
            </span>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ------------------------------------------------ navbar superior */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-6 border-b border-outline-variant/50 bg-surface-container-lowest px-8">
          <div className="flex min-w-0 flex-1 items-center gap-6">
            {/* Sin buscador global: cada pantalla busca lo suyo. El mostrador
                entra por folio o pase QR, y el hotel por su propia lista. */}
            <div className="hidden items-center gap-2 text-body-md text-on-surface-variant lg:flex">
              <Icono nombre="golf_course" size={16} className="text-outline" />
              <span className="whitespace-nowrap text-title-md text-primary">Campo Las Parotas</span>
              <span className="text-outline-variant">|</span>
              <span className="text-outline">Par 72</span>
              {rate && (
                <span className="rounded border border-outline-variant/50 bg-surface-container-low px-2.5 py-1 font-mono text-label-sm text-primary">
                  1 USD = ${Number(rate.rate).toFixed(2)} MXN
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-5">
            <RealtimeIndicator />
            <Campanita />
            <span className="h-5 w-px bg-outline-variant" />
            <div className="text-right">
              <p className="text-title-md leading-tight text-primary">{user?.full_name}</p>
              <p className="text-label-sm uppercase tracking-wider text-outline">
                {isHotel ? 'Hotel Asociado' : ROL[user?.role]}
              </p>
            </div>
            <button
              onClick={() => {
                logout();
                navigate('/login');
              }}
              className="rounded border border-outline-variant px-3 py-1.5 text-label-sm uppercase tracking-wider text-on-surface-variant transition hover:bg-surface-container-low"
            >
              Salir
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {/* El diseño original trabaja a ~1700px de contenido; con un tope más
              estrecho las tablas se recortan y sobra franja vacía a la derecha. */}
          <div className="mx-auto w-full max-w-[1720px]">
            <Outlet />
          </div>
        </main>

        <RealtimeToasts />
      </div>
    </div>
  );
}

/**
 * La campanita guarda lo que avisó el canal de tiempo real, por perfil: el
 * hotel ve lo de su hotel, el mostrador lo del mostrador. Abrirla marca todo
 * como leído.
 */
function Campanita() {
  const { notificaciones, noLeidas, marcarLeidas, limpiarNotificaciones } = useRealtime();
  const [abierta, setAbierta] = useState(false);
  const caja = useRef(null);

  useEffect(() => {
    if (!abierta) return undefined;
    function fuera(e) {
      if (caja.current && !caja.current.contains(e.target)) setAbierta(false);
    }
    function escape(e) {
      if (e.key === 'Escape') setAbierta(false);
    }
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierta]);

  function alternar() {
    setAbierta((actual) => {
      if (!actual) setTimeout(marcarLeidas, 1200);
      return !actual;
    });
  }

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={alternar}
        aria-label={noLeidas ? `Notificaciones · ${noLeidas} sin leer` : 'Notificaciones'}
        aria-expanded={abierta}
        className={`relative rounded p-1.5 transition hover:text-on-surface ${
          abierta ? 'bg-surface-container-low text-on-surface' : 'text-outline'
        }`}
      >
        <Icono nombre="notifications" size={20} />
        {noLeidas > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-estado-pend-text px-1 font-mono text-[10px] leading-none text-white">
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>

      {abierta && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-outline-variant/60 bg-surface-container-lowest shadow-lg">
          <div className="flex items-center justify-between border-b border-outline-variant/40 px-4 py-3">
            <p className="text-label-md uppercase tracking-wider text-primary">Notificaciones</p>
            {notificaciones.length > 0 && (
              <button
                type="button"
                onClick={limpiarNotificaciones}
                className="text-label-sm uppercase tracking-wider text-outline transition hover:text-on-surface"
              >
                Limpiar
              </button>
            )}
          </div>
          {notificaciones.length === 0 ? (
            <p className="px-4 py-8 text-center text-body-md text-outline">
              Sin notificaciones por ahora. Aquí quedan los avisos que lleguen.
            </p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-outline-variant/30 overflow-y-auto">
              {notificaciones.map((n) => (
                <li
                  key={n.id}
                  className={`flex gap-3 px-4 py-3 ${n.leida ? '' : 'bg-primary-fixed/20'}`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      n.leida ? 'bg-outline-variant' : 'bg-estado-ok-text'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-body-md text-on-surface">{n.texto}</p>
                    <p className="font-mono text-label-sm text-outline">{fechaHora(n.fecha)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
