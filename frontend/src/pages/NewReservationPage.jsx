/**
 * Nueva Solicitud de Reserva.
 *
 * Dos columnas: el formulario por pasos a la izquierda y el "Expediente
 * Oficial" fijo a la derecha, que se arma solo conforme se captura.
 *
 * Dos reglas que gobiernan la pantalla:
 *
 *   · El titular ES el primer jugador. Se captura una sola vez, en su propio
 *     bloque, y de ahí en adelante solo se piden los jugadores ADICIONALES.
 *     Anotarlo dos veces era la principal fuente de confusión.
 *   · Lo que se pide aquí (caddies y bastones) queda registrado en la
 *     solicitud; recepción lo ve al hacer el check-in y no lo vuelve a cobrar.
 *
 * El código PGA se captura pero no es un código promocional: es el
 * identificador del jugador profesional y lo valida recepción contra el padrón.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { bookingApi, catalogApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Field, Input, Select, Spinner } from '../components/ui';
import { advertencia as avisoAdvertencia, error as avisoError } from '../utils/avisos';
import Icono from '../components/Icono';
import { fecha, hora, hoy, mxn, fechaLocal } from '../utils/format';
import { esFinDeSemana, tarifaDelDia } from '../utils/tarifas';

// Individual ya no se vende: una salida se toma como grupo o se comparte en
// partida abierta. Las reservas viejas que la usaron se siguen leyendo, pero
// aquí no se ofrece.
const PAQUETES = [
  {
    value: 'GRUPO',
    nombre: 'En Grupo',
    etiqueta: 'Desde 4',
    icono: 'groups',
    detalle: 'El titular organiza su propio grupo en una salida exclusiva.',
    min: 4,
    // Sin techo: el grupo toma la salida completa, así que el cupo de la
    // franja no lo limita. 24 es solo un tope de captura para que un dedazo
    // no genere cien jugadores.
    max: 24,
    sinTope: true,
  },
  {
    value: 'PARTIDA_ABIERTA',
    nombre: 'Partida Abierta',
    etiqueta: 'Multihotel',
    icono: 'hub',
    detalle: 'Sale con los que se junten, hasta llegar a 4, aunque vengan de hoteles distintos.',
    min: 1,
    max: 4,
  },
];

/**
 * Validación de los datos de contacto.
 *
 * Se revisa aquí y no solo en el servidor porque el aviso llega antes y junto
 * al campo: quien captura corrige en el momento, sin perder lo ya escrito.
 * El servidor vuelve a revisarlo de todos modos.
 */
const CORREO = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

function errorDeCorreo(valor) {
  const v = (valor || '').trim();
  if (!v) return 'Hace falta el correo del titular.';
  if (!v.includes('@')) return 'Al correo le falta la arroba.';
  if (!CORREO.test(v)) return 'Ese correo está incompleto. Ejemplo: nombre@hotel.com';
  return null;
}

function errorDeTelefono(valor) {
  const v = (valor || '').trim();
  if (!v) return null; // es opcional
  const digitos = v.replace(/\D/g, '');
  if (digitos.length < 10) return 'El teléfono va a 10 dígitos. Ejemplo: 958 123 4567';
  if (digitos.length > 15) return 'Ese teléfono trae demasiados dígitos.';
  return null;
}

const PASOS = [
  { n: '01', titulo: 'Paquete & recorrido' },
  { n: '02', titulo: 'Fecha & horario' },
  { n: '03', titulo: 'Titular & jugadores' },
  { n: '04', titulo: 'Revisión y envío' },
];

/** Hasta dónde se puede agendar hacia adelante. */
const LIMITE_MESES = 6;


const jugadorVacio = () => ({
  full_name: '', age: '', pga_code: '', club_hand: '', handicap: '',
});

