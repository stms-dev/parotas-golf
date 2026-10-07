/**
 * Dashboard del Hotel — sigue el mockup `dashboard_del_hotel_desktop`.
 *
 * Estructura del diseño, de arriba hacia abajo:
 *   1. Banner del partner con la acción principal.
 *   2. Cuatro indicadores operativos (ninguna cifra de dinero).
 *   3. Rejilla de horarios con leyenda.
 *   4. Expedientes de reservas del hotel + canal directo con operaciones.
 *
 * La tabla no lleva columnas de pago ni de QR: el hotel solicita, el campo
 * cobra. Y de una salida ajena solo se sabe que está ocupada, nunca de quién.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { bookingApi, catalogApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Badge, Spinner } from '../components/ui';
import Icono from '../components/Icono';
import { esFinDeSemana, tarifaDelDia } from '../utils/tarifas';
import { ESTADO_RESERVA, MODALIDAD, fechaCorta, hora, hoy, mxn, fechaLocal, recorrido } from '../utils/format';

const FILTROS = [
  { key: 'todas', label: 'Todas' },
  { key: 'hoy', label: 'Hoy' },
  { key: 'proximas', label: 'Próximas' },
  { key: 'confirmadas', label: 'Confirmadas' },
];

/** Hasta dónde puede mirar el expediente hacia adelante. */
const LIMITE_MESES = 6;

