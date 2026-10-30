/**
 * Ventas: lo que se ha vendido, con su ticket. Reimprimir y cancelar.
 *
 * Cancelar solo se puede mientras la caja del día siga abierta: la venta se
 * marca cancelada (no se borra) y las piezas regresan al inventario.
 */
import { useEffect, useMemo, useState } from 'react';

import { tiendaApi } from '../../api/client';
import Icono from '../../components/Icono';
import { Modal, Paginador, usePaginacion } from '../../components/ui';
import { error as avisoError, notificar } from '../../utils/avisos';
import { fechaHora, hoy, mxn } from '../../utils/format';
import { BOTON, BOTON_FUERTE, CAMPO, Cifra, ETIQUETA, EstadoVenta, METODOS, TARJETA, Ticket, plural } from './comun';

export default function Ventas({ caja, atiende, onCajaCambio }) {
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [estado, setEstado] = useState('');
  const [termino, setTermino] = useState('');
  const [ventas, setVentas] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [cancelando, setCancelando] = useState(null);
  const pag = usePaginacion(ventas || [], 12, `${desde}|${hasta}|${estado}|${termino}`);

  async function cargar() {
    setVentas(null);
    try {
      setVentas(await tiendaApi.ventas({ desde, hasta, estado: estado || undefined, q: termino.trim() || undefined }));
    } catch (err) {
      avisoError('No se cargaron las ventas', err.message);
      setVentas([]);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, estado]);

  const totales = useMemo(() => {
    const pagadas = (ventas || []).filter((v) => v.estado === 'PAGADA');
    return {
      cuenta: pagadas.length,
      total: pagadas.reduce((t, v) => t + Number(v.total), 0),
      piezas: pagadas.reduce((t, v) => t + v.piezas, 0),
      canceladas: (ventas || []).length - pagadas.length,
    };
  }, [ventas]);

  return (
    <div className="space-y-gutter">
      <section className={`${TARJETA} p-4`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            cargar();
          }}
          className="flex flex-wrap items-end gap-2.5"
        >
          <label>
            <span className={ETIQUETA}>Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={CAMPO} />
          </label>
          <label>
            <span className={ETIQUETA}>Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={CAMPO} />
          </label>
          <label>
            <span className={ETIQUETA}>Estado</span>
            <select value={estado} onChange={(e) => setEstado(e.target.value)} className={CAMPO}>
              <option value="">Todas</option>
              <option value="PAGADA">Pagadas</option>
              <option value="CANCELADA">Canceladas</option>
            </select>
          </label>
          <label className="min-w-[220px] flex-1">
            <span className={ETIQUETA}>Folio, cliente o quién atendió</span>
            <input value={termino} onChange={(e) => setTermino(e.target.value)} placeholder="PS-000123" className={CAMPO} />
          </label>
          <button type="submit" className={BOTON}>
            <Icono nombre="buscar" size={15} /> Buscar
          </button>
          <button
            type="button"
            className={BOTON}
            onClick={() => {
              setDesde(hoy());
              setHasta(hoy());
              setTermino('');
              setEstado('');
            }}
          >
            Hoy
          </button>
        </form>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Cifra label="Vendido" valor={mxn(totales.total)} pie={plural(totales.cuenta, 'venta')} oscuro />
        <Cifra label="Piezas" valor={totales.piezas} />
        <Cifra label="Ticket promedio" valor={mxn(totales.cuenta ? totales.total / totales.cuenta : 0)} />
        <Cifra label="Canceladas" valor={totales.canceladas} tono={totales.canceladas ? 'text-error' : undefined} />
      </section>

      <section className={TARJETA}>
        <div className="overflow-x-auto">
        <table className="tabla-lineas min-w-[900px] text-left">
          <thead>
            <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
              <th className="px-4 py-3">Folio</th>
              <th className="px-3 py-3">Fecha</th>
              <th className="px-3 py-3">Productos</th>
              <th className="px-3 py-3">Pago</th>
              <th className="px-3 py-3">Atendió</th>
              <th className="px-3 py-3 text-right">Total</th>
              <th className="px-3 py-3">Estado</th>
              <th className="px-4 py-3 text-right" />
            </tr>
          </thead>
          <tbody>
            {ventas === null && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-body-lg text-outline">Cargando…</td>
              </tr>
            )}
            {pag.visibles.map((v) => {
              const puedeCancelar = v.estado === 'PAGADA' && caja && v.corte_id === caja.id;
              return (
                <tr key={v.id} className={`align-top ${v.estado === 'CANCELADA' ? 'opacity-70' : ''}`}>
                  <td className="px-4 py-3 font-mono text-title-md text-primary">{v.folio}</td>
                  <td className="px-3 py-3 text-body-md">{fechaHora(v.created_at)}</td>
                  <td className="max-w-[280px] px-3 py-3 text-body-md">
                    <p className="truncate">{v.lineas.map((l) => `${l.cantidad}× ${l.descripcion}`).join(', ')}</p>
                    {v.cliente && <p className="text-label-md text-outline">{v.cliente}</p>}
                  </td>
                  <td className="px-3 py-3 text-body-md">
                    {[...new Set(v.pagos.map((p) => METODOS[p.metodo] + (p.moneda === 'USD' ? ' USD' : '')))].join(' + ')}
                  </td>
                  <td className="px-3 py-3 text-body-md">{v.atendio}</td>
                  <td className={`px-3 py-3 text-right font-mono text-title-md ${v.estado === 'CANCELADA' ? 'text-outline line-through' : ''}`}>
                    {mxn(v.total)}
                  </td>
                  <td className="px-3 py-3"><EstadoVenta estado={v.estado} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setTicket(v)}
                        className="flex items-center gap-1 rounded border border-outline-variant/60 px-2 py-1 text-label-md text-on-surface-variant transition hover:border-primary-container hover:text-primary"
                      >
                        <Icono nombre="imprimir" size={14} /> Ticket
                      </button>
                      {puedeCancelar && (
                        <button
                          type="button"
                          onClick={() => setCancelando(v)}
                          className="flex items-center gap-1 rounded border border-estado-cancel-border px-2 py-1 text-label-md text-estado-cancel-text transition hover:bg-estado-cancel-bg"
                        >
                          <Icono nombre="cancelar" size={14} /> Cancelar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {ventas && !ventas.length && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-body-lg text-outline">Sin ventas en esas fechas.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <Paginador pag={pag} etiqueta="ventas" />
      </section>

      <p className="text-body-md text-outline">
        Una venta solo se cancela mientras su caja sigue abierta. Para una devolución de otro día, registre una entrada de
        mercancía en Productos con el folio en la nota.
      </p>

      {ticket && <Ticket venta={ticket} onCerrar={() => setTicket(null)} />}
      {cancelando && (
        <Cancelar
          venta={cancelando}
          atiende={atiende}
          onCerrar={() => setCancelando(null)}
          onListo={() => {
            setCancelando(null);
            cargar();
            onCajaCambio?.();
          }}
        />
      )}
    </div>
  );
}

function Cancelar({ venta, atiende, onCerrar, onListo }) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const efectivo = venta.pagos
    .filter((p) => p.metodo === 'EFECTIVO')
    .reduce((t, p) => t + Number(p.monto_mxn), 0) - Number(venta.cambio_mxn || 0);

  async function cancelar() {
    if (atiende.trim().length < 3) return avisoError('¿Quién cancela?', 'Escriba arriba quién atiende.');
    setGuardando(true);
    try {
      await tiendaApi.cancelar(venta.id, { motivo: motivo.trim(), atendio: atiende.trim() });
      notificar(`Venta ${venta.folio} cancelada`);
      onListo();
    } catch (err) {
      avisoError('No se canceló', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open
      title={`Cancelar ${venta.folio}`}
      onClose={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className={BOTON}>No cancelar</button>
          <button
            type="button"
            onClick={cancelar}
            disabled={guardando || motivo.trim().length < 3}
            className={`${BOTON_FUERTE} bg-error hover:bg-error`}
          >
            {guardando ? 'Cancelando…' : 'Sí, cancelar venta'}
          </button>
        </>
      }
    >
      <ul className="divide-y divide-outline-variant/40 rounded border border-outline-variant/50">
        {venta.lineas.map((l) => (
          <li key={l.id} className="flex justify-between px-3 py-2 text-body-lg">
            <span>{l.cantidad}× {l.descripcion}</span>
            <span className="font-mono">{mxn(l.total)}</span>
          </li>
        ))}
      </ul>
      {Number(venta.iva_monto) > 0 && (
        <p className="mt-3 text-body-md text-on-surface-variant">
          Neto {mxn(venta.total_neto)} + IVA {Number(venta.iva_pct)}% {mxn(venta.iva_monto)}
        </p>
      )}
      <p className="mt-3 text-body-lg">
        Total <strong className="font-mono">{mxn(venta.total)}</strong>. Las piezas regresan al inventario.
        {efectivo > 0 && <> Devuelva <strong className="font-mono">{mxn(efectivo)}</strong> en efectivo al cliente.</>}
      </p>
      <label className="mt-4 block">
        <span className={ETIQUETA}>Motivo (obligatorio)</span>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CAMPO} autoFocus />
      </label>
    </Modal>
  );
}
