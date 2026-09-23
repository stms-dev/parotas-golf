/**
 * Control del Sistema — la pantalla de la Administración.
 *
 * No opera el día: lo configura. Es una sola pantalla densa a propósito, con
 * todo lo que se toca de verdad y nada de lo que ya vive en las pantallas de
 * operación:
 *
 *   1. Dinero por día, semana, mes y año.
 *   2. Turno de caja: abrir y cerrar.
 *   3. Horarios del día: abrir y cerrar salidas una por una.
 *   4. Tarifas: editar las vigentes y dar de alta nuevas.
 *   5. Tipo de cambio del día.
 *   6. Comisión de cada hotel.
 *   7. Cuentas: alta, baja y cambio de contraseña.
 *
 * Todo lo que se cambia aquí queda en la bitácora con valor anterior y nuevo,
 * porque son los números con los que se cobra.
 */
import { useEffect, useState } from 'react';

import { bookingApi, catalogApi, eventsApi, treasuryApi, usersApi } from '../api/client';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Spinner } from '../components/ui';
import HistorialTipoCambio from '../components/HistorialTipoCambio';
import Icono from '../components/Icono';
import { confirmar, error as avisoError, exito } from '../utils/avisos';
import { MODALIDAD, ROL, fecha, fechaCorta, fechaHora, hora, hoy, mxn, usd, fechaLocal } from '../utils/format';

