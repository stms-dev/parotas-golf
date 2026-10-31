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

import { bookingApi, catalogApi, correosApi, eventsApi, treasuryApi, usersApi } from '../api/client';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Paginador, Spinner, usePaginacion } from '../components/ui';
import HistorialTipoCambio from '../components/HistorialTipoCambio';
import Icono from '../components/Icono';
import { confirmar, error as avisoError, exito } from '../utils/avisos';
import { MODALIDAD, MODALIDAD_VIGENTE, ROL, fecha, fechaCorta, fechaHora, hora, hoy, mxn, usd, fechaLocal } from '../utils/format';

const PERIODOS = [
  { key: 'dia', label: 'Día' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
  { key: 'anio', label: 'Año' },
];

const CATEGORIA = { ADULTO: 'Adulto', INFANTIL: 'Junior (16 o menos)', LOCAL: 'Local' };

/** Qué días cobra cada tarifa. */
const DIAS = {
  ENTRE_SEMANA: 'Lun a jue',
  FIN_DE_SEMANA: 'Vie a dom',
  TODOS: 'Todos los días',
};

/**
 * A qué hora cobra cada tarifa. Las últimas salidas del día no alcanzan a
 * terminar 18 hoyos, así que se venden más baratas: eso es el twilight.
 */
const FRANJAS = {
  TODAS: 'Cualquier hora',
  TWILIGHT: 'Twilight (últimas salidas)',
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

      <PaquetesYServicios onCambio={() => cargarTodo(false)} />

      <BeneficioPga />

      <CarritosYCaddies />

      <ContactoDelSitio />

      <TextosDelSitio />

      <Correos />

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
      <HoraCierreCajas />
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
  const [activo, setActivo] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [config, setConfig] = useState(null);
  const [tipo, setTipo] = useState('PORCENTAJE');
  const [valor, setValor] = useState('');
  const [guardando, setGuardando] = useState(false);

  function cargarActivo() {
    catalogApi
      .settings()
      .then((lista) =>
        setActivo(String(lista.find((x) => x.key === 'pga_activo')?.value || 'false').toLowerCase() === 'true'),
      )
      .catch(() => {});
  }
  useEffect(cargarActivo, []);

  async function alternarActivo() {
    const ok = await confirmar({
      titulo: activo ? 'Desactivar el descuento PGA' : 'Activar el descuento PGA',
      texto: activo
        ? 'Dejará de pedirse el identificador PGA en las reservas y de aplicarse el descuento en el check-in. ' +
          'Lo ya cobrado no cambia.'
        : 'Volverá a pedirse el identificador PGA en las reservas y recepción podrá aplicar el descuento.',
      confirmar: activo ? 'Sí, desactivar' : 'Sí, activar',
    });
    if (!ok) return;
    setCambiando(true);
    try {
      await catalogApi.updateSetting('pga_activo', activo ? 'false' : 'true');
      await exito(
        activo ? 'Descuento PGA desactivado' : 'Descuento PGA activado',
        activo ? 'Ya no se ofrece ni se aplica.' : 'Ya se ofrece y se puede aplicar en el check-in.',
      );
      cargarActivo();
    } catch (err) {
      await avisoError('No se pudo cambiar', err.message);
    } finally {
      setCambiando(false);
    }
  }

  function cargar() {
    catalogApi
      .pgaConfig()
      .then((c) => {
        setConfig(c);
        setTipo(c?.discount_type || 'PORCENTAJE');
      })
      .catch(() => setConfig(null));
  }
  useEffect(cargar, []);

  const actual = config ? Number(config.value) : 0;
  const esMonto = tipo === 'MONTO';
  const actualEsMonto = config?.discount_type === 'MONTO';

  /** Cómo se lee el beneficio vigente, en una sola expresión. */
  const vigente = !config
    ? '—'
    : actualEsMonto
      ? mxn(actual)
      : `${actual.toFixed(0)}%`;

  async function guardar() {
    const nuevo = Number(valor);
    if (valor === '' || Number.isNaN(nuevo) || nuevo < 0) {
      await avisoError(
        'Falta el valor',
        esMonto ? 'Escriba el monto a descontar.' : 'Escriba un porcentaje entre 0 y 100.',
      );
      return;
    }
    if (!esMonto && nuevo > 100) {
      await avisoError('Porcentaje inválido', 'Escriba un porcentaje entre 0 y 100.');
      return;
    }

    const nuevoTexto = esMonto ? mxn(nuevo) : `${nuevo.toFixed(0)}%`;
    const ok = await confirmar({
      titulo: 'Cambiar el descuento PGA',
      texto:
        `Pasará de <b>${vigente}</b> a <b>${nuevoTexto}</b> sobre la tarifa de cada ` +
        'profesional con credencial.<br>' +
        (esMonto
          ? '<span style="font-size:.9em;opacity:.75">El monto se descuenta a cada acreditado ' +
            'por separado, y nunca más de lo que cuesta su propio Green Fee.</span><br>'
          : '') +
        '<span style="font-size:.9em;opacity:.75">Las partidas ya cobradas conservan su ' +
        'descuento.</span>',
      confirmar: 'Sí, cambiarlo',
      icono: 'question',
    });
    if (!ok) return;
    setGuardando(true);
    try {
      await catalogApi.setPgaConfig({
        discount_type: tipo,
        value: nuevo.toFixed(2),
        description: esMonto
          ? `Beneficio PGA de ${mxn(nuevo)} sobre la tarifa del portador`
          : `Beneficio PGA ${nuevo.toFixed(0)}% sobre la tarifa del portador`,
        valid_from: hoy(),
      });
      await exito(
        'Descuento PGA actualizado',
        esMonto
          ? `Ahora se descuentan ${mxn(nuevo)} por persona acreditada.`
          : `Ahora es del ${nuevo.toFixed(0)}% por persona.`,
      );
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3">
        <p className="text-body-md text-on-surface-variant">
          <strong className="text-primary">Descuento PGA {activo ? 'activado' : 'desactivado'}.</strong>{' '}
          {activo
            ? 'Se pide el identificador en las reservas y recepción puede aplicar el descuento.'
            : 'No se pide el identificador ni se aplica ningún descuento mientras esté apagado.'}
        </p>
        <button onClick={alternarActivo} disabled={cambiando} className={`${BOTON} shrink-0 disabled:opacity-50`}>
          {cambiando ? 'Guardando…' : activo ? 'Desactivar' : 'Activar'}
        </button>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-serif text-display-lg leading-none text-primary">{vigente}</p>
          <p className="text-body-md text-outline">
            de descuento sobre la tarifa de la persona con credencial (no del total del ticket)
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label>
            <span className={ETIQUETA}>Cómo se descuenta</span>
            <select
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value);
                setValor('');
              }}
              className={CAMPO}
            >
              <option value="PORCENTAJE">Porcentaje de su tarifa</option>
              <option value="MONTO">Monto fijo en pesos</option>
            </select>
          </label>
          <label>
            <span className={ETIQUETA}>{esMonto ? 'Pesos por persona' : 'Nuevo porcentaje'}</span>
            <input
              type="number"
              min="0"
              max={esMonto ? undefined : '100'}
              step={esMonto ? '50' : '1'}
              value={valor}
              placeholder={esMonto ? '1000' : actual.toFixed(0)}
              onChange={(e) => setValor(e.target.value)}
              className={`${CAMPO} w-28 text-right font-mono`}
            />
          </label>
          <button onClick={guardar} disabled={guardando} className={BOTON}>
            {guardando ? 'Guardando…' : 'Aplicar'}
          </button>
        </div>
      </div>

      <p className="mt-4 rounded bg-surface-container-low px-3 py-2 text-body-md text-outline">
        El beneficio es individual: se aplica a la tarifa de cada jugador que presentó credencial,
        no al total de la partida.{' '}
        {esMonto
          ? 'Con monto fijo, a cada acreditado se le descuenta esa cantidad, y nunca más de lo que cuesta su propio Green Fee.'
          : 'Con porcentaje, a cada acreditado se le descuenta esa proporción de su propia tarifa.'}
      </p>
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
 * Una hora guardada en los parámetros del sistema, editable aquí.
 *
 * - same_day_cutoff: pasada esta hora ya no se reserva para hoy.
 * - cierre_automatico_caja: a esta hora las cajas (Green Fee y tienda) que
 *   sigan abiertas se cierran solas y queda pendiente contar el efectivo.
 */
function HoraAjuste({ clave, defecto, titulo, texto, mensaje }) {
  const [actual, setActual] = useState(null);
  const [valor, setValor] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    catalogApi
      .settings()
      .then((lista) => {
        const h = lista.find((x) => x.key === clave)?.value || defecto;
        setActual(h);
        setValor(h);
      })
      .catch(() => setActual(defecto));
  }, [clave, defecto]);

  async function guardar() {
    if (!/^\d{1,2}:\d{2}$/.test(valor)) {
      await avisoError('Hora inválida', 'Escríbala como HH:MM, por ejemplo 15:00.');
      return;
    }
    setGuardando(true);
    try {
      const r = await catalogApi.updateSetting(clave, valor);
      setActual(r.value);
      await exito(`${titulo} actualizada`, mensaje(r.value));
    } catch (err) {
      await avisoError('No se pudo guardar', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3">
      <p className="text-body-md text-on-surface-variant">
        <strong className="text-primary">{titulo}.</strong> {texto}
        {actual && <span className="ml-1 font-mono text-primary">Ahora: {actual}</span>}
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

function HoraLimite() {
  return (
    <HoraAjuste
      clave="same_day_cutoff"
      defecto="15:00"
      titulo="Hora límite del día"
      texto="Pasada esta hora ya no se reserva para hoy; mañana sigue abierto."
      mensaje={(h) => `Desde las <b>${h}</b> ya no se podrá reservar para el mismo día.`}
    />
  );
}

function HoraCierreCajas() {
  return (
    <HoraAjuste
      clave="cierre_automatico_caja"
      defecto="22:00"
      titulo="Cierre automático de cajas"
      texto="A esta hora la caja de Green Fee y la de la tienda se cierran solas si siguen abiertas; el efectivo se cuenta después."
      mensaje={(h) => `Las cajas se cerrarán solas a las <b>${h}</b>.`}
    />
  );
}

/* ------------------------------------------------------------- correos */

/**
 * Bandeja de salida: qué correos mandó el sistema y cuáles fallaron.
 *
 * Es la respuesta a la pregunta que siempre llega del hotel: "¿le llegó el
 * pase al huésped?". Con esto se ve, y si no salió se reintenta desde aquí.
 */
function Correos() {
  const [correos, setCorreos] = useState([]);
  const [trabajando, setTrabajando] = useState(null);
  const pagCorreos = usePaginacion(correos, 8);

  function cargar() {
    correosApi.bandeja({ limit: 25 }).then(setCorreos).catch(() => setCorreos([]));
  }
  useEffect(cargar, []);

  async function reintentar(correo) {
    setTrabajando(correo.id);
    try {
      const actualizado = await correosApi.reintentar(correo.id);
      await exito(
        actualizado.status === 'ENVIADO' ? 'Correo enviado' : 'Correo en cola',
        `<b>${actualizado.to_email}</b>`,
      );
      cargar();
    } catch (err) {
      await avisoError('No se pudo reintentar', err.message);
    } finally {
      setTrabajando(null);
    }
  }

  const pendientes = correos.filter((c) => c.status === 'PENDIENTE').length;
  const fallidos = correos.filter((c) => c.status === 'FALLIDO').length;

  return (
    <Tarjeta
      icono="enviar"
      titulo="Correos del sistema"
      extra={
        <span className="text-label-sm uppercase tracking-wider text-outline">
          {pendientes} en cola · {fallidos} con error
        </span>
      }
    >
      {correos.length === 0 ? (
        <p className="py-6 text-center text-body-lg text-outline">
          Todavía no se ha mandado ningún correo.
        </p>
      ) : (
        <div className="caja-lineas">
        <div className="overflow-x-auto">
          <table className="tabla-lineas text-left text-body-md">
            <thead>
              <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                <th>Documento</th>
                <th>Para</th>
                <th>Folio</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagCorreos.visibles.map((c) => (
                <tr key={c.id}>
                  <td className="py-2">{c.kind === 'PASE' ? 'Pase de la partida' : 'Recibo'}</td>
                  <td className="py-2 text-on-surface-variant">{c.to_email}</td>
                  <td className="py-2 font-mono text-on-surface-variant">{c.folio || '—'}</td>
                  <td className="py-2">
                    {c.status === 'ENVIADO' ? (
                      <span className="text-estado-ok-text">
                        Enviado · {fechaHora(c.sent_at)}
                      </span>
                    ) : c.status === 'FALLIDO' ? (
                      <span className="text-error" title={c.last_error || ''}>
                        Falló tras {c.attempts} intento{c.attempts === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <span className="text-estado-pend-text">En cola</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {c.status !== 'ENVIADO' && (
                      <button
                        onClick={() => reintentar(c)}
                        disabled={trabajando === c.id}
                        className={`${BOTON} disabled:opacity-50`}
                      >
                        {trabajando === c.id ? 'Enviando…' : 'Reintentar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Paginador pag={pagCorreos} etiqueta="correos" />
        </div>
      )}
      <p className="mt-3 text-body-md text-outline">
        El pase sale al crear la reserva y el recibo al cobrar. Si no hay servidor de correo
        configurado, quedan en cola hasta que lo haya.
      </p>
    </Tarjeta>
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

/* ------------------------------------------------- contacto del sitio */

/**
 * Teléfono, correo y domicilio que el sitio público muestra en el pie de
 * página y en «Casa club». Lo que se guarde aquí se ve en el sitio al
 * recargarlo; no hay que tocar código.
 */
function ContactoDelSitio() {
  const CLAVES = [
    ['contacto_telefono', 'Teléfono / WhatsApp', 'tel', '+52 55 2721 9345', 'También es el número al que abre WhatsApp'],
    ['contacto_correo', 'Correo de reservas', 'email', 'reservas@parotasgolf.com', 'Aparece como enlace de correo en el sitio'],
    ['contacto_domicilio', 'Domicilio', 'text', 'Bahías de Huatulco, Oaxaca', 'Se muestra en «Casa club»'],
  ];
  const [valores, setValores] = useState({});
  const [guardados, setGuardados] = useState({});
  const [guardando, setGuardando] = useState(null);

  function cargar() {
    catalogApi
      .settings()
      .then((lista) => {
        const datos = {};
        for (const [k, , , defecto] of CLAVES) {
          datos[k] = lista.find((x) => x.key === k)?.value || defecto;
        }
        setGuardados(datos);
        setValores(datos);
      })
      .catch(() => {});
  }
  useEffect(cargar, []);

  async function guardar(clave, etiqueta) {
    setGuardando(clave);
    try {
      await catalogApi.updateSetting(clave, String(valores[clave] || '').trim());
      await exito(`${etiqueta} actualizado`, 'El sitio ya lo muestra al recargar la página.');
      cargar();
    } catch (err) {
      await avisoError('No se pudo guardar', err.message);
    } finally {
      setGuardando(null);
    }
  }

  return (
    <Tarjeta icono="correo" titulo="Datos de contacto del sitio">
      <div className="grid gap-3 lg:grid-cols-3">
        {CLAVES.map(([clave, etiqueta, tipo, ejemplo, pie]) => (
          <div key={clave} className="rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3">
            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{etiqueta}</p>
            <input
              type={tipo}
              maxLength={200}
              placeholder={ejemplo}
              value={valores[clave] ?? ''}
              onChange={(e) => setValores({ ...valores, [clave]: e.target.value })}
              className={`${CAMPO} mt-1.5 w-full`}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-body-md text-outline">{pie}</p>
              <button
                onClick={() => guardar(clave, etiqueta)}
                disabled={guardando === clave || valores[clave] === guardados[clave]}
                className={`${BOTON} shrink-0 disabled:opacity-50`}
              >
                {guardando === clave ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Tarjeta>
  );
}


/* ----------------------------------------------- textos del sitio, por idioma */

/**
 * Textos del sitio público que se pueden cambiar, cada idioma por separado.
 * Un campo vacío deja el texto de fábrica. Así lo que se escriba en español no
 * se mezcla con el inglés.
 * [clave, qué es, texto de fábrica en español, texto de fábrica en inglés, solo inglés]
 */
const TEXTOS_SITIO = [
  ['nav.campo', 'Menú · Campo', 'Campo', 'Gallery'],
  ['nav.reservar', 'Menú · Reservas', 'Reservar tee time', 'Book a tee time'],
  ['nav.evento', 'Menú · Charter', 'Charter y torneos privados', 'Charter & private tournaments'],
  ['evento.titulo', 'Charter · título de la pantalla', 'Charter y torneos privados', 'Charter & private tournaments'],
  ['evento.invitacion', 'Charter · pregunta', '¿Quieres organizar un torneo privado?', 'Want to organize a private tournament?'],
  ['evento.boton', 'Charter · botón de contacto', 'Contáctanos', 'Contact us'],
  ['tarifas.practicaDetalle', 'Zona de práctica · tabla de tarifas', '120 pelotas o 90 minutos por persona', '120 balls or 90 minutes per person'],
  [
    'extra.PRACTICA.nota',
    'Zona de práctica · nota en extras (use {fin} para el precio de vie a dom)',
    '120 pelotas o 90 minutos por persona. No incluye bastones ni tees. Vie a dom: {fin}.',
    '120 balls or 90 minutes per person. Clubs and tees not included. Fri–Sun: {fin}.',
  ],
  ['paquete.GRUPO.detalle', 'Paquete En Grupo · descripción (el español se edita en Paquetes y servicios)', '', 'An exclusive tee time for your group, from four players. The lead player organizes the group and books for everyone.', true],
  ['paquete.PARTIDA_ABIERTA.detalle', 'Paquete Partida Abierta · descripción', '', 'For guests booking alone or in small numbers: you are matched with other players until the group reaches four, even if they stay at different hotels.', true],
  ['paquete.PRACTICA.detalle', 'Paquete Práctica · descripción', '', 'Access to the practice area, without playing a round. One or several players can book, with or without guests.', true],
];

function TextosDelSitio() {
  const [valores, setValores] = useState({});
  const [guardados, setGuardados] = useState({});
  const [guardando, setGuardando] = useState(null);
  const ajuste = (idioma, clave) => `sitio_texto_${idioma}_${clave}`;

  function cargar() {
    catalogApi
      .settings()
      .then((lista) => {
        const datos = {};
        for (const [clave, , , , soloEn] of TEXTOS_SITIO) {
          for (const i of soloEn ? ['en'] : ['es', 'en']) {
            datos[ajuste(i, clave)] = lista.find((x) => x.key === ajuste(i, clave))?.value || '';
          }
        }
        setGuardados(datos);
        setValores(datos);
      })
      .catch(() => {});
  }
  useEffect(cargar, []);

  async function guardar([clave, etiqueta, , , soloEn]) {
    setGuardando(clave);
    try {
      for (const i of soloEn ? ['en'] : ['es', 'en']) {
        const k = ajuste(i, clave);
        if ((valores[k] ?? '') !== (guardados[k] ?? '')) {
          await catalogApi.updateSetting(k, String(valores[k] || '').trim());
        }
      }
      await exito('Texto actualizado', `${etiqueta}: el sitio lo muestra al recargar la página.`);
      cargar();
    } catch (err) {
      await avisoError('No se pudo guardar', err.message);
    } finally {
      setGuardando(null);
    }
  }

  return (
    <Tarjeta icono="correo" titulo="Textos del sitio (español e inglés)">
      <p className="mb-3 text-body-md text-outline">
        Cada idioma se escribe por separado. Si dejas un campo vacío, el sitio usa el texto original.
      </p>
      <div className="grid gap-3">
        {TEXTOS_SITIO.map((fila) => {
          const [clave, etiqueta, porDefectoEs, porDefectoEn, soloEn] = fila;
          const cambiado = (soloEn ? ['en'] : ['es', 'en']).some(
            (i) => (valores[ajuste(i, clave)] ?? '') !== (guardados[ajuste(i, clave)] ?? ''),
          );
          return (
            <div key={clave} className="rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3">
              <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{etiqueta}</p>
              <div className="mt-1.5 grid gap-2.5 lg:grid-cols-2">
                {(soloEn ? [['en', 'Inglés', porDefectoEn]] : [['es', 'Español', porDefectoEs], ['en', 'Inglés', porDefectoEn]]).map(
                  ([i, nombre, defecto]) => (
                    <label key={i} className="block">
                      <span className="text-label-sm text-on-surface-variant">{nombre}</span>
                      <input
                        type="text"
                        maxLength={240}
                        placeholder={defecto}
                        value={valores[ajuste(i, clave)] ?? ''}
                        onChange={(e) => setValores({ ...valores, [ajuste(i, clave)]: e.target.value })}
                        className={`${CAMPO} mt-1 w-full`}
                      />
                    </label>
                  ),
                )}
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => guardar(fila)}
                  disabled={guardando === clave || !cambiado}
                  className={`${BOTON} shrink-0 disabled:opacity-50`}
                >
                  {guardando === clave ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Tarjeta>
  );
}

/* ------------------------------------------- paquetes y servicios adicionales */

const PAQUETES_EDITABLES = [
  ['GRUPO', 'En Grupo'],
  ['PARTIDA_ABIERTA', 'Partida Abierta'],
  ['PRACTICA', 'Práctica'],
];

/**
 * Los textos de los paquetes y los servicios adicionales (nombre, descripción y
 * precio), en un solo lugar. Lo que se escribe aquí es lo que ve el huésped en
 * el sitio y el mostrador en Nueva reserva.
 */
function PaquetesYServicios({ onCambio }) {
  const [textos, setTextos] = useState({});
  const [guardados, setGuardados] = useState({});
  const [servicios, setServicios] = useState([]);
  const [edicion, setEdicion] = useState({});
  const [ocupado, setOcupado] = useState(null);

  function cargar() {
    catalogApi
      .settings()
      .then((lista) => {
        const t = {};
        for (const [m] of PAQUETES_EDITABLES) t[m] = lista.find((x) => x.key === `paquete_${m}_detalle`)?.value || '';
        setGuardados(t);
        setTextos((prev) => (Object.keys(prev).length ? prev : t));
      })
      .catch(() => {});
    catalogApi.services({ active_only: false }).then(setServicios).catch(() => setServicios([]));
  }
  useEffect(cargar, []);

  async function guardarPaquete(m, nombre) {
    setOcupado(`p-${m}`);
    try {
      await catalogApi.updateSetting(`paquete_${m}_detalle`, String(textos[m] || '').trim());
      await exito(`«${nombre}» actualizado`, 'La descripción ya se ve en el sitio y en Nueva reserva.');
      cargar();
    } catch (err) {
      await avisoError('No se pudo guardar', err.message);
    } finally {
      setOcupado(null);
    }
  }

  function campoDe(s) {
    return edicion[s.id] || {
      name: s.name,
      description: s.description || '',
      price: String(Number(s.price)),
      weekend: s.weekend_price != null ? String(Number(s.weekend_price)) : '',
    };
  }
  function cambiarCampo(s, clave, valor) {
    setEdicion({ ...edicion, [s.id]: { ...campoDe(s), [clave]: valor } });
  }

  async function guardarServicio(s) {
    const e = campoDe(s);
    const precio = Number(e.price);
    const fin = e.weekend === '' ? null : Number(e.weekend);
    if (e.price === '' || !(precio >= 0) || (fin !== null && !(fin >= 0))) {
      await avisoError('Precio inválido', 'Escriba cantidades en pesos, sin letras.');
      return;
    }
    const cambios = { name: e.name.trim(), description: e.description.trim(), price: precio.toFixed(2) };
    if (s.weekend_price != null || fin !== null) cambios.weekend_price = fin === null ? null : fin.toFixed(2);
    setOcupado(`s-${s.id}`);
    try {
      await catalogApi.updateService(s.id, cambios);
      await exito('Servicio actualizado', 'El sitio y el sistema ya usan el cambio.');
      const { [s.id]: _quitado, ...resto } = edicion;
      setEdicion(resto);
      cargar();
      onCambio?.();
    } catch (err) {
      await avisoError('No se pudo guardar', err.message);
    } finally {
      setOcupado(null);
    }
  }

  async function alternar(s) {
    const ok = await confirmar({
      titulo: s.is_active ? `Dar de baja «${s.name}»` : `Activar «${s.name}»`,
      texto: s.is_active
        ? 'Dejará de ofrecerse en el sitio y en las reservas nuevas.'
        : 'Volverá a ofrecerse en el sitio y en las reservas nuevas.',
      confirmar: 'Sí',
    });
    if (!ok) return;
    setOcupado(`s-${s.id}`);
    try {
      await catalogApi.updateService(s.id, { is_active: !s.is_active });
      cargar();
      onCambio?.();
    } catch (err) {
      await avisoError('No se pudo cambiar', err.message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Tarjeta icono="golf" titulo="Paquetes y servicios adicionales">
      <p className="mb-3 text-label-sm uppercase tracking-wider text-on-surface-variant">
        Descripción de los paquetes
      </p>
      <div className="grid gap-3 lg:grid-cols-3">
        {PAQUETES_EDITABLES.map(([m, nombre]) => (
          <div key={m} className="rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3">
            <p className="text-title-md text-primary">{nombre}</p>
            <textarea
              rows={4}
              maxLength={300}
              value={textos[m] ?? ''}
              placeholder="Si se deja vacío, se usa la descripción de fábrica."
              onChange={(e) => setTextos({ ...textos, [m]: e.target.value })}
              className={`${CAMPO} mt-1.5 w-full resize-none`}
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => guardarPaquete(m, nombre)}
                disabled={ocupado === `p-${m}` || (textos[m] ?? '') === (guardados[m] ?? '')}
                className={`${BOTON} disabled:opacity-50`}
              >
                {ocupado === `p-${m}` ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="mb-3 mt-6 text-label-sm uppercase tracking-wider text-on-surface-variant">
        Servicios adicionales
      </p>
      <div className="grid gap-3">
        {servicios.map((s) => {
          const e = campoDe(s);
          const cambio =
            e.name !== s.name ||
            e.description !== (s.description || '') ||
            Number(e.price) !== Number(s.price) ||
            e.weekend !== (s.weekend_price != null ? String(Number(s.weekend_price)) : '');
          return (
            <div
              key={s.id}
              className={`rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3 ${
                s.is_active ? '' : 'opacity-70'
              }`}
            >
              <div className="grid gap-2 lg:grid-cols-[1.2fr_2fr_auto_auto]">
                <label>
                  <span className={ETIQUETA}>Nombre</span>
                  <input value={e.name} maxLength={120} onChange={(x) => cambiarCampo(s, 'name', x.target.value)} className={`${CAMPO} w-full`} />
                </label>
                <label>
                  <span className={ETIQUETA}>Descripción</span>
                  <input value={e.description} maxLength={300} onChange={(x) => cambiarCampo(s, 'description', x.target.value)} className={`${CAMPO} w-full`} />
                </label>
                <label>
                  <span className={ETIQUETA}>{s.weekend_price != null ? 'Lun a jue' : 'Precio'}</span>
                  <input type="number" min="0" step="10" value={e.price} onChange={(x) => cambiarCampo(s, 'price', x.target.value)} className={`${CAMPO} w-28 text-right font-mono`} />
                </label>
                {s.weekend_price != null && (
                  <label>
                    <span className={ETIQUETA}>Vie a dom</span>
                    <input type="number" min="0" step="10" value={e.weekend} onChange={(x) => cambiarCampo(s, 'weekend', x.target.value)} className={`${CAMPO} w-28 text-right font-mono`} />
                  </label>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-label-sm text-outline">{s.code}{s.is_active ? '' : ' · dado de baja'}</span>
                <div className="flex gap-2">
                  <button onClick={() => alternar(s)} disabled={ocupado === `s-${s.id}`} className={`${BOTON} disabled:opacity-50`}>
                    {s.is_active ? 'Dar de baja' : 'Activar'}
                  </button>
                  <button onClick={() => guardarServicio(s)} disabled={!cambio || ocupado === `s-${s.id}`} className={`${BOTON} disabled:opacity-50`}>
                    {ocupado === `s-${s.id}` ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Tarjeta>
  );
}

/* ----------------------------------------------------------------- 4. tarifas */

function Tarifas({ tarifas, tasa, onCambio }) {
  const [editando, setEditando] = useState(null);
  const [precio, setPrecio] = useState('');
  const [alta, setAlta] = useState(false);
  const pagTarifas = usePaginacion(tarifas, 10);

  async function guardar(tarifa) {
    const nuevo = Number(precio);
    if (!nuevo || nuevo <= 0) {
      await avisoError('Precio inválido', 'Escriba cuánto cuesta el Green Fee.');
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

      <div className="caja-lineas">
      <div className="overflow-x-auto">
        <table className="tabla-lineas text-left">
          <thead>
            <tr className="text-on-surface-variant">
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
            {pagTarifas.visibles.map((t) => (
              <tr key={t.id}>
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
                  {t.time_band === 'TWILIGHT' && (
                    <span className="ml-1 rounded bg-primary-container px-2 py-0.5 text-label-sm uppercase tracking-wider text-on-primary">
                      Twilight
                    </span>
                  )}
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
      <Paginador pag={pagTarifas} etiqueta="tarifas" />
      </div>
    </Tarjeta>
  );
}

function AltaDeTarifa({ onListo }) {
  const [form, setForm] = useState({
    name: '',
    modality: 'GRUPO',
    holes: 18,
    category: 'ADULTO',
    day_type: 'ENTRE_SEMANA',
    time_band: 'TODAS',
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
          {Object.entries(MODALIDAD_VIGENTE).map(([v, t]) => (
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
          <option value="INFANTIL">Junior (16 o menos)</option>
          <option value="LOCAL">Local (con credencial)</option>
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
        <span className={ETIQUETA}>Horario</span>
        <select
          value={form.time_band}
          onChange={(e) => setForm({ ...form, time_band: e.target.value })}
          className={CAMPO}
        >
          {Object.entries(FRANJAS).map(([v, t]) => (
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
        Es el porcentaje del Green Fee que se queda el hotel por mandar al huésped. Servicios, acompañantes y replays no generan comisión.
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
  const cuentasVisibles = cuentas.filter((u) => u.role !== 'SISTEMA');
  const pagCuentas = usePaginacion(cuentasVisibles, 10);

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

  async function cerrarSesiones(u) {
    const ok = await confirmar({
      titulo: `Cerrar las sesiones de ${u.full_name}`,
      texto: 'Tendrá que iniciar sesión de nuevo en todos sus equipos. Su cuenta y su historial no cambian.',
      confirmar: 'Sí, cerrar sesiones',
      icono: 'question',
    });
    if (!ok) return;
    try {
      await usersApi.cerrarSesiones(u.id);
      await exito('Sesiones cerradas', `${u.email} deberá entrar de nuevo.`);
    } catch (err) {
      await avisoError('No se pudieron cerrar', err.message);
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

      <div className="caja-lineas">
      <div className="overflow-x-auto">
        <table className="tabla-lineas text-left">
          <thead>
            <tr className="text-on-surface-variant">
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
            {pagCuentas.visibles.map((u) => (
              <tr
                key={u.id}
                className={u.is_active ? '' : 'opacity-50'}
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
                      {u.is_active && (
                        <button onClick={() => cerrarSesiones(u)} className={BOTON}>
                          Cerrar sesiones
                        </button>
                      )}
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
      <Paginador pag={pagCuentas} etiqueta="cuentas" />
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
