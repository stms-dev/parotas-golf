/**
 * Panel de Campo & Tee Sheet — sigue el mockup
 * `panel_admin_y_agenda_desktop_formal`.
 *
 * Es la pantalla de la Dirección de Operaciones. De arriba hacia abajo:
 *   1. Encabezado con la fecha operativa y las acciones del día.
 *   2. Resumen de salidas (seis indicadores) con TC y ocupación.
 *   3. Formulario plegable de evento o bloqueo administrativo.
 *   4. Tee sheet cronológico + caja, pool multihotel y condiciones del campo.
 *
 * Todo se recarga solo cuando llega un evento por socket: la caseta y el
 * mostrador trabajan sobre la misma agenda y no pueden verla desfasada.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { bookingApi, catalogApi, dashboardApi, eventsApi, treasuryApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Spinner } from '../components/ui';
import Icono from '../components/Icono';
import { ESTADO_RESERVA, MODALIDAD, fecha, hora, hoy, mxn, toUsd } from '../utils/format';

const TIPOS_EVENTO = [
  ['TORNEO', 'Torneo'],
  ['EVENTO_CORPORATIVO', 'Evento corporativo'],
  ['MANTENIMIENTO', 'Mantenimiento'],
  ['BLOQUEO_ADMINISTRATIVO', 'Bloqueo administrativo'],
];

export default function DashboardPage() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [date, setDate] = useState(hoy());
  const [data, setData] = useState(null);
  const [slots, setSlots] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [config, setConfig] = useState(null);
  const [caja, setCaja] = useState(null);
  const [credenciales, setCredenciales] = useState([]);
  const [hoteles, setHoteles] = useState([]);

  const [formAbierto, setFormAbierto] = useState(false);
  const [recursos, setRecursos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function cargar(conSpinner = true) {
    if (conSpinner) setLoading(true);
    setError(null);
    try {
      const [panel, dia, lista, horarios] = await Promise.all([
        dashboardApi.get({ target: date }),
        bookingApi.availability({ slot_date: date }),
        bookingApi.list({ slot_date: date, limit: 200 }),
        catalogApi.schedule(),
      ]);
      setData(panel);
      setSlots(dia.slots);
      setReservas(lista);
      setConfig(horarios[0] || null);

      // Estos cuatro son opcionales: si el rol no los puede ver, la tarjeta
      // simplemente no se pinta en vez de tumbar toda la pantalla.
      treasuryApi.currentCash().then(setCaja).catch(() => setCaja(null));
      catalogApi.pgaCredentials({ limit: 200 }).then(setCredenciales).catch(() => setCredenciales([]));
      catalogApi.hotels().then(setHoteles).catch(() => setHoteles([]));
      bookingApi.recursos({ slot_date: date }).then(setRecursos).catch(() => setRecursos(null));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, [date]);

  useRealtimeEvent(
    [
      EVENTOS.RESERVA_CREADA,
      EVENTOS.RESERVA_ACTUALIZADA,
      EVENTOS.RESERVA_CANCELADA,
      EVENTOS.CHECKIN_REGISTRADO,
      EVENTOS.DISPONIBILIDAD_CAMBIADA,
      EVENTOS.EVENTO_CREADO,
      EVENTOS.EVENTO_LIBERADO,
      EVENTOS.PAGO_REGISTRADO,
    ],
    () => cargar(false),
  );

  /** Las reservas vivas de cada salida, indexadas por hora. */
  const porHora = useMemo(() => {
    const mapa = new Map();
    reservas
      .filter((r) => !['CANCELADA', 'NO_SHOW'].includes(r.status))
      .forEach((r) => {
        const clave = hora(r.slot_time);
        if (!mapa.has(clave)) mapa.set(clave, []);
        mapa.get(clave).push(r);
      });
    return mapa;
  }, [reservas]);

  const abiertas = useMemo(
    () =>
      slots
        .filter((s) => s.status === 'ABIERTA')
        .map((s) => ({ slot: s, reservas: porHora.get(hora(s.slot_time)) || [] })),
    [slots, porHora],
  );

  if (loading) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;

  const plazas = slots.reduce((t, s) => t + s.capacity, 0);
  const cuposLibres = slots.reduce((t, s) => t + (s.status === 'BLOQUEADO' ? 0 : s.available), 0);
  // La comisión se guarda por hotel. Si todos comparten la misma se muestra
  // como cifra única; si difieren, el rango.
  const tasas = [...new Set(hoteles.map((h) => Number(h.commission_rate).toFixed(2)))]
    .map(Number)
    .sort((a, b) => a - b);
  const comision =
    tasas.length === 0
      ? '—'
      : tasas.length === 1
        ? `${tasas[0]}%`
        : `${tasas[0]}–${tasas[tasas.length - 1]}%`;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------ 1. Encabezado */}
      <header className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <p className="flex items-center gap-2 text-label-sm uppercase tracking-widest text-secondary">
            Agenda oficial
            <span className="h-1 w-1 rounded-full bg-secondary" />
            <span className="text-on-surface-variant normal-case tracking-normal">
              {fecha(date)}
            </span>
          </p>
          <h1 className="font-serif text-display-lg leading-tight text-primary">
            Panel de Campo & Tee Sheet
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {can('screen:settings') && (
            <Link
              to="/precios"
              className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-title-md text-on-surface transition hover:bg-surface-container-low"
            >
              <Icono nombre="sell" size={16} className="text-secondary" /> Precios & Tarifas
            </Link>
          )}

          <div className="flex overflow-hidden rounded border border-outline-variant bg-surface-container-lowest">
            <span className="bg-primary-container px-3.5 py-2 text-title-md text-on-primary">Día</span>
            {can('screen:tee_sheet') &&
              [
                ['Semana', 'semana'],
                ['Mes', 'mes'],
              ].map(([texto, vista]) => (
                <button
                  key={vista}
                  onClick={() => navigate(`/tee-sheet?vista=${vista}&fecha=${date}`)}
                  className="px-3.5 py-2 text-title-md text-on-surface-variant transition hover:bg-surface-container-low"
                >
                  {texto}
                </button>
              ))}
          </div>

          <label className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-2">
            <Icono nombre="calendar_today" size={16} className="text-outline" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-title-md text-on-surface focus:outline-none"
            />
          </label>

          {can('event:manage') && (
            <button
              onClick={() => setFormAbierto((v) => !v)}
              className="flex items-center gap-2 rounded bg-primary-container px-4 py-2 text-title-md text-on-primary shadow-card transition hover:bg-primary"
            >
              <Icono nombre="add" size={16} className="text-secondary-fixed" /> Nuevo Evento /
              Bloqueo
            </button>
          )}
        </div>
      </header>

      {/* -------------------------------------------------- 2. Resumen de salidas */}
      <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="flex flex-wrap items-center gap-2 text-label-md uppercase tracking-wider text-primary">
            <Icono nombre="agenda" size={17} className="text-secondary" />
            Resumen de salidas · horario oficial{' '}
            {config ? `${hora(config.start_time)} a ${hora(config.end_time)}` : '—'}
            <span className="text-body-md normal-case tracking-normal text-outline">
              ({slots.length} salidas programadas · {plazas} plazas totales · intervalo{' '}
              {config?.interval_minutes ?? 30} min)
            </span>
          </p>
          <div className="flex items-center gap-3">
            <span className="rounded border border-outline-variant/60 bg-surface-container-low px-2.5 py-1 font-mono text-label-sm text-primary">
              TC: 1 USD = ${Number(data.exchange_rate).toFixed(2)} MXN
            </span>
            <span className="flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-on-surface-variant">
              Ocupación: {Math.round(data.occupancy_percent)}% ({data.players_scheduled}/{plazas}{' '}
              pax)
              <span className="h-2 w-2 rounded-full bg-estado-ok-text" />
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <Cifra
            label="Horarios del día"
            valor={slots.length}
            pie={config ? `de ${hora(config.start_time)} a ${hora(config.end_time)}` : '—'}
          />
          <Cifra
            label="Ya reservadas"
            valor={data.slots_occupied}
            insignia={`${Math.round(data.occupancy_percent)}%`}
          />
          <Cifra
            label="Libres"
            valor={data.slots_available}
            pie={`${cuposLibres} lugares sin vender`}
          />
          <Cifra
            label="Comisión a hoteles"
            valor={comision}
            insignia={tasas.length === 1 ? 'Igual para todos' : `${hoteles.length} convenios`}
          />
          {/* Son los jugadores a los que hoy se les aplicó el beneficio, no el
              tamaño del padrón: lo que importa es cuánto se bonificó hoy. */}
          <Cifra
            label="Jugadores con PGA"
            valor={data.pga?.players_with_benefit ?? 0}
            pie={
              Number(data.pga?.total_pga_discounts || 0) > 0
                ? `${mxn(data.pga.total_pga_discounts)} bonificados`
                : 'sin descuentos hoy'
            }
          />
          <Cifra
            label="Bloqueadas"
            valor={data.slots_blocked}
            pie={data.slots_blocked ? 'evento o mantenimiento' : 'sin bloqueos'}
          />
          {/* Carritos y caddies son limitados: si se acaban, el día se cierra
              solo. Se liberan cuando la partida que los tiene se finaliza. */}
          <Cifra
            label="Carritos"
            valor={recursos ? `${recursos.carritos_libres}/${recursos.carritos_totales}` : '—'}
            pie={
              recursos
                ? recursos.carritos_libres > 0
                  ? `${recursos.carritos_usados} en uso · ${recursos.personas_por_carrito} personas c/u`
                  : 'sin carritos: no se puede reservar'
                : '—'
            }
          />
          <Cifra
            label="Caddies"
            valor={recursos ? `${recursos.caddies_libres}/${recursos.caddies_totales}` : '—'}
            pie={
              recursos && recursos.caddies_libres === 0
                ? 'asignados hasta que finalicen'
                : 'libres para asignar'
            }
          />
          <Cifra
            label="Duración promedio"
            valor={data.avg_round_minutes ? `${data.avg_round_minutes} min` : '—'}
            pie={
              data.rounds_measured
                ? `${data.rounds_measured} partida(s) · del pago al cierre`
                : 'del pago al cierre'
            }
          />
        </div>
      </section>

      {/* ------------------------------------------- 3. Alta de evento / bloqueo */}
      {formAbierto && (
        <FormularioEvento
          fecha={date}
          onCerrar={() => setFormAbierto(false)}
          onGuardado={() => {
            setFormAbierto(false);
            cargar(false);
          }}
        />
      )}

      {/* ------------------------------------------------------- 4. Tee sheet */}
      <div className="grid gap-gutter xl:grid-cols-12">
        <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card xl:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/40 p-5">
            <div>
              <h2 className="flex items-center gap-3 font-serif text-headline-lg text-primary">
                Tee Sheet Cronológico Oficial
                <span className="rounded bg-primary-container px-2.5 py-1 font-mono text-label-sm text-on-primary">
                  {config ? `${hora(config.start_time)} – ${hora(config.end_time)}` : '—'}
                </span>
              </h2>
              <p className="text-body-md text-outline">
                Rango maestro parametrizado · intervalo {config?.interval_minutes ?? 30} min ·{' '}
                {slots.length} franjas horarias
              </p>
            </div>
            <div className="flex items-center gap-2 text-label-sm uppercase tracking-wider">
              <span className="flex items-center gap-1.5 rounded bg-surface-container px-2.5 py-1 text-on-surface-variant">
                <span className="h-2 w-2 rounded-full bg-primary" /> {data.slots_occupied} ocupados
              </span>
              <span className="flex items-center gap-1.5 rounded bg-estado-ok-bg px-2.5 py-1 text-estado-ok-text">
                <span className="h-2 w-2 rounded-full bg-estado-ok-text" /> {data.slots_available}{' '}
                disponibles
              </span>
            </div>
          </div>

          <div className="divide-y divide-outline-variant/30">
            {slots.length === 0 && (
              <p className="px-5 py-10 text-center text-body-lg text-outline">
                No hay salidas programadas para esta fecha.
              </p>
            )}
            {slots.map((slot, i) => (
              <Franja
                key={slot.id}
                slot={slot}
                reservas={porHora.get(hora(slot.slot_time)) || []}
                rate={data.exchange_rate}
                ultima={i === slots.length - 1}
                puedeAsignar={can('screen:new_reservation')}
              />
            ))}
          </div>
        </section>

        <div className="space-y-gutter xl:col-span-4">
          {caja && <ControlDeCaja caja={caja} data={data} />}
          <PoolMultihotel abiertas={abiertas} hoteles={hoteles} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ piezas */