export default function HotelPanelPage() {
  const { user } = useAuth();
  const [config, setConfig] = useState(null);
  const [tarifas, setTarifas] = useState([]);
  const [slots, setSlots] = useState([]);
  const [semana, setSemana] = useState([]);
  const [reservas, setReservas] = useState([]);
  // Las próximas se consultan aparte del expediente: el indicador de arriba
  // no puede depender del periodo que el usuario esté mirando abajo.
  const [proximas, setProximas] = useState([]);
  const [filtro, setFiltro] = useState('todas');
  const [folio, setFolio] = useState('');
  // Periodo del expediente. Vacío = sin límite, que es como entra la pantalla.
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const today = hoy();

  async function cargar(conSpinner = true) {
    if (conSpinner) setLoading(true);
    setError(null);
    try {
      const fin = new Date(`${today}T00:00:00`);
      fin.setDate(fin.getDate() + 6);
      const finDeSemana = fechaLocal(fin);

      const [configs, dia, rango, lista, precios] = await Promise.all([
        catalogApi.schedule(),
        bookingApi.availability({ slot_date: today }),
        bookingApi.availabilityRange({ start: today, end: finDeSemana }),
        // El periodo lo filtra el servidor: así el expediente puede mirar
        // hacia atrás sin traerse el histórico completo al navegador.
        bookingApi.list({
          limit: 200,
          date_from: desde || undefined,
          date_to: hasta || undefined,
          term: folio.trim() || undefined,
        }),
        catalogApi.rates(),
      ]);
      setConfig(configs[0] || null);
      setTarifas(precios.filter((r) => r.is_active));
      setSlots(dia.slots);
      setSemana(rango);
      setReservas(lista);

      // Todo lo agendado de mañana en adelante, con el horizonte de 6 meses
      // que admite el sistema.
      const manana = new Date(`${today}T00:00:00`);
      manana.setDate(manana.getDate() + 1);
      const horizonte = new Date(`${today}T00:00:00`);
      horizonte.setMonth(horizonte.getMonth() + LIMITE_MESES);
      bookingApi
        .list({
          limit: 200,
          date_from: fechaLocal(manana),
          date_to: fechaLocal(horizonte),
        })
        .then((futuras) => setProximas(futuras.filter((r) => r.status !== 'CANCELADA')))
        .catch(() => setProximas([]));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, [today, desde, hasta, folio]);

  useRealtimeEvent(
    [
      EVENTOS.DISPONIBILIDAD_CAMBIADA,
      EVENTOS.RESERVA_CREADA,
      EVENTOS.RESERVA_ACTUALIZADA,
      EVENTOS.RESERVA_CANCELADA,
      EVENTOS.EVENTO_CREADO,
      EVENTOS.EVENTO_LIBERADO,
    ],
    () => cargar(false),
  );

  const metricas = useMemo(() => {
    const deHoy = reservas.filter((r) => r.slot_date === today && r.status !== 'CANCELADA');
    const jugadores = deHoy.reduce((total, r) => total + r.player_count, 0);
    const confirmadas = deHoy.filter((r) =>
      ['CONFIRMADA', 'CHECK_IN', 'EN_JUEGO', 'COMPLETADA'].includes(r.status),
    ).length;
    // Solo cuentan como libres las salidas que todavía se pueden vender.
    const libres = slots.filter(
      (s) => !s.expirada && (s.status === 'DISPONIBLE' || s.status === 'ABIERTA'),
    ).length;

    const ordenadas = [...proximas].sort((a, b) =>
      `${a.slot_date}${a.slot_time}`.localeCompare(`${b.slot_date}${b.slot_time}`),
    );
    const siguiente = ordenadas[0];

    return {
      partidasHoy: deHoy.length,
      jugadores,
      confirmadas,
      libres,
      proximas: ordenadas.length,
      jugadoresProximos: ordenadas.reduce((t, r) => t + r.player_count, 0),
      siguiente,
    };
  }, [reservas, slots, proximas, today]);

  const reservasFiltradas = useMemo(() => {
    if (filtro === 'hoy') return reservas.filter((r) => r.slot_date === today);
    if (filtro === 'proximas') return reservas.filter((r) => r.slot_date > today);
    if (filtro === 'confirmadas')
      return reservas.filter((r) =>
        ['CONFIRMADA', 'CHECK_IN', 'EN_JUEGO', 'COMPLETADA'].includes(r.status),
      );
    return reservas;
  }, [reservas, filtro, today]);

  const conteo = (key) => {
    if (key === 'hoy') return reservas.filter((r) => r.slot_date === today).length;
    if (key === 'proximas') return reservas.filter((r) => r.slot_date > today).length;
    if (key === 'confirmadas')
      return reservas.filter((r) =>
        ['CONFIRMADA', 'CHECK_IN', 'EN_JUEGO', 'COMPLETADA'].includes(r.status),
      ).length;
    return reservas.length;
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}

      {/* --------------------------------------------- 1. Banner del partner */}
      <header className="flex flex-col justify-between gap-4 rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-6 shadow-card xl:flex-row xl:items-center">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-primary-container text-secondary-fixed">
            <Icono nombre="hotel" size={32} />
          </div>
          <div className="min-w-0">
            <p className="text-label-sm uppercase tracking-widest text-secondary">
              Partner oficial VIP
            </p>
            <h1 className="truncate font-serif text-headline-lg leading-tight text-primary">
              {user?.hotel_name}
            </h1>
          </div>
        </div>
        <Link to="/reservas/nueva" className="shrink-0">
          <button className="flex items-center gap-2 rounded bg-primary-container px-6 py-2.5 text-title-md text-on-primary shadow-card transition hover:bg-primary">
<Icono nombre="add" size={18} className="text-secondary-fixed" /> Crear Nueva Reserva
          </button>
        </Link>
      </header>

      {/* ------------------------------------------------ Tarifas de hoy */}
      <TarifasDeHoy tarifas={tarifas} />

      {/* ------------------------------------------ 2. Indicadores operativos */}
      <section className="grid gap-gutter sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          icono="sports_golf"
          label="Partidas hoy"
          numero={metricas.partidasHoy}
          unidad="partidas reservadas"
          pie={`${metricas.jugadores} huéspedes en recorrido`}
          punto="bg-primary-container"
        />
        <Indicador
          icono="verified"
          label="Validación de cupos"
          numero={`${metricas.confirmadas}/${metricas.partidasHoy || 0}`}
          unidad={`confirmadas por el campo`}
          barra={
            metricas.partidasHoy
              ? Math.round((metricas.confirmadas / metricas.partidasHoy) * 100)
              : 0
          }
        />
        <Indicador
          icono="event_available"
          label="Rondas libres hoy"
          numero={metricas.libres}
          unidad="tee times disponibles"
          pie={config ? `Franja ${hora(config.start_time)} – ${hora(config.end_time)}` : ''}
          punto="bg-estado-ok-text"
        />
        <Indicador
          icono="calendar_today"
          label="Próximos juegos"
          numero={metricas.proximas}
          unidad="para otros días"
          pie={
            metricas.siguiente
              ? `La siguiente: ${fechaCorta(metricas.siguiente.slot_date)} a las ${hora(
                  metricas.siguiente.slot_time,
                )} · ${metricas.jugadoresProximos} huéspedes`
              : 'Sin partidas agendadas a futuro'
          }
          punto={metricas.proximas ? 'bg-secondary' : undefined}
        />
      </section>

      {/* ------------------------------------------- 3. Rejilla de horarios */}
      <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-6 shadow-card">
        <div className="mb-4 flex flex-wrap items-center gap-6">
          <Leyenda color="bg-primary-fixed" texto="Libre para reservar" />
          <Leyenda color="bg-surface-container-highest" texto="Ocupado / Torneo" />
          <Leyenda color="bg-secondary-fixed" texto="Reserva de su hotel" />
          <Leyenda color="bg-estado-recibido-bg border border-estado-recibido-border" texto="Partida abierta" />
        </div>

        <div className="rounded border border-outline-variant bg-surface-container-low p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/60 pb-3">
            <span className="flex items-center gap-2 text-title-md text-primary">
              <span className="text-secondary">⚑</span>
              {config?.label || 'Horarios de salida'} · 9 o 18 hoyos
            </span>
            <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
              {slots.length} franjas autorizadas ({hora(config?.start_time)} – {hora(config?.end_time)})
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
            {slots.map((slot) => (
              <Franja key={slot.id} slot={slot} />
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------ 4. Expedientes + canal directo con el campo */}
      <div className="grid items-start gap-gutter xl:grid-cols-12">
        <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-6 shadow-card xl:col-span-9">
          <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <h2 className="font-serif text-headline-md leading-tight text-primary">
                Expedientes de Reservas del Hotel
              </h2>
              <p className="text-body-md text-on-surface-variant">
                Control de huéspedes autorizados y su estado en campo.
              </p>
            </div>
            <div className="flex items-center gap-1 self-start rounded bg-surface-container-low p-1 md:self-auto">
              {FILTROS.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setFiltro(item.key)}
                  className={`whitespace-nowrap rounded px-3 py-1 text-label-md transition ${
                    filtro === item.key
                      ? 'bg-surface-container-lowest text-primary shadow-card'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {item.label} ({conteo(item.key)})
                </button>
              ))}
            </div>
          </div>

          {/* Periodo y folio: para un día concreto, lo que ya pasó o lo que
              viene, y para ir directo a una reserva cuando se sabe el folio. */}
          <Periodo
            desde={desde}
            hasta={hasta}
            folio={folio}
            onDesde={setDesde}
            onHasta={setHasta}
            onFolio={setFolio}
            hoyISO={today}
          />

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant">
                  {['Folio & fecha', 'Huésped titular', 'Paquete & pax', 'Tee time', 'Estado'].map(
                    (c, i) => (
                      <th
                        key={c}
                        className={`whitespace-nowrap px-3 py-3 text-label-sm uppercase tracking-wider ${
                          i === 1 ? 'w-full' : ''
                        } ${i === 4 ? 'text-right' : ''}`}
                      >
                        {c}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {reservasFiltradas.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-body-lg text-outline">
                      Sin reservas en este filtro.
                    </td>
                  </tr>
                ) : (
                  reservasFiltradas.map((r) => {
                    const estado = ESTADO_RESERVA[r.status] || {};
                    const cancelada = r.status === 'CANCELADA';
                    return (
                      <tr
                        key={r.id}
                        className="border-t border-outline-variant/30 transition hover:bg-surface-container-low/60"
                      >
                        <td className="whitespace-nowrap px-3 py-4 align-middle">
                          <Link
                            to={`/reservas/${r.id}`}
                            className="block font-mono text-title-md text-primary hover:underline"
                          >
                            #{r.folio}
                          </Link>
                          <span className="text-label-sm text-on-surface-variant">
                            {r.slot_date === today ? 'Hoy, ' : ''}
                            {fechaCorta(r.slot_date)}
                          </span>
                        </td>
                        <td className="w-full max-w-0 px-3 py-4 align-middle">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-title-md ${
                                cancelada
                                  ? 'bg-surface-container-high text-outline'
                                  : 'bg-primary-container text-secondary-fixed'
                              }`}
                            >
                              {iniciales(r.holder_name)}
                            </span>
                            <span
                              className={`truncate text-title-md ${
                                cancelada ? 'text-outline line-through' : 'text-primary'
                              }`}
                            >
                              {r.holder_name}
                            </span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 align-middle text-body-lg text-on-surface">
                          <span className="flex items-center gap-1.5">
                            <Icono
                              nombre={r.modality === 'GRUPO' ? 'groups' : r.modality === 'PARTIDA_ABIERTA' ? 'hub' : 'person'}
                              size={16}
                              className="text-secondary"
                            />
                            {MODALIDAD[r.modality]} ({r.player_count} pax)
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 align-middle">
                          <span className="block font-mono text-time-slot text-primary">
                            {hora(r.slot_time)}
                          </span>
                          <span className="text-label-sm text-on-surface-variant">
                            {recorrido(r)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-right align-middle">
                          <Badge variant={estado.variant}>{estado.label}</Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <p className="pt-4 text-label-md text-on-surface-variant">
            Mostrando {reservasFiltradas.length} de {reservas.length} reservas de{' '}
            {user?.hotel_name}
            {desde || hasta
              ? ` · periodo ${desde ? fechaCorta(desde) : 'inicio'} – ${
                  hasta ? fechaCorta(hasta) : 'hoy'
                }`
              : ' · historial completo'}
            {folio.trim() ? ` · folio «${folio.trim()}»` : ''}
          </p>
        </section>

        {/* Canal directo con operaciones */}
        <section className="rounded-lg bg-primary-container p-6 text-on-primary shadow-card xl:col-span-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="whitespace-nowrap text-label-sm uppercase tracking-widest text-secondary-fixed">
              Canal prioritario
            </span>
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-label-sm text-secondary-fixed-dim">
              <span className="h-2 w-2 rounded-full bg-estado-ok-border" />
              En línea
            </span>
          </div>
          <h3 className="font-serif text-headline-md text-on-primary">
            Línea Directa con Operaciones
          </h3>
          <p className="mt-1 text-body-md text-on-primary-container">
            Contacto con la Mesa de Salidas y el Caddie Master para cualquier incidencia de sus
            huéspedes.
          </p>

          <div className="mt-4 flex flex-col gap-2.5">
            <Contacto
              titulo="Mesa de Salidas"
              detalle="Extensión interna para concierge"
              icono="phone_in_talk"
              accion="call"
            />
            <Contacto
              titulo="Caddie Master"
              detalle="Asignación de salidas y caddies"
              icono="sports_golf"
              accion="chat"
            />
          </div>

          <p className="mt-4 border-t border-on-primary-container/30 pt-3 text-body-md text-on-primary-container">
            Las solicitudes enviadas desde este portal las confirma la Dirección Deportiva; el aviso
            llega aquí en cuanto cambia el estado.
          </p>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ piezas */

function Indicador({ icono, label, numero, unidad, pie, punto, barra }) {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
          {label}
        </span>
        {icono && <Icono nombre={icono} size={22} className="text-secondary" />}
      </div>
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-display-lg leading-none text-primary">{numero}</span>
          <span className="text-label-md text-on-surface-variant">{unidad}</span>
        </div>

        {barra !== undefined && (
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
            <div className="h-1.5 rounded-full bg-secondary" style={{ width: `${barra}%` }} />
          </div>
        )}

        {pie && (
          <p className="mt-1.5 flex items-center gap-1.5 text-body-md text-on-surface-variant">
            {punto && <span className={`inline-block h-2 w-2 rounded-full ${punto}`} />}
            {pie}
          </p>
        )}
      </div>
    </div>
  );
}

function Leyenda({ color, texto }) {
  return (
    <span className="flex items-center gap-2 text-label-sm uppercase tracking-wider text-on-surface-variant">
      <span className={`h-3.5 w-3.5 rounded ${color}`} />
      {texto}
    </span>
  );
}

/** Una salida de la rejilla. El color comunica el estado sin leer. */
function Franja({ slot }) {
  const propia = slot.es_de_mi_hotel;
  // Un horario que ya pasó se pinta como cerrado, salvo que sea una reserva
  // del hotel: esa sigue siendo suya y la quiere ver.
  const vencida = slot.expirada && !propia;
  const bloqueada = !vencida && slot.status === 'BLOQUEADO';
  const abierta = !vencida && slot.status === 'ABIERTA';
  const libre = !vencida && slot.status === 'DISPONIBLE';

  // Cada celda lleva su propio borde: sin él, los recuadros se confunden entre
  // sí y cuesta ver dónde termina un horario y empieza el siguiente.
  const base =
    'flex flex-col items-center justify-center rounded border px-2 py-2.5 text-center';
  const clase = vencida
    ? `${base} border-outline-variant/60 bg-surface-container text-outline-variant`
    : bloqueada
    ? `${base} border-outline-variant bg-surface-dim text-outline`
    : propia
      ? `${base} border-secondary bg-secondary-fixed text-on-secondary-container shadow-card`
      : abierta
        ? `${base} border-estado-recibido-border bg-estado-recibido-bg text-estado-recibido-text`
        : libre
          ? `${base} border-outline-variant bg-surface-container-lowest text-primary shadow-card transition hover:border-primary-container hover:bg-primary-fixed/40`
          : `${base} border-outline-variant bg-surface-container-highest text-outline`;

  let leyenda = 'Ocupado';
  if (vencida) leyenda = 'Cerrado';
  else if (bloqueada) leyenda = slot.event_name ? 'Torneo' : 'No disponible';
  else if (propia) leyenda = 'Su hotel';
  else if (abierta) leyenda = `Abierta ${slot.occupied}/${slot.capacity}`;
  else if (libre) leyenda = 'Disponible';

  const contenido = (
    <>
      <span className={`font-mono text-time-slot ${vencida ? 'line-through' : ''}`}>
        {hora(slot.slot_time)}
      </span>
      <span className="mt-0.5 text-label-sm font-bold uppercase tracking-wider">{leyenda}</span>
    </>
  );

  if (libre || (abierta && !propia)) {
    return (
      <Link to={`/reservas/nueva?slot=${slot.id}`} className={clase} title="Reservar este horario">
        {contenido}
      </Link>
    );
  }

  return (
    <div className={clase} title={propia && slot.titular ? slot.titular : undefined}>
      {contenido}
    </div>
  );
}

/**
 * Selector de periodo del expediente.
 *
 * Los atajos cubren lo que se consulta a diario; las dos fechas quedan para
 * cuando se busca algo puntual. Vacío significa sin límite, no "hoy": el hotel
 * entra a ver todo lo suyo y desde ahí acota.
 */
/**
 * Tarifas vigentes, a la vista.
 *
 * El concierge contesta precios por teléfono todo el día; tenerlos arriba le
 * evita entrar a la solicitud solo para consultarlos. Son los mismos que
 * aplica el sistema al cotizar, no una copia escrita aparte.
 */
function TarifasDeHoy({ tarifas }) {
  const [hoyos, setHoyos] = useState(18);

  // "Tarifas de hoy": el precio que aplica hoy, que cambia en fin de semana.
  const precio = (modalidad, categoria) => {
    const t = tarifaDelDia(tarifas, { modalidad, hoyos, categoria, fecha: hoy() });
    return t ? Number(t.price) : null;
  };

  if (tarifas.length === 0) return null;

  // Es un vistazo, no una tabla de precios: una sola franja que se lee de
  // corrido sin empujar la agenda hacia abajo.
  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-4 py-2.5 shadow-card">
      <p className="flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-primary">
        <Icono nombre="sell" size={14} className="text-secondary" />
        Tarifas
      </p>

      <div className="flex overflow-hidden rounded border border-outline-variant">
        {[9, 18].map((h) => (
          <button
            key={h}
            onClick={() => setHoyos(h)}
            className={`px-2.5 py-1 text-label-sm uppercase tracking-wider transition ${
              hoyos === h
                ? 'bg-primary-container text-on-primary'
                : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
            }`}
          >
            {h}h
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
        {Object.entries(MODALIDAD).map(([clave, nombre]) => {
          const adulto = precio(clave, 'ADULTO');
          const infantil = precio(clave, 'INFANTIL');
          if (adulto === null) return null;
          return (
            <span key={clave} className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-label-sm uppercase tracking-wider text-outline">{nombre}</span>
              <span className="font-mono text-title-md text-primary">{mxn(adulto)}</span>
              {infantil !== null && (
                <span className="font-mono text-label-sm text-outline">
                  · junior {mxn(infantil)}
                </span>
              )}
            </span>
          );
        })}
      </div>

      {/* El precio de hoy depende del día: se dice cuál aplica. */}
      <span className="text-label-sm text-outline">
        Green fee por jugador ·{' '}
        <span className="font-medium text-secondary">
          {esFinDeSemana(hoy()) ? 'precio de fin de semana' : 'precio entre semana'}
        </span>
      </span>
    </section>
  );
}

function Periodo({ desde, hasta, folio, onDesde, onHasta, onFolio, hoyISO }) {
  function corre(dias) {
    const d = new Date(`${hoyISO}T00:00:00`);
    d.setDate(d.getDate() + dias);
    return fechaLocal(d);
  }

  const horizonte = (() => {
    const d = new Date(`${hoyISO}T00:00:00`);
    d.setMonth(d.getMonth() + LIMITE_MESES);
    return fechaLocal(d);
  })();

  const atajos = [
    { label: 'Hoy', desde: hoyISO, hasta: hoyISO },
    { label: 'Últimos 7 días', desde: corre(-7), hasta: hoyISO },
    { label: 'Últimos 30 días', desde: corre(-30), hasta: hoyISO },
    { label: `Próximas (${LIMITE_MESES} meses)`, desde: corre(1), hasta: horizonte },
    { label: 'Todo', desde: '', hasta: '' },
  ];

  const activo = (a) => a.desde === desde && a.hasta === hasta;

  return (
    <div className="mb-4 space-y-3 rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 text-label-sm uppercase tracking-wider text-on-surface-variant">
          <Icono nombre="calendar_today" size={16} className="text-secondary" />
          Periodo
        </span>

        <label className="flex items-center gap-2">
          <span className="text-label-sm text-outline">Del</span>
          <input
            type="date"
            value={desde}
            max={hasta || horizonte}
            onChange={(e) => onDesde(e.target.value)}
            className={ENTRADA_FECHA}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-label-sm text-outline">al</span>
          <input
            type="date"
            value={hasta}
            min={desde || undefined}
            max={horizonte}
            onChange={(e) => onHasta(e.target.value)}
            className={ENTRADA_FECHA}
          />
        </label>

        <span className="hidden h-5 w-px bg-outline-variant sm:block" />

        {/* Buscar por folio: el hotel llega con el folio en la mano cuando el
            huésped pregunta por su reserva. */}
        <label className="relative flex min-w-[210px] flex-1 items-center">
          <Icono
            nombre="buscar"
            size={15}
            className="pointer-events-none absolute left-2.5 text-outline"
          />
          <input
            value={folio}
            onChange={(e) => onFolio(e.target.value)}
            placeholder="Buscar por folio o huésped"
            className={`${ENTRADA_FECHA} w-full pl-8 pr-8`}
          />
          {folio && (
            <button
              type="button"
              onClick={() => onFolio('')}
              className="absolute right-2 text-outline transition hover:text-on-surface"
              aria-label="Limpiar folio"
            >
              <Icono nombre="cancelar" size={15} />
            </button>
          )}
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {atajos.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => {
              onDesde(a.desde);
              onHasta(a.hasta);
            }}
            className={`whitespace-nowrap rounded border px-2.5 py-1 text-label-md transition ${
              activo(a)
                ? 'border-primary-container bg-primary-container text-on-primary'
                : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const ENTRADA_FECHA =
  'rounded border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 font-mono text-label-md text-on-surface focus:border-primary-container focus:outline-none';

function Contacto({ titulo, detalle, icono, accion }) {
  return (
    <div className="flex items-center justify-between gap-2.5 rounded bg-tertiary-container p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Icono nombre={icono} size={22} className="shrink-0 text-secondary-fixed" />
        <div className="min-w-0">
          <p className="text-title-md leading-snug text-on-primary">{titulo}</p>
          {/* El detalle envuelve: recortarlo dejaba la extensión a medias. */}
          <p className="text-label-sm leading-snug text-on-primary-container">{detalle}</p>
        </div>
      </div>
      <span className="shrink-0 rounded bg-primary p-2 text-secondary-fixed">
        <Icono nombre={accion} size={18} />
      </span>
    </div>
  );
}

function iniciales(nombre = '') {
  return nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}