const PERIODOS = [
  { key: 'dia', label: 'Día' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
  { key: 'anio', label: 'Año' },
];

const CATEGORIA = { ADULTO: 'Adulto', INFANTIL: 'Infantil' };

/** Qué días cobra cada tarifa. */
const DIAS = {
  ENTRE_SEMANA: 'Lun a jue',
  FIN_DE_SEMANA: 'Vie a dom',
  TODOS: 'Todos los días',
};

function iso(d) {
  return fechaLocal(d);
}

/** "09:00:00" → "09:01:00". Para cerrar una sola salida sin tocar la siguiente. */
function unMinutoDespues(hhmmss) {
  const [h, m] = String(hhmmss).split(':').map(Number);
  const total = h * 60 + m + 1;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:00`;
}

function rangoDe(key) {
  const fin = new Date();
  const inicio = new Date();
  if (key === 'semana') inicio.setDate(fin.getDate() - 6);
  if (key === 'mes') inicio.setDate(1);
  if (key === 'anio') {
    inicio.setMonth(0);
    inicio.setDate(1);
  }
  return { start: iso(inicio), end: iso(fin) };
}

export default function AdminPage() {
  const [periodo, setPeriodo] = useState('dia');
  const [dia, setDia] = useState(hoy());

  const [resumen, setResumen] = useState(null);
  const [caja, setCaja] = useState(null);
  const [slots, setSlots] = useState([]);
  const [tarifas, setTarifas] = useState([]);
  const [tc, setTc] = useState(null);
  const [hoteles, setHoteles] = useState([]);
  const [cuentas, setCuentas] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { start, end } = rangoDe(periodo);

  async function cargarTodo(conSpinner = true) {
    if (conSpinner) setLoading(true);
    setError(null);
    try {
      const [res, cash, tarifaList, cambio, hotelList, users] = await Promise.all([
        treasuryApi.summary({ start, end }),
        treasuryApi.currentCash().catch(() => null),
        catalogApi.rates(),
        catalogApi.exchangeRate(),
        catalogApi.hotels(),
        usersApi.list().catch(() => []),
      ]);
      setResumen(res);
      setCaja(cash);
      setTarifas(tarifaList);
      setTc(cambio);
      setHoteles(hotelList);
      setCuentas(users);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function cargarSlots() {
    try {
      const data = await bookingApi.availability({ slot_date: dia });
      setSlots(data.slots);
    } catch {
      setSlots([]);
    }
  }

  useEffect(() => {
    cargarTodo();
  }, [start, end]);

  useEffect(() => {
    cargarSlots();
  }, [dia]);

  useRealtimeEvent(
    [
      EVENTOS.PAGO_REGISTRADO,
      EVENTOS.CHECKIN_REGISTRADO,
      EVENTOS.DISPONIBILIDAD_CAMBIADA,
      EVENTOS.TIPO_CAMBIO_ACTUALIZADO,
    ],
    () => {
      cargarTodo(false);
      cargarSlots();
    },
  );

  if (loading) return <Spinner />;

  const tasa = Number(tc?.rate || 0);

  return (
    <div className="space-y-gutter">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="font-serif text-display-lg leading-tight text-primary">
            Control del sistema
          </h1>
          <p className="text-body-lg text-outline">
            Todo lo que se puede cambiar del club, en una sola pantalla.
          </p>
        </div>
        <div className="flex overflow-hidden rounded border border-outline-variant bg-surface-container-lowest">
          {PERIODOS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriodo(p.key)}
              className={`px-4 py-2 text-title-md transition ${
                periodo === p.key
                  ? 'bg-primary-container text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <Alert tone="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* ------------------------------------------------------------- dinero */}
      <section className="grid gap-gutter lg:grid-cols-4">
        <Cifra
          label="Venta total"
          valor={mxn(resumen?.gross_sales ?? 0)}
          pie={`${resumen?.reservations_count ?? 0} partidas · ${fecha(start)} a ${fecha(end)}`}
        />
        <Cifra
          label="Comisión a hoteles"
          valor={mxn(resumen?.hotel_commissions ?? 0)}
          pie="lo que se les queda"
          tono="text-secondary"
        />
        <Cifra
          label="Descuentos PGA"
          valor={mxn(resumen?.pga_discounts ?? 0)}
          pie="bonificado a profesionales"
          tono="text-estado-ok-text"
        />
        <Cifra
          label="Ingreso neto"
          valor={mxn(resumen?.net_course ?? 0)}
          pie={`cobrado ${mxn(resumen?.total_collected ?? 0)}`}
          oscuro
        />
      </section>

      <div className="grid gap-gutter xl:grid-cols-2">
        <TurnoDeCaja caja={caja} onCambio={() => cargarTodo(false)} />
        <TipoDeCambio tc={tc} onCambio={() => cargarTodo(false)} />
      </div>

      <HorariosDelDia
        dia={dia}
        slots={slots}
        onDia={setDia}
        onCambio={cargarSlots}
      />

      <Tarifas tarifas={tarifas} tasa={tasa} onCambio={() => cargarTodo(false)} />

      <BeneficioPga />

      <CarritosYCaddies />

      <Comisiones hoteles={hoteles} onCambio={() => cargarTodo(false)} />

      <Cuentas cuentas={cuentas} hoteles={hoteles} onCambio={() => cargarTodo(false)} />
    </div>
  );
}

/* --------------------------------------------------------------- 2. caja */

function TurnoDeCaja({ caja, onCambio }) {
  const [guardando, setGuardando] = useState(false);
  const [contado, setContado] = useState({ mxn: '', tarjeta: '' });
  const abierto = Boolean(caja?.session_id);

  async function abrir() {
    setGuardando(true);
    try {
      await treasuryApi.openCash({ opening_cash_mxn: '0.00', opening_cash_usd: '0.00' });
      await exito('Turno abierto', 'El mostrador ya puede registrar cobros.');
      onCambio();
    } catch (err) {
      await avisoError('No se pudo abrir el turno', err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function cerrar() {
    const efectivo = Number(contado.mxn);
    const tarjeta = Number(contado.tarjeta);
    if (!contado.mxn || !contado.tarjeta) {
      await avisoError(
        'Faltan las cantidades contadas',
        'Anote cuánto contó en efectivo y cuánto marcó la terminal.',
      );
      return;
    }
    const dif = efectivo + tarjeta - Number(caja.total_mxn || 0);
    const ok = await confirmar({
      titulo: 'Cerrar el turno de caja',
      texto:
        `Se cerrará el turno con <b>${mxn(efectivo + tarjeta)}</b> contados contra ` +
        `<b>${mxn(caja.total_mxn)}</b> esperados.<br>` +
        (Math.abs(dif) < 0.005
          ? 'Cuadra exacto.'
          : `<span style="opacity:.8">Diferencia de <b>${mxn(Math.abs(dif))}</b> ` +
            `${dif < 0 ? 'faltante' : 'sobrante'}; queda registrada y no se puede corregir.</span>`),
      confirmar: 'Sí, cerrar el turno',
      icono: 'question',
    });
    if (!ok) return;

    setGuardando(true);
    try {
      await treasuryApi.closeCash(caja.session_id, {
        counted_cash_mxn: efectivo.toFixed(2),
        counted_card_mxn: tarjeta.toFixed(2),
      });
      await exito('Turno cerrado', 'Quedó registrado el corte con su diferencia.');
      setContado({ mxn: '', tarjeta: '' });
      onCambio();
    } catch (err) {
      await avisoError('No se pudo cerrar el turno', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Tarjeta icono="cajaFuerte" titulo="Turno de caja">
      {abierto ? (
        <>
          <div className="grid gap-2.5 sm:grid-cols-3">
            <Dato label="Efectivo" valor={mxn(caja.cash_mxn)} />
            <Dato label="Terminal" valor={mxn(caja.card_mxn)} />
            <Dato label="Total" valor={mxn(caja.total_mxn)} fuerte />
          </div>
          <p className="mt-2 text-body-md text-outline">
            Abierto por {caja.opened_by_name || '—'}
            {caja.opened_at ? ` · ${fechaHora(caja.opened_at)}` : ''} ·{' '}
            {caja.payment_count ?? 0} movimientos.
          </p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <label>
              <span className={ETIQUETA}>Efectivo contado</span>
              <input
                type="number"
                step="0.01"
                value={contado.mxn}
                placeholder="0.00"
                onChange={(e) => setContado({ ...contado, mxn: e.target.value })}
                className={`${CAMPO} text-right font-mono`}
              />
            </label>
            <label>
              <span className={ETIQUETA}>Terminal según el corte</span>
              <input
                type="number"
                step="0.01"
                value={contado.tarjeta}
                placeholder="0.00"
                onChange={(e) => setContado({ ...contado, tarjeta: e.target.value })}
                className={`${CAMPO} text-right font-mono`}
              />
            </label>
          </div>
          <button onClick={cerrar} disabled={guardando} className={`${BOTON_FUERTE} mt-3 w-full`}>
            <Icono nombre="candado" size={16} className="text-secondary-fixed" />
            {guardando ? 'Cerrando…' : 'Cerrar el turno'}
          </button>
        </>
      ) : (
        <>
          <p className="text-body-lg text-outline">
            No hay turno abierto. Sin turno, el mostrador no puede cobrar.
          </p>
          <button onClick={abrir} disabled={guardando} className={`${BOTON_FUERTE} mt-3 w-full`}>
            <Icono nombre="cajaFuerte" size={16} className="text-secondary-fixed" />
            {guardando ? 'Abriendo…' : 'Abrir el turno de caja'}
          </button>
        </>
      )}
    </Tarjeta>
  );
}

/* -------------------------------------------------------- 5. tipo de cambio */

function TipoDeCambio({ tc, onCambio }) {
  const [valor, setValor] = useState('');
  const [verHistorial, setVerHistorial] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    const nuevo = Number(valor);
    if (!nuevo || nuevo <= 0) {
      await avisoError('Tipo de cambio inválido', 'Escriba cuántos pesos vale un dólar.');
      return;
    }
    const ok = await confirmar({
      titulo: 'Cambiar el tipo de cambio',
      texto:
        `Pasará de <b>$${Number(tc?.rate || 0).toFixed(2)}</b> a <b>$${nuevo.toFixed(2)}</b> ` +
        'por dólar.<br><span style="font-size:.9em;opacity:.75">Las reservas ya cobradas ' +
        'conservan el tipo de cambio con el que se cobraron.</span>',
      confirmar: 'Sí, cambiarlo',
      icono: 'question',
    });
    if (!ok) return;
    setGuardando(true);
    try {
      await catalogApi.setExchangeRate({ rate: nuevo.toFixed(4) });
      await exito('Tipo de cambio actualizado', `1 USD = $${nuevo.toFixed(2)} MXN.`);
      setValor('');
      onCambio();
    } catch (err) {
      await avisoError('No se pudo actualizar', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Tarjeta icono="refrescar" titulo="Tipo de cambio">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-serif text-display-lg leading-none text-primary">
            ${Number(tc?.rate || 0).toFixed(2)}
          </p>
          <p className="text-body-md text-outline">
            pesos por dólar
            {tc?.effective_from ? ` · desde ${fechaHora(tc.effective_from)}` : ''}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label>
            <span className={ETIQUETA}>Nuevo valor</span>
            <input
              type="number"
              step="0.01"
              value={valor}
              placeholder={Number(tc?.rate || 0).toFixed(2)}
              onChange={(e) => setValor(e.target.value)}
              className={`${CAMPO} w-28 text-right font-mono`}
            />
          </label>
          <button onClick={guardar} disabled={guardando} className={BOTON}>
            {guardando ? 'Guardando…' : 'Aplicar'}
          </button>
        </div>
      </div>

      {/* Cada cambio queda como una fila nueva: aquí se ve la historia. */}
      <div className="mt-4 border-t border-outline-variant/40 pt-3">
        <button
          type="button"
          onClick={() => setVerHistorial((v) => !v)}
          className="flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-on-surface-variant transition hover:text-primary"
        >
          <Icono nombre="historial" size={15} className="text-secondary" />
          {verHistorial ? 'Ocultar historial' : 'Ver historial de cambios'}
        </button>
        {verHistorial && (
          <div className="mt-3">
            <HistorialTipoCambio limite={30} compacto />
          </div>
        )}
      </div>
    </Tarjeta>
  );
}

/* ------------------------------------------------------------- beneficio PGA */

/**
 * Porcentaje que se descuenta al profesional con credencial. Se aplica solo a
 * la tarifa de esa persona, nunca al total del ticket. Cada cambio queda como
 * una configuración nueva; lo ya cobrado conserva el descuento que tuvo.
 */
function BeneficioPga() {
  const [config, setConfig] = useState(null);
  const [valor, setValor] = useState('');
  const [guardando, setGuardando] = useState(false);

  function cargar() {
    catalogApi.pgaConfig().then(setConfig).catch(() => setConfig(null));
  }
  useEffect(cargar, []);

  const actual = config ? Number(config.value) : 0;

  async function guardar() {
    const nuevo = Number(valor);
    if (!(nuevo >= 0 && nuevo <= 100) || valor === '') {
      await avisoError('Porcentaje inválido', 'Escriba un porcentaje entre 0 y 100.');
      return;
    }
    const ok = await confirmar({
      titulo: 'Cambiar el descuento PGA',
      texto:
        `Pasará de <b>${actual.toFixed(0)}%</b> a <b>${nuevo.toFixed(0)}%</b> sobre la tarifa ` +
        'de cada profesional con credencial.<br><span style="font-size:.9em;opacity:.75">' +
        'Las partidas ya cobradas conservan su descuento.</span>',
      confirmar: 'Sí, cambiarlo',
      icono: 'question',
    });
    if (!ok) return;
    setGuardando(true);
    try {
      await catalogApi.setPgaConfig({
        discount_type: 'PORCENTAJE',
        value: nuevo.toFixed(2),
        description: `Beneficio PGA ${nuevo.toFixed(0)}% sobre la tarifa del portador`,
        valid_from: hoy(),
      });
      await exito('Descuento PGA actualizado', `Ahora es del ${nuevo.toFixed(0)}% por persona.`);
      setValor('');
      cargar();
    } catch (err) {
      await avisoError('No se pudo actualizar', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Tarjeta icono="verificado" titulo="Beneficio PGA">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-serif text-display-lg leading-none text-primary">
            {config ? `${actual.toFixed(0)}%` : '—'}
          </p>
          <p className="text-body-md text-outline">
            de descuento sobre la tarifa de la persona con credencial (no del total del ticket)
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label>
            <span className={ETIQUETA}>Nuevo porcentaje</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={valor}
              placeholder={actual.toFixed(0)}
              onChange={(e) => setValor(e.target.value)}
              className={`${CAMPO} w-24 text-right font-mono`}
            />
          </label>
          <button onClick={guardar} disabled={guardando} className={BOTON}>
            {guardando ? 'Guardando…' : 'Aplicar'}
          </button>
        </div>
      </div>
    </Tarjeta>
  );
}

/* ------------------------------------------------------- 3. horarios del día */

function HorariosDelDia({ dia, slots, onDia, onCambio }) {
  const [trabajando, setTrabajando] = useState(null);

  async function alternar(slot) {
    const bloqueada = slot.status === 'BLOQUEADO';
    if (!bloqueada && slot.occupied > 0) {
      await avisoError(
        'Esa salida tiene gente',
        `Las ${hora(slot.slot_time)} ya tienen ${slot.occupied} jugador(es). ` +
          'Cancele la partida antes de cerrar el horario.',
      );
      return;
    }
    setTrabajando(slot.id);
    try {
      if (bloqueada) {
        if (!slot.event_id) {
          await avisoError('No se pudo abrir', 'Esa salida no trae el bloqueo que la cerró.');
          return;
        }
        await eventsApi.release(slot.event_id);
      } else {
        // Cerrar una salida es crear un bloqueo de su franja: así queda
        // registrado quién la cerró y se puede volver a abrir.
        //
        // El bloqueo toma las salidas entre la hora inicial y la final, con
        // las dos incluidas, y exige que la final sea posterior. Por eso se
        // le suma un minuto y no el intervalo: con el intervalo completo
        // caería también la salida siguiente.
        await eventsApi.create({
          name: `Cierre de las ${hora(slot.slot_time)}`,
          event_type: 'MANTENIMIENTO',
          event_date: slot.slot_date,
          start_time: slot.slot_time,
          end_time: unMinutoDespues(slot.slot_time),
          tee: slot.tee,
          blocks_availability: true,
        });
      }
      onCambio();
    } catch (err) {
      await avisoError('No se pudo cambiar el horario', err.message);
    } finally {
      setTrabajando(null);
    }
  }

  const abiertas = slots.filter((s) => s.status !== 'BLOQUEADO').length;

  return (
    <Tarjeta
      icono="reloj"
      titulo="Horarios del día"
      extra={
        <div className="flex items-center gap-2.5">
          <span className="text-body-md text-outline">
            {abiertas} de {slots.length} abiertas
          </span>
          <input
            type="date"
            value={dia}
            onChange={(e) => onDia(e.target.value)}
            className={`${CAMPO} w-auto`}
          />
        </div>
      }
    >
      <HoraLimite />
      <p className="mb-3 text-body-md text-outline">
        Toque una salida para cerrarla o volverla a abrir. Una salida con gente no se cierra.
      </p>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {slots.map((slot) => {
          const bloqueada = slot.status === 'BLOQUEADO';
          const ocupada = slot.occupied > 0;
          return (
            <button
              key={slot.id}
              onClick={() => alternar(slot)}
              disabled={trabajando === slot.id}
              className={`rounded border px-3 py-2.5 text-left transition disabled:opacity-50 ${
                bloqueada
                  ? 'border-outline-variant bg-surface-container-high text-outline'
                  : ocupada
                    ? 'border-secondary-fixed-dim bg-secondary-fixed/25'
                    : 'border-estado-ok-border bg-estado-ok-bg/50 hover:bg-estado-ok-bg'
              }`}
            >
              <span
                className={`block font-mono text-title-lg ${
                  bloqueada ? 'text-outline line-through' : 'text-primary'
                }`}
              >
                {hora(slot.slot_time)}
              </span>
              <span className="block text-label-sm uppercase tracking-wider text-on-surface-variant">
                {bloqueada
                  ? 'Cerrada'
                  : ocupada
                    ? `${slot.occupied} jugador${slot.occupied === 1 ? '' : 'es'}`
                    : 'Abierta'}
              </span>
            </button>
          );
        })}
        {slots.length === 0 && (
          <p className="py-6 text-center text-body-lg text-outline sm:col-span-3 lg:col-span-4 2xl:col-span-6">
            Ese día no tiene horarios generados.
          </p>
        )}
      </div>
    </Tarjeta>
  );
}

/**
 * Hora a partir de la cual ya no se reserva para hoy. Pasada esa hora el día
 * se cierra entero aunque le queden salidas libres; los días siguientes siguen
 * abiertos. Se guarda en la base, así que aplica a todos los hoteles a la vez.
 */
function HoraLimite() {
  const [actual, setActual] = useState(null);
  const [valor, setValor] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    catalogApi
      .settings()
      .then((lista) => {
        const h = lista.find((x) => x.key === 'same_day_cutoff')?.value || '15:00';
        setActual(h);
        setValor(h);
      })
      .catch(() => setActual('15:00'));
  }, []);

  async function guardar() {
    if (!/^\d{1,2}:\d{2}$/.test(valor)) {
      await avisoError('Hora inválida', 'Escríbala como HH:MM, por ejemplo 15:00.');
      return;
    }
    setGuardando(true);
    try {
      const r = await catalogApi.updateSetting('same_day_cutoff', valor);
      setActual(r.value);
      await exito(
        'Hora límite actualizada',
        `Desde las <b>${r.value}</b> ya no se podrá reservar para el mismo día.`,
      );
    } catch (err) {
      await avisoError('No se pudo guardar', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3">
      <p className="text-body-md text-on-surface-variant">
        <strong className="text-primary">Hora límite del día.</strong> Pasada esta hora ya no se
        reserva para hoy; mañana sigue abierto.
        {actual && (
          <span className="ml-1 font-mono text-primary">Ahora: {actual}</span>
        )}
      </p>
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className={`${CAMPO} w-32 font-mono`}
        />
        <button
          onClick={guardar}
          disabled={guardando || valor === actual}
          className={`${BOTON} disabled:opacity-50`}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------- carritos y caddies */

/**
 * Lo que el club tiene para prestar. Los dos limitan la operación: sin
 * carritos no se puede reservar el día, y los caddies solo alcanzan para las
 * partidas que los pidan primero. Se liberan al finalizar la partida.
 */
function CarritosYCaddies() {
  const [valores, setValores] = useState({
    carritos_totales: '',
    personas_por_carrito: '',
    caddies_totales: '',
  });
  const [guardados, setGuardados] = useState(null);
  const [guardando, setGuardando] = useState(null);

  function cargar() {
    catalogApi
      .settings()
      .then((lista) => {
        const leer = (k, x) => lista.find((s) => s.key === k)?.value || x;
        const datos = {
          carritos_totales: leer('carritos_totales', '20'),
          personas_por_carrito: leer('personas_por_carrito', '2'),
          caddies_totales: leer('caddies_totales', '2'),
        };
        setGuardados(datos);
        setValores(datos);
      })
      .catch(() => setGuardados(null));
  }
  useEffect(cargar, []);

  async function guardar(clave, etiqueta) {
    const valor = String(valores[clave] || '').trim();
    if (!/^\d+$/.test(valor) || Number(valor) < 1) {
      await avisoError('Cantidad inválida', 'Escriba un número entero mayor que cero.');
      return;
    }
    setGuardando(clave);
    try {
      await catalogApi.updateSetting(clave, valor);
      await exito(`${etiqueta} actualizado`, `Ahora son <b>${valor}</b>.`);
      cargar();
    } catch (err) {
      await avisoError('No se pudo guardar', err.message);
    } finally {
      setGuardando(null);
    }
  }

  const campos = [
    ['carritos_totales', 'Carritos del club', 'Sin carritos libres, ese día ya no se reserva'],
    ['personas_por_carrito', 'Personas por carrito', 'Con esto se calcula cuántos usa cada partida'],
    ['caddies_totales', 'Caddies', 'Se liberan cuando la partida que los tiene se finaliza'],
  ];

  return (
    <Tarjeta icono="golf" titulo="Carritos y caddies">
      <div className="grid gap-3 sm:grid-cols-3">
        {campos.map(([clave, etiqueta, pie]) => (
          <div key={clave} className="rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3">
            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{etiqueta}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min="1"
                value={valores[clave]}
                onChange={(e) => setValores({ ...valores, [clave]: e.target.value })}
                className={`${CAMPO} w-24 text-right font-mono`}
              />
              <button
                onClick={() => guardar(clave, etiqueta)}
                disabled={guardando === clave || valores[clave] === guardados?.[clave]}
                className={`${BOTON} disabled:opacity-50`}
              >
                {guardando === clave ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
            <p className="mt-1.5 text-body-md text-outline">{pie}</p>
          </div>
        ))}
      </div>
    </Tarjeta>
  );
}

/* ----------------------------------------------------------------- 4. tarifas */

function Tarifas({ tarifas, tasa, onCambio }) {
  const [editando, setEditando] = useState(null);
  const [precio, setPrecio] = useState('');
  const [alta, setAlta] = useState(false);

  async function guardar(tarifa) {
    const nuevo = Number(precio);
    if (!nuevo || nuevo <= 0) {
      await avisoError('Precio inválido', 'Escriba cuánto cuesta el green fee.');
      return;
    }
    try {
      await catalogApi.updateRate(tarifa.id, { price: nuevo.toFixed(2) });
      await exito('Tarifa actualizada', `${tarifa.name}: ${mxn(nuevo)}.`);
      setEditando(null);
      setPrecio('');
      onCambio();
    } catch (err) {
      await avisoError('No se pudo guardar', err.message);
    }
  }

  return (
    <Tarjeta
      icono="etiquetaPrecio"
      titulo="Tarifas"
      extra={
        <button onClick={() => setAlta((v) => !v)} className={BOTON}>
          <Icono nombre="add" size={15} className="text-secondary" />
          {alta ? 'Cancelar' : 'Nueva tarifa'}
        </button>
      }
    >
      {alta && (
        <AltaDeTarifa
          onListo={() => {
            setAlta(false);
            onCambio();
          }}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-container-low text-on-surface-variant">
              {['Paquete', 'Hoyos', 'Quién', 'Días', 'Precio', 'En dólares', ''].map((c, i) => (
                <th
                  key={c || i}
                  className={`whitespace-nowrap px-3 py-2.5 text-label-sm uppercase tracking-wider ${
                    i === 0 ? 'w-full' : ''
                  } ${i === 4 || i === 5 ? 'text-right' : ''}`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tarifas.map((t) => (
              <tr key={t.id} className="border-t border-outline-variant/30">
                <td className="max-w-0 truncate px-3 py-2.5 text-title-md text-primary">
                  {MODALIDAD[t.modality] || t.modality}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-body-lg">{t.holes}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-body-lg text-on-surface-variant">
                  {CATEGORIA[t.category] || t.category}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span
                    className={`rounded px-2 py-0.5 text-label-sm uppercase tracking-wider ${
                      t.day_type === 'FIN_DE_SEMANA'
                        ? 'bg-secondary-container text-on-secondary-container'
                        : 'bg-surface-container-high text-on-surface-variant'
                    }`}
                  >
                    {DIAS[t.day_type] || DIAS.TODOS}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  {editando === t.id ? (
                    <input
                      type="number"
                      step="0.01"
                      autoFocus
                      value={precio}
                      onChange={(e) => setPrecio(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && guardar(t)}
                      className={`${CAMPO} w-28 text-right font-mono`}
                    />
                  ) : (
                    <span className="font-mono text-title-md text-primary">{mxn(t.price)}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-label-sm text-outline">
                  {tasa ? usd(Number(t.price) / tasa) : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  {editando === t.id ? (
                    <span className="flex gap-1.5">
                      <button onClick={() => guardar(t)} className={BOTON}>
                        Guardar
                      </button>
                      <button onClick={() => setEditando(null)} className={BOTON}>
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setEditando(t.id);
                        setPrecio(String(t.price));
                      }}
                      className={BOTON}
                    >
                      Cambiar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {tarifas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-body-lg text-outline">
                  Sin tarifas dadas de alta.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  );
}

function AltaDeTarifa({ onListo }) {
  const [form, setForm] = useState({
    name: '',
    modality: 'INDIVIDUAL',
    holes: 18,
    category: 'ADULTO',
    day_type: 'ENTRE_SEMANA',
    price: '',
  });
  const [guardando, setGuardando] = useState(false);

  async function crear() {
    if (form.name.trim().length < 3 || !Number(form.price)) {
      await avisoError('Faltan datos', 'La tarifa necesita un nombre y un precio.');
      return;
    }
    setGuardando(true);
    try {
      await catalogApi.createRate({
        ...form,
        name: form.name.trim(),
        holes: Number(form.holes),
        price: Number(form.price).toFixed(2),
        // Vale desde hoy. Sin esta fecha el servidor rechaza el alta.
        valid_from: hoy(),
      });
      await exito('Tarifa creada', `${form.name} quedó dada de alta.`);
      onListo();
    } catch (err) {
      await avisoError('No se pudo crear', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mb-4 grid gap-2.5 rounded border border-outline-variant/60 bg-surface-container-low p-4 sm:grid-cols-6">
      <label className="sm:col-span-2">
        <span className={ETIQUETA}>Nombre</span>
        <input
          value={form.name}
          placeholder="Grupo · 18 hoyos"
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={CAMPO}
        />
      </label>
      <label>
        <span className={ETIQUETA}>Paquete</span>
        <select
          value={form.modality}
          onChange={(e) => setForm({ ...form, modality: e.target.value })}
          className={CAMPO}
        >
          {Object.entries(MODALIDAD).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={ETIQUETA}>Hoyos</span>
        <select
          value={form.holes}
          onChange={(e) => setForm({ ...form, holes: e.target.value })}
          className={CAMPO}
        >
          <option value={9}>9</option>
          <option value={18}>18</option>
        </select>
      </label>
      <label>
        <span className={ETIQUETA}>Quién</span>
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className={CAMPO}
        >
          <option value="ADULTO">Adulto</option>
          <option value="INFANTIL">Infantil</option>
        </select>
      </label>
      <label>
        <span className={ETIQUETA}>Días</span>
        <select
          value={form.day_type}
          onChange={(e) => setForm({ ...form, day_type: e.target.value })}
          className={CAMPO}
        >
          {Object.entries(DIAS).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={ETIQUETA}>Precio en pesos</span>
        <input
          type="number"
          step="0.01"
          value={form.price}
          placeholder="2064.00"
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          className={`${CAMPO} text-right font-mono`}
        />
      </label>
      <div className="flex items-end sm:col-span-5">
        <button onClick={crear} disabled={guardando} className={`${BOTON_FUERTE} w-full`}>
          {guardando ? 'Guardando…' : 'Dar de alta la tarifa'}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- 6. comisiones */

function Comisiones({ hoteles, onCambio }) {
  const [editando, setEditando] = useState(null);
  const [valor, setValor] = useState('');

  async function guardar(hotel) {
    const nuevo = Number(valor);
    if (Number.isNaN(nuevo) || nuevo < 0 || nuevo > 100) {
      await avisoError('Porcentaje inválido', 'La comisión va entre 0 y 100.');
      return;
    }
    const ok = await confirmar({
      titulo: `Comisión de ${hotel.name}`,
      texto:
        `Pasará de <b>${Number(hotel.commission_rate).toFixed(2)}%</b> a ` +
        `<b>${nuevo.toFixed(2)}%</b>.<br><span style="font-size:.9em;opacity:.75">` +
        'Las reservas ya vendidas conservan la comisión que tenían.</span>',
      confirmar: 'Sí, cambiarla',
      icono: 'question',
    });
    if (!ok) return;
    try {
      await catalogApi.updateHotel(hotel.id, { commission_rate: nuevo.toFixed(2) });
      await exito('Comisión actualizada', `${hotel.name}: ${nuevo.toFixed(2)}%.`);
      setEditando(null);
      onCambio();
    } catch (err) {
      await avisoError('No se pudo guardar', err.message);
    }
  }

  return (
    <Tarjeta icono="hotel" titulo="Comisión de cada hotel">
      <p className="mb-3 text-body-md text-outline">
        Es el porcentaje del green fee que se queda el hotel por mandar al huésped. Servicios, acompañantes y replays no generan comisión.
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {/* La venta directa del mostrador no es un convenio: no paga comisión
            y por eso no aparece aquí. */}
        {hoteles.filter((h) => !h.is_direct).map((h) => (
          <div
            key={h.id}
            className="rounded border border-outline-variant/60 bg-surface-container-low px-3.5 py-3"
          >
            <p className="truncate text-title-md text-primary" title={h.name}>
              {h.name}
            </p>
            {editando === h.id ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.01"
                  autoFocus
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && guardar(h)}
                  className={`${CAMPO} w-20 text-right font-mono`}
                />
                <button onClick={() => guardar(h)} className={BOTON}>
                  OK
                </button>
                <button onClick={() => setEditando(null)} className={BOTON}>
                  ✕
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="font-mono text-headline-md text-secondary">
                  {Number(h.commission_rate).toFixed(2)}%
                </span>
                <button
                  onClick={() => {
                    setEditando(h.id);
                    setValor(String(h.commission_rate));
                  }}
                  className={BOTON}
                >
                  Cambiar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Tarjeta>
  );
}

/* ----------------------------------------------------------------- 7. cuentas */

function Cuentas({ cuentas, hoteles, onCambio }) {
  const [alta, setAlta] = useState(false);
  const [clave, setClave] = useState(null);

  async function alternarActiva(u) {
    const ok = await confirmar({
      titulo: u.is_active ? `Dar de baja a ${u.full_name}` : `Reactivar a ${u.full_name}`,
      texto: u.is_active
        ? 'No podrá volver a entrar al sistema. Su historial se conserva.'
        : 'Volverá a poder entrar con su contraseña de siempre.',
      confirmar: u.is_active ? 'Sí, dar de baja' : 'Sí, reactivar',
      icono: 'question',
    });
    if (!ok) return;
    try {
      await usersApi.update(u.id, { is_active: !u.is_active });
      await exito(u.is_active ? 'Cuenta dada de baja' : 'Cuenta reactivada', u.email);
      onCambio();
    } catch (err) {
      await avisoError('No se pudo cambiar', err.message);
    }
  }

  async function cambiarClave(u, nueva) {
    if (!nueva || nueva.length < 8) {
      await avisoError('Contraseña muy corta', 'Necesita al menos 8 caracteres.');
      return;
    }
    try {
      await usersApi.update(u.id, { password: nueva });
      await exito('Contraseña cambiada', `${u.email} ya entra con la nueva.`);
      setClave(null);
      onCambio();
    } catch (err) {
      await avisoError('No se pudo cambiar', err.message);
    }
  }

  return (
    <Tarjeta
      icono="llave"
      titulo="Cuentas"
      extra={
        <button onClick={() => setAlta((v) => !v)} className={BOTON}>
          <Icono nombre="add" size={15} className="text-secondary" />
          {alta ? 'Cancelar' : 'Nueva cuenta'}
        </button>
      }
    >
      {alta && (
        <AltaDeCuenta
          hoteles={hoteles}
          onListo={() => {
            setAlta(false);
            onCambio();
          }}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-container-low text-on-surface-variant">
              {['Correo', 'Nombre', 'Rol', 'Hotel', 'Entró', ''].map((c, i) => (
                <th
                  key={c || i}
                  className={`whitespace-nowrap px-3 py-2.5 text-label-sm uppercase tracking-wider ${
                    i === 0 ? 'w-full' : ''
                  }`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cuentas.map((u) => (
              <tr
                key={u.id}
                className={`border-t border-outline-variant/30 ${u.is_active ? '' : 'opacity-50'}`}
              >
                <td className="max-w-0 truncate px-3 py-2.5 font-mono text-body-lg text-primary">
                  {u.email}
                  {!u.is_active && (
                    <span className="ml-2 rounded bg-surface-container-high px-1.5 py-0.5 text-label-sm uppercase tracking-wider text-outline">
                      de baja
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-body-lg">{u.full_name}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-body-md text-on-surface-variant">
                  {ROL[u.role] || u.role}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-body-md text-outline">
                  {u.hotel_name || '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-label-sm text-outline">
                  {u.last_login_at ? fechaCorta(u.last_login_at) : "nunca"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  {clave === u.id ? (
                    <span className="flex items-center justify-end gap-1.5">
                      <input
                        type="text"
                        autoFocus
                        placeholder="nueva contraseña"
                        onKeyDown={(e) => e.key === 'Enter' && cambiarClave(u, e.target.value)}
                        className={`${CAMPO} w-48`}
                        id={`clave-${u.id}`}
                      />
                      <button
                        onClick={() =>
                          cambiarClave(u, document.getElementById(`clave-${u.id}`).value)
                        }
                        className={BOTON}
                      >
                        Guardar
                      </button>
                      <button onClick={() => setClave(null)} className={BOTON}>
                        ✕
                      </button>
                    </span>
                  ) : (
                    <span className="flex justify-end gap-1.5">
                      <button onClick={() => setClave(u.id)} className={BOTON}>
                        Contraseña
                      </button>
                      <button onClick={() => alternarActiva(u)} className={BOTON}>
                        {u.is_active ? 'Dar de baja' : 'Reactivar'}
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  );
}

function AltaDeCuenta({ hoteles, onListo }) {
  const [form, setForm] = useState({
    email: '',
    full_name: '',
    role: 'HOTEL',
    hotel_id: '',
    password: '',
  });
  const [guardando, setGuardando] = useState(false);

  async function crear() {
    if (!form.email.includes('@') || form.full_name.trim().length < 3) {
      await avisoError('Faltan datos', 'Hace falta un correo válido y el nombre completo.');
      return;
    }
    if (form.password.length < 8) {
      await avisoError('Contraseña muy corta', 'Necesita al menos 8 caracteres.');
      return;
    }
    if (form.role === 'HOTEL' && !form.hotel_id) {
      await avisoError('Falta el hotel', 'Una cuenta de hotel tiene que pertenecer a uno.');
      return;
    }
    setGuardando(true);
    try {
      await usersApi.create({
        email: form.email.trim().toLowerCase(),
        full_name: form.full_name.trim(),
        role: form.role,
        hotel_id: form.role === 'HOTEL' ? Number(form.hotel_id) : null,
        password: form.password,
      });
      await exito('Cuenta creada', `${form.email} ya puede entrar.`);
      onListo();
    } catch (err) {
      await avisoError('No se pudo crear', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mb-4 grid gap-2.5 rounded border border-outline-variant/60 bg-surface-container-low p-4 sm:grid-cols-3">
      <label>
        <span className={ETIQUETA}>Correo</span>
        <input
          type="email"
          value={form.email}
          placeholder="concierge@hotel.mx"
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className={CAMPO}
        />
      </label>
      <label>
        <span className={ETIQUETA}>Nombre completo</span>
        <input
          value={form.full_name}
          placeholder="María Fernanda López"
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          className={CAMPO}
        />
      </label>
      <label>
        <span className={ETIQUETA}>Rol</span>
        <select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
          className={CAMPO}
        >
          {Object.entries(ROL).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {form.role === 'HOTEL' && (
        <label>
          <span className={ETIQUETA}>Hotel</span>
          <select
            value={form.hotel_id}
            onChange={(e) => setForm({ ...form, hotel_id: e.target.value })}
            className={CAMPO}
          >
            <option value="">Elija uno</option>
            {hoteles.filter((h) => !h.is_direct).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span className={ETIQUETA}>Contraseña (mínimo 8)</span>
        <input
          type="text"
          value={form.password}
          placeholder="Reserva2026*"
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          className={CAMPO}
        />
      </label>
      <div className="flex items-end">
        <button onClick={crear} disabled={guardando} className={`${BOTON_FUERTE} w-full`}>
          {guardando ? 'Creando…' : 'Crear la cuenta'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- piezas */

function Tarjeta({ icono, titulo, extra, children }) {
  return (
    <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/40 px-5 py-3.5">
        <h2 className="flex items-center gap-2.5 text-label-md uppercase tracking-wider text-primary">
          <Icono nombre={icono} size={17} className="text-secondary" />
          {titulo}
        </h2>
        {extra}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Cifra({ label, valor, pie, tono, oscuro }) {
  return (
    <div
      className={`rounded-lg border p-5 shadow-card ${
        oscuro
          ? 'border-primary-container bg-primary-container text-on-primary'
          : 'border-outline-variant/50 bg-surface-container-lowest'
      }`}
    >
      <p
        className={`text-label-sm uppercase tracking-wider ${
          oscuro ? 'text-secondary-fixed' : 'text-on-surface-variant'
        }`}
      >
        {label}
      </p>
      <p
        className={`font-serif text-headline-lg leading-tight ${
          oscuro ? 'text-on-primary' : tono || 'text-primary'
        }`}
      >
        {valor}
      </p>
      <p className={`text-body-md ${oscuro ? 'text-primary-fixed' : 'text-outline'}`}>{pie}</p>
    </div>
  );
}

function Dato({ label, valor, fuerte }) {
  return (
    <div className="rounded border border-outline-variant/50 bg-surface-container-low px-3 py-2">
      <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className={`font-mono ${fuerte ? 'text-title-lg text-primary' : 'text-body-lg'}`}>
        {valor}
      </p>
    </div>
  );
}

const CAMPO =
  'w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-lg text-on-surface focus:border-primary-container focus:outline-none';

const ETIQUETA = 'mb-1 block text-label-sm uppercase tracking-wider text-on-surface-variant';

const BOTON =
  'flex items-center gap-1.5 rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-label-sm uppercase tracking-wider text-on-surface-variant transition hover:bg-surface-container-low';

const BOTON_FUERTE =
  'flex items-center justify-center gap-2 rounded bg-primary-container px-4 py-2.5 text-title-md text-on-primary shadow-card transition hover:bg-primary disabled:opacity-60';
