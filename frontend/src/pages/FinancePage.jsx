/**
 * Finanzas y Cierre — sigue el mockup `finanzas_y_cierre_desktop`.
 *
 * Consolida lo vendido, lo cobrado y lo que se le retiene a cada hotel. De
 * arriba hacia abajo:
 *   1. Venta bruta, comisión hotelera e ingreso neto del campo.
 *   2. Métricas del beneficio PGA del periodo.
 *   3. Distribución de cobros del turno y dinero en caja.
 *   4. Liquidación hotel por hotel.
 *   5. Auditoría de cada bonificación PGA aplicada.
 *
 * La comisión que se muestra por reserva es la que estaba vigente el día que
 * se vendió, no la de hoy: cambiar el convenio no reescribe el pasado.
 */
import { useEffect, useState } from 'react';

import { treasuryApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Spinner } from '../components/ui';
import Icono from '../components/Icono';
import { fecha, fechaHora, hoy, mxn, fechaLocal } from '../utils/format';

const RANGOS = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
  { key: 'historico', label: 'Histórico' },
];

/** Fecha de arranque para el histórico: antes de que existiera el sistema. */
const ORIGEN = '2020-01-01';

function iso(d) {
  return fechaLocal(d);
}

/** "1 jugador" y no "1 jugadores". */
function plural(n, singular, plurales) {
  return `${n} ${n === 1 ? singular : plurales}`;
}

function rangoDe(key) {
  const fin = new Date();
  const inicio = new Date();
  if (key === 'semana') inicio.setDate(fin.getDate() - 6);
  if (key === 'mes') inicio.setDate(1);
  if (key === 'historico') return { start: ORIGEN, end: iso(fin) };
  return { start: iso(inicio), end: iso(fin) };
}