function Cifra({ label, valor, pie, insignia }) {
  return (
    <div className="rounded border border-outline-variant/50 bg-surface-container-low px-4 py-3">
      <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="font-serif text-headline-lg leading-none text-primary">{valor}</span>
        {insignia && (
          <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono text-label-sm text-on-surface-variant">
            {insignia}
          </span>
        )}
        {pie && <span className="text-body-md text-outline">{pie}</span>}
      </p>
    </div>
  );
}

/** Una franja del tee sheet: ocupada, bloqueada o libre. */
function Franja({ slot, reservas, rate, ultima, puedeAsignar }) {
  // Un horario que ya pasó (o de hoy, después de la hora límite) ya no se
  // vende: se pinta apagado y sin botón para asignar.
  const vencida = Boolean(slot.expirada);
  // Salida tomada por el replay de otra partida: está ocupada aunque no
  // tenga reserva propia.
  const deReplay = Boolean(slot.replay_folio);
  // Los horarios se abren en orden: los de más tarde esperan su turno.
  const enEspera = slot.cerrada_por === 'orden';
  const sinCarritos = slot.cerrada_por === 'carritos';
  const libre = !vencida && slot.status === 'DISPONIBLE';
  const abierta = !vencida && slot.status === 'ABIERTA';
  const bloqueada = slot.status === 'BLOQUEADO';

  return (
    <div
      className={`flex flex-wrap items-center gap-4 px-5 py-4 ${
        (libre || abierta) && !deReplay && !enEspera && !sinCarritos ? 'bg-estado-ok-bg/40' : ''
      } ${vencida && reservas.length === 0 ? 'bg-surface-container-low/70 opacity-70' : ''}`}
    >
      <div className="w-16 shrink-0">
        <p className="font-mono text-time-slot leading-tight text-primary">{hora(slot.slot_time)}</p>
        <p className="text-label-sm uppercase tracking-wider text-outline">
          {ultima ? 'Fin' : slot.tee}
        </p>
      </div>

      <span
        className={`h-10 w-px ${
          bloqueada ? 'bg-outline-variant' : libre || abierta ? 'bg-estado-ok-text' : 'bg-primary'
        }`}
      />

      <div className="min-w-0 flex-1">
        {bloqueada ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-title-md text-primary">
              {slot.event_name || 'Franja bloqueada'}
              <Etiqueta tono="neutral">Bloqueada</Etiqueta>
            </p>
            <p className="text-body-md text-outline">
              Inhabilitada para reservas externas · {slot.capacity} plazas retenidas
            </p>
          </>
        ) : reservas.length === 0 && deReplay ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-title-md text-primary">
              Replay de la partida #{slot.replay_folio}
              <Etiqueta tono="ok">Replay</Etiqueta>
            </p>
            <p className="text-body-md text-outline">Salida tomada por la ronda extra</p>
          </>
        ) : reservas.length === 0 && (enEspera || sinCarritos) ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-title-md text-outline">
              {enEspera ? 'Espera su turno' : 'Sin carritos disponibles'}
              <Etiqueta tono="neutral">{enEspera ? 'Por abrir' : 'Cerrada'}</Etiqueta>
            </p>
            <p className="text-body-md text-outline">
              {enEspera
                ? 'Se abre cuando se llene la salida anterior o pase su hora'
                : 'Los 20 carritos del club ya están asignados este día'}
            </p>
          </>
        ) : reservas.length === 0 && vencida ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-title-md text-outline">
              Horario pasado
              <Etiqueta tono="neutral">Cerrado</Etiqueta>
            </p>
            <p className="text-body-md text-outline">Ya no se puede reservar en esta salida</p>
          </>
        ) : reservas.length === 0 ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-title-md text-estado-ok-text">
              Franja libre para reservación
              <Etiqueta tono="ok">Disponible</Etiqueta>
            </p>
            <p className="text-body-md text-outline">
              Capacidad abierta: {slot.capacity} cupos (Individual, Grupo o Partida Abierta)
            </p>
          </>
        ) : (
          reservas.map((r) => {
            const estado = ESTADO_RESERVA[r.status] || {};
            return (
              <div key={r.id} className="py-0.5">
                <p className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/reservas/${r.id}`}
                    className="text-title-md text-primary hover:underline"
                  >
                    {r.holder_name} · {r.holes} hoyos
                  </Link>
                  {r.hotel_name && <Etiqueta tono="hotel">{r.hotel_name}</Etiqueta>}
                  <Etiqueta tono={estado.variant === 'ok' ? 'ok' : 'neutral'}>
                    {estado.label}
                  </Etiqueta>
                </p>
                <p className="text-body-md text-outline">
                  {r.player_count} jugadores · {MODALIDAD[r.modality]} · folio {r.folio}
                  {abierta ? ` · ${slot.available} cupo(s) para emparejar` : ''}
                </p>
              </div>
            );
          })
        )}
      </div>

      <div className="shrink-0 text-right">
        {reservas.length > 0 && !bloqueada ? (
          <>
            <p className="font-mono text-title-md text-primary">
              {mxn(reservas.reduce((t, r) => t + Number(r.total), 0))}
            </p>
            <p className="font-mono text-label-sm text-outline">
              ({toUsd(
                reservas.reduce((t, r) => t + Number(r.total), 0),
                rate,
              )}
              ){' · '}
              {reservas.every((r) => Number(r.balance) <= 0) ? 'Liquidado' : 'Pendiente'}
            </p>
          </>
        ) : (
          puedeAsignar &&
          !bloqueada &&
          !vencida &&
          !deReplay &&
          !enEspera &&
          !sinCarritos && (
            <Link
              to={`/reservas/nueva?slot=${slot.id}`}
              className="inline-flex items-center gap-1.5 rounded bg-primary-container px-3.5 py-2 text-title-md text-on-primary transition hover:bg-primary"
            >
              <Icono nombre="add" size={15} className="text-secondary-fixed" /> Asignar reserva
            </Link>
          )
        )}
      </div>
    </div>
  );
}

function Etiqueta({ children, tono = 'neutral' }) {
  const tonos = {
    ok: 'bg-estado-ok-bg text-estado-ok-text',
    neutral: 'bg-surface-container-high text-on-surface-variant',
    hotel: 'bg-secondary-container text-on-secondary-container',
  };
  return (
    <span
      className={`whitespace-nowrap rounded px-2 py-0.5 text-label-sm uppercase tracking-wider ${tonos[tono]}`}
    >
      {children}
    </span>
  );
}

/** Caja del día: lo esperado según los cobros contra lo contado en arqueo. */
function ControlDeCaja({ caja, data }) {
  const esperado = Number(caja.total_mxn || 0);
  const efectivo = Number(caja.cash_mxn || 0);

  return (
    <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-label-md uppercase tracking-wider text-primary">
            Control de caja & cierre diario
          </h3>
          <p className="text-body-md text-outline">Auditoría previa al cierre de las 22:00 hrs</p>
        </div>
        <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono text-label-sm text-on-surface-variant">
          22:00
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-outline-variant/50 bg-surface-container-low px-3.5 py-3">
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            Total esperado
          </p>
          <p className="font-serif text-headline-lg text-primary">{mxn(esperado)}</p>
          <p className="text-label-sm text-outline">Total recaudación</p>
        </div>
        <div className="rounded border border-outline-variant/50 bg-surface-container-low px-3.5 py-3">
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            Cobrado hoy
          </p>
          <p className="font-serif text-headline-lg text-primary">{mxn(data.collected_today)}</p>
          <p className="text-label-sm text-outline">Caja física + TPV</p>
        </div>
      </div>

      <dl className="mt-3 space-y-2 rounded border border-outline-variant/50 px-3.5 py-3 text-body-lg">
        <Renglon t="Efectivo en turno" v={mxn(efectivo)} />
        <Renglon t="Tarjeta / TPV" v={mxn(caja.card_mxn)} />
        <Renglon t="Transferencia" v={mxn(caja.transfer_mxn)} />
        <Renglon t="Por cobrar" v={mxn(data.pending_collection)} acento />
      </dl>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-body-md text-outline">
          {caja.opened_by_name ? `Turno de ${caja.opened_by_name}` : 'Sin turno abierto'}
        </p>
        <Link
          to="/finanzas"
          className="rounded bg-primary-container px-3.5 py-2 text-title-md text-on-primary transition hover:bg-primary"
        >
          Auditar cierre
        </Link>
      </div>
    </section>
  );
}

function Renglon({ t, v, acento }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-on-surface-variant">{t}</dt>
      <dd className={`font-mono ${acento ? 'text-secondary' : 'text-primary'}`}>{v}</dd>
    </div>
  );
}

/** Partidas abiertas que todavía admiten huéspedes de otro hotel. */
function PoolMultihotel({ abiertas, hoteles }) {
  return (
    <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-label-md uppercase tracking-wider text-primary">
          Pool de partidas multihotel
        </h3>
        <span className="text-body-md text-outline">{abiertas.length} activas</span>
      </div>

      {abiertas.length === 0 ? (
        <p className="rounded bg-surface-container-low px-3.5 py-4 text-body-lg text-outline">
          Ninguna partida abierta admite jugadores en este momento.
        </p>
      ) : (
        <div className="space-y-4">
          {abiertas.map(({ slot, reservas }) => (
            <div key={slot.id}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-title-md text-primary">Salida {hora(slot.slot_time)}</p>
                <p className="font-mono text-body-md text-on-surface-variant">
                  {slot.occupied} / {slot.capacity} jugadores
                </p>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-primary-container"
                  style={{ width: `${(slot.occupied / slot.capacity) * 100}%` }}
                />
              </div>
              <p className="mt-1 text-body-md text-outline">
                {reservas.map((r) => r.hotel_name).filter(Boolean).join(' + ') ||
                  `${hoteles.length} hoteles con convenio`}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Alta de evento o bloqueo: inhabilita franjas para reservas externas. */
function FormularioEvento({ fecha: fechaOperativa, onCerrar, onGuardado }) {
  const [form, setForm] = useState({
    event_type: 'EVENTO_CORPORATIVO',
    event_date: fechaOperativa,
    start_time: '12:00',
    end_time: '13:00',
    estimated_players: 16,
    name: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await eventsApi.create({
        ...form,
        estimated_players: Number(form.estimated_players) || null,
        start_time: `${form.start_time}:00`.slice(0, 8),
        end_time: `${form.end_time}:00`.slice(0, 8),
        blocks_availability: true,
      });
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form
      onSubmit={guardar}
      className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-label-md uppercase tracking-wider text-primary">
            Registrar evento o bloqueo administrativo
          </h2>
          <p className="text-body-md text-outline">
            Inhabilita franjas para reservas externas y agenda uso exclusivo del recorrido.
          </p>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          className="p-1 text-outline transition hover:text-on-surface"
          aria-label="Cerrar"
        >
          <Icono nombre="cancelar" size={20} />
        </button>
      </div>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Campo label="Tipo">
          <select value={form.event_type} onChange={set('event_type')} className={ENTRADA}>
            {TIPOS_EVENTO.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Fecha">
          <input type="date" value={form.event_date} onChange={set('event_date')} className={ENTRADA} />
        </Campo>
        <Campo label="Horario">
          <div className="flex items-center gap-2">
            <input type="time" value={form.start_time} onChange={set('start_time')} className={ENTRADA} />
            <span className="text-outline">–</span>
            <input type="time" value={form.end_time} onChange={set('end_time')} className={ENTRADA} />
          </div>
        </Campo>
        <Campo label="Capacidad">
          <input
            type="number"
            min="1"
            value={form.estimated_players}
            onChange={set('estimated_players')}
            className={ENTRADA}
          />
        </Campo>
        <Campo label="Denominación / motivo">
          <input
            value={form.name}
            onChange={set('name')}
            required
            minLength={3}
            placeholder="Copa Invitacional"
            className={ENTRADA}
          />
        </Campo>
      </div>

      <div className="mt-4 flex justify-end gap-2.5">
        <button
          type="button"
          onClick={onCerrar}
          className="rounded border border-outline-variant px-4 py-2 text-title-md text-on-surface-variant transition hover:bg-surface-container-low"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={guardando}
          className="rounded bg-primary-container px-5 py-2 text-title-md text-on-primary shadow-card transition hover:bg-primary disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : 'Guardar bloqueo'}
        </button>
      </div>
    </form>
  );
}

const ENTRADA =
  'w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-lg text-on-surface focus:border-primary-container focus:outline-none';

function Campo({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-label-sm uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      {children}
    </label>
  );
}
