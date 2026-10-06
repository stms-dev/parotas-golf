/**
 * Partidas — el historial del campo.
 *
 * Sustituye a la antigua "Validación de Cupos". Ya no hay que aprobar nada a
 * mano: una solicitud del hotel se confirma sola cuando el huésped se presenta
 * y se le cobra. Lo que hace falta entonces no es una bandeja de pendientes,
 * sino poder ver cómo va el día y qué pasó los días anteriores.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { bookingApi, catalogApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Badge, Spinner } from '../components/ui';
import Icono from '../components/Icono';
import { ESTADO_RESERVA, MODALIDAD, fechaCorta, hora, hoy, mxn, fechaLocal } from '../utils/format';

const RANGOS = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
  { key: 'historico', label: 'Todo' },
];

const ORIGEN = '2020-01-01';

function iso(d) {
  return fechaLocal(d);
}

function rangoDe(key) {
  const fin = new Date();
  const inicio = new Date();
  if (key === 'semana') inicio.setDate(fin.getDate() - 6);
  if (key === 'mes') inicio.setDate(1);
  // "Todo" sí mira hacia adelante: aquí interesa la agenda completa, no el
  // corte contable, así que entran también las partidas ya reservadas.
  if (key === 'historico') {
    const futuro = new Date();
    futuro.setMonth(futuro.getMonth() + 6);
    return { start: ORIGEN, end: iso(futuro) };
  }
  return { start: iso(inicio), end: iso(fin) };
}

export default function PartidasPage() {
  const { isHotel } = useAuth();
  const [rango, setRango] = useState('hoy');
  const [aMano, setAMano] = useState({ start: '', end: '' });
  const [filtros, setFiltros] = useState({ term: '', status: '', hotel_id: '' });

  const [rows, setRows] = useState([]);
  const [hotels, setHotels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const rapido = rangoDe(rango);
  const aManoCompleto = aMano.start && aMano.end;
  const start = aManoCompleto ? aMano.start : rapido.start;
  const end = aManoCompleto ? aMano.end : rapido.end;
  const invertidas = aMano.start && aMano.end && aMano.start > aMano.end;

  useEffect(() => {
    if (!isHotel) catalogApi.hotels().then(setHotels).catch(() => {});
  }, [isHotel]);

  async function cargar(conSpinner = true) {
    if (invertidas) return;
    if (conSpinner) setLoading(true);
    setError(null);
    try {
      setRows(
        await bookingApi.list({
          ...filtros,
          date_from: start,
          date_to: end,
          limit: 200,
        }),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, [start, end, filtros.status, filtros.hotel_id]);

  useRealtimeEvent(
    [
      EVENTOS.RESERVA_CREADA,
      EVENTOS.RESERVA_ACTUALIZADA,
      EVENTOS.RESERVA_CANCELADA,
      EVENTOS.CHECKIN_REGISTRADO,
      EVENTOS.PAGO_REGISTRADO,
    ],
    () => cargar(false),
  );

  // Los números de arriba salen de la misma lista que la tabla: si se filtra,
  // el resumen filtra con ella y nunca se contradicen.
  const jugadas = rows.filter((r) => ['EN_JUEGO', 'COMPLETADA'].includes(r.status));
  const enMostrador = rows.filter((r) => r.status === 'CHECK_IN');
  const porLlegar = rows.filter((r) => ['PENDIENTE', 'CONFIRMADA'].includes(r.status));
  const canceladas = rows.filter((r) => ['CANCELADA', 'NO_SHOW'].includes(r.status));
  const vivas = rows.filter((r) => !['CANCELADA', 'NO_SHOW'].includes(r.status));

  const cobrado = vivas.reduce((s, r) => s + (Number(r.total) - Number(r.balance)), 0);
  const porCobrar = vivas.reduce((s, r) => s + Number(r.balance), 0);
  const jugadores = vivas.reduce((s, r) => s + (r.player_count || 0), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="flex flex-wrap items-baseline gap-3 font-serif text-display-lg leading-tight text-primary">
            Partidas
            <span className="text-body-lg text-outline">
              {rango === 'hoy' && !aManoCompleto
                ? fechaCorta(hoy())
                : `${fechaCorta(start)} – ${fechaCorta(end)}`}
            </span>
          </h1>
          <p className="text-body-lg text-outline">
            Cómo va el día y qué pasó antes. Las solicitudes del hotel se confirman solas
            cuando el huésped se presenta al mostrador.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex overflow-hidden rounded border border-outline-variant bg-surface-container-lowest">
            {RANGOS.map((r) => (
              <button
                key={r.key}
                onClick={() => {
                  setAMano({ start: '', end: '' });
                  setRango(r.key);
                }}
                className={`px-3.5 py-2 text-title-md transition ${
                  !aManoCompleto && rango === r.key
                    ? 'bg-primary-container text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 rounded border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5">
            <Icono nombre="calendario" size={15} className="shrink-0 text-secondary" />
            <input
              type="date"
              value={aMano.start}
              max={aMano.end || undefined}
              onChange={(e) => setAMano({ ...aMano, start: e.target.value })}
              className="bg-transparent text-body-md text-on-surface focus:outline-none"
            />
            <span className="text-outline">→</span>
            <input
              type="date"
              value={aMano.end}
              min={aMano.start || undefined}
              onChange={(e) => setAMano({ ...aMano, end: e.target.value })}
              className="bg-transparent text-body-md text-on-surface focus:outline-none"
            />
            {(aMano.start || aMano.end) && (
              <button
                onClick={() => setAMano({ start: '', end: '' })}
                className="text-outline transition hover:text-on-surface"
                aria-label="Quitar las fechas"
              >
                <Icono nombre="cancelar" size={15} />
              </button>
            )}
          </div>

          <Link
            to="/reservas/nueva"
            className="flex items-center gap-2 rounded bg-primary-container px-4 py-2 text-title-md text-on-primary shadow-card transition hover:bg-primary"
          >
            <Icono nombre="add" size={16} className="text-secondary-fixed" /> Nueva reserva
          </Link>
        </div>
      </header>

      {invertidas && (
        <Alert tone="warning">
          La fecha inicial es posterior a la final. Corrija el rango.
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      {/* ------------------------------------------------ cómo va el periodo */}
      <section className="grid gap-gutter sm:grid-cols-2 xl:grid-cols-5">
        <Cifra label="Partidas" valor={vivas.length} pie={`${jugadores} jugadores`} icono="grupo" />
        <Cifra label="Ya jugaron" valor={jugadas.length} pie="en campo o terminadas" icono="golf" />
        <Cifra
          label="En mostrador"
          valor={enMostrador.length}
          pie="llegaron, falta despacharlas"
          icono="registro"
        />
        <Cifra
          label="Por llegar"
          valor={porLlegar.length}
          pie={canceladas.length ? `${canceladas.length} canceladas o no-show` : 'sin cancelaciones'}
          icono="reloj"
        />
        <Cifra
          label="Cobrado"
          valor={mxn(cobrado)}
          pie={porCobrar > 0 ? `faltan ${mxn(porCobrar)}` : 'sin saldos abiertos'}
          icono="pago"
          oscuro
        />
      </section>

      {/* ------------------------------------------------------------ filtros */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          cargar();
        }}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-4 shadow-card"
      >
        <label className="relative flex min-w-[260px] flex-1 items-center">
          <Icono
            nombre="buscar"
            size={17}
            className="pointer-events-none absolute left-3.5 text-outline"
          />
          <input
            value={filtros.term}
            placeholder="Folio, titular, teléfono o correo"
            onChange={(e) => setFiltros({ ...filtros, term: e.target.value })}
            className="w-full rounded border border-outline-variant bg-surface-container-low py-2 pl-10 pr-3 text-body-lg text-on-surface placeholder:text-outline focus:border-primary-container focus:outline-none"
          />
        </label>

        <select
          value={filtros.status}
          onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}
          className={CAMPO}
        >
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_RESERVA).map(([value, item]) => (
            <option key={value} value={value}>
              {item.label}
            </option>
          ))}
        </select>

        {!isHotel && (
          <select
            value={filtros.hotel_id}
            onChange={(e) => setFiltros({ ...filtros, hotel_id: e.target.value })}
            className={CAMPO}
          >
            <option value="">Todos los hoteles</option>
            {hotels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}

        <button
          type="submit"
          className="rounded border border-outline-variant px-4 py-2 text-title-md text-on-surface transition hover:bg-surface-container-low"
        >
          Buscar
        </button>
      </form>

      {/* Lo que antes era el tablero de hoteles: la misma lista del periodo,
          contada por convenio. Se calcula de las filas ya cargadas, así que
          responde al mismo rango y a los mismos filtros. */}
      {!isHotel && <PorHotel rows={rows} onHotel={(id) => setFiltros({ ...filtros, hotel_id: id })} />}

      {/* -------------------------------------------------------------- tabla */}
      <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card">
        {loading ? (
          <div className="py-12">
            <Spinner />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant">
                  {['Folio', 'Titular / hotel', 'Salida', 'Partida', 'Estado', 'Total', 'Saldo'].map(
                    (c, i) => (
                      <th
                        key={c}
                        className={`whitespace-nowrap px-3 py-3 text-label-sm uppercase tracking-wider ${
                          i === 1 ? 'w-full' : ''
                        } ${i >= 5 ? 'text-right' : ''}`}
                      >
                        {c}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const estado = ESTADO_RESERVA[row.status] || {};
                  const debe = Number(row.balance) > 0;
                  return (
                    <tr
                      key={row.id}
                      className="border-t border-outline-variant/30 transition hover:bg-surface-container-low/60"
                    >
                      <td className="whitespace-nowrap px-3 py-3">
                        <Link
                          to={`/reservas/${row.id}`}
                          className="font-mono text-body-lg text-primary hover:underline"
                        >
                          {row.folio}
                        </Link>
                      </td>
                      <td className="max-w-0 truncate px-3 py-3">
                        <span className="block truncate text-title-md text-primary">
                          {row.holder_name}
                        </span>
                        <span className="block truncate text-body-md text-outline">
                          {row.hotel_name}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-body-lg text-on-surface-variant">
                        {fechaCorta(row.slot_date)}
                        <span className="ml-1.5 font-mono">{hora(row.slot_time)}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-body-md text-outline">
                        {MODALIDAD[row.modality]} · {row.player_count} pax · {row.holes}H
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <Badge variant={estado.variant}>{estado.label}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-body-lg text-primary">
                        {mxn(row.total)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <span
                          className={`font-mono text-body-lg ${
                            debe ? 'text-estado-pend-text' : 'text-estado-ok-text'
                          }`}
                        >
                          {debe ? mxn(row.balance) : 'Pagada'}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-12 text-center text-body-lg text-outline">
                      No hay partidas en este periodo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Resumen por hotel del mismo periodo. Sustituye al tablero de hoteles, que
 * mostraba estas mismas reservas en otra pantalla: aquí se agrupa lo que ya
 * está en la lista, sin una segunda consulta que pudiera no coincidir.
 */
function PorHotel({ rows, onHotel }) {
  const porHotel = rows.reduce((acc, r) => {
    const nombre = r.hotel_name || 'Sin hotel';
    if (!acc[nombre]) acc[nombre] = { id: r.hotel_id, partidas: 0, jugadores: 0, venta: 0, saldo: 0 };
    acc[nombre].partidas += 1;
    acc[nombre].jugadores += r.player_count || 0;
    acc[nombre].venta += Number(r.total || 0);
    acc[nombre].saldo += Number(r.balance || 0);
    return acc;
  }, {});

  const lista = Object.entries(porHotel).sort((a, b) => b[1].venta - a[1].venta);
  if (lista.length === 0) return null;

  return (
    <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-4 shadow-card">
      <p className="mb-2.5 flex items-center gap-2 text-label-md uppercase tracking-wider text-primary">
        <Icono nombre="hotel" size={15} className="text-secondary" />
        Por hotel en este periodo
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {lista.map(([nombre, d]) => (
          <button
            key={nombre}
            onClick={() => onHotel(d.id ? String(d.id) : '')}
            title={`Ver solo las partidas de ${nombre}`}
            className="rounded border border-outline-variant/60 bg-surface-container-low px-3.5 py-2.5 text-left transition hover:bg-surface-container"
          >
            <p className="truncate text-title-md text-primary">{nombre}</p>
            <p className="font-mono text-headline-md leading-tight text-primary">{mxn(d.venta)}</p>
            <p className="text-body-md text-outline">
              {d.partidas} partida{d.partidas === 1 ? '' : 's'} · {d.jugadores} jugadores
              {d.saldo > 0 && (
                <span className="text-estado-pend-text"> · debe {mxn(d.saldo)}</span>
              )}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

function Cifra({ label, valor, pie, icono, oscuro }) {
  return (
    <div
      className={`rounded-lg border p-5 shadow-card ${
        oscuro
          ? 'border-transparent bg-primary-container text-on-primary'
          : 'border-outline-variant/50 bg-surface-container-lowest'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={`text-label-sm uppercase tracking-wider ${
            oscuro ? 'text-secondary-fixed' : 'text-on-surface-variant'
          }`}
        >
          {label}
        </p>
        <Icono
          nombre={icono}
          size={16}
          className={oscuro ? 'text-secondary-fixed' : 'text-outline'}
        />
      </div>
      <p
        className={`mt-1 font-serif text-headline-lg leading-tight ${
          oscuro ? 'text-on-primary' : 'text-primary'
        }`}
      >
        {valor}
      </p>
      <p className={`text-body-md ${oscuro ? 'text-primary-fixed' : 'text-outline'}`}>{pie}</p>
    </div>
  );
}

const CAMPO =
  'rounded border border-outline-variant bg-surface-container-low px-3 py-2 text-body-lg text-on-surface focus:border-primary-container focus:outline-none';
