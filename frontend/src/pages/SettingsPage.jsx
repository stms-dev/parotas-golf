/**
 * Configuración del Sistema & Parámetros Operativos — sigue el mockup
 * `configuraci_n_del_sistema_desktop`.
 *
 * Es una sola pantalla con tarjetas, no pestañas: quien administra el club
 * quiere ver de un vistazo tarifas, tipo de cambio, convenios, padrón PGA,
 * horarios y servicios, porque son parámetros que se ajustan juntos.
 *
 * Todo lo de aquí es lo que el README llama "no hardcodeado": se cambia sin
 * tocar el código y cada cambio queda en la bitácora con valor anterior y
 * nuevo. Ver la pantalla y poder editarla son cosas distintas: la Dirección de
 * Operaciones consulta, la Administración modifica, y la interfaz lo refleja
 * en vez de ofrecer botones que el backend va a rechazar.
 */
import { useEffect, useState } from 'react';

import { auditApi, catalogApi } from '../api/client';
import { confirmar, error as avisoError, exito } from '../utils/avisos';
import { useAuth } from '../context/AuthContext';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Spinner } from '../components/ui';
import HistorialTipoCambio from '../components/HistorialTipoCambio';
import Icono from '../components/Icono';
import { MODALIDAD, fecha, fechaHora, hora, mxn, usd, fechaLocal, recorrido } from '../utils/format';

const CATEGORIA = { ADULTO: 'Adulto', INFANTIL: 'Junior (16 años o menos)', LOCAL: 'Local (credencial)' };