export default function FinancePage() {
  const { can } = useAuth();
  const [rango, setRango] = useState('hoy');
  /** Fechas escritas a mano en el calendario; mandan sobre el rango rápido. */
  const [aMano, setAMano] = useState({ start: '', end: '' });
  const [resumen, setResumen] = useState(null);
  const [caja, setCaja] = useState(null);
  const [liquidaciones, setLiquidaciones] = useState([]);
  const [beneficios, setBeneficios] = useState([]);
  const [cierres, setCierres] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [corteAbierto, setCorteAbierto] = useState(false);

  // Si el usuario escribió las dos fechas, esas mandan; si no, el botón.
  const rapido = rangoDe(rango);
  const aManoCompleto = aMano.start && aMano.end;
  const start = aManoCompleto ? aMano.start : rapido.start;
  const end = aManoCompleto ? aMano.end : rapido.end;
  const fechasInvertidas = aMano.start && aMano.end && aMano.start > aMano.end;

  // Recepción cierra su turno pero no ve la consolidación del club; la
  // pantalla se arma con lo que su rol sí puede consultar.
  const verGlobal = can('finance:view_global');

  async function cargar(conSpinner = true) {
    if (conSpinner) setLoading(true);
    setError(null);
    try {
      const [sesion, sesiones] = await Promise.all([
        treasuryApi.currentCash().catch(() => null),
        treasuryApi.cashSessions({ limit: 5 }).catch(() => []),
      ]);
      setCaja(sesion);
      setCierres(sesiones);

      if (verGlobal) {
        const datos = await treasuryApi.summary({ start, end });
        setResumen(datos);
        treasuryApi.settlements({ limit: 100 }).then(setLiquidaciones).catch(() => setLiquidaciones([]));
        treasuryApi
          .pgaBenefits({ start, end, limit: 50 })
          .then(setBeneficios)
          .catch(() => setBeneficios([]));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const [abriendo, setAbriendo] = useState(false);

  /** Sin turno abierto los cobros no tienen dónde registrarse. */
  async function abrirTurno() {
    setAbriendo(true);
    setError(null);
    try {
      await treasuryApi.openCash({ opening_balance: '0.00' });
      setAviso('Turno de caja abierto. Los cobros del mostrador ya quedan registrados aquí.');
      cargar(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setAbriendo(false);
    }
  }

  useEffect(() => {
    if (fechasInvertidas) return;
    cargar();
  }, [start, end]);

  useRealtimeEvent(
    [EVENTOS.PAGO_REGISTRADO, EVENTOS.CHECKIN_REGISTRADO, EVENTOS.CAJA_CERRADA],
    () => cargar(false),
  );

  if (loading) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;

  const bruto = Number(resumen?.gross_sales ?? 0);
  const comision = Number(resumen?.hotel_commissions ?? 0);
  const neto = Number(resumen?.net_course ?? 0);
  const margen = bruto > 0 ? (neto / bruto) * 100 : 0;
  const cobrado = Number(resumen?.total_collected ?? 0);
  const porcentajeCobrado = bruto > 0 ? (cobrado / bruto) * 100 : 0;
  const ultimoCierre = cierres.find((c) => c.closed_at);

  const etiquetaPeriodo = aManoCompleto
    ? `${fecha(start)} a ${fecha(end)}`
    : {
        hoy: 'hoy',
        semana: 'últimos 7 días',
        mes: 'este mes',
        // Se dice "hasta hoy" a propósito: las cifras se cuentan por día de
        // juego, así que una partida pagada para la semana que entra todavía
        // no es venta. Aparecerá cuando llegue su fecha.
        historico: 'histórico hasta hoy',
      }[rango];

  return (
    <div className="space-y-6">
      {/* --------------------------------------------------------- encabezado */}
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="flex flex-wrap items-baseline gap-3 font-serif text-display-lg leading-tight text-primary">
            Finanzas y Cierre
            <span className="text-body-lg text-outline">
              {verGlobal ? `${fecha(start)} – ${fecha(end)}` : fecha(hoy())}
            </span>
          </h1>
          <p className="text-body-lg text-outline">
            {verGlobal
              ? 'Resumen consolidado de operaciones y liquidación de convenios hoteleros.'
              : 'Lo cobrado en el turno de caja del mostrador.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {verGlobal && (
            <>
              <div className="flex overflow-hidden rounded border border-outline-variant bg-surface-container-lowest">
                {RANGOS.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => {
                      // Elegir un rango rápido descarta las fechas a mano: si
                      // no, el botón se vería activo sin estar mandando.
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

              {/* Calendario para cualquier periodo que no sea uno de los
                  botones: un mes cerrado, una quincena, una fecha suelta. */}
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
            </>
          )}
          {verGlobal && (
          <button
            onClick={() => exportarInforme(resumen, beneficios, start, end)}
            className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-4 py-2 text-title-md text-on-surface transition hover:bg-surface-container-low"
          >
            <Icono nombre="download" size={16} className="text-secondary" /> Exportar informe
          </button>
          )}
        </div>
      </header>

      {aviso && <Alert tone="success" onClose={() => setAviso(null)}>{aviso}</Alert>}

      {fechasInvertidas && (
        <Alert tone="warning">
          La fecha inicial es posterior a la final. Corrija el rango para ver las cifras.
        </Alert>
      )}

      {verGlobal && (
      <>
      {/* ------------------------------------------------- 1. Cifras del periodo */}
      <section className="grid gap-gutter xl:grid-cols-3">
        <Grande
          label="Venta total"
          valor={bruto}
          pie={`${plural(resumen.reservations_count, "reserva", "reservas")}${
            Number(resumen.replays_total) > 0
              ? ` + ${plural(resumen.replays_count, 'replay', 'replays')} (${mxn(resumen.replays_total)})`
              : ''
          } · ${etiquetaPeriodo}`}
          icono="pago"
        />
        <Grande
          label="Total de comisiones"
          valor={comision}
          pie="Solo sobre green fees: servicios, acompañantes y replays no generan comisión"
          icono="hotel"
          tono="text-secondary"
        />
        <Grande
          label="Ingreso neto"
          valor={neto}
          pie={`Le queda al campo el ${margen.toFixed(1)}% de la venta`}
          icono="verificado"
          oscuro
        />
      </section>

      {/* Cuánto dura una partida: del pago hasta que la finalizan. */}
      {resumen.rounds_measured > 0 && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-5 py-4 shadow-card">
          <p className="flex items-center gap-2 text-title-md text-primary">
            <Icono nombre="reloj" size={17} className="text-secondary" />
            Duración promedio de una partida
            <span className="text-body-md text-outline">
              · del pago al cierre · {plural(resumen.rounds_measured, 'partida medida', 'partidas medidas')}
            </span>
          </p>
          <p className="font-serif text-headline-lg text-primary">
            {resumen.avg_round_minutes} min
          </p>
        </section>
      )}

      {/* ---------------------------------------------------- 2. Métricas PGA */}
      <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded bg-secondary-container px-2 py-1 text-label-sm font-bold uppercase tracking-wider text-on-secondary-container">
              PGA
            </span>
            <div>
              <h2 className="text-title-lg text-primary">Métricas del beneficio PGA</h2>
              <p className="text-body-md text-outline">
                Control y conciliación de bonificaciones a jugadores profesionales.
              </p>
            </div>
          </div>
          <span className="rounded bg-surface-container-high px-2.5 py-1 text-label-sm uppercase tracking-wider text-on-surface-variant">
            Auditoría vigente
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Pequena
            label="Jugadores con beneficio"
            valor={plural(beneficios.length, 'jugador', 'jugadores')}
            icono="persona"
          />
          <Pequena
            label="Descuentos PGA aplicados"
            valor={mxn(resumen.pga_discounts)}
            icono="sell"
          />
          <Pequena
            label="Reservas con PGA"
            valor={plural(
              new Set(beneficios.map((b) => b.folio)).size,
              'reserva',
              'reservas',
            )}
            icono="golf"
          />
        </div>
      </section>
      </>
      )}

      {/* -------------------------------------- 3. Cobros del turno y dinero en caja */}
      <div className="grid gap-gutter xl:grid-cols-2">
        <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-outline-variant/40 px-5 py-4">
            <div>
              <h2 className="text-title-lg text-primary">Distribución de cobros</h2>
              {/* Esta tarjeta es del turno abierto, no del periodo de arriba:
                  se dice aquí porque si no, las dos cifras parecen no cuadrar
                  cuando hay partidas pagadas por adelantado. */}
              <p className="text-body-md text-outline">
                Turno de caja abierto, por forma de pago. No depende del periodo elegido.
              </p>
            </div>
            <span className="font-mono text-title-md text-primary">
              {mxn(caja?.total_mxn ?? 0)} cobrado
            </span>
          </div>

          <ul className="divide-y divide-outline-variant/30">
            <Forma icono="pago" nombre="Tarjeta / TPV" monto={caja?.card_mxn} />
            <Forma icono="cajaFuerte" nombre="Efectivo en mostrador" monto={caja?.cash_mxn} />
            <Forma icono="enviar" nombre="Transferencia directa" monto={caja?.transfer_mxn} />
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/40 px-5 py-4">
            <p className="text-body-md text-outline">
              {verGlobal
                ? `Pendiente de cobro en el periodo: ${mxn(resumen.pending_collection)}`
                : `${caja?.payment_count ?? 0} movimientos en el turno`}
            </p>
            {verGlobal && (
              <span className="rounded bg-surface-container-low px-2.5 py-1 font-mono text-label-sm text-primary">
                {porcentajeCobrado.toFixed(1)}% liquidado
              </span>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-outline-variant/40 px-5 py-4">
            <div>
              <h2 className="text-title-lg text-primary">Dinero en caja</h2>
              <p className="text-body-md text-outline">
                El efectivo que está físicamente en el cajón. La terminal y las transferencias
                se cobran igual, pero ese dinero no pasa por la caja.
              </p>
            </div>
            <span
              className={`rounded px-2.5 py-1 text-label-sm uppercase tracking-wider ${
                caja?.session_id
                  ? 'bg-estado-pend-bg text-estado-pend-text'
                  : 'bg-surface-container-high text-outline'
              }`}
            >
              {caja?.session_id ? 'En custodia' : 'Sin turno abierto'}
            </span>
          </div>

          <div className="p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Efectivo en caja
                </p>
                <p className="font-serif text-headline-lg text-primary">
                  {mxn(caja?.cash_mxn ?? 0)}
                </p>
                <p className="text-label-sm text-outline">
                  Ya descontado el cambio entregado · {caja?.payment_count ?? 0} movimientos en el
                  turno
                </p>
              </div>
              <div className="rounded border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Efectivo en USD recibido
                </p>
                <p className="font-serif text-headline-lg text-secondary">
                  {Number(caja?.usd_cash_original ?? 0).toFixed(2)} USD
                </p>
                <p className="text-label-sm text-outline">
                  Ya contado arriba, convertido al TC del día
                </p>
              </div>
            </div>

            {/* Terminal y transferencias ya se ven arriba, por forma de pago.
                Aquí solo se aclara para que nadie las busque en el cajón. */}
            <p className="mt-3 text-body-md text-outline">
              Con terminal {mxn(caja?.card_mxn ?? 0)} y por transferencia{' '}
              {mxn(caja?.transfer_mxn ?? 0)}: ese dinero llega al banco, no a la caja.
            </p>

            {caja?.opened_by_name && (
              <p className="mt-3 flex items-start gap-2 text-body-md text-outline">
                <Icono nombre="reloj" size={15} className="mt-0.5 shrink-0 text-secondary" />
                Turno abierto por {caja.opened_by_name}
                {caja.opened_at ? ` el ${fechaHora(caja.opened_at)}` : ''}.
              </p>
            )}

            {/* Abrir y cerrar el turno es de operaciones. Recepción cobra
                dentro del turno abierto, así que aquí solo lo ve. */}
            {can('cash_session:manage') ? (
              caja?.session_id ? (
                <button
                  onClick={() => setCorteAbierto(true)}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-primary-container px-5 py-3 text-title-md text-on-primary shadow-card transition hover:bg-primary"
                >
                  <Icono nombre="candado" size={17} className="text-secondary-fixed" />
                  Hacer el corte de caja
                </button>
              ) : (
                <button
                  onClick={abrirTurno}
                  disabled={abriendo}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded border border-outline-variant px-5 py-3 text-title-md text-on-surface transition hover:bg-surface-container-low disabled:opacity-60"
                >
                  <Icono nombre="cajaFuerte" size={17} className="text-secondary" />
                  {abriendo ? 'Abriendo…' : 'Abrir turno de caja'}
                </button>
              )
            ) : (
              !caja?.session_id && (
                <p className="mt-4 flex items-start gap-2 rounded bg-estado-pend-bg px-4 py-3 text-body-md text-estado-pend-text">
                  <Icono nombre="reloj" size={16} className="mt-0.5 shrink-0" />
                  No hay turno de caja abierto. Pida a operaciones que lo abra para poder
                  registrar cobros.
                </p>
              )
            )}
          </div>
        </section>
      </div>

      {corteAbierto && (
        <CorteDeCaja
          caja={caja}
          onCerrar={() => setCorteAbierto(false)}
          onCerrado={(mensaje) => {
            setCorteAbierto(false);
            setAviso(mensaje);
            cargar(false);
          }}
        />
      )}

      {verGlobal && (
      <>
      {/* ---------------------------------------------- 4. Liquidación hotelera */}
      <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-outline-variant/40 p-5">
          <div>
            <h2 className="font-serif text-headline-lg text-primary">
              Liquidación de hoteles asociados
            </h2>
            <p className="text-body-md text-outline">
              Desglose de reservas, bonificaciones PGA y comisión por entidad.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded bg-secondary-container px-2.5 py-1 text-label-sm uppercase tracking-wider text-on-secondary-container">
              Total retenido: {mxn(comision)}
            </span>
            <span className="rounded bg-estado-ok-bg px-2.5 py-1 text-label-sm uppercase tracking-wider text-estado-ok-text">
              Bonificación PGA: {mxn(resumen.pga_discounts)}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant">
                {['Hotel / entidad', 'Reservas', 'Venta bruta', 'Descto. PGA', 'Comisión', 'Neto campo', 'Estado'].map(
                  (c, i) => (
                    <th
                      key={c}
                      className={`whitespace-nowrap px-3 py-3 text-label-sm uppercase tracking-wider ${
                        i === 0 ? 'w-full' : ''
                      } ${i >= 2 && i <= 5 ? 'text-right' : ''}`}
                    >
                      {c}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {resumen.by_hotel.map((h) => {
                const liquidada = liquidaciones.find(
                  (l) => l.hotel_id === h.hotel_id && l.status === 'LIQUIDADA',
                );
                return (
                  <tr
                    key={h.hotel_id}
                    className="border-t border-outline-variant/30 transition hover:bg-surface-container-low/60"
                  >
                    <td className="max-w-0 truncate px-3 py-3.5 text-title-md text-primary">
                      {h.hotel_name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 font-mono text-body-lg text-on-surface">
                      {h.reservations_count}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono text-body-lg text-primary">
                      {mxn(h.gross_sales)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono text-body-lg text-estado-ok-text">
                      {Number(h.pga_discounts) > 0 ? `−${mxn(h.pga_discounts)}` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono text-body-lg text-secondary">
                      {mxn(h.commission_amount)}
                      <span className="ml-1.5 text-label-sm text-outline">
                        {Number(h.commission_rate_applied).toFixed(0)}%
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono text-title-md text-primary">
                      {mxn(h.net_course)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5">
                      <span
                        className={`rounded px-2 py-0.5 text-label-sm uppercase tracking-wider ${
                          liquidada
                            ? 'bg-estado-ok-bg text-estado-ok-text'
                            : 'bg-estado-pend-bg text-estado-pend-text'
                        }`}
                      >
                        {liquidada ? 'Liquidado' : 'Pendiente'}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {resumen.by_hotel.length > 0 && (
                <tr className="border-t-2 border-outline-variant bg-surface-container-low">
                  <td className="max-w-0 truncate px-3 py-3.5 text-title-md text-primary">
                    Total consolidado
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 font-mono text-body-lg text-primary">
                    {resumen.reservations_count}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono text-title-md text-primary">
                    {mxn(bruto)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono text-title-md text-estado-ok-text">
                    −{mxn(resumen.pga_discounts)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono text-title-md text-secondary">
                    {mxn(comision)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono text-title-md text-primary">
                    {mxn(neto)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 font-mono text-label-sm text-outline">
                    {margen.toFixed(0)}% neto
                  </td>
                </tr>
              )}

              {resumen.by_hotel.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-body-lg text-outline">
                    Sin operaciones en el periodo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Lo de arriba es lo devengado en el periodo que se está viendo; esto
            de abajo son las liquidaciones ya emitidas, que no cambian aunque
            se mueva el calendario. */}
        {liquidaciones.length > 0 && (
          <div className="border-t border-outline-variant/40 p-5">
            <p className="mb-2.5 flex items-center gap-2 text-label-md uppercase tracking-wider text-primary">
              <Icono nombre="historial" size={15} className="text-secondary" />
              Liquidaciones ya emitidas
            </p>
            <ul className="divide-y divide-outline-variant/30">
              {liquidaciones.slice(0, 12).map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-title-md text-primary">{l.hotel_name}</span>
                    <span className="block font-mono text-label-sm text-outline">
                      {fecha(l.period_start)} – {fecha(l.period_end)} · {l.reservations_count}{' '}
                      reservas
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-title-md text-secondary">
                      {mxn(l.commission_amount)}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-label-sm uppercase tracking-wider ${
                        l.status === 'LIQUIDADA'
                          ? 'bg-estado-ok-bg text-estado-ok-text'
                          : 'bg-estado-pend-bg text-estado-pend-text'
                      }`}
                    >
                      {l.status === 'LIQUIDADA'
                        ? `Pagada ${l.settled_at ? fecha(l.settled_at) : ''}`
                        : 'Por pagar'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ------------------------------------------ 5. Auditoría de beneficios */}
      <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-outline-variant/40 p-5">
          <div>
            <h2 className="flex flex-wrap items-center gap-2.5 font-serif text-headline-lg text-primary">
              Detalle de beneficios PGA aplicados
              <span className="rounded bg-surface-container-high px-2.5 py-1 text-label-sm uppercase tracking-wider text-on-surface-variant">
                Auditoría administrativa
              </span>
            </h2>
            <p className="text-body-md text-outline">
              Registro individual de bonificaciones a titulares de credencial.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant">
                {['Folio', 'Hotel', 'Jugador', 'Credencial PGA', 'Tarifa base', 'Descuento', 'Tarifa final', 'Validó'].map(
                  (c, i) => (
                    <th
                      key={c}
                      className={`whitespace-nowrap px-3 py-3 text-label-sm uppercase tracking-wider ${
                        i === 1 ? 'w-full' : ''
                      } ${i >= 4 && i <= 6 ? 'text-right' : ''}`}
                    >
                      {c}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {beneficios.map((b, i) => (
                <tr key={`${b.folio}-${i}`} className="border-t border-outline-variant/30">
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className="block font-mono text-body-lg text-primary">#{b.folio}</span>
                    <span className="block font-mono text-label-sm text-outline">
                      {fecha(b.slot_date)}
                    </span>
                  </td>
                  <td className="max-w-0 truncate px-3 py-3 text-body-lg text-on-surface-variant">
                    {b.hotel_name || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-body-lg text-on-surface">
                    {b.player_name}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className="rounded bg-secondary-container px-2 py-0.5 font-mono text-label-sm text-on-secondary-container">
                      {b.pga_code}
                    </span>
                    {b.credential_number && (
                      <span className="mt-0.5 block font-mono text-label-sm text-outline">
                        Cred. {b.credential_number}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-body-lg text-on-surface">
                    {mxn(b.base_rate)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-body-lg text-estado-ok-text">
                    −{mxn(b.discount)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-title-md text-primary">
                    {mxn(b.final_rate)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-body-md text-outline">
                    {b.validated_by || '—'}
                  </td>
                </tr>
              ))}
              {beneficios.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-body-lg text-outline">
                    No se aplicó ningún beneficio PGA en el periodo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="flex items-start gap-2 border-t border-outline-variant/40 px-5 py-4 text-body-md text-outline">
          <Icono nombre="escudo" size={16} className="mt-0.5 shrink-0 text-secondary" />
          El descuento PGA lo configura la Administración. Es un beneficio individual, aplicado
          únicamente al titular de la credencial verificada en el mostrador.
        </p>
      </section>
      </>
      )}

      {ultimoCierre && (
        <p className="flex items-center gap-2 px-1 text-body-md text-outline">
          <Icono nombre="verificado" size={16} className="text-secondary" />
          Último corte de caja: {fechaHora(ultimoCierre.closed_at)} por{' '}
          {ultimoCierre.closed_by_name || 'recepción'} · diferencia{' '}
          {mxn(ultimoCierre.difference_mxn)}.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- piezas */

function Grande({ label, valor, pie, icono, tono, oscuro }) {
  return (
    <div
      className={`rounded-lg p-6 shadow-card ${
        oscuro
          ? 'bg-primary-container text-on-primary'
          : 'border border-outline-variant/50 bg-surface-container-lowest'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={`text-label-sm uppercase tracking-wider ${
            oscuro ? 'text-secondary-fixed' : 'text-on-surface-variant'
          }`}
        >
          {label}
        </p>
        <Icono nombre={icono} size={20} className={oscuro ? 'text-secondary-fixed' : 'text-outline'} />
      </div>
      <p
        className={`mt-1 font-serif text-display-lg leading-none ${
          oscuro ? 'text-on-primary' : tono || 'text-primary'
        }`}
      >
        {mxn(valor)}
      </p>
      <p className={`mt-1.5 text-body-md ${oscuro ? 'text-primary-fixed' : 'text-outline'}`}>{pie}</p>
    </div>
  );
}

function Pequena({ label, valor, icono }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded border border-outline-variant/50 bg-surface-container-low px-4 py-3">
      <div>
        <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</p>
        <p className="font-serif text-headline-lg text-primary">{valor}</p>
      </div>
      <Icono nombre={icono} size={19} className="text-outline" />
    </div>
  );
}

function Forma({ icono, nombre, monto }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3.5">
      <span className="flex items-center gap-2.5 text-body-lg text-on-surface">
        <Icono nombre={icono} size={18} className="text-secondary" />
        {nombre}
      </span>
      <span className="font-mono text-title-md text-primary">{mxn(monto ?? 0)}</span>
    </li>
  );
}

/** Corte de caja: se captura lo contado y el sistema calcula la diferencia. */
function CorteDeCaja({ caja, onCerrar, onCerrado }) {
  const [form, setForm] = useState({
    counted_cash_mxn: '',
    counted_cash_usd: '',
    counted_card_mxn: '',
    counted_transfer_mxn: '',
    notes: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function cerrar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const sesion = await treasuryApi.closeCash(caja.session_id, {
        counted_cash_mxn: form.counted_cash_mxn || '0',
        counted_cash_usd: form.counted_cash_usd || '0',
        counted_card_mxn: form.counted_card_mxn || '0',
        counted_transfer_mxn: form.counted_transfer_mxn || '0',
        notes: form.notes || null,
      });
      const diferencia = Number(sesion.difference_mxn);
      onCerrado(
        Math.abs(diferencia) < 0.01
          ? 'Caja cerrada sin diferencias.'
          : `Caja cerrada con una diferencia de ${mxn(diferencia)}. Queda registrada para justificar.`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={cerrar}
        className="w-full max-w-2xl rounded-lg bg-surface-container-lowest p-6 shadow-modal"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-headline-lg text-primary">Corte de caja</h2>
            <p className="text-body-md text-outline">
              Anote lo que contó de verdad. El sistema lo compara con lo que debería haber y
              guarda la diferencia; no se puede corregir a mano.
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

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Contado
            label="Efectivo MXN contado"
            esperado={caja?.cash_mxn}
            value={form.counted_cash_mxn}
            onChange={set('counted_cash_mxn')}
          />
          <Contado
            label="Efectivo USD contado"
            esperado={caja?.usd_cash_original}
            moneda="USD"
            value={form.counted_cash_usd}
            onChange={set('counted_cash_usd')}
          />
          <Contado
            label="Tarjeta / TPV"
            esperado={caja?.card_mxn}
            value={form.counted_card_mxn}
            onChange={set('counted_card_mxn')}
          />
          <Contado
            label="Transferencias"
            esperado={caja?.transfer_mxn}
            value={form.counted_transfer_mxn}
            onChange={set('counted_transfer_mxn')}
          />
        </div>

        <label className="block">
          <span className="mb-1.5 block text-label-sm uppercase tracking-wider text-on-surface-variant">
            Observaciones del turno
          </span>
          <textarea
            rows={2}
            value={form.notes}
            onChange={set('notes')}
            placeholder="Justificación de cualquier diferencia"
            className="w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-lg text-on-surface focus:border-primary-container focus:outline-none"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2.5">
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
            {guardando ? 'Cerrando…' : 'Cerrar caja'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Contado({ label, esperado, value, onChange, moneda = 'MXN' }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-label-sm uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={onChange}
        placeholder="0.00"
        className="w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-right font-mono text-body-lg text-on-surface focus:border-primary-container focus:outline-none"
      />
      <span className="mt-1 block text-label-sm text-outline">
        Esperado:{' '}
        {moneda === 'USD' ? `${Number(esperado ?? 0).toFixed(2)} USD` : mxn(esperado ?? 0)}
      </span>
    </label>
  );
}

/** Informe en CSV: es lo que abre cualquier hoja de cálculo sin plugins. */
function exportarInforme(resumen, beneficios, start, end) {
  const filas = [
    ['Las Parotas · Informe de finanzas'],
    ['Periodo', start, end],
    [],
    ['Concepto', 'Monto MXN'],
    ['Venta bruta', resumen.gross_sales],
    ['Cobrado', resumen.total_collected],
    ['Pendiente de cobro', resumen.pending_collection],
    ['Servicios', resumen.services_total],
    ['Replays (sin comisión)', resumen.replays_total],
    ['Descuentos PGA', resumen.pga_discounts],
    ['Comisión a hoteles', resumen.hotel_commissions],
    ['Ingreso neto del campo', resumen.net_course],
    [],
    ['Hotel', 'Reservas', 'Venta bruta', 'Descuento PGA', 'Comisión', 'Neto campo'],
    ...resumen.by_hotel.map((h) => [
      h.hotel_name,
      h.reservations_count,
      h.gross_sales,
      h.pga_discounts,
      h.commission_amount,
      h.net_course,
    ]),
    [],
    ['Fecha', 'Folio', 'Hotel', 'Jugador', 'PGA', 'Tarifa', 'Descuento', 'Final', 'Validó'],
    ...beneficios.map((b) => [
      b.slot_date,
      b.folio,
      b.hotel_name,
      b.player_name,
      b.pga_code,
      b.base_rate,
      b.discount,
      b.final_rate,
      b.validated_by,
    ]),
  ];

  const csv = filas
    .map((fila) => fila.map((celda) => `"${String(celda ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  enlace.download = `las-parotas-finanzas-${start}-a-${end}.csv`;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}
