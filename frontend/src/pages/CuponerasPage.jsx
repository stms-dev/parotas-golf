/**
 * Cuponeras: paquetes de Green Fees pagados por adelantado.
 *
 * Arriba, el canje del mostrador: se escanea el código de barras (o se escribe
 * el folio), aparece el saldo y se descuentan los pases de quienes llegaron.
 * Abajo, para Operaciones y la Administración, la lista: vender una cuponera,
 * confirmar la transferencia, ver el historial e imprimir su tarjeta.
 * Precio, vigencia, modalidad, cancelaciones y anulaciones son de la
 * Administración.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { cuponerasApi } from '../api/client';
import Icono from '../components/Icono';
import { Modal, Paginador, usePaginacion } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { confirmar, error as avisoError, exito } from '../utils/avisos';
import CodigoBarras from '../utils/codigoBarras.jsx';
import { fecha, fechaHora, hoy, mxn } from '../utils/format';
import { BOTON, BOTON_FUERTE, CAMPO, ETIQUETA, TARJETA, plural } from './tienda/comun';

const ESTADOS = {
  PENDIENTE_PAGO: { texto: 'Pendiente de pago', clase: 'border-estado-pend-border bg-estado-pend-bg text-estado-pend-text' },
  ACTIVA: { texto: 'Activa', clase: 'border-estado-ok-border bg-estado-ok-bg text-estado-ok-text' },
  AGOTADA: { texto: 'Agotada', clase: 'border-outline-variant bg-surface-container-high text-on-surface-variant' },
  VENCIDA: { texto: 'Vencida', clase: 'border-outline-variant bg-surface-container-high text-on-surface-variant' },
  CANCELADA: { texto: 'Cancelada', clase: 'border-estado-cancel-border bg-estado-cancel-bg text-estado-cancel-text' },
};

function Estado({ valor }) {
  const e = ESTADOS[valor] || { texto: valor, clase: '' };
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-label-sm uppercase tracking-wider ${e.clase}`}>
      {e.texto}
    </span>
  );
}

const jugadoresTxt = (n) => `${n} jugador${n === 1 ? '' : 'es'}`;

const modalidades = (c) => [c.hoyos_18 && '18 hoyos', c.hoyos_9 && '9 hoyos'].filter(Boolean).join(' y ');

export default function CuponerasPage() {
  const { can } = useAuth();
  const puedeCanjear = can('cuponera:canjear');
  const gestiona = can('cuponera:gestionar');
  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-serif text-display-lg leading-tight text-primary">Cuponeras</h1>
        <p className="text-body-lg text-outline">
          Green Fees pagados por adelantado: se canjean con el código de barras de la cuponera.
        </p>
      </header>
      {puedeCanjear && <Canje />}
      {gestiona && <Lista />}
    </div>
  );
}

// --------------------------------------------------------------------- canje
function Canje() {
  const [folio, setFolio] = useState('');
  const [cup, setCup] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [falla, setFalla] = useState('');
  const [jugadores, setJugadores] = useState('1');
  const [hoyos, setHoyos] = useState(18);
  const [atendio, setAtendio] = useState('');
  const [reserva, setReserva] = useState('');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef(null);

  useEffect(() => {
    entrada.current?.focus();
  }, []);

  async function buscar(e) {
    e?.preventDefault();
    const limpio = folio.trim();
    if (!limpio) return;
    setBuscando(true);
    setFalla('');
    setCup(null);
    try {
      const c = await cuponerasApi.porCodigo(limpio);
      setCup(c);
      setJugadores('1');
      setHoyos(c.hoyos_18 ? 18 : 9);
      setReserva('');
      setNota('');
    } catch (err) {
      setFalla(err.message);
    } finally {
      setBuscando(false);
    }
  }

  function otra() {
    setCup(null);
    setFolio('');
    setFalla('');
    entrada.current?.focus();
  }

  const n = Number(jugadores);
  const bloqueada = Boolean(cup?.motivo_bloqueo);
  const listo = cup && !bloqueada && Number.isInteger(n) && n >= 1 && n <= cup.saldo && atendio.trim().length >= 3;

  async function canjear() {
    setEnviando(true);
    try {
      const nueva = await cuponerasApi.canjear(cup.id, {
        jugadores: n, hoyos, atendio: atendio.trim(),
        reserva_folio: reserva.trim() || null, nota: nota.trim() || null,
      });
      setCup(nueva);
      setJugadores('1');
      setReserva('');
      setNota('');
      exito('Pases descontados', `${plural(n, 'pase')} de ${nueva.folio}. Quedan ${nueva.saldo}.`);
    } catch (err) {
      avisoError('No se pudo canjear', err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className={`${TARJETA} p-5`}>
      <h2 className="font-serif text-headline-md text-primary">Canje en mostrador</h2>
      <form onSubmit={buscar} className="mt-3 flex flex-wrap items-end gap-2.5">
        <label className="min-w-[260px] flex-1">
          <span className={ETIQUETA}>Escanee el código o escriba el folio</span>
          <input
            ref={entrada}
            value={folio}
            onChange={(e) => setFolio(e.target.value.toUpperCase())}
            placeholder="CUP-0001"
            autoComplete="off"
            className={`${CAMPO} font-mono text-title-lg`}
          />
        </label>
        <button type="submit" disabled={buscando || !folio.trim()} className={BOTON_FUERTE}>
          <Icono nombre="buscar" size={16} /> Buscar
        </button>
      </form>
      {falla && <p className="mt-3 rounded border border-estado-cancel-border bg-estado-cancel-bg px-3 py-2 text-body-md text-estado-cancel-text">{falla}</p>}

      {cup && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-lg border border-outline-variant/60 bg-surface-container-low p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-title-lg">{cup.folio}</p>
              <Estado valor={cup.estado} />
            </div>
            <p className="mt-1 text-title-md font-semibold">{cup.titular_nombre}</p>
            {cup.empresa && <p className="text-body-md text-on-surface-variant">{cup.empresa}</p>}
            <p className="mt-3 font-serif text-[2.6rem] leading-none text-primary" data-testid="saldo">
              {cup.saldo}
              <span className="ml-2 text-body-lg text-outline">de {cup.pases_total} pases</span>
            </p>
            <p className="mt-2 text-body-md text-on-surface-variant">
              {modalidades(cup)} · vence el {fecha(cup.vence_el)}
            </p>
            {cup.fechas_bloqueadas.length > 0 && (
              <p className="mt-1 text-label-sm text-outline">
                No aplica: {cup.fechas_bloqueadas.map((b) => `${b.desde}${b.hasta !== b.desde ? ` a ${b.hasta}` : ''}${b.motivo ? ` (${b.motivo})` : ''}`).join(' · ')}
              </p>
            )}
            {bloqueada && (
              <p className="mt-3 rounded border border-estado-cancel-border bg-estado-cancel-bg px-3 py-2 text-body-md font-semibold text-estado-cancel-text">
                {cup.motivo_bloqueo}
              </p>
            )}
            {cup.usos.length > 0 && (
              <ul className="mt-3 max-h-40 divide-y divide-outline-variant/40 overflow-y-auto text-body-md">
                {cup.usos.map((u) => (
                  <li key={u.id} className={`flex justify-between gap-2 py-1.5 ${u.anulado ? 'text-outline line-through' : ''}`}>
                    <span>{fecha(u.fecha)} · {jugadoresTxt(u.jugadores)} · {u.hoyos} hoyos</span>
                    <span className="text-on-surface-variant">{u.validado_por_nombre}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={ETIQUETA}>Jugadores que llegan</span>
                <input type="number" min={1} max={cup.saldo} step={1} value={jugadores} disabled={bloqueada}
                  onChange={(e) => setJugadores(e.target.value)} className={CAMPO} data-testid="jugadores" />
              </label>
              <label>
                <span className={ETIQUETA}>Hoyos</span>
                <select value={hoyos} disabled={bloqueada} onChange={(e) => setHoyos(Number(e.target.value))} className={CAMPO}>
                  {cup.hoyos_18 && <option value={18}>18 hoyos</option>}
                  {cup.hoyos_9 && <option value={9}>9 hoyos</option>}
                </select>
              </label>
            </div>
            <label className="block">
              <span className={ETIQUETA}>Folio de la reserva (opcional)</span>
              <input value={reserva} disabled={bloqueada} onChange={(e) => setReserva(e.target.value.toUpperCase())} className={CAMPO} />
            </label>
            <label className="block">
              <span className={ETIQUETA}>Nota (opcional)</span>
              <input value={nota} disabled={bloqueada} maxLength={300} onChange={(e) => setNota(e.target.value)} className={CAMPO} />
            </label>
            <label className="block">
              <span className={ETIQUETA}>Quién valida</span>
              <input value={atendio} disabled={bloqueada} onChange={(e) => setAtendio(e.target.value)} placeholder="Escribe tu nombre"
                className={`${CAMPO} ${atendio.trim().length < 3 && !bloqueada ? 'border-estado-pend-border bg-estado-pend-bg' : ''}`} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button onClick={canjear} disabled={!listo || enviando} className={BOTON_FUERTE}>
                Descontar {plural(Number.isInteger(n) && n > 0 ? n : 0, 'pase')}
              </button>
              <button onClick={otra} className={BOTON}>Otra cuponera</button>
            </div>
            {n > cup.saldo && <p className="text-body-md text-error">Solo quedan {cup.saldo} pases.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------------- lista
function Lista() {
  const { can } = useAuth();
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const [lista, setLista] = useState(null);
  const [nueva, setNueva] = useState(false);
  const [abierta, setAbierta] = useState(null); // id
  const pag = usePaginacion(lista || [], 10, `${estado}|${q}`);

  async function cargar() {
    try {
      setLista(await cuponerasApi.lista({ estado: estado || undefined, q: q.trim() || undefined }));
    } catch (err) {
      avisoError('No se cargaron las cuponeras', err.message);
      setLista([]);
    }
  }
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const totales = useMemo(() => {
    const vivas = (lista || []).filter((c) => c.estado !== 'CANCELADA');
    return {
      vendido: vivas.reduce((t, c) => t + Number(c.precio_total), 0),
      cobrado: vivas.filter((c) => c.pago_estado === 'PAGADA').reduce((t, c) => t + Number(c.precio_total), 0),
      pendiente: vivas.filter((c) => c.pago_estado !== 'PAGADA').reduce((t, c) => t + Number(c.precio_total), 0),
      saldo: vivas.filter((c) => c.estado === 'ACTIVA').reduce((t, c) => t + c.saldo, 0),
    };
  }, [lista]);

  return (
    <section className={`${TARJETA} p-5`}>
      <div className="flex flex-wrap items-end gap-2.5">
        <h2 className="mr-auto font-serif text-headline-md text-primary">Cuponeras vendidas</h2>
        <label>
          <span className={ETIQUETA}>Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className={CAMPO}>
            <option value="">Todas</option>
            {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
          </select>
        </label>
        <form onSubmit={(e) => { e.preventDefault(); cargar(); }} className="min-w-[200px]">
          <span className={ETIQUETA}>Folio o titular</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} className={CAMPO} />
        </form>
        <button onClick={() => setNueva(true)} className={BOTON_FUERTE}>
          <Icono nombre="add" size={16} /> Nueva cuponera
        </button>
      </div>
      <p className="mt-3 text-body-md text-on-surface-variant">
        Vendido {mxn(totales.vendido)} · cobrado {mxn(totales.cobrado)} · por cobrar {mxn(totales.pendiente)} · {plural(totales.saldo, 'pase')} por usar en cuponeras activas
      </p>

      <div className="caja-lineas mt-3">
        <div className="overflow-x-auto">
          <table className="tabla-lineas min-w-[900px] text-left">
            <thead>
              <tr className="text-label-sm uppercase tracking-wider text-outline">
                <th className="px-3 py-3">Folio</th>
                <th className="px-3 py-3">Titular</th>
                <th className="px-3 py-3 text-right">Pases</th>
                <th className="px-3 py-3 text-right">Precio</th>
                <th className="px-3 py-3">Vigencia</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {lista === null && <tr><td colSpan={7} className="px-3 py-6 text-center text-outline">Cargando…</td></tr>}
              {lista?.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-outline">Sin cuponeras</td></tr>}
              {pag.visibles.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-3 font-mono text-body-md">{c.folio}</td>
                  <td className="px-3 py-3">
                    <span className="block text-body-lg">{c.titular_nombre}</span>
                    {c.empresa && <span className="text-label-sm text-outline">{c.empresa}</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-body-md">
                    {c.saldo}<span className="text-outline"> / {c.pases_total}</span>
                    <span className="block text-label-sm text-outline">{modalidades(c)}</span>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-body-md">
                    {mxn(c.precio_total)}
                    {c.descuento_pct != null && Number(c.descuento_pct) > 0 && (
                      <span className="block text-label-sm text-estado-ok-text">-{Number(c.descuento_pct)}%</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-body-md">{fecha(c.vence_el)}</td>
                  <td className="px-3 py-3"><Estado valor={c.estado} /></td>
                  <td className="px-3 py-3 text-right">
                    <button onClick={() => setAbierta(c.id)} className={BOTON}>Abrir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Paginador pag={pag} etiqueta="cuponeras" />
      </div>

      {nueva && (
        <Formulario
          onClose={() => setNueva(false)}
          onListo={(c) => { setNueva(false); cargar(); setAbierta(c.id); }}
        />
      )}
      {abierta && (
        <Detalle
          id={abierta}
          admin={can('cuponera:administrar')}
          onClose={() => setAbierta(null)}
          onCambio={cargar}
        />
      )}
    </section>
  );
}

// ------------------------------------------------------------------- detalle
function Detalle({ id, admin, onClose, onCambio }) {
  const [c, setC] = useState(null);
  const [editando, setEditando] = useState(false);
  const [pagando, setPagando] = useState(false);
  const [tarjeta, setTarjeta] = useState(false);
  const [nota, setNota] = useState(null); // { tipo: 'cancelar'|'anular', uso? }

  async function cargar() {
    try {
      setC(await cuponerasApi.detalle(id));
    } catch (err) {
      avisoError('No se pudo abrir la cuponera', err.message);
      onClose();
    }
  }
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function actualizado(nueva) {
    setC(nueva);
    onCambio();
  }

  if (!c) return null;
  const viva = !c.cancelada;
  return (
    <>
      <Modal
        open
        title={`${c.folio} · ${c.titular_nombre}`}
        onClose={onClose}
        ancho="max-w-2xl"
        footer={
          <>
            {viva && c.pago_estado !== 'PAGADA' && (
              <button onClick={() => setPagando(true)} className={BOTON_FUERTE}>Confirmar transferencia</button>
            )}
            {c.pago_estado === 'PAGADA' && viva && (
              <button onClick={() => setTarjeta(true)} className={BOTON}><Icono nombre="imprimir" size={15} /> Tarjeta con código</button>
            )}
            {admin && viva && <button onClick={() => setEditando(true)} className={BOTON}>Editar</button>}
            {admin && viva && <button onClick={() => setNota({ tipo: 'cancelar' })} className={BOTON}>Cancelar cuponera</button>}
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Estado valor={c.estado} />
            <span className="text-body-md text-on-surface-variant">
              {modalidades(c)} · vence el {fecha(c.vence_el)}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-md">
            <Dato t="Pases" v={`${c.saldo} por usar de ${c.pases_total}`} />
            <Dato t="Precio" v={`${mxn(c.precio_total)} (${mxn(c.precio_por_pase)} por pase)`} />
            {c.precio_lista != null && <Dato t="A tarifa normal" v={`${mxn(c.precio_lista)}${c.descuento_pct != null ? ` · descuento ${Number(c.descuento_pct)}%` : ''}`} />}
            <Dato t="Pago" v={c.pago_estado === 'PAGADA' ? `Pagada · ref. ${c.pago_referencia} · ${fechaHora(c.pagada_en)} · ${c.pago_confirmo_nombre}` : 'Pendiente de transferencia'} />
            {c.empresa && <Dato t="Empresa" v={c.empresa} />}
            {(c.telefono || c.correo) && <Dato t="Contacto" v={[c.telefono, c.correo].filter(Boolean).join(' · ')} />}
            <Dato t="Vendió" v={`${c.creada_por_nombre || '—'} · ${fechaHora(c.created_at)}`} />
            {c.notas && <Dato t="Notas" v={c.notas} />}
          </dl>
          {c.fechas_bloqueadas.length > 0 && (
            <p className="text-body-md text-on-surface-variant">
              <strong>Fechas bloqueadas:</strong>{' '}
              {c.fechas_bloqueadas.map((b) => `${b.desde}${b.hasta !== b.desde ? ` a ${b.hasta}` : ''}${b.motivo ? ` (${b.motivo})` : ''}`).join(' · ')}
            </p>
          )}
          {c.cancelada && (
            <p className="rounded border border-estado-cancel-border bg-estado-cancel-bg px-3 py-2 text-body-md text-estado-cancel-text">
              Cancelada por {c.cancelada_por} el {fechaHora(c.cancelada_en)}: {c.cancelada_nota}
            </p>
          )}
          <div>
            <h4 className="text-label-sm uppercase tracking-wider text-outline">Historial de canjes</h4>
            {c.usos.length === 0 ? (
              <p className="mt-1 text-body-md text-outline">Todavía no se ha usado.</p>
            ) : (
              <ul className="mt-1 divide-y divide-outline-variant/40">
                {c.usos.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-body-md">
                    <span className={u.anulado ? 'text-outline line-through' : ''}>
                      {fecha(u.fecha)} · {jugadoresTxt(u.jugadores)} · {u.hoyos} hoyos
                      {u.reserva_folio && ` · reserva ${u.reserva_folio}`}
                      <span className="block text-label-sm text-outline">
                        Validó {u.validado_por_nombre}{u.nota ? ` · ${u.nota}` : ''}
                      </span>
                      {u.anulado && (
                        <span className="block text-label-sm text-error no-underline">
                          Anulado por {u.anulado_por}: {u.anulado_nota}
                        </span>
                      )}
                    </span>
                    {admin && !u.anulado && (
                      <button onClick={() => setNota({ tipo: 'anular', uso: u })} className="text-body-md text-primary underline">Anular</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>

      {pagando && <Pago c={c} onClose={() => setPagando(false)} onListo={(n) => { setPagando(false); actualizado(n); }} />}
      {editando && <Formulario inicial={c} onClose={() => setEditando(false)} onListo={(n) => { setEditando(false); actualizado(n); }} />}
      {tarjeta && <Tarjeta c={c} onClose={() => setTarjeta(false)} />}
      {nota && (
        <NotaModal
          tipo={nota.tipo}
          c={c}
          uso={nota.uso}
          onClose={() => setNota(null)}
          onListo={(n) => { setNota(null); actualizado(n); }}
        />
      )}
    </>
  );
}

function Dato({ t, v }) {
  return (
    <div>
      <dt className="text-label-sm uppercase tracking-wider text-outline">{t}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Pago({ c, onClose, onListo }) {
  const [ref, setRef] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    setEnviando(true);
    try {
      const n = await cuponerasApi.pago(c.id, { referencia: ref.trim() });
      exito('Pago confirmado', `${n.folio} ya se puede usar.`);
      onListo(n);
    } catch (err) {
      avisoError('No se pudo confirmar', err.message);
      setEnviando(false);
    }
  }
  return (
    <Modal open title={`Confirmar pago de ${c.folio}`} onClose={onClose}
      footer={<><button onClick={onClose} className={BOTON}>Volver</button>
        <button onClick={enviar} disabled={enviando || ref.trim().length < 3} className={BOTON_FUERTE}>Ya llegó la transferencia</button></>}>
      <p className="mb-3 text-body-md text-on-surface-variant">Monto: {mxn(c.precio_total)}. Anota la referencia o clave de rastreo.</p>
      <label>
        <span className={ETIQUETA}>Referencia de la transferencia</span>
        <input value={ref} onChange={(e) => setRef(e.target.value)} className={CAMPO} autoFocus />
      </label>
    </Modal>
  );
}

function NotaModal({ tipo, c, uso, onClose, onListo }) {
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const cancelar = tipo === 'cancelar';
  async function enviar() {
    if (cancelar) {
      const ok = await confirmar({ titulo: `¿Cancelar ${c.folio}?`, texto: `Quedan ${c.saldo} pases sin usar. No se puede deshacer.`, confirmar: 'Cancelar cuponera' });
      if (!ok) return;
    }
    setEnviando(true);
    try {
      const n = cancelar
        ? await cuponerasApi.cancelar(c.id, { nota: nota.trim() })
        : await cuponerasApi.anularUso(uso.id, { nota: nota.trim() });
      exito(cancelar ? 'Cuponera cancelada' : 'Canje anulado', cancelar ? '' : `Regresaron ${uso.jugadores} pases.`);
      onListo(n);
    } catch (err) {
      avisoError('No se pudo completar', err.message);
      setEnviando(false);
    }
  }
  return (
    <Modal open title={cancelar ? `Cancelar ${c.folio}` : 'Anular canje'} onClose={onClose}
      footer={<><button onClick={onClose} className={BOTON}>Volver</button>
        <button onClick={enviar} disabled={enviando || nota.trim().length < 3} className={BOTON_FUERTE}>{cancelar ? 'Cancelar cuponera' : 'Anular canje'}</button></>}>
      <label>
        <span className={ETIQUETA}>Motivo</span>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} maxLength={300} className={CAMPO} autoFocus />
      </label>
    </Modal>
  );
}

// ------------------------------------------------------------------- tarjeta
function Tarjeta({ c, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/45 p-4">
      <div className="my-4 w-full max-w-md">
        <div className="no-imprimir mb-3 flex items-center justify-between gap-2">
          <p className="text-title-lg text-white">Tarjeta {c.folio}</p>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded bg-primary-container px-4 py-2 text-title-md text-on-primary shadow-card hover:bg-primary">
              <Icono nombre="imprimir" size={16} className="text-secondary-fixed" /> Imprimir
            </button>
            <button onClick={onClose} className="rounded border border-white/40 px-4 py-2 text-title-md text-white hover:bg-white/10">Cerrar</button>
          </div>
        </div>
        <div className="documento-imprimible rounded-lg bg-white p-6 text-black shadow-modal">
          <p className="text-center font-serif text-[22px] font-semibold">Las Parotas</p>
          <p className="text-center text-[11px] uppercase tracking-widest">Club de Golf Huatulco · Cuponera de Green Fees</p>
          <div className="my-4 border-t border-dashed border-black/50" />
          <p className="text-[18px] font-semibold">{c.titular_nombre}</p>
          {c.empresa && <p className="text-[13px]">{c.empresa}</p>}
          <p className="mt-2 text-[13px]">
            {c.pases_total} pases · {modalidades(c)}
            <br />Vigente hasta el {fecha(c.vence_el)}
          </p>
          {c.fechas_bloqueadas.length > 0 && (
            <p className="mt-2 text-[11px]">
              No aplica: {c.fechas_bloqueadas.map((b) => `${b.desde}${b.hasta !== b.desde ? ` a ${b.hasta}` : ''}${b.motivo ? ` (${b.motivo})` : ''}`).join(' · ')}
            </p>
          )}
          <CodigoBarras valor={c.folio} alto={80} modulo={2} className="mt-4 w-full" />
          <p className="mt-3 text-center text-[11px]">
            Preséntela en recepción antes de salir al campo. Debe acompañar el titular o quien hizo la reserva.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- formulario
function sumarMeses(meses) {
  const d = new Date();
  d.setMonth(d.getMonth() + meses);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function Formulario({ inicial = null, onClose, onListo }) {
  const edita = Boolean(inicial);
  const [f, setF] = useState(() => ({
    titular_nombre: inicial?.titular_nombre || '',
    empresa: inicial?.empresa || '',
    telefono: inicial?.telefono || '',
    correo: inicial?.correo || '',
    pases_total: String(inicial?.pases_total ?? 50),
    hoyos_18: inicial?.hoyos_18 ?? true,
    hoyos_9: inicial?.hoyos_9 ?? false,
    precio_total: inicial ? String(Number(inicial.precio_total)) : '',
    precio_lista: inicial?.precio_lista != null ? String(Number(inicial.precio_lista)) : '',
    vence_el: inicial?.vence_el || sumarMeses(12),
    notas: inicial?.notas || '',
    pagada: false,
    pago_referencia: '',
    nota_cambio: '',
  }));
  const [bloqueos, setBloqueos] = useState(inicial?.fechas_bloqueadas || []);
  const [enviando, setEnviando] = useState(false);
  const poner = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const pases = Number(f.pases_total);
  const precio = Number(f.precio_total);
  const lista = f.precio_lista === '' ? null : Number(f.precio_lista);
  const descuento = lista && lista > 0 && precio >= 0 ? ((lista - precio) / lista) * 100 : null;
  const bloqueosOk = bloqueos.every((b) => b.desde && b.hasta && b.hasta >= b.desde);
  const listo =
    f.titular_nombre.trim().length >= 3 && Number.isInteger(pases) && pases >= 1 && f.precio_total !== '' && precio >= 0 &&
    (f.hoyos_18 || f.hoyos_9) && f.vence_el && bloqueosOk && (lista == null || precio <= lista) &&
    (edita ? f.nota_cambio.trim().length >= 3 : !f.pagada || f.pago_referencia.trim().length >= 3);

  async function enviar() {
    setEnviando(true);
    const comun = {
      titular_nombre: f.titular_nombre.trim(), empresa: f.empresa.trim() || null, telefono: f.telefono.trim() || null,
      correo: f.correo.trim() || null, pases_total: pases, hoyos_18: f.hoyos_18, hoyos_9: f.hoyos_9,
      precio_total: String(precio), precio_lista: lista == null ? null : String(lista), vence_el: f.vence_el,
      fechas_bloqueadas: bloqueos.map((b) => ({ desde: b.desde, hasta: b.hasta, motivo: b.motivo || null })),
      notas: f.notas.trim() || null,
    };
    try {
      const c = edita
        ? await cuponerasApi.actualizar(inicial.id, { ...comun, nota_cambio: f.nota_cambio.trim() })
        : await cuponerasApi.crear({ ...comun, pagada: f.pagada, pago_referencia: f.pagada ? f.pago_referencia.trim() : null });
      exito(edita ? 'Cuponera actualizada' : 'Cuponera registrada', edita ? '' : `Folio ${c.folio}`);
      onListo(c);
    } catch (err) {
      avisoError('No se pudo guardar', err.message);
      setEnviando(false);
    }
  }

  return (
    <Modal open title={edita ? `Editar ${inicial.folio}` : 'Nueva cuponera'} onClose={onClose} ancho="max-w-2xl"
      footer={<><button onClick={onClose} className={BOTON}>Cancelar</button>
        <button onClick={enviar} disabled={!listo || enviando} className={BOTON_FUERTE}>{edita ? 'Guardar cambios' : 'Registrar cuponera'}</button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className={ETIQUETA}>Titular</span><input value={f.titular_nombre} onChange={poner('titular_nombre')} className={CAMPO} /></label>
          <label><span className={ETIQUETA}>Empresa (opcional)</span><input value={f.empresa} onChange={poner('empresa')} className={CAMPO} /></label>
          <label><span className={ETIQUETA}>Teléfono (opcional)</span><input value={f.telefono} onChange={poner('telefono')} className={CAMPO} /></label>
          <label><span className={ETIQUETA}>Correo (opcional)</span><input type="email" value={f.correo} onChange={poner('correo')} className={CAMPO} /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label><span className={ETIQUETA}>Pases (Green Fees)</span><input type="number" min={1} value={f.pases_total} onChange={poner('pases_total')} className={CAMPO} data-testid="f-pases" /></label>
          <label><span className={ETIQUETA}>Precio total (MXN)</span><input type="number" min={0} value={f.precio_total} onChange={poner('precio_total')} className={CAMPO} data-testid="f-precio" /></label>
          <label><span className={ETIQUETA}>A tarifa normal (opcional)</span><input type="number" min={0} value={f.precio_lista} onChange={poner('precio_lista')} className={CAMPO} /></label>
        </div>
        <p className="text-body-md text-on-surface-variant">
          {pases > 0 && f.precio_total !== '' && `${mxn(precio / pases)} por pase`}
          {descuento != null && ` · descuento de ${descuento.toFixed(1)}%`}
          {lista != null && precio > lista && <span className="text-error"> · el precio no puede pasar de la tarifa normal</span>}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset>
            <span className={ETIQUETA}>Modalidades válidas</span>
            <label className="mr-4 inline-flex items-center gap-2 text-body-lg"><input type="checkbox" checked={f.hoyos_18} onChange={poner('hoyos_18')} /> 18 hoyos</label>
            <label className="inline-flex items-center gap-2 text-body-lg"><input type="checkbox" checked={f.hoyos_9} onChange={poner('hoyos_9')} /> 9 hoyos</label>
          </fieldset>
          <label><span className={ETIQUETA}>Vigente hasta</span><input type="date" value={f.vence_el} onChange={poner('vence_el')} className={CAMPO} /></label>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className={ETIQUETA}>Fechas en que no aplica</span>
            <button type="button" onClick={() => setBloqueos((b) => [...b, { desde: hoy(), hasta: hoy(), motivo: '' }])} className="text-body-md text-primary underline">Agregar</button>
          </div>
          {bloqueos.map((b, i) => (
            <div key={i} className="mt-1.5 flex flex-wrap items-center gap-2">
              <input type="date" value={b.desde} onChange={(e) => setBloqueos((l) => l.map((x, j) => j === i ? { ...x, desde: e.target.value } : x))} className={`${CAMPO} w-40`} />
              <span className="text-outline">a</span>
              <input type="date" value={b.hasta} min={b.desde} onChange={(e) => setBloqueos((l) => l.map((x, j) => j === i ? { ...x, hasta: e.target.value } : x))} className={`${CAMPO} w-40`} />
              <input value={b.motivo || ''} placeholder="Motivo" maxLength={80} onChange={(e) => setBloqueos((l) => l.map((x, j) => j === i ? { ...x, motivo: e.target.value } : x))} className={`${CAMPO} w-40 flex-1`} />
              <button type="button" onClick={() => setBloqueos((l) => l.filter((_, j) => j !== i))} className="text-body-md text-error">Quitar</button>
            </div>
          ))}
        </div>

        <label className="block"><span className={ETIQUETA}>Notas (opcional)</span><input value={f.notas} maxLength={500} onChange={poner('notas')} className={CAMPO} /></label>

        {edita ? (
          <label className="block">
            <span className={ETIQUETA}>Motivo del cambio</span>
            <input value={f.nota_cambio} maxLength={300} onChange={poner('nota_cambio')} className={CAMPO} />
          </label>
        ) : (
          <div className="rounded border border-outline-variant/60 bg-surface-container-low p-3">
            <label className="inline-flex items-center gap-2 text-body-lg">
              <input type="checkbox" checked={f.pagada} onChange={poner('pagada')} /> Ya se pagó por transferencia
            </label>
            {f.pagada ? (
              <label className="mt-2 block">
                <span className={ETIQUETA}>Referencia de la transferencia</span>
                <input value={f.pago_referencia} onChange={poner('pago_referencia')} className={CAMPO} />
              </label>
            ) : (
              <p className="mt-1 text-body-md text-on-surface-variant">Queda pendiente de pago y no se puede usar hasta confirmar la transferencia.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