export default function SettingsPage() {
  const { can } = useAuth();

  const [rates, setRates] = useState([]);
  const [tc, setTc] = useState(null);
  const [hoteles, setHoteles] = useState([]);
  const [pga, setPga] = useState({ config: null, credenciales: [] });
  const [horario, setHorario] = useState(null);
  const [servicios, setServicios] = useState([]);
  const [bitacora, setBitacora] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  async function cargar(conSpinner = true) {
    if (conSpinner) setLoading(true);
    setError(null);
    try {
      const [tarifas, cambio, horarios, serviciosLista] = await Promise.all([
        catalogApi.rates(),
        catalogApi.exchangeRate(),
        catalogApi.schedule(),
        // También los dados de baja: si no, no habría forma de reactivarlos.
        catalogApi.services({ active_only: false }),
      ]);
      setRates(tarifas);
      setTc(cambio);
      setHorario(horarios[0] || null);
      setServicios(serviciosLista);

      // Opcionales según el rol: si no tiene el permiso, la tarjeta no se pinta.
      catalogApi.hotels().then(setHoteles).catch(() => setHoteles([]));
      Promise.all([
        catalogApi.pgaConfig().catch(() => null),
        catalogApi.pgaCredentials({ limit: 100 }).catch(() => []),
      ]).then(([config, credenciales]) => setPga({ config, credenciales }));
      // La bitácora es solo de la Administración: pedirla sin permiso deja un
      // 403 en la consola aunque la tarjeta no se pinte.
      if (can('audit:view')) {
        auditApi.list({ limit: 8 }).then(setBitacora).catch(() => setBitacora([]));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  useRealtimeEvent([EVENTOS.TIPO_CAMBIO_ACTUALIZADO], () => cargar(false));

  if (loading) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;

  const tasa = Number(tc?.rate || 0);
  const ultimoCambio = bitacora[0];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <p className="flex items-center gap-2 text-label-sm uppercase tracking-widest text-secondary">
            Administración global
            <span className="h-1 w-1 rounded-full bg-secondary" />
            <span className="normal-case tracking-normal text-on-surface-variant">
              {fecha(fechaLocal())}
            </span>
          </p>
          <h1 className="font-serif text-headline-lg leading-tight text-primary sm:text-display-lg">
            Precios & Configuración
          </h1>
          <p className="text-body-lg text-outline">
            Tarifas, tipo de cambio, beneficio PGA, horarios y servicios del campo.
          </p>
          {/* Esta pantalla es de consulta: los cambios los hace la
              Administración desde Control del sistema. */}
          <p className="mt-2 inline-flex items-center gap-2 rounded border border-outline-variant/60 bg-surface-container-low px-3 py-1.5 text-body-md text-on-surface-variant">
            <Icono nombre="escudo" size={15} className="text-secondary" />
            Solo consulta · los cambios los hace la Administración
          </p>
        </div>

        {ultimoCambio && (
          <div className="flex items-start gap-2 rounded border border-outline-variant/50 bg-surface-container-lowest px-4 py-3">
            <Icono nombre="verificado" size={17} className="mt-0.5 text-secondary" />
            <p className="font-mono text-label-sm text-on-surface-variant">
              Auditoría: {fechaHora(ultimoCambio.created_at)}
              <br />
              por {ultimoCambio.user_name || 'sistema'}
            </p>
          </div>
        )}
      </header>

      {aviso && <Alert tone="success">{aviso}</Alert>}

      {/* Dos columnas que se reparten las tarjetas para que alturas parecidas
          queden lado a lado; cada tarjeta mide lo que necesita, sin estirarse
          para igualar a la vecina (eso dejaba medio panel en blanco). */}
      <div className="grid items-start gap-gutter xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-gutter">
          <TarifasOficiales rates={rates} tasa={tasa} />

          <Servicios
            servicios={servicios}
            tasa={tasa}
            puedeEditar={can('catalog:manage_services')}
            onCambio={() => cargar(false)}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-gutter">
          <Monedas
            tc={tc}
            hoteles={hoteles}
            editableTc={false}
            editableComision={false}
            onCambio={(mensaje) => {
              setAviso(mensaje);
              cargar(false);
            }}
          />

          <Panel icono="historial" titulo="Historial del tipo de cambio" insignia="Cada cambio">
            <HistorialTipoCambio limite={8} compacto />
          </Panel>

          <PadronPga pga={pga} editable={false} />
        </div>
      </div>

      {/* Ancho completo: son tres campos y quedan mejor repartidos en una fila. */}
      <HorarioMaestro
        horario={horario}
        editable={false}
        onCambio={(mensaje) => {
          setAviso(mensaje);
          cargar(false);
        }}
      />

      {can('audit:view') && <Bitacora registros={bitacora} />}
    </div>
  );
}

/* ------------------------------------------------------------------ tarjetas */

function Panel({ icono, titulo, insignia, accion, children }) {
  return (
    <section className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest shadow-card transition hover:border-outline-variant/70">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/40 px-5 py-4">
        <h2 className="flex items-center gap-2.5 text-label-md uppercase tracking-wider text-primary">
          <Icono nombre={icono} size={18} className="text-secondary" />
          {titulo}
        </h2>
        {insignia && (
          <span className="rounded bg-surface-container-high px-2.5 py-1 text-label-sm uppercase tracking-wider text-on-surface-variant">
            {insignia}
          </span>
        )}
        {accion}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

const COLUMNAS_DIA = [
  { id: 'ENTRE_SEMANA', texto: 'Lun a jue' },
  { id: 'FIN_DE_SEMANA', texto: 'Vie a dom' },
];

/**
 * Las tarifas vigentes en una matriz: una fila por tipo de ronda y una columna
 * por tipo de día. Grupo y Partida abierta casi siempre cuestan lo mismo, así
 * que no se repite cada fila por modalidad: si el precio es igual se muestra
 * una vez, y solo si difiere se desglosa por modalidad.
 */
function TarifasOficiales({ rates, tasa }) {
  // Por defecto se ve cada modalidad (Individual, Grupo, Partida abierta) con su
  // precio; si el usuario quiere la vista corta, se juntan las que cuestan igual.
  const [desglosar, setDesglosar] = useState(true);
  const vigentes = rates.filter((r) => r.is_active);

  const filas = new Map();
  for (const r of vigentes) {
    const clave = `${r.modality === 'PRACTICA' ? 'P' : r.holes}|${r.category}|${r.time_band}`;
    if (!filas.has(clave)) {
      filas.set(clave, { clave, holes: r.holes, category: r.category, band: r.time_band, practica: r.modality === 'PRACTICA', celdas: {} });
    }
    const fila = filas.get(clave);
    const dias = r.day_type === 'TODOS' ? ['ENTRE_SEMANA', 'FIN_DE_SEMANA'] : [r.day_type];
    for (const d of dias) (fila.celdas[d] ||= {})[r.modality] = Number(r.price);
  }
  const lista = [...filas.values()].sort(
    (a, b) =>
      Number(a.practica) - Number(b.practica) ||
      a.holes - b.holes ||
      ['ADULTO', 'LOCAL', 'INFANTIL'].indexOf(a.category) - ['ADULTO', 'LOCAL', 'INFANTIL'].indexOf(b.category) ||
      (a.band === 'TWILIGHT') - (b.band === 'TWILIGHT'),
  );

  const nombre = (f) => {
    if (f.practica) return 'Zona de práctica';
    const quien = f.band === 'TWILIGHT' ? 'Twilight' : CATEGORIA[f.category] || f.category;
    return `${f.holes} hoyos · ${quien}`;
  };

  function Celda({ celda }) {
    if (!celda) return <span className="text-outline">—</span>;
    const orden = ['INDIVIDUAL', 'GRUPO', 'PARTIDA_ABIERTA'];
    const precios = Object.entries(celda).sort(
      ([a], [b]) => (orden.indexOf(a) + 1 || 9) - (orden.indexOf(b) + 1 || 9),
    );
    const iguales = precios.every(([, v]) => v === precios[0][1]);
    if (iguales && (!desglosar || precios.length === 1)) {
      return (
        <>
          <span className="block font-mono text-body-lg text-primary">{mxn(precios[0][1])}</span>
          {tasa ? <span className="block font-mono text-label-md text-outline">{usd(precios[0][1] / tasa)}</span> : null}
        </>
      );
    }
    return precios.map(([m, v]) => (
      <span key={m} className="block py-0.5 font-mono text-body-md text-primary">
        <span className="mr-2 font-sans text-label-sm uppercase tracking-wider text-outline">{MODALIDAD[m] || m}</span>
        {mxn(v)}
        {tasa ? <span className="ml-2 text-label-sm text-outline">{usd(v / tasa)}</span> : null}
      </span>
    ));
  }

  return (
    <Panel icono="pago" titulo="Tarifas y precios oficiales" insignia="Valores base">
      <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 text-body-md text-on-surface-variant">
        <input type="checkbox" checked={desglosar} onChange={(e) => setDesglosar(e.target.checked)} />
        Ver cada modalidad (Individual, Grupo, Partida abierta)
      </label>
      <div className="caja-lineas overflow-x-auto">
        <table className="tabla-lineas text-left">
          <thead>
            <tr className="text-on-surface-variant">
              <th className="pb-2 text-label-sm uppercase tracking-wider">Ronda</th>
              {COLUMNAS_DIA.map((c) => (
                <th key={c.id} className="pb-2 pl-4 text-right text-label-sm uppercase tracking-wider">
                  {c.texto}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.clave} className="border-t border-outline-variant/30 align-top">
                <td className="py-2.5 pr-3 text-body-lg text-on-surface">{nombre(f)}</td>
                {COLUMNAS_DIA.map((c) => (
                  <td key={c.id} className="whitespace-nowrap py-2.5 pl-4 text-right">
                    <Celda celda={f.celdas[c.id]} />
                  </td>
                ))}
              </tr>
            ))}
            {lista.length === 0 && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-body-lg text-outline">
                  Sin tarifas vigentes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 rounded bg-surface-container-low px-3.5 py-2.5 text-body-md text-outline">
        Precio por jugador en MXN, con su equivalente en USD debajo. Con la vista corta, las modalidades que cuestan lo mismo
        se juntan en un solo precio. El precio se congela en cada reserva: subir una tarifa hoy no altera lo ya vendido.
      </p>
    </Panel>
  );
}

function Monedas({ tc, hoteles, editableTc, editableComision, onCambio }) {
  const [valor, setValor] = useState(tc ? Number(tc.rate).toFixed(2) : '');
  const [comision, setComision] = useState(
    hoteles.find((h) => !h.is_direct)
      ? Number(hoteles.find((h) => !h.is_direct).commission_rate).toFixed(2)
      : '5.00',
  );
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(null);

  async function guardarTc(e) {
    e.preventDefault();
    setOcupado('tc');
    setError(null);
    try {
      await catalogApi.setExchangeRate({ rate: valor, from_currency: 'USD', to_currency: 'MXN' });
      onCambio('Tipo de cambio actualizado. El anterior queda en el histórico.');
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(null);
    }
  }

  /** La comisión se guarda hotel por hotel: se aplica la misma a todos. */
  async function guardarComision(e) {
    e.preventDefault();
    setOcupado('comision');
    setError(null);
    try {
      // La venta directa del mostrador no lleva comisión: se queda fuera.
      const convenios = hoteles.filter((h) => !h.is_direct);
      await Promise.all(
        convenios.map((h) => catalogApi.updateHotel(h.id, { commission_rate: comision })),
      );
      onCambio(`Comisión del ${comision}% aplicada a ${convenios.length} convenios.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Panel icono="refresh" titulo="Monedas y tipo de cambio operativo" insignia="En vigor">
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="fila-lineas rounded bg-surface-container-low px-4 py-3">
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            Moneda base oficial
          </p>
          <p className="text-title-lg text-primary">
            MXN <span className="text-body-md text-outline">(Peso mexicano)</span>
          </p>
        </div>
        <div className="fila-lineas rounded bg-surface-container-low px-4 py-3">
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            Moneda aceptada
          </p>
          <p className="text-title-lg text-primary">
            USD <span className="text-body-md text-outline">(Dólar estadounidense)</span>
          </p>
        </div>
      </div>

      <form
        onSubmit={guardarTc}
        className="mt-3 rounded border border-outline-variant/50 px-4 py-3.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="text-body-lg text-on-surface" htmlFor="tc">
            Tipo de cambio vigente (1 USD = MXN)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-outline">$</span>
            <input
              id="tc"
              type="number"
              step="0.01"
              min="0"
              value={valor}
              disabled={!editableTc}
              onChange={(e) => setValor(e.target.value)}
              className="w-28 rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-right font-mono text-body-lg text-primary focus:border-primary-container focus:outline-none disabled:bg-surface-container-low"
            />
            <span className="text-label-sm uppercase text-outline">MXN</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-label-sm text-outline">
            {tc?.effective_from
              ? `Vigente desde ${fechaHora(tc.effective_from)}${
                  tc.created_by_name ? ` · registrado por ${tc.created_by_name}` : ''
                }`
              : 'Sin registro previo'}
          </p>
          {editableTc && (
            <button
              type="submit"
              disabled={ocupado === 'tc'}
              className="rounded bg-primary-container px-4 py-2 text-title-md text-on-primary transition hover:bg-primary disabled:opacity-60"
            >
              {ocupado === 'tc' ? 'Guardando…' : 'Guardar tipo de cambio'}
            </button>
          )}
        </div>
      </form>

      <form
        onSubmit={guardarComision}
        className="mt-3 rounded border border-outline-variant/50 px-4 py-3.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-body-lg text-on-surface" htmlFor="comision">
            <Icono nombre="hotel" size={17} className="text-secondary" />
            Participación de hoteles (comisión master)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="comision"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={comision}
              disabled={!editableComision}
              onChange={(e) => setComision(e.target.value)}
              className="w-24 rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-right font-mono text-body-lg text-primary focus:border-primary-container focus:outline-none disabled:bg-surface-container-low"
            />
            <span className="text-label-sm uppercase text-outline">%</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-label-sm text-outline">
            Aplicada a {hoteles.filter((h) => !h.is_direct).length} convenios. La venta directa
            del mostrador no paga comisión. La tasa se congela en cada reserva.
          </p>
          {editableComision && hoteles.length > 0 && (
            <button
              type="submit"
              disabled={ocupado === 'comision'}
              className="rounded border border-outline-variant px-4 py-2 text-title-md text-on-surface transition hover:bg-surface-container-low disabled:opacity-60"
            >
              {ocupado === 'comision' ? 'Aplicando…' : 'Actualizar comisión'}
            </button>
          )}
        </div>
      </form>
    </Panel>
  );
}

function PadronPga({ pga, editable }) {
  const { config, credenciales } = pga;

  return (
    <Panel
      icono="escudo"
      titulo="PGA y profesionales acreditados"
      insignia={config?.is_active ? 'Beneficio activo' : 'Beneficio inactivo'}
    >
      <div className="mb-4 fila-lineas rounded bg-surface-container-low px-4 py-3">
        <p className="text-body-lg text-on-surface">
          {config
            ? `Beneficio vigente: ${
                config.discount_type === 'PORCENTAJE'
                  ? `${Number(config.value).toFixed(0)}% sobre el Green Fee`
                  : mxn(config.value)
              }`
            : 'Sin configuración de beneficio.'}
        </p>
        <p className="text-body-md text-outline">
          Se aplica solo en la pantalla de check-in, sobre la tarifa del portador de la credencial
          validada. No es un código promocional ni se extiende a su grupo.
        </p>
      </div>

      <div className="caja-lineas overflow-x-auto">
        <table className="tabla-lineas text-left">
          <thead>
            <tr className="text-on-surface-variant">
              {['Credencial', 'Profesional', 'Acreditación', 'Estado'].map((c, i) => (
                <th
                  key={c}
                  className={`whitespace-nowrap pb-2 text-label-sm uppercase tracking-wider ${
                    i === 1 ? 'w-full pl-4' : i > 0 ? 'pl-4' : ''
                  }`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {credenciales.slice(0, 8).map((c) => (
              <tr key={c.id} className="border-t border-outline-variant/30">
                <td className="whitespace-nowrap py-2.5 pr-3 font-mono text-body-lg text-primary">
                  {c.credential_number}
                </td>
                <td className="max-w-0 truncate py-2.5 pl-4 text-body-lg text-on-surface">
                  {c.professional_name}
                </td>
                <td className="whitespace-nowrap py-2.5 pl-4 text-body-lg text-outline">
                  {c.accreditation || '—'}
                </td>
                <td className="whitespace-nowrap py-2.5 pl-4">
                  <span
                    className={`rounded px-2 py-0.5 text-label-sm uppercase tracking-wider ${
                      c.is_active
                        ? 'bg-estado-ok-bg text-estado-ok-text'
                        : 'bg-surface-container-high text-outline'
                    }`}
                  >
                    {c.is_active ? 'Activo' : 'Baja'}
                  </span>
                </td>
              </tr>
            ))}
            {credenciales.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-body-lg text-outline">
                  {editable ? 'Padrón vacío.' : 'Sin acceso al padrón.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {credenciales.length > 8 && (
        <p className="mt-3 text-body-md text-outline">
          Mostrando 8 de {credenciales.length} credenciales acreditadas.
        </p>
      )}
    </Panel>
  );
}

function HorarioMaestro({ horario, editable, onCambio }) {
  const [form, setForm] = useState({
    start_time: hora(horario?.start_time) || '09:00',
    end_time: hora(horario?.end_time) || '12:30',
    interval_minutes: horario?.interval_minutes ?? 30,
  });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function guardar(e) {
    e.preventDefault();
    if (!horario) return;
    setOcupado(true);
    setError(null);
    try {
      await catalogApi.updateSchedule(horario.id, {
        start_time: `${form.start_time}:00`.slice(0, 8),
        end_time: `${form.end_time}:00`.slice(0, 8),
        interval_minutes: Number(form.interval_minutes),
      });
      onCambio('Horario maestro actualizado. Las salidas futuras se regeneran con el nuevo rango.');
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  }

  /** Las horas que produce el rango, para que se vea antes de guardar. */
  const salidas = (() => {
    const [h1, m1] = form.start_time.split(':').map(Number);
    const [h2, m2] = form.end_time.split(':').map(Number);
    const paso = Number(form.interval_minutes) || 30;
    const lista = [];
    for (let t = h1 * 60 + m1; t <= h2 * 60 + m2 && lista.length < 60; t += paso) {
      lista.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    }
    return lista;
  })();

  return (
    <Panel
      icono="schedule"
      titulo="Horarios del campo (generador maestro)"
      insignia={`${salidas.length} salidas`}
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <form onSubmit={guardar}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Entrada label="Hora inicial">
            <input
              type="time"
              value={form.start_time}
              disabled={!editable}
              onChange={set('start_time')}
              className={CAMPO}
            />
          </Entrada>
          <Entrada label="Hora final">
            <input
              type="time"
              value={form.end_time}
              disabled={!editable}
              onChange={set('end_time')}
              className={CAMPO}
            />
          </Entrada>
          <Entrada label="Intervalo de salidas">
            <select
              value={form.interval_minutes}
              disabled={!editable}
              onChange={set('interval_minutes')}
              className={CAMPO}
            >
              {[8, 10, 12, 15, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </select>
          </Entrada>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded bg-surface-container-low px-3.5 py-3">
          <p className="min-w-0 flex-1 text-body-md text-outline">
            Salidas generadas:{' '}
            <span className="font-mono text-on-surface-variant">
              {salidas.slice(0, 10).join(', ')}
              {salidas.length > 10 ? '…' : ''}
            </span>
          </p>
          {editable && (
            <button
              type="submit"
              disabled={ocupado}
              className="shrink-0 rounded bg-primary-container px-4 py-2 text-title-md text-on-primary transition hover:bg-primary disabled:opacity-60"
            >
              {ocupado ? 'Regenerando…' : 'Regenerar agenda'}
            </button>
          )}
        </div>
      </form>
    </Panel>
  );
}

function Servicios({ servicios, tasa, puedeEditar = false, onCambio }) {
  const [ocupado, setOcupado] = useState(null);
  const [editando, setEditando] = useState(null); // { id, price, weekend }

  async function guardar(s, cambios, titulo, texto) {
    const ok = await confirmar({ titulo, texto, confirmar: 'Sí, guardar' });
    if (!ok) return false;
    setOcupado(s.id);
    try {
      await catalogApi.updateService(s.id, cambios);
      await exito('Guardado', 'El sitio y el sistema ya usan el cambio.');
      onCambio?.();
      return true;
    } catch (err) {
      await avisoError('No se pudo guardar', err.message);
      return false;
    } finally {
      setOcupado(null);
    }
  }

  function alternar(s) {
    return guardar(
      s,
      { is_active: !s.is_active },
      s.is_active ? `Dar de baja «${s.name}»` : `Activar «${s.name}»`,
      s.is_active
        ? 'Dejará de ofrecerse en el sitio y en las reservas nuevas.'
        : 'Volverá a ofrecerse en el sitio y en las reservas nuevas.',
    );
  }

  async function guardarPrecio(s) {
    const precio = Number(editando.price);
    const fin = editando.weekend === '' ? null : Number(editando.weekend);
    if (!(precio >= 0) || editando.price === '' || (fin !== null && !(fin >= 0))) {
      await avisoError('Precio inválido', 'Escriba cantidades en pesos, sin letras.');
      return;
    }
    const cambios = { price: precio.toFixed(2) };
    if (s.weekend_price != null || fin !== null) cambios.weekend_price = fin === null ? null : fin.toFixed(2);
    const listo = await guardar(
      s,
      cambios,
      `Cambiar el precio de «${s.name}»`,
      `Quedará en <b>${mxn(precio)}</b>${fin !== null ? ` y <b>${mxn(fin)}</b> de viernes a domingo` : ''}.`,
    );
    if (listo) setEditando(null);
  }

  return (
    <Panel icono="golf" titulo="Servicios adicionales y alquileres" insignia="Precios en MXN">
      <div className="grid gap-2.5">
        {servicios.map((s) => (
          <div
            key={s.id}
            className={`fila-lineas rounded bg-surface-container-low px-4 py-3 ${
              s.is_active ? '' : 'opacity-70'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <div className="min-w-0">
                <p className="text-title-md text-primary">{s.name}</p>
                <p className="font-mono text-label-sm text-outline">
                  {s.weekend_price
                    ? `${mxn(s.price)} lun a jue · ${mxn(s.weekend_price)} vie a dom`
                    : `${mxn(s.price)} ${tasa ? `(${usd(Number(s.price) / tasa)})` : ''}`}
                </p>
              </div>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-label-sm uppercase tracking-wider ${
                  s.is_active
                    ? 'bg-estado-ok-bg text-estado-ok-text'
                    : 'bg-surface-container-high text-outline'
                }`}
              >
                {s.is_active ? 'Activo' : 'Baja'}
              </span>
            </div>

            {puedeEditar && editando?.id === s.id && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Lun a jue
                  <input
                    type="number" min="0" step="1" value={editando.price}
                    onChange={(e) => setEditando({ ...editando, price: e.target.value })}
                    className="mt-1 block w-28 rounded border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-right font-mono"
                  />
                </label>
                {(s.weekend_price != null || s.code === 'PRACTICA') && (
                  <label className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                    Vie a dom
                    <input
                      type="number" min="0" step="1" value={editando.weekend}
                      onChange={(e) => setEditando({ ...editando, weekend: e.target.value })}
                      className="mt-1 block w-28 rounded border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-right font-mono"
                    />
                  </label>
                )}
                <button
                  onClick={() => guardarPrecio(s)}
                  disabled={ocupado === s.id}
                  className="rounded border border-outline-variant px-3 py-1.5 text-label-sm uppercase tracking-wider text-primary hover:bg-surface-container-high disabled:opacity-50"
                >
                  Guardar
                </button>
                <button
                  onClick={() => setEditando(null)}
                  className="px-2 py-1.5 text-label-sm uppercase tracking-wider text-outline hover:text-primary"
                >
                  Cancelar
                </button>
              </div>
            )}

            {puedeEditar && editando?.id !== s.id && (
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={() =>
                    setEditando({
                      id: s.id,
                      price: String(Number(s.price)),
                      weekend: s.weekend_price == null ? '' : String(Number(s.weekend_price)),
                    })
                  }
                  className="rounded border border-outline-variant px-3 py-1 text-label-sm uppercase tracking-wider text-on-surface-variant hover:bg-surface-container-high"
                >
                  Cambiar precio
                </button>
                <button
                  onClick={() => alternar(s)}
                  disabled={ocupado === s.id}
                  className="rounded border border-outline-variant px-3 py-1 text-label-sm uppercase tracking-wider text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
                >
                  {s.is_active ? 'Dar de baja' : 'Activar'}
                </button>
              </div>
            )}
          </div>
        ))}
        {servicios.length === 0 && (
          <p className="py-8 text-center text-body-lg text-outline">
            Sin servicios registrados.
          </p>
        )}
      </div>
      <p className="mt-4 rounded bg-surface-container-low px-3.5 py-2.5 text-body-md text-outline">
        Caddie, buggy y bastones se contratan en recepción, no en el portal del hotel.
      </p>
    </Panel>
  );
}

function Bitacora({ registros }) {
  return (
    <Panel icono="history_edu" titulo="Registro maestro de auditoría de cambios" insignia="Últimos movimientos">
      <div className="caja-lineas overflow-x-auto">
        <table className="tabla-lineas text-left">
          <thead>
            <tr className="text-on-surface-variant">
              {['Usuario', 'Fecha / hora', 'Parámetro modificado', 'Valor anterior', 'Valor nuevo'].map(
                (c, i) => (
                  <th
                    key={c}
                    className={`whitespace-nowrap pb-2 text-label-sm uppercase tracking-wider ${
                      i === 2 ? 'w-full pl-4' : i > 0 ? 'pl-4' : ''
                    }`}
                  >
                    {c}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {registros.map((r) => (
              <tr key={r.id} className="border-t border-outline-variant/30">
                <td className="whitespace-nowrap py-2.5 pr-3 text-body-lg text-on-surface">
                  {r.user_name || 'sistema'}
                </td>
                <td className="whitespace-nowrap py-2.5 pl-4 font-mono text-label-sm text-outline">
                  {fechaHora(r.created_at)}
                </td>
                <td className="max-w-0 truncate py-2.5 pl-4 text-body-lg text-on-surface-variant">
                  {r.description || `${r.entity}${r.field ? ` · ${r.field}` : ''}`}
                </td>
                <td className="whitespace-nowrap py-2.5 pl-4 font-mono text-label-sm text-outline">
                  {r.old_value ?? '—'}
                </td>
                <td className="whitespace-nowrap py-2.5 pl-4 font-mono text-label-sm text-primary">
                  {r.new_value ?? '—'}
                </td>
              </tr>
            ))}
            {registros.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-body-lg text-outline">
                  Sin cambios registrados todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const CAMPO =
  'w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-body-lg text-on-surface focus:border-primary-container focus:outline-none disabled:bg-surface-container-low';

function Entrada({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-label-sm uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      {children}
    </label>
  );
}
