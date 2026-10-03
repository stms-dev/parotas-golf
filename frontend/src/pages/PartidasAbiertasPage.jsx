/**
 * Control de partidas abiertas.
 *
 * Una partida abierta junta huéspedes de hoteles distintos en la misma salida.
 * Eso necesita a alguien decidiendo, y hasta ahora el sistema solo la dejaba
 * llenarse sola hasta los cuatro lugares. Aquí operaciones ve con quién quedó
 * cada grupo y puede acomodarlo:
 *
 *   · Ver quiénes se juntaron y de qué hotel viene cada uno.
 *   · Cerrar una salida antes de que se llene, cuando ya se va a despachar.
 *   · Pasar a un hotel de una salida a otra, para armar mejor los grupos.
 *   · No aceptar partidas abiertas ese día, si el campo está pesado.
 *
 * Es de piso, no de mostrador: el que decide con quién juega un huésped es el
 * que está viendo el campo. El backend vuelve a validar el permiso.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { bookingApi } from '../api/client';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Badge, Button, Card, EmptyState, Modal, Select, Spinner } from '../components/ui';
import Icono from '../components/Icono';
import { confirmar, error as avisoError, exito } from '../utils/avisos';
import { ESTADO_RESERVA, fechaCorta, hora, hoy } from '../utils/format';

export default function PartidasAbiertasPage() {
  const [dia, setDia] = useState(hoy());
  const [datos, setDatos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(null);
  // La reserva que se está moviendo, junto con la salida a la que iría.
  const [mover, setMover] = useState(null);

  function cargar(conSpinner = true) {
    if (conSpinner) setLoading(true);
    bookingApi
      .partidasAbiertas({ slot_date: dia })
      .then((respuesta) => {
        setDatos(respuesta);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    cargar();
  }, [dia]);

  // Alguien más vendió, canceló o movió: la pantalla se pone al día sola. Sin
  // esto, dos operadores acomodando grupos al mismo tiempo se pisarían.
  useRealtimeEvent(
    [
      EVENTOS.RESERVA_CREADA,
      EVENTOS.RESERVA_ACTUALIZADA,
      EVENTOS.RESERVA_CANCELADA,
      EVENTOS.DISPONIBILIDAD_CAMBIADA,
    ],
    () => cargar(false),
  );

  const salidas = datos?.salidas || [];
  const admite = datos?.admite_abiertas !== false;
  const jugadores = salidas.reduce((suma, s) => suma + s.occupied, 0);
  const hoteles = new Set(
    salidas.flatMap((s) => s.reservas.map((r) => r.hotel_name).filter(Boolean)),
  );

  async function alternarDia() {
    const cerrando = admite;
    const acepta = await confirmar({
      titulo: cerrando ? '¿No aceptar partidas abiertas ese día?' : '¿Volver a aceptarlas?',
      texto: cerrando
        ? `Los hoteles ya no podrán armar partidas abiertas para el ${fechaCorta(dia)}. ` +
          'Las que ya estaban vendidas no se tocan, y los grupos se siguen reservando igual.'
        : `El ${fechaCorta(dia)} vuelve a admitir partidas abiertas.`,
      confirmar: cerrando ? 'Sí, cerrar el día' : 'Sí, reabrirlo',
    });
    if (!acepta) return;

    let nota = null;
    if (cerrando) {
      // Para qué se cerró. Se ve aquí y queda en la bitácora: dentro de un mes
      // nadie se va a acordar de por qué ese jueves no hubo partidas abiertas.
      nota = window.prompt('¿Por qué? (opcional — queda anotado)', '') || null;
    }

    setTrabajando('dia');
    try {
      await bookingApi.reglaDelDia({ dia, admite: !admite, nota });
      cargar(false);
      exito(
        cerrando ? 'Día cerrado a partidas abiertas' : 'Día reabierto',
        cerrando
          ? 'Los hoteles verán la modalidad deshabilitada para ese día.'
          : 'La modalidad vuelve a la venta.',
      );
    } catch (err) {
      avisoError('No se pudo cambiar la regla del día', err.message);
    } finally {
      setTrabajando(null);
    }
  }

  async function alternarSalida(salida) {
    const cerrando = !salida.cerrada;
    if (cerrando) {
      const acepta = await confirmar({
        titulo: `¿Cerrar la partida de las ${hora(salida.slot_time)}?`,
        texto:
          `Quedan ${salida.libres} lugar(es) libre(s). Al cerrarla ya no entra nadie ` +
          'más, aunque sobre espacio. Se puede volver a abrir.',
        confirmar: 'Sí, cerrarla',
      });
      if (!acepta) return;
    }

    setTrabajando(`salida-${salida.tee_slot_id}`);
    try {
      await bookingApi.cerrarPartidaAbierta(salida.tee_slot_id, cerrando);
      cargar(false);
    } catch (err) {
      avisoError('No se pudo cambiar la salida', err.message);
    } finally {
      setTrabajando(null);
    }
  }

  async function confirmarMovimiento() {
    if (!mover?.destino) return;
    setTrabajando(`mover-${mover.reserva.id}`);
    try {
      await bookingApi.moverReserva(mover.reserva.id, Number(mover.destino));
      setMover(null);
      cargar(false);
      exito('Partida movida', `${mover.reserva.folio} cambió de salida.`);
    } catch (err) {
      avisoError('No se pudo mover', err.message);
    } finally {
      setTrabajando(null);
    }
  }

  // A dónde se puede mover: otra partida abierta del mismo día, abierta y con
  // lugar para los jugadores que vienen en la reserva.
  const destinos = mover
    ? salidas.filter(
        (s) =>
          s.tee_slot_id !== mover.origen.tee_slot_id &&
          !s.cerrada &&
          s.libres >= mover.reserva.jugadores.length,
      )
    : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="flex flex-wrap items-baseline gap-3 font-serif text-display-lg leading-tight text-primary">
            Partidas abiertas
            <span className="text-body-lg text-outline">{fechaCorta(dia)}</span>
          </h1>
          <p className="text-body-lg text-outline">
            Con quién quedó armado cada grupo. Cierre una salida antes de que se llene,
            pase a un hotel de una a otra, o deje el día sin partidas abiertas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5">
            <Icono nombre="calendario" size={15} className="shrink-0 text-secondary" />
            <input
              type="date"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              className="bg-transparent text-body-md text-on-surface focus:outline-none"
            />
          </div>
          <Button
            variant={admite ? 'danger' : 'primary'}
            onClick={alternarDia}
            disabled={trabajando === 'dia'}
          >
            <Icono nombre={admite ? 'cancelar' : 'check'} size={16} />
            {admite ? 'No aceptar ese día' : 'Volver a aceptarlas'}
          </Button>
        </div>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      {!admite && (
        <Alert tone="warning" title="Este día no acepta partidas abiertas">
          Los hoteles no pueden armar grupos revueltos el {fechaCorta(dia)}. Las que ya
          estaban vendidas siguen en pie y los grupos se venden igual.
        </Alert>
      )}

      {loading ? (
        <Spinner label="Cargando las partidas del día…" />
      ) : salidas.length === 0 ? (
        <EmptyState
          title="No hay partidas abiertas ese día"
          description="Cuando un hotel reserve en partida abierta, la salida aparece aquí con la gente que se vaya juntando."
        />
      ) : (
        <>
          <section className="grid gap-gutter sm:grid-cols-3">
            <Resumen label="Salidas armadas" valor={salidas.length} icono="golf" />
            <Resumen label="Jugadores" valor={jugadores} icono="grupo" />
            <Resumen
              label="Hoteles distintos"
              valor={hoteles.size}
              icono="apartment"
              pie={[...hoteles].join(' · ') || '—'}
            />
          </section>

          <div className="space-y-4">
            {salidas.map((salida) => (
              <Card
                key={salida.tee_slot_id}
                title={`Salida de las ${hora(salida.slot_time)}`}
                subtitle={
                  salida.cerrada
                    ? `Cerrada a mano con ${salida.occupied} de ${salida.capacity} lugares`
                    : `${salida.occupied} de ${salida.capacity} lugares · quedan ${salida.libres}`
                }
                action={
                  <div className="flex shrink-0 items-center gap-2">
                    {salida.cerrada && <Badge variant="cancelado">Cerrada</Badge>}
                    {!salida.cerrada && salida.libres === 0 && (
                      <Badge variant="ok">Completa</Badge>
                    )}
                    <Button
                      size="sm"
                      variant={salida.cerrada ? 'secondary' : 'auric'}
                      onClick={() => alternarSalida(salida)}
                      disabled={trabajando === `salida-${salida.tee_slot_id}`}
                    >
                      {salida.cerrada ? 'Reabrir' : 'Cerrar ya'}
                    </Button>
                  </div>
                }
                bodyClass="p-0"
              >
                <ul className="divide-y divide-outline-variant/40">
                  {salida.reservas.map((reserva) => (
                    <li
                      key={reserva.id}
                      className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/reservas/${reserva.id}`}
                            className="font-serif text-title-lg text-primary hover:underline"
                          >
                            {reserva.folio}
                          </Link>
                          <Badge variant={ESTADO_RESERVA[reserva.status]?.variant || 'neutro'}>
                            {ESTADO_RESERVA[reserva.status]?.label || reserva.status}
                          </Badge>
                          <span className="text-body-md text-secondary">
                            {reserva.hotel_name || 'Público general'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-body-md text-outline">
                          {reserva.jugadores.join(', ')}
                          {reserva.booked_by_name && (
                            <span className="text-outline"> · la levantó {reserva.booked_by_name}</span>
                          )}
                        </p>
                      </div>

                      <Button
                        size="sm"
                        variant="secondary"
                        className="shrink-0"
                        onClick={() => setMover({ reserva, origen: salida, destino: '' })}
                      >
                        <Icono nombre="intercambiar" size={15} /> Mover
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* --------------------------------------------------- mover de salida */}
      <Modal
        open={Boolean(mover)}
        title="Pasar a otra partida abierta"
        onClose={() => setMover(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMover(null)}>
              Cancelar
            </Button>
            <Button
              onClick={confirmarMovimiento}
              disabled={!mover?.destino || trabajando === `mover-${mover?.reserva?.id}`}
            >
              Moverla
            </Button>
          </>
        }
      >
        {mover && (
          <div className="space-y-4">
            <p className="text-body-lg text-on-surface">
              <span className="font-serif text-title-lg text-primary">{mover.reserva.folio}</span>{' '}
              — {mover.reserva.hotel_name || 'Público general'}, {mover.reserva.jugadores.length}{' '}
              jugador(es), hoy en la salida de las {hora(mover.origen.slot_time)}.
            </p>

            <Select
              value={mover.destino}
              onChange={(e) => setMover({ ...mover, destino: e.target.value })}
            >
              <option value="">Elija la salida…</option>
              {destinos.map((s) => (
                <option key={s.tee_slot_id} value={s.tee_slot_id}>
                  {hora(s.slot_time)} · {s.occupied}/{s.capacity} ocupados ·{' '}
                  {s.reservas.map((r) => r.hotel_name || 'Público').join(', ')}
                </option>
              ))}
            </Select>

            {destinos.length === 0 && (
              <Alert tone="warning">
                No hay otra partida abierta ese día con lugar para{' '}
                {mover.reserva.jugadores.length} jugador(es). Reserve una salida nueva en
                partida abierta y vuelva a intentarlo.
              </Alert>
            )}

            <p className="text-body-md text-outline">
              Se mueve la reserva completa, con su cobro y su comisión. Para separar
              jugadores hay que cancelar y volver a reservar.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Resumen({ label, valor, pie, icono }) {
  return (
    <div className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-label-sm uppercase tracking-wider text-outline">{label}</span>
        {icono && <Icono nombre={icono} size={16} className="text-secondary" />}
      </div>
      <p className="font-serif text-headline-lg leading-none text-primary">{valor}</p>
      {pie && <p className="mt-1.5 truncate text-body-md text-outline">{pie}</p>}
    </div>
  );
}
