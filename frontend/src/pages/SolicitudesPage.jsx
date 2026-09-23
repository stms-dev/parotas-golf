/**
 * Solicitudes del día.
 *
 * Es la bandeja del mostrador: lo que los hoteles fueron mandando para hoy,
 * con lo que falta por atender arriba. Sirve para dos cosas que antes no
 * tenían dónde hacerse:
 *
 *   1. Ver de un vistazo quién falta por llegar y a qué hora sale.
 *   2. Cerrar las que ya no van a llegar. Pasada su hora, la partida se marca
 *      como "no se presentó" o se cancela, y así el hotel deja de verla
 *      pendiente en su panel.
 *
 * La regla de la hora la valida también el servidor: antes de que pase su
 * salida, nadie puede darla por ausente.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { bookingApi, dashboardApi } from '../api/client';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Spinner } from '../components/ui';
import Icono from '../components/Icono';
import { confirmar, error as avisoError, exito } from '../utils/avisos';
import { ESTADO_RESERVA, MODALIDAD, fechaHora, hora, hoy, mxn } from '../utils/format';

const FILTROS = [
  { key: 'pendientes', label: 'Por atender' },
  { key: 'atendidas', label: 'Atendidas' },
  { key: 'cerradas', label: 'Canceladas y ausentes' },
  { key: 'todas', label: 'Todas' },
];

/** Una salida ya pasó cuando su hora es anterior a la de ahora. */
function yaPaso(fecha, horaSalida) {
  if (!fecha || !horaSalida) return false;
  return new Date(`${fecha}T${String(horaSalida).slice(0, 8)}`) < new Date();
}

