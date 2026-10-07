import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { bookingApi, correosApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Alert, Badge, Button, Card, Modal, Spinner, Stat, Table, Textarea } from '../components/ui';
import Icono from '../components/Icono';
import { error as avisoError, exito, pedirCorreo } from '../utils/avisos';
import {
  ESTADO_RESERVA, MODALIDAD, categoria, fecha, fechaHora, fechaLocal, hora, mxn, recorrido } from '../utils/format';

export default function ReservationDetailPage() {
  const { id } = useParams();
  const { can, isHotel } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [reservation, setReservation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(location.state?.creada ? 'Solicitud enviada. Queda pendiente de validación por el campo.' : null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [correos, setCorreos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  /** Campo suspendido: en qué hoyo se quedaron y por qué. */
  const [suspenderOpen, setSuspenderOpen] = useState(false);
  const [suspension, setSuspension] = useState({ hoyo: '', motivo: 'Lluvia' });
  /** Reposición: la salida nueva donde juegan su ronda de cortesía. */
  const [reponerOpen, setReponerOpen] = useState(false);
  const [diaReposicion, setDiaReposicion] = useState('');
  const [salidasReposicion, setSalidasReposicion] = useState([]);
  const [salidaElegida, setSalidaElegida] = useState(null);

  function cargarCorreos() {
    correosApi.deLaReserva(id).then(setCorreos).catch(() => setCorreos([]));
  }

  async function load() {
    setLoading(true);
    try {
      setReservation(await bookingApi.get(id));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    cargarCorreos();
  }, [id]);

  async function accion(fn, texto) {
    setError(null);
    try {
      setReservation(await fn());
      setMessage(texto);
    } catch (err) {
      setError(err.message);
    }
  }

  /** Marca la partida como suspendida por el clima. */
  async function suspender() {
    const hoyo = Number(suspension.hoyo);
    if (!hoyo || hoyo < 1 || hoyo > (reservation?.holes || 18)) {
      await avisoError(
        'Falta el hoyo',
        `Escriba en qué hoyo se quedaron, entre 1 y ${reservation?.holes || 18}.`,
      );
      return;
    }
    if (suspension.motivo.trim().length < 3) {
      await avisoError('Falta el motivo', 'Anote por qué se suspendió el campo.');
      return;
    }
    setSuspenderOpen(false);
    await accion(
      () => bookingApi.interrumpir(id, { hoyo, motivo: suspension.motivo.trim() }),
      `Partida suspendida en el hoyo ${hoyo}. Ya se le puede reponer la ronda.`,
    );
  }

  /** Abre el selector de salida para la ronda de cortesía. */
  async function abrirReposicion() {
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const dia = fechaLocal(manana);
    setDiaReposicion(dia);
    setReponerOpen(true);
    await cargarSalidas(dia);
  }

  async function cargarSalidas(dia) {
    setSalidaElegida(null);
    try {
      const data = await bookingApi.availability({ slot_date: dia });
      // Solo las que de verdad admiten la partida: con lugar, sin bloqueo y
      // cuya hora no pasó.
      setSalidasReposicion(
        data.slots.filter((x) => x.available > 0 && !x.expirada && x.status !== 'BLOQUEADO'),
      );
    } catch (err) {
      setSalidasReposicion([]);
      await avisoError('No se pudieron leer los horarios', err.message);
    }
  }

  async function reponer() {
    if (!salidaElegida) {
      await avisoError('Elija el horario', 'La ronda de cortesía necesita una salida.');
      return;
    }
    setReponerOpen(false);
    setError(null);
    try {
      const cortesia = await bookingApi.reagendar(id, { tee_slot_id: salidaElegida });
      await exito(
        'Ronda repuesta',
        `Se agendó el folio <b>${cortesia.folio}</b> sin costo. Reanudan en el hoyo ` +
          `${reservation.interrupted_at_hole} de ${reservation.holes}.`,
      );
      navigate(`/reservas/${cortesia.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <Spinner />;
  if (!reservation) return <Alert tone="error">{error || 'Reserva no encontrada'}</Alert>;

  const estado = ESTADO_RESERVA[reservation.status] || {};
  async function reenviarPase() {
    const destino = await pedirCorreo(reservation.holder_email);
    if (destino === null) return;
    setEnviando(true);
    try {
      const correo = await correosApi.reenviarPase(reservation.id, destino || undefined);
      cargarCorreos();
      if (correo.status === 'ENVIADO') {
        await exito('Pase enviado', `Salió a <b>${correo.to_email}</b>.`);
      } else {
        // No salió al primer intento. No se pierde: el repartidor lo vuelve a
        // intentar solo, y en Control del sistema se ve en qué quedó.
        await exito(
          'Pase pendiente',
          `No salió al momento para <b>${correo.to_email}</b>. El sistema lo reintenta ` +
            'solo; puede seguirlo en Control del sistema → Correos.',
        );
      }
    } catch (err) {
      await avisoError('No se pudo reenviar', err.message);
    } finally {
      setEnviando(false);
    }
  }

  const lineaAcompanante = reservation.services.find((s) => s.service_code === 'ACOMPANANTE');
  const totalAcompanantes = Number(lineaAcompanante?.total || 0);
  const serviciosSinAcompanantes = reservation.services.filter((s) => s.service_code !== 'ACOMPANANTE');
  const conPga = reservation.players.filter((player) => player.pga_validated);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button onClick={() => navigate('/reservas')} className="text-body-md text-outline hover:underline">
            ← Volver a reservas
          </button>
          <h1 className="mt-1 font-serif text-3xl text-primary">{reservation.folio}</h1>
          <p className="text-body-lg text-outline">
            {reservation.hotel_name} · {fecha(reservation.slot_date)} · {hora(reservation.slot_time)}
          </p>
        </div>
        <Badge variant={estado.variant} className="px-3 py-1">{estado.label}</Badge>
      </header>

      {message && <Alert tone="success" onClose={() => setMessage(null)}>{message}</Alert>}
      {error && <Alert tone="error" onClose={() => setError(null)}>{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Modalidad" value={MODALIDAD[reservation.modality]} hint={recorrido(reservation)} />
        <Stat label="Jugadores" value={reservation.players.length} hint={`${reservation.companions.length} acompañantes`} />
        <Stat label="Total" value={mxn(reservation.total)} hint={`TC ${Number(reservation.exchange_rate_applied).toFixed(2)}`} />
        <Stat
          label="Saldo"
          value={mxn(reservation.balance)}
          tone={Number(reservation.balance) > 0 ? 'alert' : 'default'}
          hint={`Pagado ${mxn(reservation.total_paid)}`}
        />
      </div>

      {/* La cadena de la cortesía, cuando hay. Se enseña arriba de las
          acciones porque cambia lo que tiene sentido hacer. */}
      {(reservation.interrupted_at_hole ||
        reservation.rescheduled_from_folio ||
        reservation.reposicion_folio) && (
        <Card title="Campo suspendido">
          <div className="space-y-2 text-body-lg">
            {reservation.interrupted_at_hole && (
              <p>
                La partida se suspendió en el{' '}
                <span className="text-primary">hoyo {reservation.interrupted_at_hole}</span> de{' '}
                {reservation.holes}
                {reservation.interrupted_reason ? ` · ${reservation.interrupted_reason}` : ''}.
              </p>
            )}
            {reservation.reposicion_folio && (
              <p className="text-outline">
                Se le repuso la ronda en el folio{' '}
                <span className="font-mono text-on-surface">{reservation.reposicion_folio}</span>,
                sin costo.
              </p>
            )}
            {reservation.rescheduled_from_folio && (
              <p className="text-outline">
                Esta es la ronda de cortesía de{' '}
                <span className="font-mono text-on-surface">
                  {reservation.rescheduled_from_folio}
                </span>
                : no se le cobra al huésped y no genera comisión.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Las acciones disponibles dependen del estado y del permiso: no se
          muestra un botón que el backend va a rechazar. */}
      <Card title="Acciones">
        <div className="flex flex-wrap gap-2">
          {reservation.status === 'PENDIENTE' && can('reservation:confirm') && (
            <Button onClick={() => accion(() => bookingApi.confirm(id), 'Reserva confirmada')}>
              Confirmar reserva
            </Button>
          )}
          {['CONFIRMADA', 'CHECK_IN'].includes(reservation.status) && can('checkin:perform') && (
            <Button onClick={() => navigate(`/recepcion?folio=${reservation.folio}`)}>Ir a check-in</Button>
          )}
          {/* En juego, lo que sigue es la salida del campo: finalizar o
              cobrar un replay. Las dos cosas se hacen en el mostrador. */}
          {reservation.status === 'EN_JUEGO' && can('checkin:perform') && (
            <Button onClick={() => navigate(`/recepcion?folio=${reservation.folio}`)}>
              Salida del campo
            </Button>
          )}
          {reservation.status === 'CONFIRMADA' && can('reservation:confirm') && (
            <Button variant="secondary" onClick={() => accion(() => bookingApi.noShow(id), 'Marcada como no-show')}>
              Marcar no-show
            </Button>
          )}
          {/* Llovió y la partida no se pudo terminar. Es cortesía del campo,
              así que la decide operaciones. */}
          {reservation.status === 'EN_JUEGO' && can('reservation:reschedule') && (
            <Button variant="secondary" onClick={() => setSuspenderOpen(true)}>
              Campo suspendido
            </Button>
          )}
          {reservation.status === 'INTERRUMPIDA' &&
            can('reservation:reschedule') &&
            !reservation.reposicion_folio && (
              <Button onClick={abrirReposicion}>Reponer la ronda</Button>
            )}
          {['PENDIENTE', 'CONFIRMADA', 'CHECK_IN'].includes(reservation.status) && can('reservation:cancel') && (
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              Cancelar reserva
            </Button>
          )}
          {/* El pase ya salió solo al crear la reserva. Esto es para cuando
              hace falta repetirlo: el huésped lo borró, el concierge escribió
              mal el correo, o se lo quieren mandar a alguien más. */}
          <Button variant="secondary" onClick={reenviarPase} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Volver a mandar el pase'}
          </Button>
          {['COMPLETADA', 'CANCELADA', 'NO_SHOW'].includes(reservation.status) && (
            <p className="text-body-lg text-outline">Esta reserva ya no admite cambios.</p>
          )}
        </div>
      </Card>

      <Card title="Titular">
        <dl className="grid gap-4 text-body-lg sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Nombre', reservation.holder_name],
            ['Correo', reservation.holder_email],
            ['Teléfono', reservation.holder_phone || '—'],
            ['Habitación', reservation.holder_room || '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-body-md uppercase tracking-wide text-outline">{label}</dt>
              <dd className="mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* Las cuentas son del hotel y del puesto, no de la persona. Estos dos
          nombres son lo único que dice quién estuvo del otro lado. */}
      <Card title="Quién la atendió">
        <dl className="grid gap-4 text-body-lg sm:grid-cols-2">
          <div>
            <dt className="text-body-md uppercase tracking-wide text-outline">
              La levantó
            </dt>
            <dd className="mt-0.5">
              {reservation.booked_by_name || (
                <span className="text-outline">Sin registrar · reserva anterior a este control</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-body-md uppercase tracking-wide text-outline">
              Atendió en el mostrador
            </dt>
            <dd className="mt-0.5">
              {reservation.attended_by_name || (
                <span className="text-outline">Todavía no pasa por recepción</span>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title="Jugadores">
        <Table
          columns={['Jugador', 'Categoría', 'Handicap/GHIN', 'Tarifa', 'PGA', 'Final', 'Llegó']}
          rows={reservation.players}
          renderRow={(player) => (
            <tr key={player.id}>
              <td className="px-3 py-2">
                {player.full_name} {player.is_holder && <Badge className="ml-1">Titular</Badge>}
              </td>
              <td className="px-3 py-2 text-on-surface-variant">
                {categoria(player.category)}
                {player.age ? ` · ${player.age} años` : ''}
              </td>
              {/* Una sola columna. `ghin` sigue en la base y se muestra si
                  la reserva es de antes de que los dos campos se juntaran. */}
              <td className="px-3 py-2 text-on-surface-variant">
                {player.handicap || player.ghin || '—'}
              </td>
              <td className="px-3 py-2 text-right">{mxn(player.rate_applied)}</td>
              <td className="px-3 py-2 text-right">
                {player.pga_validated ? (
                  <span className="text-primary-container">−{mxn(player.pga_discount_applied)}</span>
                ) : player.pga_code ? (
                  <span className="text-body-md text-estado-pend-text">Por validar</span>
                ) : (
                  <span className="text-outline">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-medium">{mxn(player.final_rate)}</td>
              <td className="px-3 py-2 text-center">{player.arrived ? '✓' : '—'}</td>
            </tr>
          )}
        />
        {/* El acompañante va con el grupo: no juega, pero paga su lugar. */}
        {reservation.companions.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {reservation.companions.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-body-lg"
              >
                <span>
                  {c.full_name}{' '}
                  <span className="text-body-md text-outline">· acompañante, no juega</span>
                </span>
                <span className="font-mono">{mxn(lineaAcompanante?.unit_price_applied ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
        {conPga.length > 0 && (
          <p className="mt-3 rounded bg-primary-fixed/25 px-3 py-2 text-body-md text-primary">
            El beneficio PGA es individual: se aplicó únicamente sobre la tarifa de{' '}
            {conPga.map((player) => player.full_name).join(', ')}.
          </p>
        )}
      </Card>

      {serviciosSinAcompanantes.length > 0 && (
        <Card title="Servicios contratados">
          <Table
            columns={['Servicio', 'Cantidad', 'Precio unitario', 'Total']}
            rows={serviciosSinAcompanantes}
            renderRow={(item) => (
              <tr key={item.id}>
                <td className="px-3 py-2">{item.service_name}</td>
                <td className="px-3 py-2 text-center">{item.quantity}</td>
                <td className="px-3 py-2 text-right">{mxn(item.unit_price_applied)}</td>
                <td className="px-3 py-2 text-right font-medium">{mxn(item.total)}</td>
              </tr>
            )}
          />
        </Card>
      )}

      {correos.length > 0 && (
        <Card title="Correos enviados">
          <ul className="space-y-2 text-body-lg">
            {correos.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/30 pb-2 last:border-0"
              >
                <span className="flex items-center gap-2">
                  <Icono
                    nombre={c.status === 'ENVIADO' ? 'check' : c.status === 'FALLIDO' ? 'cancelar' : 'reloj'}
                    size={16}
                    className={
                      c.status === 'ENVIADO'
                        ? 'text-estado-ok-text'
                        : c.status === 'FALLIDO'
                          ? 'text-error'
                          : 'text-estado-pend-text'
                    }
                  />
                  {c.kind === 'PASE' ? 'Pase de la partida' : 'Recibo del cobro'} ·{' '}
                  <span className="text-on-surface-variant">{c.to_email}</span>
                </span>
                <span className="text-body-md text-outline">
                  {c.status === 'ENVIADO'
                    ? `enviado ${fechaHora(c.sent_at)}`
                    : c.status === 'FALLIDO'
                      ? `falló: ${c.last_error || 'sin detalle'}`
                      : 'en cola'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Desglose de la cuenta">
        <dl className="space-y-2 text-body-lg">
          <div className="flex justify-between">
            <dt className="text-outline">Green fees</dt>
            <dd>{mxn(reservation.subtotal_green_fees)}</dd>
          </div>
          {totalAcompanantes > 0 && (
            <div className="flex justify-between">
              <dt className="text-outline">Acompañantes</dt>
              <dd>{mxn(totalAcompanantes)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-outline">Servicios</dt>
            <dd>{mxn(Number(reservation.subtotal_services) - totalAcompanantes)}</dd>
          </div>
          {Number(reservation.discount_amount) > 0 && (
            <div className="flex justify-between text-error">
              <dt>Convenio {reservation.discount_code_applied}</dt>
              <dd>−{mxn(reservation.discount_amount)}</dd>
            </div>
          )}
          {Number(reservation.pga_discount_amount) > 0 && (
            <div className="flex justify-between text-primary-container">
              <dt>Beneficio PGA (individual)</dt>
              <dd>−{mxn(reservation.pga_discount_amount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-outline-variant/50 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd>{mxn(reservation.total)}</dd>
          </div>
        </dl>

        {isHotel ? (
          <p className="mt-4 rounded bg-surface-container-low px-3 py-2 text-body-md text-outline">
            Sobre este total se calcula su comisión del{' '}
            {Number(reservation.commission_rate_applied).toFixed(2)}%. Puede bajar en el campo: si
            se acredita una credencial PGA el descuento es individual y se refleja aquí, y si
            alguien de la partida no se presenta su green fee deja de cobrarse. Lo que el huésped
            consuma en el mostrador no entra en esta cuenta.
          </p>
        ) : (
        <p className="mt-4 rounded bg-surface-container-low px-3 py-2 text-body-md text-outline">
          Valores congelados al momento de la operación · tipo de cambio{' '}
          {Number(reservation.exchange_rate_applied).toFixed(4)} · comisión hotelera{' '}
          {Number(reservation.commission_rate_applied).toFixed(2)}%. No se recalculan si estos
          parámetros cambian después.
        </p>
        )}
      </Card>

      <Modal
        open={suspenderOpen}
        title="Campo suspendido"
        onClose={() => setSuspenderOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSuspenderOpen(false)}>
              Cerrar
            </Button>
            <Button onClick={suspender}>Marcar suspendida</Button>
          </>
        }
      >
        <p className="mb-3 text-body-lg text-outline">
          La partida ya salió y ya se cobró, así que esto no la cancela: queda marcada en el hoyo
          donde se quedaron y de ahí se le repone la ronda sin costo. Los carritos y los caddies se
          liberan para el resto del día.
        </p>
        <label className="mb-3 block">
          <span className="mb-1 block text-body-md uppercase tracking-wide text-outline">
            ¿En qué hoyo se quedaron?
          </span>
          <input
            type="number"
            min="1"
            max={reservation.holes}
            value={suspension.hoyo}
            onChange={(e) => setSuspension({ ...suspension, hoyo: e.target.value })}
            placeholder={`1 a ${reservation.holes}`}
            className="w-32 rounded border border-outline-variant bg-surface-container-low px-3 py-2 font-mono text-body-lg"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-body-md uppercase tracking-wide text-outline">
            Motivo
          </span>
          <input
            value={suspension.motivo}
            onChange={(e) => setSuspension({ ...suspension, motivo: e.target.value })}
            placeholder="Lluvia, tormenta eléctrica…"
            className="w-full rounded border border-outline-variant bg-surface-container-low px-3 py-2 text-body-lg"
          />
        </label>
      </Modal>

      <Modal
        open={reponerOpen}
        title="Reponer la ronda"
        onClose={() => setReponerOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReponerOpen(false)}>
              Cerrar
            </Button>
            <Button onClick={reponer}>Agendar sin costo</Button>
          </>
        }
      >
        <p className="mb-3 text-body-lg text-outline">
          Se crea un folio nuevo, sin cargo y sin comisión para el hotel, donde el huésped reanuda
          en el hoyo {reservation.interrupted_at_hole}. Puede ser cualquier día
          {reservation.modality === 'PARTIDA_ABIERTA'
            ? ', y al ser partida abierta no tiene que volver con la misma gente.'
            : '.'}
        </p>
        <label className="mb-3 block">
          <span className="mb-1 block text-body-md uppercase tracking-wide text-outline">Día</span>
          <input
            type="date"
            value={diaReposicion}
            min={fechaLocal(new Date())}
            onChange={(e) => {
              setDiaReposicion(e.target.value);
              cargarSalidas(e.target.value);
            }}
            className="rounded border border-outline-variant bg-surface-container-low px-3 py-2 text-body-lg"
          />
        </label>
        {salidasReposicion.length === 0 ? (
          <p className="text-body-lg text-outline">
            Ese día no tiene salidas libres. Pruebe con otro.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {salidasReposicion.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setSalidaElegida(x.id)}
                className={`rounded border px-3 py-2 font-mono text-body-lg transition ${
                  salidaElegida === x.id
                    ? 'border-primary-container bg-primary-container text-on-primary'
                    : 'border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container'
                }`}
              >
                {hora(x.slot_time)}
                <span className="ml-2 text-label-sm opacity-75">{x.available} libres</span>
              </button>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={cancelOpen}
        title="Cancelar reserva"
        onClose={() => setCancelOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Volver
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              onClick={async () => {
                await accion(() => bookingApi.cancel(id, reason), 'Reserva cancelada y cupo liberado');
                setCancelOpen(false);
              }}
            >
              Confirmar cancelación
            </Button>
          </>
        }
      >
        <p className="mb-3 text-body-lg text-on-surface-variant">
          El cupo de la franja quedará disponible para otros hoteles. El motivo se guarda en la
          bitácora de auditoría.
        </p>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Motivo de la cancelación"
        />
      </Modal>
    </div>
  );
}
