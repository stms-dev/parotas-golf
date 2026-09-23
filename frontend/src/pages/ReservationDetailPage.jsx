import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { bookingApi, correosApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Alert, Badge, Button, Card, Modal, Spinner, Stat, Table, Textarea } from '../components/ui';
import Icono from '../components/Icono';
import { error as avisoError, exito, pedirCorreo } from '../utils/avisos';
import { ESTADO_RESERVA, MODALIDAD, fecha, fechaHora, hora, mxn } from '../utils/format';

export default function ReservationDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
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
        await exito(
          'Pase en cola',
          `Quedó encolado para <b>${correo.to_email}</b> y sale en cuanto el servidor ` +
            'de correo responda.',
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
        <Stat label="Modalidad" value={MODALIDAD[reservation.modality]} hint={`${reservation.holes} hoyos`} />
        <Stat label="Jugadores" value={reservation.players.length} hint={`${reservation.companions.length} acompañantes`} />
        <Stat label="Total" value={mxn(reservation.total)} hint={`TC ${Number(reservation.exchange_rate_applied).toFixed(2)}`} />
        <Stat
          label="Saldo"
          value={mxn(reservation.balance)}
          tone={Number(reservation.balance) > 0 ? 'alert' : 'default'}
          hint={`Pagado ${mxn(reservation.total_paid)}`}
        />
      </div>

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
          {['PENDIENTE', 'CONFIRMADA', 'CHECK_IN'].includes(reservation.status) && can('reservation:cancel') && (
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              Cancelar reserva
            </Button>
          )}
          {/* El pase se puede volver a mandar: el huésped borró el correo,
              lo escribió mal el concierge, o se lo quieren mandar a otro. */}
          <Button variant="secondary" onClick={reenviarPase} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Reenviar pase por correo'}
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

      <Card title="Jugadores">
        <Table
          columns={['Jugador', 'Categoría', 'HCP', 'Tarifa', 'PGA', 'Final', 'Llegó']}
          rows={reservation.players}
          renderRow={(player) => (
            <tr key={player.id}>
              <td className="px-3 py-2">
                {player.full_name} {player.is_holder && <Badge className="ml-1">Titular</Badge>}
              </td>
              <td className="px-3 py-2 text-on-surface-variant">
                {player.category === 'INFANTIL' ? 'Infantil' : 'Adulto'}
                {player.age ? ` · ${player.age} años` : ''}
              </td>
              <td className="px-3 py-2 text-on-surface-variant">{player.handicap || '—'}</td>
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

        <p className="mt-4 rounded bg-surface-container-low px-3 py-2 text-body-md text-outline">
          Valores congelados al momento de la operación · tipo de cambio{' '}
          {Number(reservation.exchange_rate_applied).toFixed(4)} · comisión hotelera{' '}
          {Number(reservation.commission_rate_applied).toFixed(2)}%. No se recalculan si estos
          parámetros cambian después.
        </p>
      </Card>

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
