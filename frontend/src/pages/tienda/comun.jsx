/**
 * Piezas compartidas de la tienda: estilos, cifras, el ticket imprimible.
 */
import { useEffect, useState } from 'react';

import Icono from '../../components/Icono';
import { fechaHora, mxn, usd } from '../../utils/format';

export const CAMPO =
  'w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-lg text-on-surface focus:border-primary-container focus:outline-none';
export const ETIQUETA = 'mb-1 block text-label-sm uppercase tracking-wider text-on-surface-variant';
export const BOTON =
  'flex items-center justify-center gap-1.5 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-title-md text-on-surface transition hover:bg-surface-container-low disabled:opacity-50';
export const BOTON_FUERTE =
  'flex items-center justify-center gap-2 rounded bg-primary-container px-4 py-2.5 text-title-md text-on-primary shadow-card transition hover:bg-primary disabled:cursor-not-allowed disabled:bg-surface-container-highest disabled:text-outline disabled:shadow-none';
export const TARJETA = 'rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card';

export const METODOS = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
};

/** "1 venta", "3 ventas". */
export const plural = (n, palabra) => `${n} ${palabra}${Number(n) === 1 ? '' : 's'}`;

/** Quién está atendiendo: la cuenta la comparten los turnos. */
export function useAtiende() {
  const [atiende, setAtiende] = useState(() => {
    try {
      return localStorage.getItem('ultimo_atendio') || '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('ultimo_atendio', atiende.trim());
    } catch {
      /* almacenamiento bloqueado */
    }
  }, [atiende]);
  return [atiende, setAtiende];
}

export function Cifra({ label, valor, pie, tono, oscuro }) {
  return (
    <div
      className={`rounded-lg border p-4 shadow-card ${
        oscuro
          ? 'border-primary-container bg-primary-container text-on-primary'
          : 'border-outline-variant/50 bg-surface-container-lowest'
      }`}
    >
      <p className={`text-label-sm uppercase tracking-wider ${oscuro ? 'text-secondary-fixed' : 'text-on-surface-variant'}`}>
        {label}
      </p>
      <p className={`mt-0.5 font-serif text-headline-lg leading-tight ${oscuro ? 'text-on-primary' : tono || 'text-primary'}`}>
        {valor}
      </p>
      {pie && <p className={`text-body-md ${oscuro ? 'text-primary-fixed' : 'text-outline'}`}>{pie}</p>}
    </div>
  );
}

export function Existencia({ producto }) {
  const n = producto.existencia;
  const tono =
    n <= 0
      ? 'bg-estado-cancel-bg text-estado-cancel-text border-estado-cancel-border'
      : producto.por_surtir
        ? 'bg-estado-pend-bg text-estado-pend-text border-estado-pend-border'
        : 'bg-estado-ok-bg text-estado-ok-text border-estado-ok-border';
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-label-md ${tono}`}>
      {n <= 0 ? 'Agotado' : `${n} pza${n === 1 ? '' : 's'}`}
    </span>
  );
}

export function EstadoVenta({ estado }) {
  return estado === 'CANCELADA' ? (
    <span className="rounded border border-estado-cancel-border bg-estado-cancel-bg px-2 py-0.5 text-label-sm uppercase tracking-wider text-estado-cancel-text">
      Cancelada
    </span>
  ) : (
    <span className="rounded border border-estado-ok-border bg-estado-ok-bg px-2 py-0.5 text-label-sm uppercase tracking-wider text-estado-ok-text">
      Pagada
    </span>
  );
}

/**
 * El ticket de la venta, listo para la impresora térmica (80 mm) o una hoja.
 * La regla `@media print` de styles.css imprime solo `.documento-imprimible`.
 */
export function Ticket({ venta, onCerrar }) {
  if (!venta) return null;
  const pagado = venta.pagos.reduce((t, p) => t + Number(p.monto_mxn), 0);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4">
      <div className="my-4 w-full max-w-sm">
        <div className="no-imprimir mb-3 flex items-center justify-between gap-2">
          <p className="text-title-lg text-white">Ticket {venta.folio}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded bg-primary-container px-4 py-2 text-title-md text-on-primary shadow-card transition hover:bg-primary"
            >
              <Icono nombre="imprimir" size={16} className="text-secondary-fixed" /> Imprimir
            </button>
            <button
              type="button"
              onClick={onCerrar}
              className="rounded border border-white/40 px-4 py-2 text-title-md text-white transition hover:bg-white/10"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="documento-imprimible ticket rounded-lg bg-white p-6 font-mono text-[12.5px] leading-snug text-black shadow-modal">
          <div className="text-center">
            <p className="font-serif text-[18px] font-semibold">Las Parotas</p>
            <p className="text-[11px] uppercase tracking-widest">Pro-Shop · Club de Golf Huatulco</p>
            <p className="mt-1 text-[11px]">Bahías de Huatulco, Oaxaca</p>
          </div>
          <div className="my-3 border-t border-dashed border-black/50" />
          <div className="flex justify-between"><span>Ticket</span><span className="font-semibold">{venta.folio}</span></div>
          <div className="flex justify-between"><span>Fecha</span><span>{fechaHora(venta.created_at)}</span></div>
          <div className="flex justify-between"><span>Atendió</span><span>{venta.atendio}</span></div>
          {venta.cliente && <div className="flex justify-between"><span>Cliente</span><span>{venta.cliente}</span></div>}
          <div className="my-3 border-t border-dashed border-black/50" />

          {venta.lineas.map((l) => (
            <div key={l.id} className="mb-1.5">
              <p className="uppercase">{l.descripcion}</p>
              <div className="flex justify-between text-black/75">
                <span>
                  {l.cantidad} × {mxn(l.precio_unitario)}
                </span>
                <span className="text-black">{mxn(l.total)}</span>
              </div>
            </div>
          ))}

          <div className="my-3 border-t border-dashed border-black/50" />
          <div className="flex justify-between"><span>Subtotal</span><span>{mxn(venta.subtotal)}</span></div>
          {Number(venta.descuento) > 0 && (
            <div className="flex justify-between">
              <span>Descuento</span>
              <span>−{mxn(venta.descuento)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between text-[15px] font-semibold">
            <span>TOTAL</span>
            <span>{mxn(venta.total)}</span>
          </div>
          <p className="text-right text-[11px] text-black/70">{venta.piezas} pieza{venta.piezas === 1 ? '' : 's'}</p>

          <div className="my-3 border-t border-dashed border-black/50" />
          {venta.pagos.map((p) => (
            <div key={p.id} className="flex justify-between">
              <span>
                {METODOS[p.metodo]} {p.moneda === 'USD' ? `${usd(p.monto)} @ ${Number(p.tipo_cambio).toFixed(2)}` : ''}
              </span>
              <span>{mxn(p.monto_mxn)}</span>
            </div>
          ))}
          <div className="flex justify-between"><span>Recibido</span><span>{mxn(pagado)}</span></div>
          {Number(venta.cambio_mxn) > 0 && (
            <div className="flex justify-between font-semibold"><span>Cambio</span><span>{mxn(venta.cambio_mxn)}</span></div>
          )}

          {venta.estado === 'CANCELADA' && (
            <p className="mt-3 border border-black p-1.5 text-center font-semibold uppercase">
              Venta cancelada · {venta.motivo_cancelacion}
            </p>
          )}
          <div className="my-3 border-t border-dashed border-black/50" />
          <p className="text-center text-[11px]">¡Gracias por su compra!</p>
          <p className="text-center text-[10px] text-black/60">Comprobante interno, no fiscal.</p>
        </div>
      </div>
    </div>
  );
}