export default function NewReservationPage() {
  const navigate = useNavigate();
  const { user, isHotel, isRecepcion } = useAuth();
  const [searchParams] = useSearchParams();

  const [date, setDate] = useState(hoy());
  const [slots, setSlots] = useState([]);
  /** Cierre del campo y desde cuándo aplica twilight, según Control del sistema. */
  const [jornada, setJornada] = useState({ cierre: null, twilight: null, admiteAbiertas: true });
  const [hotels, setHotels] = useState([]);
  const [tarifas, setTarifas] = useState([]);
  const [servicios, setServicios] = useState([]);
  const [config, setConfig] = useState(null);
  /** Carritos y caddies del día elegido: los dos son limitados. */
  const [recursos, setRecursos] = useState(null);

  const [form, setForm] = useState({
    modality: 'GRUPO',
    holes: 18,
    tee_slot_id: Number(searchParams.get('slot')) || null,
    hotel_id: null,
    // La cuenta es del hotel o del mostrador y la comparten varios turnos:
    // aquí va el nombre de quien está levantando esta reserva.
    booked_by_name: (() => {
      try {
        return localStorage.getItem('ultimo_atendio') || '';
      } catch {
        return '';
      }
    })(),
    holder_name: '',
    holder_email: '',
    holder_phone: '',
    holder_room: '',
    // El titular juega: estos son SUS datos de jugador.
    holder_age: '',
    holder_pga: '',
    holder_club_hand: '',
    holder_handicap: '',
  });

  /** Campos de los que ya salió el cursor: solo esos muestran su aviso. */
  const [tocado, setTocado] = useState({ holder_email: false, holder_phone: false });

  /** Solo los jugadores ADICIONALES al titular. */
  const [extras, setExtras] = useState([]);
  const [companions, setCompanions] = useState([]);

  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const paquete = PAQUETES.find((p) => p.value === form.modality);
  const maxExtras = paquete.max - 1;
  const minExtras = Math.max(paquete.min - 1, 0);

  useEffect(() => {
    Promise.all([
      catalogApi.rates(),
      catalogApi.schedule(),
      catalogApi.services(),
      isHotel ? Promise.resolve([]) : catalogApi.hotels(),
    ])
      .then(([rates, configs, serviceList, hotelList]) => {
        setTarifas(rates);
        setConfig(configs[0] || null);
        setServicios(serviceList);
        setHotels(hotelList);
        if (!isHotel && hotelList.length) {
          // Del mostrador se llega con ?directo=1: es alguien que llegó por su
          // cuenta, sin hotel de por medio.
          const directo = hotelList.find((h) => h.is_direct);
          // Recepción no elige: lo suyo es siempre público general.
          const inicial =
            isRecepcion || (searchParams.get('directo') === '1' && directo)
              ? directo?.id
              : hotelList.find((h) => !h.is_direct)?.id || hotelList[0].id;
          setForm((prev) => ({ ...prev, hotel_id: prev.hotel_id || inicial }));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [isHotel, isRecepcion]);

  useEffect(() => {
    bookingApi
      .availability({ slot_date: date })
      .then((data) => {
        setSlots(data.slots);
        setJornada({
          cierre: data.cierre_de_campo || null,
          twilight: data.twilight_desde || null,
          // Hay días en que el campo no arma grupos revueltos. Se apaga la
          // modalidad aquí, en vez de dejar capturar toda la reserva y
          // rebotarla al guardar.
          admiteAbiertas: data.admite_abiertas !== false,
        });
      })
      .catch((err) => setError(err.message));
    bookingApi
      .recursos({ slot_date: date })
      .then(setRecursos)
      .catch(() => setRecursos(null));
  }, [date]);

  useRealtimeEvent([EVENTOS.DISPONIBILIDAD_CAMBIADA], (mensaje) => {
    if (mensaje.payload.fecha !== date) return;
    bookingApi.availability({ slot_date: date }).then((data) => {
      setSlots(data.slots);
      const elegida = data.slots.find((s) => s.id === form.tee_slot_id);
      if (form.tee_slot_id && elegida && !admite(elegida)) {
        setAviso(
          `La salida de las ${hora(elegida.slot_time)} acaba de asignarse a otra partida. Elija otro horario.`,
        );
        setForm((prev) => ({ ...prev, tee_slot_id: null }));
      }
    });
  });

  /** ¿Esta salida admite el paquete que se está armando? */
  function admite(slot) {
    // Cualquier horario libre se puede tomar: ya no se abren en orden. Lo que
    // cierra una salida es que esté llena, bloqueada, o que su hora pasó.
    if (slot.expirada) return false;
    if (slot.status === 'BLOQUEADO' || slot.status === 'OCUPADO') return false;
    if (slot.status === 'ABIERTA') return form.modality === 'PARTIDA_ABIERTA';
    return true;
  }

  // El paquete manda sobre cuántos jugadores adicionales caben.
  useEffect(() => {
    setExtras((current) => {
      let next = [...current];
      while (next.length < minExtras) next.push(jugadorVacio());
      if (next.length > maxExtras) next = next.slice(0, maxExtras);
      return next;
    });
    setForm((prev) => {
      const elegida = slots.find((s) => s.id === prev.tee_slot_id);
      if (!elegida) return prev;
      const compatible =
        elegida.status === 'DISPONIBLE' ||
        (elegida.status === 'ABIERTA' && form.modality === 'PARTIDA_ABIERTA');
      return compatible ? prev : { ...prev, tee_slot_id: null };
    });
  }, [form.modality]);

  // Si se cambia a un día que no arma partidas abiertas, la selección se
  // devuelve a grupo sola: dejarla puesta solo lleva a un rechazo al guardar.
  useEffect(() => {
    if (jornada.admiteAbiertas || form.modality !== 'PARTIDA_ABIERTA') return;
    setForm((prev) => ({ ...prev, modality: 'GRUPO', tee_slot_id: null }));
    setAviso(
      `El ${fecha(date)} el campo no está armando partidas abiertas. Se cambió el paquete a Grupo.`,
    );
  }, [jornada.admiteAbiertas, date]);

  // El precio depende del día de la salida: de viernes a domingo es más caro.
  function precioDe(modalidad, categoria = 'ADULTO', hoyos = form.holes) {
    const t = tarifaDelDia(tarifas, { modalidad, hoyos, categoria, fecha: date });
    return t ? Number(t.price) : null;
  }

  const servicio = (codigo) => servicios.find((s) => s.code === codigo) || null;
  const caddie = servicio('CADDIE');
  const bastones = servicio('BASTONES');
  const acompanante = servicio('ACOMPANANTE');

  const precioAdulto = precioDe(form.modality);
  const precioInfantil = precioDe(form.modality, 'INFANTIL');

  /**
   * El titular como jugador, seguido de los adicionales. Esta lista es la
   * verdad para cupos, tarifas y bastones: se arma una sola vez.
   */
  const jugadores = useMemo(() => {
    const lista = [];
    if (form.holder_name.trim().length >= 3) {
      lista.push({
        full_name: form.holder_name.trim(),
        age: form.holder_age,
        pga_code: form.holder_pga,
        club_hand: form.holder_club_hand,
        handicap: form.holder_handicap,
        is_holder: true,
      });
    }
    extras
      .filter((p) => p.full_name.trim().length >= 3)
      .forEach((p) => lista.push({ ...p, is_holder: false }));
    return lista;
  }, [
    form.holder_name,
    form.holder_age,
    form.holder_pga,
    form.holder_club_hand,
    form.holder_handicap,
    extras,
  ]);

  const esMenor = (p) => p.age && Number(p.age) < 16;
  const adultos = jugadores.filter((p) => !esMenor(p));
  const menores = jugadores.filter(esMenor);

  const subtotalAdultos = (precioAdulto || 0) * adultos.length;
  const subtotalMenores = (precioInfantil || 0) * menores.length;

  // Bastones: uno por jugador que pidió set, con su orientación.
  const diestros = jugadores.filter((p) => p.club_hand === 'DIESTRO').length;
  const zurdos = jugadores.filter((p) => p.club_hand === 'ZURDO').length;
  const sets = diestros + zurdos;

  // Los carritos no se eligen: salen de cuánta gente va, dos por carrito.
  const hotelDirecto = hotels.find((h) => h.is_direct) || null;
  const hotelesConConvenio = hotels.filter((h) => !h.is_direct);
  /** Venta de mostrador: el huésped llegó al campo, sin hotel de por medio. */
  const ventaDirecta = Boolean(hotelDirecto && form.hotel_id === hotelDirecto.id);
  const nombreDelHotel =
    hotels.find((h) => h.id === form.hotel_id)?.name || user?.hotel_name || 'Campo';

  const asientosPorCarrito = recursos?.personas_por_carrito || 2;
  const caddiesLibres = recursos ? recursos.caddies_libres : 0;

  const precioCaddie = caddie ? Number(caddie.price) : 0;
  const precioSet = bastones ? Number(bastones.price) : 0;
  const subtotalSets = precioSet * sets;
  // El caddie no entra: lo paga el huésped directo al caddie, no el club.
  const subtotalServicios = subtotalSets;

  // Quien acompaña no juega, pero sí paga su lugar. Se cobra desde aquí,
  // junto con los jugadores; no es un servicio ni una cortesía.
  const precioAcompanante = acompanante ? Number(acompanante.price) : 0;
  const acompanantesConNombre = companions.filter((c) => c.full_name.trim().length >= 3);
  const subtotalAcompanantes = precioAcompanante * acompanantesConNombre.length;

  const carritosNecesarios = Math.ceil(
    (jugadores.length + acompanantesConNombre.length) / asientosPorCarrito,
  );
  // Un caddie por carrito, hasta donde alcancen los del día. Si no quedan, la
  // partida sale sin caddie: el club tiene dos y no deja de vender por eso.
  const caddiesAsignados = Math.max(Math.min(carritosNecesarios, caddiesLibres), 0);
  const costoCaddiesInformativo = precioCaddie * caddiesAsignados;

  const total = subtotalAdultos + subtotalMenores + subtotalAcompanantes + subtotalServicios;

  const salidaElegida = slots.find((s) => s.id === form.tee_slot_id);

  const fallaCorreo = errorDeCorreo(form.holder_email);
  const fallaTelefono = errorDeTelefono(form.holder_phone);

  const listo =
    form.tee_slot_id &&
    form.booked_by_name.trim().length >= 3 &&
    form.holder_name.trim().length >= 3 &&
    !fallaCorreo &&
    !fallaTelefono &&
    jugadores.length >= paquete.min &&
    jugadores.length <= paquete.max;

  const pasoActual = !form.tee_slot_id ? 2 : !listo ? 3 : 4;

  async function enviar() {
    // Última red antes de mandar: si algo de contacto está mal, se señala el
    // campo y se dice qué corregir, en vez de esperar el rechazo del servidor.
    if (fallaCorreo || fallaTelefono) {
      setTocado({ holder_email: true, holder_phone: true });
      await avisoAdvertencia(
        'Revise los datos de contacto',
        [fallaCorreo, fallaTelefono].filter(Boolean).join('<br>'),
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const serviciosPedidos = [];

      if (bastones && sets > 0) {
        serviciosPedidos.push({ service_id: bastones.id, quantity: sets });
      }

      try {
        // Se recuerda en este equipo para que el siguiente turno solo confirme
        // su nombre en vez de escribirlo completo cada vez.
        localStorage.setItem('ultimo_atendio', form.booked_by_name.trim());
      } catch {
        /* Modo privado o almacenamiento bloqueado: no es grave. */
      }
      const creada = await bookingApi.create({
        tee_slot_id: form.tee_slot_id,
        modality: form.modality,
        holes: Number(form.holes),
        hotel_id: isHotel ? undefined : form.hotel_id,
        booked_by_name: form.booked_by_name.trim(),
        holder_name: form.holder_name.trim(),
        holder_email: form.holder_email.trim(),
        holder_phone: form.holder_phone || null,
        holder_room: form.holder_room || null,
        players: jugadores.map((p) => ({
          full_name: p.full_name.trim(),
          age: p.age ? Number(p.age) : null,
          is_holder: Boolean(p.is_holder),
          pga_code: p.pga_code ? p.pga_code.trim() : null,
          club_hand: p.club_hand || null,
          handicap: p.handicap ? String(p.handicap).trim() : null,
        })),
        companions: companions
          .filter((c) => c.full_name.trim().length >= 3)
          .map((c) => ({ full_name: c.full_name.trim() })),
        services: serviciosPedidos,
      });
      navigate(`/reservas/${creada.id}`);
    } catch (err) {
      setError(err.message);
      await avisoError('No se pudo crear la reserva', err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  const dias = proximosDias(6);
  const horizonte = (() => {
    const d = new Date(`${hoy()}T00:00:00`);
    d.setMonth(d.getMonth() + LIMITE_MESES);
    return fechaLocal(d);
  })();

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------- Encabezado */}
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-label-sm uppercase tracking-widest text-outline">
            {isHotel ? 'Portal hotel' : 'Mostrador'} <span className="text-outline-variant">›</span>{' '}
            {isHotel ? user?.hotel_name : ventaDirecta ? 'Sin hotel' : nombreDelHotel}{' '}
            <span className="text-outline-variant">›</span> Nueva solicitud
          </p>
          <h1 className="font-serif text-display-lg leading-tight text-primary">
            {ventaDirecta ? 'Nueva Reserva en Mostrador' : 'Nueva Solicitud de Reserva'}
          </h1>
          <p className="text-body-lg text-outline">
            {ventaDirecta
              ? 'Alta de un huésped que llegó por su cuenta al campo, sin hotel de por medio.'
              : 'Despacho de tee times y asignación de salidas para huéspedes asociados.'}
          </p>
        </div>
        <span className="shrink-0 self-start rounded bg-secondary-fixed px-3 py-1.5 text-label-sm uppercase tracking-wider text-on-secondary-fixed-variant xl:self-auto">
          {ventaDirecta ? 'Venta de mostrador' : 'Convenio hotelero vigente'}
        </span>
      </header>

      {/* ---------------------------------------------------------- Pasos */}
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PASOS.map((paso, i) => {
          const n = i + 1;
          const hecho = n < pasoActual;
          const activo = n === pasoActual;
          return (
            <li
              key={paso.n}
              className={`rounded border px-4 py-3 ${
                activo
                  ? 'border-primary-container bg-surface-container-lowest shadow-card'
                  : hecho
                    ? 'border-estado-ok-border bg-estado-ok-bg'
                    : 'border-outline-variant/50 bg-surface-container-low'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-label-sm uppercase tracking-wider text-outline">
                  Paso {paso.n}
                </span>
                {hecho && <Icono nombre="check" size={15} className="text-estado-ok-text" />}
              </span>
              <span
                className={`block text-title-md ${activo || hecho ? 'text-primary' : 'text-on-surface-variant'}`}
              >
                {paso.titulo}
              </span>
            </li>
          );
        })}
      </ol>

      {error && (
        <Alert tone="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {aviso && (
        <Alert tone="warning" onClose={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      {/* Quién está levantando la reserva. Va antes que todo porque la cuenta
          no lo dice: la comparten los turnos, y cuando una reserva sale mal
          capturada hay que saber a quién preguntarle. */}
      <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[280px] flex-1">
            <Field
              label={isHotel ? '¿Quién de la conserjería levanta la reserva?' : '¿Quién atiende?'}
              required
              hint="Su nombre queda en la reserva. La cuenta la comparten varios turnos, así que es lo único que dice quién la hizo."
            >
              <Input
                value={form.booked_by_name}
                placeholder="María Fernanda Ríos"
                onChange={(e) => setForm({ ...form, booked_by_name: e.target.value })}
              />
            </Field>
          </div>
          {form.booked_by_name.trim().length >= 3 && (
            <p className="pb-2 text-body-md text-outline">
              Esta reserva va a quedar a nombre de{' '}
              <span className="text-on-surface">{form.booked_by_name.trim()}</span>.
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-gutter xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          {/* =========================== 1. Paquete, recorrido y caddie === */}
          <Bloque numero="1" titulo="Paquete y recorrido" nota="Selección requerida">
            <div className="grid gap-3 md:grid-cols-3">
              {PAQUETES.map((item) => {
                const on = form.modality === item.value;
                const precio = precioDe(item.value);
                // El campo puede cerrar la partida abierta por día completo,
                // cuando no quiere andar armando grupos revueltos.
                const apagado =
                  item.value === 'PARTIDA_ABIERTA' && !jornada.admiteAbiertas;
                return (
                  <button
                    key={item.value}
                    type="button"
                    disabled={apagado}
                    title={
                      apagado
                        ? 'Ese día el campo no está armando partidas abiertas.'
                        : undefined
                    }
                    onClick={() => setForm({ ...form, modality: item.value })}
                    className={`paquete ${on ? 'paquete-on' : 'paquete-off'} ${
                      apagado ? 'cursor-not-allowed opacity-50' : ''
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span
                        className={`flex items-center gap-1.5 whitespace-nowrap text-title-lg ${
                          on ? 'text-on-primary' : 'text-primary'
                        }`}
                      >
                        <Icono
                          nombre={item.icono}
                          size={18}
                          className={on ? 'text-secondary-fixed' : 'text-secondary'}
                        />
                        {item.nombre}
                      </span>
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-label-sm uppercase tracking-wider ${
                          on
                            ? 'bg-on-primary-container/25 text-secondary-fixed'
                            : 'bg-surface-container text-on-surface-variant'
                        }`}
                      >
                        {item.etiqueta}
                      </span>
                    </div>
                    <span
                      className={`flex-1 text-body-md ${
                        on ? 'text-primary-fixed' : 'text-on-surface-variant'
                      }`}
                    >
                      {item.detalle}
                    </span>
                    {precio !== null && (
                      <span
                        className={`mt-3 flex items-center justify-between border-t pt-2.5 ${
                          on ? 'border-on-primary-container/40' : 'border-outline-variant/50'
                        }`}
                      >
                        <span
                          className={`font-serif text-title-lg ${
                            on ? 'text-on-primary' : 'text-primary'
                          }`}
                        >
                          {mxn(precio)}
                        </span>
                        <span
                          className={`text-label-sm uppercase tracking-wider ${
                            on ? 'text-secondary-fixed' : 'text-outline'
                          }`}
                        >
                          por persona
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap items-end gap-6">
              <div>
                <p className="mb-1.5 text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Recorrido del campo
                </p>
                <div className="flex overflow-hidden rounded border border-outline-variant">
                  {[9, 18].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setForm({ ...form, holes: h })}
                      className={`px-5 py-2 text-title-md transition ${
                        Number(form.holes) === h
                          ? 'bg-primary-container text-on-primary'
                          : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
                      }`}
                    >
                      {h} hoyos
                    </button>
                  ))}
                </div>
              </div>

              {!isHotel && isRecepcion && (
                <div className="min-w-[280px]">
                  <Field
                    label="¿Quién manda al huésped?"
                    hint="Recepción levanta solo al huésped que llega por su cuenta. Si viene de un hotel con convenio, la reserva la registra operaciones."
                  >
                    <div className="rounded border border-outline-variant/60 bg-surface-container-low px-3 py-2.5 text-body-lg text-on-surface">
                      Sin hotel · huésped que llegó al campo
                    </div>
                  </Field>
                </div>
              )}

              {!isHotel && !isRecepcion && (
                <div className="min-w-[280px]">
                  <Field
                    label="¿Quién manda al huésped?"
                    required
                    hint={
                      ventaDirecta
                        ? 'Llegó por su cuenta: no hay comisión de hotel'
                        : 'La venta se liquida a ese hotel'
                    }
                  >
                    <Select
                      value={form.hotel_id || ''}
                      onChange={(e) => setForm({ ...form, hotel_id: Number(e.target.value) })}
                    >
                      {hotelDirecto && (
                        <option value={hotelDirecto.id}>Sin hotel · huésped que llegó al campo</option>
                      )}
                      {hotelesConConvenio.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}
            </div>

            {/* El caddie no se pide ni se cobra aquí: se asigna uno por
                carrito, hasta donde alcancen los dos que tiene el campo, y el
                huésped le paga directo. Lo que sí hace falta es que la
                conserjería sepa cuánto vale para poder decírselo. */}
            {caddie && (
              <div className="mt-5 rounded border border-outline-variant/60 bg-surface-container-low">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/50 px-4 py-2.5">
                  <span className="flex items-center gap-2 text-title-md text-primary">
                    <Icono nombre="registro" size={18} className="text-secondary" />
                    {caddie.name}
                  </span>
                  <span className="font-mono text-label-md text-secondary">
                    {mxn(precioCaddie)} por caddie / ronda
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
                  <div className="min-w-[240px] flex-1">
                    <p className="text-title-md text-on-surface">
                      Se asigna uno por carrito, no se elige
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      El caddie <strong>lo paga el huésped directo al caddie</strong>: no entra en
                      el total de esta reserva ni lo cobra el mostrador. Dígale al huésped cuánto
                      es para que llegue preparado.
                    </p>
                    <p className="mt-1 text-body-md text-outline">
                      {!recursos
                        ? ''
                        : caddiesAsignados > 0
                          ? `Esta partida lleva ${caddiesAsignados} caddie${
                              caddiesAsignados === 1 ? '' : 's'
                            } · el huésped paga ${mxn(costoCaddiesInformativo)} en el campo. Quedan ${caddiesLibres} de ${recursos.caddies_totales} ese día.`
                          : 'Los caddies del campo ya están asignados ese día, así que esta partida sale sin caddie. Se liberan cuando la partida que los tiene se finaliza.'}
                    </p>
                  </div>

                  <div className="rounded border border-outline-variant bg-surface-container-lowest px-4 py-2 text-right">
                    <p className="text-label-sm uppercase tracking-wider text-outline">
                      Le paga al caddie
                    </p>
                    <p className="font-serif text-title-lg text-primary">
                      {mxn(costoCaddiesInformativo)}
                    </p>
                    <p className="text-label-sm text-outline">No entra en el total</p>
                  </div>
                </div>
              </div>
            )}
          </Bloque>

          {/* ====================================== 2. Fecha y horarios === */}
          <Bloque
            numero="2"
            titulo="Fecha y horarios"
            nota={config ? `Intervalos de ${config.interval_minutes} min` : undefined}
          >
            {/* El cierre del campo no bloquea nada: una salida tardía no
                alcanza a terminar 18 hoyos y eso es justo lo que se vende en
                twilight. Se dice aquí para que nadie prometa lo que no cabe. */}
            {jornada.cierre && (
              <p className="mb-3 rounded border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-body-md text-outline">
                El campo cierra a las <span className="text-on-surface">{hora(jornada.cierre)}</span>
                {jornada.twilight && (
                  <>
                    {' '}· desde las{' '}
                    <span className="text-on-surface">{hora(jornada.twilight)}</span> la salida es
                    twilight
                  </>
                )}
                . Una salida tardía puede no alcanzar a terminar los 18 hoyos; conviene decírselo al
                huésped.
              </p>
            )}

            {!jornada.admiteAbiertas && (
              <p className="mb-3 rounded border border-estado-pend-border bg-estado-pend-bg px-3 py-2 text-body-md text-estado-pend-text">
                Ese día el campo no está armando partidas abiertas. Se puede reservar en
                grupo, desde 4 jugadores.
              </p>
            )}

            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                Seleccionar fecha de salida
              </p>
              {/* Calendario para cualquier día dentro del horizonte; los
                  atajos de abajo cubren la semana en curso. */}
              <label className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5">
                <Icono nombre="calendar_today" size={16} className="text-secondary" />
                <span className="text-label-sm uppercase tracking-wider text-outline">
                  Otra fecha
                </span>
                <input
                  type="date"
                  value={date}
                  min={hoy()}
                  max={horizonte}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  className="bg-transparent font-mono text-label-md text-on-surface focus:outline-none"
                />
              </label>
            </div>

            <div className="mb-2 grid grid-cols-3 gap-2 lg:grid-cols-6">
              {dias.map((d) => {
                const on = d.iso === date;
                return (
                  <button
                    key={d.iso}
                    type="button"
                    onClick={() => setDate(d.iso)}
                    className={`rounded border px-2 py-3 text-center transition ${
                      on
                        ? 'border-primary-container bg-primary-container text-on-primary'
                        : 'border-outline-variant bg-surface-container-lowest hover:border-secondary'
                    }`}
                  >
                    <span
                      className={`block text-label-sm uppercase tracking-wider ${
                        on ? 'text-secondary-fixed' : 'text-outline'
                      }`}
                    >
                      {d.etiqueta}
                    </span>
                    <span
                      className={`block text-title-md ${on ? 'text-on-primary' : 'text-on-surface'}`}
                    >
                      {d.dia}
                    </span>
                    <span
                      className={`block text-label-sm ${on ? 'text-primary-fixed' : 'text-outline'}`}
                    >
                      {d.mes}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mb-4 text-label-sm text-outline">
              Se puede agendar hasta {LIMITE_MESES} meses adelante.
            </p>

            <div className="mb-4 rounded border border-primary-container bg-primary-container px-4 py-3">
              <p className="text-title-md text-on-primary">
                {config?.label || 'Horarios de salida'}
              </p>
              <p className="text-body-md text-primary-fixed">
                Campo Las Parotas · una salida por partida
              </p>
            </div>

            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                Horarios disponibles
              </span>
              <span className="flex items-center gap-4 text-label-sm uppercase tracking-wider">
                <span className="flex items-center gap-1.5 text-estado-ok-text">
                  <span className="h-2 w-2 rounded-full bg-estado-ok-text" /> Disponible
                </span>
                <span className="flex items-center gap-1.5 text-primary">
                  <span className="h-2 w-2 rounded-full bg-primary-container" /> Seleccionado
                </span>
                <span className="flex items-center gap-1.5 text-outline">
                  <span className="h-2 w-2 rounded-full bg-outline-variant" /> Ocupado o en espera
                </span>
              </span>
            </div>

            {/* Los horarios se abren de uno en uno, en orden. */}
            <p className="mb-3 flex items-start gap-2 rounded border border-outline-variant/50 bg-surface-container-low px-3.5 py-2.5 text-body-md text-on-surface-variant">
              <Icono nombre="escudo" size={15} className="mt-0.5 shrink-0 text-secondary" />
              Los horarios se abren en orden: al llenarse uno —o al pasar su hora— se abre el
              siguiente.
              {recursos && recursos.carritos_libres <= 0 && (
                <span className="text-estado-pend-text">
                  {' '}
                  Hoy ya no hay carritos disponibles, así que no se puede reservar.
                </span>
              )}
            </p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {slots.map((slot) => {
                const libre = admite(slot);
                const on = form.tee_slot_id === slot.id;
                const abierta = slot.status === 'ABIERTA';

                let etiqueta = 'Ocupado';
                if (on) etiqueta = 'Seleccionado';
                else if (slot.cerrada_por === 'bloqueada') etiqueta = 'Bloqueado';
                else if (slot.cerrada_por === 'vencida') etiqueta = 'Horario cerrado';
                else if (slot.cerrada_por === 'carritos') etiqueta = 'Sin carritos';
                // Una partida abierta que el campo ya cerró: sobran lugares,
                // pero esa salida ya se va a despachar.
                else if (slot.cerrada_por === 'cerrada') etiqueta = 'Partida cerrada';
                else if (abierta && libre) etiqueta = `Abierta ${slot.occupied}/${slot.capacity}`;
                else if (abierta) etiqueta = 'Partida abierta';
                else if (libre) etiqueta = 'Disponible';

                return (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={!libre}
                    onClick={() => setForm({ ...form, tee_slot_id: slot.id })}
                    className={`horario ${
                      on ? 'horario-seleccionado' : libre ? 'horario-disponible' : 'horario-ocupado'
                    }`}
                  >
                    <span className="flex w-full items-center justify-between">
                      <span
                        className={`font-mono text-time-slot ${
                          on ? 'text-on-primary' : libre ? 'text-primary' : 'text-outline line-through'
                        }`}
                      >
                        {hora(slot.slot_time)}
                      </span>
                      {on && <span className="text-secondary-fixed">✓</span>}
                    </span>
                    <span
                      className={`text-label-sm font-bold uppercase tracking-wider ${
                        on ? 'text-secondary-fixed' : libre ? 'text-estado-ok-text' : 'text-outline'
                      }`}
                    >
                      {etiqueta}
                    </span>
                  </button>
                );
              })}
              {slots.length === 0 && (
                <p className="col-span-full py-6 text-center text-body-lg text-outline">
                  No hay salidas programadas para esta fecha.
                </p>
              )}
            </div>
          </Bloque>

          {/* ================= 3. Titular, jugadores, bastones y tarifas === */}
          <Bloque numero="3" titulo="Titular, jugadores y tarifas" nota="Expediente del huésped">
            {/* --- 3a. El titular, que también juega --- */}
            <div className="rounded border border-primary-container/40 bg-primary-fixed/20 px-4 py-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-title-md text-primary">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-container font-mono text-label-sm text-secondary-fixed">
                    1
                  </span>
                  Titular de la reserva
                </p>
                <span className="rounded bg-primary-container px-2.5 py-0.5 text-label-sm uppercase tracking-wider text-on-primary">
                  Jugador 1 · cuenta para el cupo
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre completo del titular" required>
                  <Input
                    value={form.holder_name}
                    placeholder="Roberto Morales Vega"
                    onChange={(e) => setForm({ ...form, holder_name: e.target.value })}
                  />
                </Field>
                <Field label="Habitación / suite asignada">
                  <Input
                    value={form.holder_room}
                    placeholder="Suite 412"
                    onChange={(e) => setForm({ ...form, holder_room: e.target.value })}
                  />
                </Field>
                {/* El aviso aparece al salir del campo, no mientras se teclea:
                    marcar en rojo un correo a medio escribir es molesto. */}
                <Field
                  label="Correo electrónico del titular"
                  required
                  error={tocado.holder_email ? fallaCorreo : null}
                  hint="A este correo llega la confirmación y el pase de la partida."
                >
                  <Input
                    type="email"
                    value={form.holder_email}
                    placeholder="nombre@hotel.com"
                    aria-invalid={tocado.holder_email && Boolean(fallaCorreo)}
                    onBlur={() => setTocado((t) => ({ ...t, holder_email: true }))}
                    onChange={(e) => setForm({ ...form, holder_email: e.target.value })}
                    className={
                      tocado.holder_email && fallaCorreo ? '!border-error focus:!border-error' : ''
                    }
                  />
                </Field>
                <Field
                  label="Teléfono de contacto"
                  error={tocado.holder_phone ? fallaTelefono : null}
                >
                  <Input
                    value={form.holder_phone}
                    placeholder="958 123 4567"
                    inputMode="tel"
                    aria-invalid={tocado.holder_phone && Boolean(fallaTelefono)}
                    onBlur={() => setTocado((t) => ({ ...t, holder_phone: true }))}
                    onChange={(e) => setForm({ ...form, holder_phone: e.target.value })}
                    className={
                      tocado.holder_phone && fallaTelefono ? '!border-error focus:!border-error' : ''
                    }
                  />
                </Field>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="Edad" hint="Menor de 16 toma tarifa infantil">
                  <Input
                    type="number"
                    min="1"
                    max="120"
                    value={form.holder_age}
                    placeholder="45"
                    onChange={(e) => setForm({ ...form, holder_age: e.target.value })}
                  />
                </Field>
                <Field label="Identificador PGA" hint="Opcional · lo valida recepción">
                  <Input
                    value={form.holder_pga}
                    placeholder="PGA-00123"
                    onChange={(e) => setForm({ ...form, holder_pga: e.target.value })}
                  />
                </Field>
                {/* Un solo campo, aunque sean dos cosas distintas en el
                    mundo del golf: el hándicap es el número y el GHIN es la
                    credencial que lo respalda. En la caseta nadie los pide
                    por separado — el jugador dice uno o el otro, y lo que el
                    club necesita es tenerlo anotado. Pedir dos casillas para
                    que una siempre quede vacía solo hace más lento el
                    registro. */}
                <Field label="Handicap/GHIN" hint="Opcional · el número o la credencial">
                  <Input
                    value={form.holder_handicap}
                    placeholder="12.4 o 1234567"
                    onChange={(e) => setForm({ ...form, holder_handicap: e.target.value })}
                  />
                </Field>
                <Field label="Bastones" hint="Primero propios o renta">
                  <Bastones
                    valor={form.holder_club_hand}
                    onCambio={(v) => setForm({ ...form, holder_club_hand: v })}
                  />
                </Field>
              </div>
            </div>

            {/* --- 3b. Jugadores además del titular --- */}
            {maxExtras > 0 && (
              <div className="mt-5 rounded border border-outline-variant/60 bg-surface-container-low">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/50 px-4 py-3">
                  <div>
                    <p className="text-title-md text-on-surface">
                      Jugadores además del titular
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {paquete.sinTope
                        ? `Este paquete admite desde ${paquete.min} jugadores, sin límite, contando al titular.`
                        : paquete.min === paquete.max
                          ? `Este paquete admite ${paquete.max} jugadores en total, contando al titular.`
                          : `Este paquete admite de ${paquete.min} a ${paquete.max} jugadores en total, contando al titular.`}
                    </p>
                  </div>
                  <Contador
                    valor={extras.length}
                    min={minExtras}
                    max={maxExtras}
                    etiqueta="Cantidad"
                    onCambio={(n) => {
                      const next = [...extras];
                      while (next.length < n) next.push(jugadorVacio());
                      setExtras(next.slice(0, n));
                    }}
                  />
                </div>

                <div className="space-y-2 p-4">
                  {extras.map((player, index) => (
                    <JugadorFila
                      key={index}
                      numero={index + 2}
                      player={player}
                      precio={esMenor(player) ? precioInfantil : precioAdulto}
                      puedeQuitar={extras.length > minExtras}
                      onQuitar={() => setExtras(extras.filter((_, i) => i !== index))}
                      onChange={(campo, valor) => {
                        const next = [...extras];
                        next[index] = { ...next[index], [campo]: valor };
                        setExtras(next);
                      }}
                    />
                  ))}
                  {extras.length === 0 && (
                    <p className="py-3 text-center text-body-md text-outline">
                      Solo juega el titular. Suba la cantidad para agregar acompañantes de juego.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* --- 3c. Cupos y aforo --- */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded border border-outline-variant/40 bg-surface-container-low px-4 py-3">
              <div>
                <p className="text-title-md text-on-surface">Cupos y aforo de la salida</p>
                <p className="text-body-md text-on-surface-variant">
                  {paquete.sinTope
                    ? 'El grupo toma la salida completa, sin tope de jugadores.'
                    : `Los jugadores computan en el límite de partida (máx ${paquete.max} pax).`}{' '}
                  Los acompañantes no ocupan cupo y pagan {mxn(precioAcompanante)} cada uno.
                </p>
              </div>
              <div className="flex gap-2">
                <span className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-center">
                  <span className="block whitespace-nowrap text-title-md text-primary">
                    {jugadores.length} {jugadores.length === 1 ? 'jugador' : 'jugadores'}
                  </span>
                  <span className="block text-label-sm uppercase tracking-wider text-outline">
                    Ocupan cupo
                  </span>
                </span>
                <span className="rounded border border-secondary-fixed-dim bg-secondary-fixed/40 px-3 py-1.5 text-center">
                  <span className="block whitespace-nowrap text-title-md text-on-secondary-fixed-variant">
                    {companions.length}{' '}
                    {companions.length === 1 ? 'acompañante' : 'acompañantes'}
                  </span>
                  <span className="block text-label-sm uppercase tracking-wider text-on-secondary-container">
                    Sin cupo · {mxn(precioAcompanante)} c/u
                  </span>
                </span>
              </div>
            </div>

            {/* --- 3d. Tarifas de green fee --- */}
            <p className="mb-2 mt-5 flex items-center justify-between text-label-sm uppercase tracking-wider text-on-surface-variant">
              <span>Categorías de tarifa de green fee</span>
              <span className="normal-case tracking-normal text-outline">
                {ventaDirecta ? 'Precios del campo' : 'Precios de convenio hotelero'}
              </span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TarifaCard
                titulo="Tarifa adulto"
                detalle={`${adultos.length} ${adultos.length === 1 ? 'jugador' : 'jugadores'} × ${mxn(precioAdulto || 0)} c/u`}
                monto={subtotalAdultos}
                pie="Subtotal adultos"
              />
              <TarifaCard
                titulo="Tarifa infantil"
                detalle={`${menores.length} ${menores.length === 1 ? 'menor' : 'menores'} de 16 × ${mxn(precioInfantil || 0)} c/u`}
                monto={subtotalMenores}
                pie="Subtotal infantil"
              />
            </div>

            {/* --- 3e. Bastones, deducidos de cada jugador --- */}
            {bastones && (
              <>
                <p className="mb-2 mt-5 flex items-center justify-between text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <span className="flex items-center gap-2">
                    <Icono nombre="golf" size={15} className="text-secondary" />
                    Bastones / sets de palos
                  </span>
                  <span className="normal-case tracking-normal text-secondary">
                    {mxn(precioSet)} por set / ronda
                  </span>
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3">
                    <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                      Sets requeridos
                    </p>
                    <p className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="text-title-md text-on-surface">
                        {sets} {sets === 1 ? 'set' : 'sets'}
                      </span>
                      <span className="font-serif text-title-lg text-secondary">
                        {mxn(subtotalSets)}
                      </span>
                    </p>
                  </div>
                  <ContadorMano
                    titulo="Orientación diestro"
                    cantidad={diestros}
                    detalle={`${diestros} ${diestros === 1 ? 'jugador diestro' : 'jugadores diestros'}`}
                  />
                  <ContadorMano
                    titulo="Orientación zurdo"
                    cantidad={zurdos}
                    detalle={`${zurdos} ${zurdos === 1 ? 'jugador zurdo' : 'jugadores zurdos'}`}
                  />
                </div>
                <p className="mt-2 text-body-md text-outline">
                  Se calculan solos a partir de la orientación que elija en cada jugador. Quien trae
                  sus propios palos no genera cargo.
                </p>
              </>
            )}

            {/* --- 3f. Resumen del grupo --- */}
            <div className="mb-2 mt-6 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-title-md text-on-surface">
                  Resumen del grupo (jugadores y acompañantes)
                </p>
                <p className="text-body-md text-on-surface-variant">
                  Identificación, equipamiento asignado y rol en el tee time.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCompanions([...companions, { full_name: '' }])}
                className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-label-md text-primary transition hover:bg-surface-container-low"
              >
                + Agregar acompañante
              </button>
            </div>

            <div className="space-y-2">
              {jugadores.map((p, i) => (
                <FilaResumen
                  key={`j-${i}`}
                  numero={i + 1}
                  nombre={p.full_name}
                  rol={p.is_holder ? 'Titular · jugador' : esMenor(p) ? 'Jugador · infantil' : 'Jugador · adulto'}
                  tonoRol={esMenor(p) ? 'infantil' : 'adulto'}
                  detalle={[
                    p.age ? `${p.age} años` : null,
                    p.handicap ? `Handicap/GHIN ${p.handicap}` : null,
                    p.pga_code ? `PGA ${p.pga_code}` : null,
                    p.club_hand
                      ? `Renta de bastones: ${p.club_hand === 'ZURDO' ? 'zurdo' : 'diestro'}`
                      : 'Trae sus bastones',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  monto={mxn(esMenor(p) ? precioInfantil || 0 : precioAdulto || 0)}
                />
              ))}

              {jugadores.length === 0 && (
                <p className="rounded border border-dashed border-outline-variant px-4 py-6 text-center text-body-lg text-outline">
                  Capture el nombre del titular para armar el grupo.
                </p>
              )}

              {companions.map((companion, index) => (
                <div
                  key={`acomp-${index}`}
                  className="flex flex-wrap items-center gap-3 rounded border border-secondary-fixed-dim bg-secondary-fixed/25 px-3 py-2.5"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary-fixed text-label-md text-on-secondary-fixed">
                    A
                  </span>
                  <input
                    value={companion.full_name}
                    placeholder="Nombre del acompañante"
                    onChange={(e) => {
                      const next = [...companions];
                      next[index].full_name = e.target.value;
                      setCompanions(next);
                    }}
                    className="min-w-[180px] flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-body-lg"
                  />
                  <span className="whitespace-nowrap rounded bg-surface-container-lowest px-2 py-0.5 text-label-sm uppercase tracking-wider text-on-secondary-container">
                    No juega
                  </span>
                  <span className="whitespace-nowrap font-mono text-title-md text-primary">
                    {mxn(precioAcompanante)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCompanions(companions.filter((_, i) => i !== index))}
                    className="text-outline hover:text-error"
                    aria-label="Quitar acompañante"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Bloque>
        </div>

        {/* ============================= COLUMNA DERECHA: EXPEDIENTE ===== */}
        <aside className="space-y-4 xl:sticky xl:top-24 xl:col-span-4">
          <section className="rounded-lg border-t-4 border-secondary bg-surface-container-lowest shadow-card">
            <header className="flex items-start justify-between gap-2 px-5 pb-3 pt-4">
              <div>
                <p className="text-label-sm uppercase tracking-widest text-outline">
                  Expediente oficial
                </p>
                <h2 className="font-serif text-headline-md text-primary">Resumen de solicitud</h2>
              </div>
              <span className="shrink-0 rounded bg-secondary-fixed px-2 py-0.5 text-label-sm uppercase tracking-wider text-on-secondary-fixed-variant">
                {ventaDirecta ? 'Venta directa' : 'Hotel partner'}
              </span>
            </header>

            <dl className="space-y-2 px-5 pb-4 text-body-lg">
              <Renglon
                t={ventaDirecta ? 'Origen de la reserva' : 'Hotel solicitante'}
                v={isHotel ? user?.hotel_name || '—' : ventaDirecta ? 'Llegó al campo' : nombreDelHotel}
              />
              <Renglon t="Titular de la reserva" v={form.holder_name || '—'} />
              <Renglon
                t="Fecha y salida"
                v={
                  salidaElegida ? (
                    <>
                      {fecha(date)}
                      <span className="block font-mono text-label-md text-secondary">
                        {hora(salidaElegida.slot_time)} hrs
                      </span>
                    </>
                  ) : (
                    '—'
                  )
                }
              />
              <Renglon t="Paquete" v={`${paquete.nombre} (${jugadores.length} pax)`} />
              <Renglon t="Recorrido" v={`${form.holes} hoyos`} />
              <Renglon
                t="Jugadores con cupo"
                v={`${jugadores.length} (${adultos.length} ${
                  adultos.length === 1 ? 'adulto' : 'adultos'
                }, ${menores.length} ${menores.length === 1 ? 'menor' : 'menores'})`}
              />
              <Renglon
                t="Acompañantes"
                v={
                  acompanantesConNombre.length
                    ? `${acompanantesConNombre.length} (no juegan · ${mxn(subtotalAcompanantes)})`
                    : 'Ninguno'
                }
                acento
              />
              <Renglon
                t="Carritos asignados"
                v={
                  carritosNecesarios
                    ? `${carritosNecesarios} (${asientosPorCarrito} personas por carrito)`
                    : 'Ninguno'
                }
              />
              <Renglon
                t="Caddies asignados"
                v={
                  caddiesAsignados
                    ? `${caddiesAsignados} · ${mxn(costoCaddiesInformativo)} que el huésped paga directo`
                    : 'Ninguno disponible ese día'
                }
              />
              <Renglon
                t="Bastones / sets"
                v={
                  sets
                    ? `${sets} ${sets === 1 ? 'set' : 'sets'} (${diestros} diestro${
                        diestros === 1 ? '' : 's'
                      }, ${zurdos} zurdo${zurdos === 1 ? '' : 's'})`
                    : 'Traen los suyos'
                }
              />
            </dl>

            <div className="mx-5 mb-4 rounded border border-outline-variant/50 bg-surface-container-low p-4">
              <p className="mb-2 text-label-sm uppercase tracking-wider text-on-surface-variant">
                Desglose de servicios solicitados
              </p>
              <div className="space-y-1.5 text-body-md">
                <div className="flex justify-between gap-3">
                  <span className="text-on-surface-variant">
                    Tarifa adultos ({adultos.length})
                  </span>
                  <span className="font-mono text-on-surface">{mxn(subtotalAdultos)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-on-surface-variant">
                    Tarifa infantil ({menores.length})
                  </span>
                  <span className="font-mono text-on-surface">{mxn(subtotalMenores)}</span>
                </div>
                {acompanantesConNombre.length > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-on-surface-variant">
                      Acompañantes ({acompanantesConNombre.length} × {mxn(precioAcompanante)})
                    </span>
                    <span className="font-mono text-on-surface">{mxn(subtotalAcompanantes)}</span>
                  </div>
                )}
                {subtotalServicios > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0 text-on-surface-variant">
                      Servicios ({sets} set{sets === 1 ? '' : 's'} de bastones)
                    </span>
                    <span className="font-mono text-secondary">{mxn(subtotalServicios)}</span>
                  </div>
                )}
              </div>
              <div className="mt-3 border-t border-outline-variant/50 pt-3">
                <p className="text-label-sm uppercase tracking-wider text-secondary">
                  Total de la solicitud
                </p>
                <div className="mt-1 flex items-end justify-between gap-3">
                  {/* Se dice qué precio aplica: el mismo paquete cuesta más de
                      viernes a domingo, y el hotel tiene que poder explicarlo. */}
                  <p className="text-label-sm text-outline">
                    {esFinDeSemana(date) ? 'Precio de fin de semana' : 'Precio entre semana'}
                  </p>
                  <p className="whitespace-nowrap font-serif text-headline-md text-primary">
                    {mxn(total)}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-5 pb-5">
              <button
                type="button"
                onClick={enviar}
                disabled={!listo || saving}
                className="flex w-full items-center justify-center gap-2 rounded bg-primary-container px-4 py-3 text-title-md text-on-primary shadow-card transition hover:bg-primary disabled:bg-surface-container-highest disabled:text-outline"
              >
                {saving ? (
                  'Enviando…'
                ) : (
                  <>
                    <Icono nombre="send" size={18} /> Enviar solicitud al campo
                  </>
                )}
              </button>
              {!listo && (
                <p className="mt-2 text-center text-body-md text-outline">
                  Falta elegir horario y completar los datos del titular.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card">
            <p className="mb-3 flex items-center gap-2 text-label-sm uppercase tracking-wider text-primary">
              <Icono nombre="gavel" size={16} className="text-secondary" /> Políticas del club
            </p>
            <ul className="space-y-3 text-body-md text-on-surface-variant">
              <li>
                <span className="block text-title-md text-on-surface">Confirmación</span>
                La Dirección Deportiva valida la solicitud; el cambio de estado se ve en su panel en
                cuanto ocurre.
              </li>
              <li>
                <span className="block text-title-md text-on-surface">Una salida, una partida</span>
                Al reservar, ese horario deja de ofrecerse a los demás hoteles. La partida abierta
                es la excepción.
              </li>
              <li>
                <span className="block text-title-md text-on-surface">Servicios y cobro</span>
                Caddies y bastones quedan apartados con esta solicitud. El cobro y la validación de
                credenciales PGA se hacen en recepción.
              </li>
              <li>
                <span className="block text-title-md text-on-surface">Agenda</span>
                Se puede reservar hasta {LIMITE_MESES} meses adelante; los horarios que ya pasaron
                dejan de ofrecerse.
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ piezas */

function Bloque({ numero, titulo, nota, children }) {
  return (
    <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/40 px-5 py-3.5">
        <h2 className="flex items-center gap-3 font-serif text-headline-md text-primary">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-container font-sans text-label-md text-on-primary">
            {numero}
          </span>
          {titulo}
        </h2>
        {nota && (
          <span className="text-label-sm uppercase tracking-wider text-outline">{nota}</span>
        )}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/**
 * Bastones en dos pasos: primero si trae los suyos o renta, y solo si renta se
 * pregunta la orientación. Preguntar las tres cosas juntas confundía: "diestro"
 * parecía una característica del jugador y no una renta.
 */
function Bastones({ valor, onCambio }) {
  const renta = valor === 'DIESTRO' || valor === 'ZURDO';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="flex rounded border border-outline-variant p-0.5">
        <Pastilla activa={!renta} onClick={() => onCambio('')}>
          Trae los suyos
        </Pastilla>
        <Pastilla activa={renta} onClick={() => onCambio(valor || 'DIESTRO')}>
          Renta
        </Pastilla>
      </div>
      {renta && (
        <div className="flex rounded border border-outline-variant p-0.5">
          <Pastilla activa={valor === 'DIESTRO'} onClick={() => onCambio('DIESTRO')}>
            Diestro
          </Pastilla>
          <Pastilla activa={valor === 'ZURDO'} onClick={() => onCambio('ZURDO')}>
            Zurdo
          </Pastilla>
        </div>
      )}
    </div>
  );
}

function Pastilla({ activa, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded px-2.5 py-1 text-label-sm uppercase tracking-wider transition ${
        activa
          ? 'bg-primary-container text-on-primary'
          : 'text-on-surface-variant hover:bg-surface-container-low'
      }`}
    >
      {children}
    </button>
  );
}

/** Contador +/- reutilizable: caddies y jugadores adicionales usan el mismo. */
function Contador({ valor, min, max, onCambio, etiqueta }) {
  return (
    <div className="shrink-0">
      {etiqueta && (
        <p className="mb-1 text-label-sm uppercase tracking-wider text-on-surface-variant">
          {etiqueta}
        </p>
      )}
      <div className="flex items-center overflow-hidden rounded border border-outline-variant bg-surface-container-lowest">
        <button
          type="button"
          onClick={() => onCambio(Math.max(min, valor - 1))}
          disabled={valor <= min}
          className="px-3 py-1.5 text-title-lg text-on-surface-variant transition hover:bg-surface-container-low disabled:opacity-40"
          aria-label="Quitar uno"
        >
          −
        </button>
        <span className="min-w-[2.5rem] border-x border-outline-variant py-1.5 text-center font-mono text-title-md text-primary">
          {valor}
        </span>
        <button
          type="button"
          onClick={() => onCambio(Math.min(max, valor + 1))}
          disabled={valor >= max}
          className="px-3 py-1.5 text-title-lg text-on-surface-variant transition hover:bg-surface-container-low disabled:opacity-40"
          aria-label="Agregar uno"
        >
          +
        </button>
      </div>
    </div>
  );
}

function ContadorMano({ titulo, cantidad, detalle }) {
  return (
    <div className="rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3">
      <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{titulo}</p>
      <p className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-body-md text-outline">{detalle}</span>
        <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono text-label-md text-on-surface">
          {cantidad} {cantidad === 1 ? 'set' : 'sets'}
        </span>
      </p>
    </div>
  );
}

function TarifaCard({ titulo, detalle, monto, pie }) {
  return (
    <div className="rounded border border-outline-variant/50 bg-surface-container-low px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-title-md text-on-surface">{titulo}</p>
          <p className="text-body-md text-outline">{detalle}</p>
        </div>
        <p className="shrink-0 font-serif text-title-lg text-primary">{mxn(monto)}</p>
      </div>
      <p className="mt-1 text-right text-label-sm uppercase tracking-wider text-estado-ok-text">
        {pie}
      </p>
    </div>
  );
}

function Renglon({ t, v, acento }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-on-surface-variant">{t}</dt>
      <dd className={`text-right text-title-md ${acento ? 'text-secondary' : 'text-primary'}`}>
        {v}
      </dd>
    </div>
  );
}

/** Un renglón del resumen del grupo: quién es, qué trae y cuánto paga. */
function FilaResumen({ numero, nombre, rol, tonoRol, detalle, monto }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-outline-variant/50 bg-surface-container-lowest px-3 py-2.5">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-label-md ${
          numero === 1
            ? 'bg-primary-container text-secondary-fixed'
            : 'bg-surface-container-high text-on-surface-variant'
        }`}
      >
        {numero}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-title-md text-primary">{nombre}</span>
          <span
            className={`whitespace-nowrap rounded px-2 py-0.5 text-label-sm uppercase tracking-wider ${
              tonoRol === 'infantil'
                ? 'bg-secondary-fixed text-on-secondary-fixed-variant'
                : 'bg-primary-container text-on-primary'
            }`}
          >
            {rol}
          </span>
        </span>
        <span className="block text-body-md text-outline">{detalle}</span>
      </span>
      <span className="shrink-0 rounded bg-estado-ok-bg px-2.5 py-1 font-mono text-label-md text-estado-ok-text">
        {monto} GF
      </span>
    </div>
  );
}

function JugadorFila({ numero, player, precio, puedeQuitar, onQuitar, onChange }) {
  const menor = player.age && Number(player.age) < 16;
  return (
    <div className="rounded border border-outline-variant/50 bg-surface-container-lowest px-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-mono text-label-md text-on-surface-variant">
          {numero}
        </span>
        <input
          value={player.full_name}
          placeholder="Nombre del jugador"
          onChange={(e) => onChange('full_name', e.target.value)}
          className="min-w-[180px] flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-body-lg"
        />
        <input
          type="number"
          min="1"
          max="120"
          value={player.age}
          placeholder="Edad"
          onChange={(e) => onChange('age', e.target.value)}
          className="w-20 rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-body-lg"
        />
        <span
          className={`whitespace-nowrap rounded px-2 py-0.5 text-label-sm uppercase tracking-wider ${
            menor
              ? 'bg-secondary-fixed text-on-secondary-fixed-variant'
              : 'bg-surface-container-high text-on-surface-variant'
          }`}
        >
          {menor ? 'Infantil' : 'Adulto'}
        </span>
        <span className="whitespace-nowrap rounded bg-estado-ok-bg px-2 py-0.5 font-mono text-label-md text-estado-ok-text">
          {mxn(precio || 0)}
        </span>
        {puedeQuitar && (
          <button
            type="button"
            onClick={onQuitar}
            className="text-outline transition hover:text-error"
            aria-label="Quitar jugador"
          >
            ×
          </button>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3 border-t border-outline-variant/40 pt-2.5">
        <input
          value={player.pga_code}
          placeholder="PGA (opcional)"
          onChange={(e) => onChange('pga_code', e.target.value)}
          className="min-w-[150px] flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-body-md"
        />
        <input
          value={player.handicap}
          placeholder="Handicap/GHIN"
          onChange={(e) => onChange('handicap', e.target.value)}
          className="w-40 rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-body-md"
        />
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-label-sm uppercase tracking-wider text-outline">
            Bastones
          </span>
          <Bastones valor={player.club_hand} onCambio={(v) => onChange('club_hand', v)} />
        </div>
      </div>
    </div>
  );
}

/**
 * Número de semana (lunes como primer día) para distinguir "esta semana" de
 * "la próxima" en el selector de fechas.
 */
function semanaDe(d) {
  const lunes = new Date(d);
  const desplazamiento = (d.getDay() + 6) % 7; // domingo = 6
  lunes.setHours(0, 0, 0, 0);
  lunes.setDate(d.getDate() - desplazamiento);
  return Math.floor(lunes.getTime() / 86400000);
}

/** Seis días a partir de hoy, con etiquetas legibles. */
function proximosDias(cantidad) {
  const dias = [];
  const base = new Date();
  for (let i = 0; i < cantidad; i += 1) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = fechaLocal(d);

    // La etiqueta superior es relativa (nunca el día de la semana: ese ya va
    // en la línea grande), igual que en el diseño.
    let etiqueta;
    if (i === 0) etiqueta = 'Hoy';
    else if (i === 1) etiqueta = 'Mañana';
    else if (semanaDe(d) > semanaDe(base)) etiqueta = 'Próxima sem.';
    else if ([0, 6].includes(d.getDay())) etiqueta = 'Fin de sem.';
    else etiqueta = 'Esta sem.';

    const diaSemana = new Intl.DateTimeFormat('es-MX', { weekday: 'short' })
      .format(d)
      .replace('.', '');
    dias.push({
      iso,
      etiqueta,
      dia: `${diaSemana.charAt(0).toUpperCase()}${diaSemana.slice(1)} ${String(d.getDate()).padStart(2, '0')}`,
      mes: new Intl.DateTimeFormat('es-MX', { month: 'short' }).format(d).replace('.', ''),
    });
  }
  return dias;
}
