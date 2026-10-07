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
        catalogApi.services(),
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
          <h1 className="font-serif text-display-lg leading-tight text-primary">
            Configuración del Sistema & Parámetros Operativos
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

      <div className="grid gap-gutter xl:grid-cols-2">
        <TarifasOficiales rates={rates} tasa={tasa} />

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
          <HistorialTipoCambio limite={20} compacto />
        </Panel>

        <PadronPga pga={pga} editable={false} />

        <HorarioMaestro
          horario={horario}
          editable={false}
          onCambio={(mensaje) => {
            setAviso(mensaje);
            cargar(false);
          }}
        />

        <Servicios servicios={servicios} tasa={tasa} />
      </div>

      {can('audit:view') && <Bitacora registros={bitacora} />}
    </div>
  );
}

/* ------------------------------------------------------------------ tarjetas */

function Panel({ icono, titulo, insignia, accion, children }) {
  return (
    <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card">
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

function TarifasOficiales({ rates, tasa }) {
  const vigentes = rates.filter((r) => r.is_active);

  return (
    <Panel icono="pago" titulo="Tarifas y precios oficiales" insignia="Valores base">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-on-surface-variant">
              {['Modalidad / concepto', 'Recorrido', 'Precio (MXN)', 'Equiv. USD', 'Estado'].map(
                (c, i) => (
                  <th
                    key={c}
                    className={`whitespace-nowrap pb-2 text-label-sm uppercase tracking-wider ${
                      i === 0 ? 'w-full' : 'pl-4'
                    } ${i >= 2 && i <= 3 ? 'text-right' : ''}`}
                  >
                    {c}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {vigentes.map((r) => (
              <tr key={r.id} className="border-t border-outline-variant/30">
                <td className="max-w-0 truncate py-2.5 pr-3 text-body-lg text-on-surface">
                  {MODALIDAD[r.modality] || r.modality}
                  <span className="text-outline"> · {CATEGORIA[r.category] || r.category}</span>
                </td>
                <td className="whitespace-nowrap py-2.5 pl-4 text-body-lg text-on-surface-variant">
                  {recorrido(r)}
                  {/* Sin el día, las dos tarifas del mismo recorrido se verían
                      iguales con precios distintos. */}
                  <span className="ml-1.5 text-label-sm uppercase tracking-wider text-outline">
                    {r.day_type === 'FIN_DE_SEMANA'
                      ? 'vie a dom'
                      : r.day_type === 'ENTRE_SEMANA'
                        ? 'lun a jue'
                        : 'todos los días'}
                  </span>
                </td>
                <td className="whitespace-nowrap py-2.5 pl-4 text-right font-mono text-body-lg text-primary">
                  {mxn(r.price)}
                </td>
                <td className="whitespace-nowrap py-2.5 pl-4 text-right font-mono text-body-lg text-outline">
                  {tasa ? usd(Number(r.price) / tasa) : '—'}
                </td>
                <td className="whitespace-nowrap py-2.5 pl-4">
                  <span className="flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-estado-ok-text">
                    <Icono nombre="check" size={14} /> Activo
                  </span>
                </td>
              </tr>
            ))}
            {vigentes.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-body-lg text-outline">
                  Sin tarifas vigentes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 rounded bg-surface-container-low px-3.5 py-2.5 text-body-md text-outline">
        El precio se congela en cada reserva: subir una tarifa hoy no altera lo ya vendido.
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
        <div className="rounded border border-outline-variant/50 bg-surface-container-low px-4 py-3">
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            Moneda base oficial
          </p>
          <p className="text-title-lg text-primary">
            MXN <span className="text-body-md text-outline">(Peso mexicano)</span>
          </p>
        </div>
        <div className="rounded border border-outline-variant/50 bg-surface-container-low px-4 py-3">
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
      <div className="mb-4 rounded border border-outline-variant/50 bg-surface-container-low px-4 py-3">
        <p className="text-body-lg text-on-surface">
          {config
            ? `Beneficio vigente: ${
                config.discount_type === 'PORCENTAJE'
                  ? `${Number(config.value).toFixed(0)}% sobre el green fee`
                  : mxn(config.value)
              }`
            : 'Sin configuración de beneficio.'}
        </p>
        <p className="text-body-md text-outline">
          Se aplica solo en la pantalla de check-in, sobre la tarifa del portador de la credencial
          validada. No es un código promocional ni se extiende a su grupo.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-on-surface-variant">
              {['Credencial PGA', 'Profesional asociado', 'Acreditación', 'Estado'].map((c, i) => (
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

function Servicios({ servicios, tasa }) {
  return (
    <Panel icono="golf" titulo="Servicios adicionales y alquileres" insignia="Precios en MXN">
      <div className="grid gap-3 sm:grid-cols-2">
        {servicios.map((s) => (
          <div
            key={s.id}
            className="flex items-start justify-between gap-3 rounded border border-outline-variant/50 bg-surface-container-low px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-title-md text-primary">{s.name}</p>
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
        ))}
        {servicios.length === 0 && (
          <p className="py-8 text-center text-body-lg text-outline sm:col-span-2">
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
      <div className="overflow-x-auto">
        <table className="w-full text-left">
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
