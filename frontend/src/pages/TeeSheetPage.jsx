import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { bookingApi, catalogApi, eventsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Spinner } from '../components/ui';
import { fecha, hora, hoy } from '../utils/format';

const TIPOS_EVENTO = [
  ['TORNEO', 'Torneo'],
  ['EVENTO_CORPORATIVO', 'Evento corporativo'],
  ['EVENTO_ESPECIAL', 'Evento especial'],
  ['MANTENIMIENTO', 'Mantenimiento'],
  ['BLOQUEO_TECNICO', 'Bloqueo técnico'],
];

export default function TeeSheetPage() {
  const { can } = useAuth();
  const [date, setDate] = useState(hoy());
  const [schedule, setSchedule] = useState([]);
  const [slotsByTee, setSlotsByTee] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const configs = await catalogApi.schedule();
      setSchedule(configs);
      const entries = await Promise.all(
        configs.map(async (config) => {
          const data = await bookingApi.availability({ slot_date: date, tee: config.tee });
          return [config.tee, data.slots];
        }),
      );
      setSlotsByTee(Object.fromEntries(entries));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [date]);

  /**
   * Actualización quirúrgica: cuando llega un cambio de cupo del día que se
   * está viendo, se corrige esa franja en memoria en vez de recargar todo.
   * Recargar la pantalla completa cada vez que alguien reserva daría saltos
   * visuales y pediría datos de más.
   */
  useRealtimeEvent([EVENTOS.DISPONIBILIDAD_CAMBIADA], (mensaje) => {
    const cambio = mensaje.payload;
    if (cambio.fecha !== date) return;

    setSlotsByTee((actual) => {
      const franjas = actual[cambio.tee];
      if (!franjas) return actual;
      return {
        ...actual,
        [cambio.tee]: franjas.map((franja) =>
          franja.id === cambio.franja_id
            ? {
                ...franja,
                occupied: cambio.ocupados,
                available: cambio.disponibles,
                status: cambio.estado,
              }
            : franja,
        ),
      };
    });
  });

  // Un evento bloquea varias franjas de golpe: ahí sí conviene recargar.
  useRealtimeEvent([EVENTOS.EVENTO_CREADO, EVENTOS.EVENTO_LIBERADO], (mensaje) => {
    if (mensaje.payload.fecha === date) load();
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-body-md uppercase tracking-widest text-secondary">Agenda oficial</p>
          <h1 className="font-serif text-3xl text-primary">Tee Sheet</h1>
          <p className="text-body-lg text-outline">{fecha(date)}</p>
        </div>
        <div className="flex items-end gap-3">
          <Field label="Fecha">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          {can('event:manage') && (
            <Button variant="secondary" onClick={() => setModalOpen(true)}>
              + Evento o bloqueo
            </Button>
          )}
        </div>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex flex-wrap gap-4 text-body-md text-on-surface-variant">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded border border-outline-variant bg-white" /> Disponible
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded border border-outline-variant/50 bg-surface-container" /> Ocupado
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded border border-outline-variant bg-surface-container-highest" /> Bloqueado por evento
        </span>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        schedule.map((config) => {
          const slots = slotsByTee[config.tee] || [];
          return (
            <Card
              key={config.tee}
              title={config.label}
              subtitle={`${hora(config.start_time)} a ${hora(config.end_time)} · intervalo ${config.interval_minutes} min · ${config.slot_capacity} cupos por franja`}
              action={<Badge>{slots.length} franjas</Badge>}
            >
              <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {slots.map((slot) => {
                  const clase = slot.expirada
                    ? 'salida salida-bloqueada opacity-60'
                    : slot.status === 'BLOQUEADO'
                      ? 'salida salida-bloqueada'
                      : slot.available === 0
                        ? 'salida salida-ocupada'
                        : 'salida salida-libre';
                  return (
                    <div key={slot.id} className={clase}>
                      <p className="font-mono text-body-lg font-medium">{hora(slot.slot_time)}</p>
                      <p className="mt-0.5 text-[11px]">
                        {slot.replay_folio
                          ? `Replay #${slot.replay_folio}`
                          : slot.cerrada_por === 'orden'
                          ? 'Espera su turno'
                          : slot.cerrada_por === 'carritos'
                          ? 'Sin carritos'
                          : slot.expirada
                          ? 'Horario pasado'
                          : slot.status === 'BLOQUEADO'
                          ? slot.event_name || 'Bloqueado'
                          : `${slot.available} de ${slot.capacity} libres`}
                      </p>
                      {slot.en_turno && slot.available > 0 && slot.status !== 'BLOQUEADO' && (
                        <Link
                          to={`/reservas/nueva?slot=${slot.id}`}
                          className="mt-1 block text-[11px] text-primary-container underline"
                        >
                          Asignar
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })
      )}

      <EventModal
        open={modalOpen}
        date={date}
        tees={schedule}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          load();
        }}
      />
    </div>
  );
}

function EventModal({ open, date, tees, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '',
    event_type: 'EVENTO_CORPORATIVO',
    event_date: date,
    start_time: '12:00',
    end_time: '13:00',
    tee: 'TEE_1',
    estimated_players: 16,
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm((prev) => ({ ...prev, event_date: date })), [date]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await eventsApi.create({
        ...form,
        start_time: `${form.start_time}:00`,
        end_time: `${form.end_time}:00`,
        estimated_players: Number(form.estimated_players) || null,
        blocks_availability: true,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  return (
    <Modal
      open={open}
      title="Registrar evento o bloqueo"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !form.name}>
            {saving ? 'Guardando…' : 'Bloquear franjas'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Denominación" required>
          <Input value={form.name} onChange={set('name')} placeholder="Copa Invitacional" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={form.event_type} onChange={set('event_type')}>
              {TIPOS_EVENTO.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tee">
            <Select value={form.tee} onChange={set('tee')}>
              {tees.map((config) => (
                <option key={config.tee} value={config.tee}>
                  {config.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha">
            <Input type="date" value={form.event_date} onChange={set('event_date')} />
          </Field>
          <Field label="Jugadores estimados">
            <Input type="number" min="1" value={form.estimated_players} onChange={set('estimated_players')} />
          </Field>
          <Field label="Hora inicial">
            <Input type="time" value={form.start_time} onChange={set('start_time')} />
          </Field>
          <Field label="Hora final">
            <Input type="time" value={form.end_time} onChange={set('end_time')} />
          </Field>
        </div>

        <Alert tone="info">
          Las franjas del rango quedarán bloqueadas. Si alguna ya tiene reservas activas, el
          sistema lo indicará y no bloqueará nada hasta que se resuelvan.
        </Alert>
      </div>
    </Modal>
  );
}