export default function SolicitudesPage() {
  const [dia, setDia] = useState(hoy());
  const [filtro, setFiltro] = useState('pendientes');
  const [reservas, setReservas] = useState([]);
  const [panel, setPanel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(null);

  function cargar(conSpinner = true) {
    if (conSpinner) setLoading(true);
    Promise.all([
      bookingApi.list({ slot_date: dia, limit: 200 }),
      dashboardApi.get({ target: dia }).catch(() => null),
    ])
      .then(([lista, tablero]) => {
        setReservas(lista);
        setPanel(tablero);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    cargar();
  }, [dia]);

  useRealtimeEvent(
    [
      EVENTOS.RESERVA_CREADA,
      EVENTOS.RESERVA_ACTUALIZADA,
      EVENTOS.RESERVA_CANCELADA,
      EVENTOS.CHECKIN_REGISTRADO,
    ],
    () => cargar(false),
  );

  async function marcarNoShow(reserva) {
    const ok = await confirmar({
      titulo: 'Marcar como no presentada',
      texto:
        `La partida <b>#${reserva.folio}</b> de las <b>${hora(reserva.slot_time)}</b> quedará como ` +
        '<b>no se presentó</b>.<br><span style="font-size:.9em;opacity:.75">El hotel la verá así ' +
        'y el horario se libera.</span>',
      confirmar: 'Sí, no se presentó',
      icono: 'question',
    });
    if (!ok) return;
    setTrabajando(reserva.id);
    try {
      await bookingApi.noShow(reserva.id);
      await exito('Partida cerrada', `<b>#${reserva.folio}</b> quedó como no presentada.`);
      cargar(false);
    } catch (err) {
      await avisoError('No se pudo marcar', err.message);
    } finally {
      setTrabajando(null);
    }
  }

  async function cancelar(reserva) {
    const ok = await confirmar({
      titulo: 'Cancelar la solicitud',
      texto:
        `Se cancelará la partida <b>#${reserva.folio}</b> de las <b>${hora(reserva.slot_time)}</b> ` +
        'y su horario vuelve a estar libre.',
      confirmar: 'Sí, cancelar',
      icono: 'warning',
    });
    if (!ok) return;
    setTrabajando(reserva.id);
    try {
      await bookingApi.cancel(reserva.id, 'Cancelada en el mostrador');
      await exito('Solicitud cancelada', `<b>#${reserva.folio}</b> liberó su horario.`);
      cargar(false);
    } catch (err) {
      await avisoError('No se pudo cancelar', err.message);
    } finally {
      setTrabajando(null);
    }
  }

  const listas = useMemo(() => {
    const porAtender = reservas.filter((r) => ['PENDIENTE', 'CONFIRMADA'].includes(r.status));
    const atendidas = reservas.filter((r) =>
      ['CHECK_IN', 'EN_JUEGO', 'COMPLETADA'].includes(r.status),
    );
    const cerradas = reservas.filter((r) => ['CANCELADA', 'NO_SHOW'].includes(r.status));
    return { porAtender, atendidas, cerradas };
  }, [reservas]);

  const visibles = useMemo(() => {
    const orden = (a, b) => `${a.slot_time}`.localeCompare(`${b.slot_time}`);
    if (filtro === 'pendientes') return [...listas.porAtender].sort(orden);
    if (filtro === 'atendidas') return [...listas.atendidas].sort(orden);
    if (filtro === 'cerradas') return [...listas.cerradas].sort(orden);
    return [...reservas].sort(orden);
  }, [filtro, listas, reservas]);

  const vencidas = listas.porAtender.filter((r) => yaPaso(r.slot_date, r.slot_time));

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}

      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="font-serif text-display-lg leading-tight text-primary">
            Solicitudes del día
          </h1>
          <p className="text-body-lg text-outline">
            Lo que mandaron los hoteles. Pasada su hora, aquí se cierran las que no llegaron.
          </p>
        </div>
        <label className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2">
          <Icono nombre="calendar_today" size={16} className="text-secondary" />
          <span className="text-label-sm uppercase tracking-wider text-outline">Día</span>
          <input
            type="date"
            value={dia}
            onChange={(e) => setDia(e.target.value || hoy())}
            className="bg-transparent font-mono text-body-lg text-on-surface focus:outline-none"
          />
        </label>
      </header>

      <section className="grid gap-gutter sm:grid-cols-2 xl:grid-cols-4">
        <Cifra
          label="Por atender"
          valor={listas.porAtender.length}
          pie={`${vencidas.length} ya pasaron su hora`}
          icono="registro"
        />
        <Cifra
          label="En el campo o cobradas"
          valor={listas.atendidas.length}
          pie="check-in hecho"
          icono="how_to_reg"
        />
        <Cifra
          label="Canceladas y ausentes"
          valor={listas.cerradas.length}
          pie="ya no ocupan horario"
          icono="cancelar"
        />
        <Cifra
          label="Duración promedio"
          valor={panel?.avg_round_minutes ? `${panel.avg_round_minutes} min` : '—'}
          pie={
            panel?.rounds_measured
              ? `${panel.rounds_measured} partida(s) medidas`
              : 'del pago al cierre'
          }
          icono="reloj"
          oscuro
        />
      </section>

      {vencidas.length > 0 && (
        <Alert tone="warning">
          {vencidas.length === 1
            ? 'Hay 1 solicitud que ya pasó su hora y sigue sin llegar al mostrador.'
            : `Hay ${vencidas.length} solicitudes que ya pasaron su hora y siguen sin llegar al mostrador.`}{' '}
          Ciérrelas para que el hotel deje de verlas pendientes.
        </Alert>
      )}

      <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/40 px-5 py-4">
          <h2 className="flex items-center gap-2.5 text-label-md uppercase tracking-wider text-primary">
            <Icono nombre="historial" size={18} className="text-secondary" />
            Bandeja del mostrador
          </h2>
          <div className="flex flex-wrap overflow-hidden rounded border border-outline-variant">
            {FILTROS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFiltro(f.key)}
                className={`px-3.5 py-1.5 text-title-md transition ${
                  filtro === f.key
                    ? 'bg-primary-container text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {visibles.length === 0 ? (
          <p className="px-5 py-12 text-center text-body-lg text-outline">
            Nada por aquí con ese filtro.
          </p>
        ) : (
          <ul className="divide-y divide-outline-variant/30">
            {visibles.map((r) => {
              const estado = ESTADO_RESERVA[r.status] || {};
              const pasada = yaPaso(r.slot_date, r.slot_time);
              const abierta = ['PENDIENTE', 'CONFIRMADA'].includes(r.status);
              return (
                <li
                  key={r.id}
                  className={`flex flex-wrap items-center gap-4 px-5 py-4 ${
                    abierta && pasada ? 'bg-estado-pend-bg/40' : ''
                  }`}
                >
                  <div className="w-20 shrink-0">
                    <p className="font-mono text-time-slot leading-tight text-primary">
                      {hora(r.slot_time)}
                    </p>
                    <p className="text-label-sm uppercase tracking-wider text-outline">{r.tee}</p>
                  </div>

                  <div className="min-w-[220px] flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/reservas/${r.id}`}
                        className="text-title-md text-primary hover:underline"
                      >
                        {r.holder_name}
                      </Link>
                      <span className="rounded bg-secondary-container px-2 py-0.5 text-label-sm uppercase tracking-wider text-on-secondary-container">
                        {r.hotel_name}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-label-sm uppercase tracking-wider ${
                          r.status === 'NO_SHOW' || r.status === 'CANCELADA'
                            ? 'bg-surface-container-high text-on-surface-variant'
                            : 'bg-estado-ok-bg text-estado-ok-text'
                        }`}
                      >
                        {estado.label}
                      </span>
                    </p>
                    <p className="text-body-md text-outline">
                      folio {r.folio} · {r.player_count} jugadores · {MODALIDAD[r.modality]} ·{' '}
                      {r.holes} hoyos · solicitada {fechaHora(r.created_at)}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-mono text-title-md text-primary">{mxn(r.total)}</p>
                    <p className="font-mono text-label-sm text-outline">
                      {Number(r.balance) <= 0 ? 'Pagada' : `saldo ${mxn(r.balance)}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {abierta && (
                      <Link
                        to={`/recepcion?folio=${r.folio}`}
                        className="rounded bg-primary-container px-3.5 py-2 text-title-md text-on-primary transition hover:bg-primary"
                      >
                        Atender
                      </Link>
                    )}
                    {abierta && (
                      <button
                        type="button"
                        disabled={!pasada || trabajando === r.id}
                        title={
                          pasada
                            ? 'Marcar que no llegaron'
                            : 'Se habilita cuando pase su hora de salida'
                        }
                        onClick={() => marcarNoShow(r)}
                        className="rounded border border-outline-variant px-3.5 py-2 text-title-md text-on-surface transition hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        No se presentó
                      </button>
                    )}
                    {abierta && (
                      <button
                        type="button"
                        disabled={trabajando === r.id}
                        onClick={() => cancelar(r)}
                        className="rounded border border-outline-variant px-3.5 py-2 text-title-md text-error transition hover:bg-surface-container-low disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Cifra({ label, valor, pie, icono, oscuro }) {
  return (
    <div
      className={`rounded-lg border p-5 shadow-card ${
        oscuro
          ? 'border-primary-container bg-primary-container text-on-primary'
          : 'border-outline-variant/50 bg-surface-container-lowest'
      }`}
    >
      <p
        className={`flex items-center gap-2 text-label-sm uppercase tracking-wider ${
          oscuro ? 'text-secondary-fixed' : 'text-outline'
        }`}
      >
        <Icono nombre={icono} size={15} className={oscuro ? 'text-secondary-fixed' : 'text-secondary'} />
        {label}
      </p>
      <p
        className={`mt-1 font-serif text-display-lg leading-none ${
          oscuro ? 'text-on-primary' : 'text-primary'
        }`}
      >
        {valor}
      </p>
      <p className={`text-body-md ${oscuro ? 'text-primary-fixed' : 'text-outline'}`}>{pie}</p>
    </div>
  );
}
