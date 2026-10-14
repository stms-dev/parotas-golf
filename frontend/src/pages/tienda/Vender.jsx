/**
 * Vender: el mostrador de la tienda.
 *
 * El lector de códigos de barras escribe el código y da Enter, así que el
 * buscador tiene el foco siempre. Un código exacto entra directo al ticket;
 * lo demás filtra la rejilla. Sin lector, se toca el producto.
 *
 * Atajos: F2 regresa al buscador, F9 cobra, Esc limpia la búsqueda.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { catalogApi, tiendaApi } from '../../api/client';
import Icono from '../../components/Icono';
import { Modal } from '../../components/ui';
import { confirmar, error as avisoError, notificar } from '../../utils/avisos';
import { mxn, usd } from '../../utils/format';
import { BOTON, BOTON_FUERTE, CAMPO, ETIQUETA, Existencia, METODOS, Ticket } from './comun';

export default function Vender({ caja, atiende, onCajaCambio, onAbrirCaja }) {
  const [productos, setProductos] = useState([]);
  const [categoria, setCategoria] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [carrito, setCarrito] = useState([]); // [{producto, cantidad}]
  const [cliente, setCliente] = useState('');
  const [conDescuento, setConDescuento] = useState(false);
  const [descuento, setDescuento] = useState('');
  const [motivoDescuento, setMotivoDescuento] = useState('');
  const [cobrando, setCobrando] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [tc, setTc] = useState(null);
  const [aviso, setAviso] = useState(null);
  const buscador = useRef(null);

  function cargar() {
    tiendaApi.productos().then(setProductos).catch(() => setProductos([]));
  }

  useEffect(() => {
    cargar();
    catalogApi.exchangeRate().then((r) => setTc(Number(r.rate))).catch(() => setTc(null));
    buscador.current?.focus();
  }, []);

  // Atajos de teclado del mostrador.
  useEffect(() => {
    function tecla(e) {
      if (e.key === 'F2') {
        e.preventDefault();
        buscador.current?.focus();
      }
      if (e.key === 'F9') {
        e.preventDefault();
        if (carrito.length && caja) setCobrando(true);
      }
    }
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [carrito.length, caja]);

  const categorias = useMemo(
    () => [...new Set(productos.map((p) => p.categoria))].sort(),
    [productos],
  );

  const visibles = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    return productos.filter(
      (p) =>
        (!categoria || p.categoria === categoria) &&
        (!t ||
          p.codigo.toLowerCase().includes(t) ||
          p.descripcion.toLowerCase().includes(t) ||
          (p.marca || '').toLowerCase().includes(t) ||
          (p.talla || '').toLowerCase().includes(t)),
    );
  }, [productos, busqueda, categoria]);

  const enCarrito = (id) => carrito.find((l) => l.producto.id === id)?.cantidad || 0;

  function agregar(producto, cantidad = 1) {
    setAviso(null);
    if (producto.precio == null) {
      setAviso(`${producto.descripcion} no tiene precio de venta. Póngale precio en Productos.`);
      return false;
    }
    const ya = enCarrito(producto.id);
    if (ya + cantidad > producto.existencia) {
      setAviso(
        producto.existencia <= 0
          ? `${producto.descripcion} está agotado.`
          : `Solo hay ${producto.existencia} de ${producto.descripcion}.`,
      );
      return false;
    }
    setCarrito((actual) => {
      const i = actual.findIndex((l) => l.producto.id === producto.id);
      if (i === -1) return [...actual, { producto, cantidad }];
      const copia = [...actual];
      copia[i] = { ...copia[i], cantidad: copia[i].cantidad + cantidad };
      return copia;
    });
    return true;
  }

  function cambiarCantidad(id, cantidad) {
    const linea = carrito.find((l) => l.producto.id === id);
    if (!linea) return;
    if (cantidad <= 0) {
      setCarrito((a) => a.filter((l) => l.producto.id !== id));
      return;
    }
    if (cantidad > linea.producto.existencia) {
      setAviso(`Solo hay ${linea.producto.existencia} de ${linea.producto.descripcion}.`);
      return;
    }
    setCarrito((a) => a.map((l) => (l.producto.id === id ? { ...l, cantidad } : l)));
  }

  async function escanear(e) {
    e.preventDefault();
    const codigo = busqueda.trim();
    if (!codigo) return;
    // "3*CODIGO" agrega tres de un jalón, como en cualquier caja.
    const m = codigo.match(/^(\d{1,3})\*(.+)$/);
    const cant = m ? Number(m[1]) : 1;
    const cod = m ? m[2].trim() : codigo;
    let p = productos.find((x) => x.codigo.toLowerCase() === cod.toLowerCase());
    if (!p) {
      try {
        p = await tiendaApi.porCodigo(cod);
        if (!p.activo) {
          setAviso(`${p.descripcion} está dado de baja.`);
          return;
        }
      } catch {
        // No es un código: se queda como búsqueda. Si solo hay un resultado, entra.
        if (visibles.length === 1) {
          if (agregar(visibles[0], cant)) setBusqueda('');
        }
        return;
      }
    }
    if (agregar(p, cant)) setBusqueda('');
  }

  const subtotal = carrito.reduce((t, l) => t + Number(l.producto.precio) * l.cantidad, 0);
  const montoDescuento = conDescuento ? Math.min(Number(descuento) || 0, subtotal) : 0;
  const total = Math.round((subtotal - montoDescuento) * 100) / 100;
  const piezas = carrito.reduce((t, l) => t + l.cantidad, 0);

  function limpiar() {
    setCarrito([]);
    setCliente('');
    setConDescuento(false);
    setDescuento('');
    setMotivoDescuento('');
    setAviso(null);
    buscador.current?.focus();
  }

  async function vaciar() {
    if (!carrito.length) return;
    const ok = await confirmar({ titulo: 'Vaciar el ticket', texto: 'Se quitan todos los productos.', confirmar: 'Sí, vaciar' });
    if (ok) limpiar();
  }

  function intentarCobrar() {
    if (!caja) {
      onAbrirCaja();
      return;
    }
    if (conDescuento && montoDescuento > 0 && motivoDescuento.trim().length < 3) {
      setAviso('Escriba el motivo del descuento.');
      return;
    }
    if (atiende.trim().length < 3) {
      setAviso('Escriba arriba quién atiende.');
      return;
    }
    setCobrando(true);
  }

  async function cobrar(pagos) {
    try {
      const venta = await tiendaApi.vender({
        lineas: carrito.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad })),
        pagos,
        descuento: montoDescuento,
        descuento_motivo: montoDescuento > 0 ? motivoDescuento.trim() : null,
        cliente: cliente.trim() || null,
        atendio: atiende.trim(),
      });
      setCobrando(false);
      limpiar();
      cargar();
      onCajaCambio();
      setTicket(venta);
      notificar(`Venta ${venta.folio} · ${mxn(venta.total)}`);
    } catch (err) {
      await avisoError('No se registró la venta', err.message);
    }
  }

  return (
    <div className="grid gap-gutter xl:grid-cols-12">
      {/* ----------------------------------------------------- catálogo */}
      <section className="space-y-4 xl:col-span-7 2xl:col-span-8">
        <form onSubmit={escanear} className="relative">
          <Icono nombre="codigoBarras" size={22} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-secondary" />
          <input
            ref={buscador}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setBusqueda('')}
            placeholder="Escanee el código o busque por nombre, marca o talla"
            className="w-full rounded-lg border-2 border-primary-container/40 bg-surface-container-lowest py-4 pl-14 pr-28 text-title-lg text-on-surface shadow-card placeholder:text-outline focus:border-primary-container focus:outline-none"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded border border-outline-variant px-2 py-0.5 font-mono text-label-sm text-outline">
            F2
          </span>
        </form>

        <div className="flex flex-wrap gap-2">
          {['', ...categorias].map((c) => (
            <button
              key={c || 'todas'}
              type="button"
              onClick={() => setCategoria(c)}
              className={`rounded-full border px-4 py-1.5 text-title-md transition ${
                categoria === c
                  ? 'border-primary-container bg-primary-container text-on-primary'
                  : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              {c || 'Todas'}
            </button>
          ))}
        </div>

        {aviso && (
          <p className="flex items-center justify-between gap-3 rounded border border-estado-pend-border bg-estado-pend-bg px-4 py-2.5 text-body-lg text-estado-pend-text">
            {aviso}
            <button type="button" onClick={() => setAviso(null)} className="text-xl leading-none">×</button>
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visibles.map((p) => {
            const sinPrecio = p.precio == null;
            const agotado = p.existencia - enCarrito(p.id) <= 0;
            const cuantos = enCarrito(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => agregar(p)}
                disabled={sinPrecio || agotado}
                className={`group relative flex min-h-[132px] flex-col rounded-lg border bg-surface-container-lowest p-3.5 text-left shadow-card transition ${
                  cuantos
                    ? 'border-primary-container ring-2 ring-primary-container/25'
                    : 'border-outline-variant/50 hover:border-primary-container/60 hover:shadow-modal'
                } disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:shadow-card`}
              >
                {cuantos > 0 && (
                  <span className="absolute -right-2 -top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-primary-container px-1.5 font-mono text-label-md text-on-primary shadow-card">
                    {cuantos}
                  </span>
                )}
                <span className="text-label-sm uppercase tracking-wider text-secondary">{p.categoria}</span>
                <span className="mt-0.5 line-clamp-2 text-title-md leading-snug text-primary">{p.descripcion}</span>
                <span className="mt-0.5 truncate text-body-md text-outline">
                  {[p.marca, p.talla].filter(Boolean).join(' · ') || p.codigo}
                </span>
                <span className="mt-auto flex items-end justify-between gap-2 pt-2.5">
                  <span className={`font-serif text-headline-md leading-none ${sinPrecio ? 'text-outline' : 'text-primary'}`}>
                    {sinPrecio ? 'Sin precio' : mxn(p.precio)}
                  </span>
                  <Existencia producto={p} />
                </span>
              </button>
            );
          })}
          {!visibles.length && (
            <p className="col-span-full rounded-lg border border-dashed border-outline-variant p-8 text-center text-body-lg text-outline">
              {productos.length ? 'Nada coincide con la búsqueda.' : 'Todavía no hay productos. Dé de alta en Productos.'}
            </p>
          )}
        </div>
      </section>

      {/* -------------------------------------------------------- ticket */}
      <aside className="xl:col-span-5 2xl:col-span-4">
        <div className="sticky top-4 overflow-hidden rounded-lg bg-primary-container text-on-primary shadow-modal">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-label-sm uppercase tracking-wider text-secondary-fixed">Venta en curso</p>
              <p className="font-serif text-headline-lg leading-tight">Ticket</p>
            </div>
            <button
              type="button"
              onClick={vaciar}
              disabled={!carrito.length}
              className="flex items-center gap-1.5 rounded border border-white/20 px-3 py-1.5 text-label-md text-primary-fixed transition hover:bg-white/10 disabled:opacity-40"
            >
              <Icono nombre="basura" size={15} /> Vaciar
            </button>
          </div>

          <div className="max-h-[42vh] min-h-[140px] overflow-y-auto px-5 py-3">
            {!carrito.length ? (
              <div className="flex h-[120px] flex-col items-center justify-center text-center text-primary-fixed/70">
                <Icono nombre="carrito" size={28} />
                <p className="mt-2 text-body-lg">Escanee o toque un producto</p>
              </div>
            ) : (
              <ul className="divide-y divide-white/10">
                {carrito.map((l) => (
                  <li key={l.producto.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-body-lg leading-snug">{l.producto.descripcion}</p>
                      <p className="shrink-0 font-mono text-title-md">{mxn(Number(l.producto.precio) * l.cantidad)}</p>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="font-mono text-label-md text-primary-fixed/80">
                        {mxn(l.producto.precio)} c/u
                      </span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => cambiarCantidad(l.producto.id, l.cantidad - 1)} className="flex h-7 w-7 items-center justify-center rounded border border-white/20 hover:bg-white/10" aria-label="Uno menos">
                          <Icono nombre="menos" size={14} />
                        </button>
                        <input
                          value={l.cantidad}
                          onChange={(e) => cambiarCantidad(l.producto.id, Number(e.target.value.replace(/\D/g, '')) || 0)}
                          className="h-7 w-11 rounded border border-white/20 bg-transparent text-center font-mono text-title-md focus:border-secondary-fixed focus:outline-none"
                        />
                        <button type="button" onClick={() => cambiarCantidad(l.producto.id, l.cantidad + 1)} className="flex h-7 w-7 items-center justify-center rounded border border-white/20 hover:bg-white/10" aria-label="Uno más">
                          <Icono nombre="add" size={14} />
                        </button>
                        <button type="button" onClick={() => cambiarCantidad(l.producto.id, 0)} className="ml-1 flex h-7 w-7 items-center justify-center rounded text-primary-fixed/70 hover:bg-white/10 hover:text-white" aria-label="Quitar">
                          <Icono nombre="basura" size={14} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2.5 border-t border-white/10 px-5 py-4">
            <input
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Cliente (opcional)"
              className="w-full rounded border border-white/20 bg-white/5 px-3 py-2 text-body-lg text-on-primary placeholder:text-primary-fixed/50 focus:border-secondary-fixed focus:outline-none"
            />
            <label className="flex cursor-pointer items-center gap-2 text-body-md text-primary-fixed">
              <input type="checkbox" checked={conDescuento} onChange={(e) => setConDescuento(e.target.checked)} className="accent-secondary-fixed" />
              Aplicar descuento
            </label>
            {conDescuento && (
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <input
                  value={descuento}
                  onChange={(e) => setDescuento(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="$ monto"
                  inputMode="decimal"
                  className="rounded border border-white/20 bg-white/5 px-3 py-2 font-mono text-body-lg text-on-primary placeholder:text-primary-fixed/50 focus:border-secondary-fixed focus:outline-none"
                />
                <input
                  value={motivoDescuento}
                  onChange={(e) => setMotivoDescuento(e.target.value)}
                  placeholder="Motivo del descuento"
                  className="rounded border border-white/20 bg-white/5 px-3 py-2 text-body-lg text-on-primary placeholder:text-primary-fixed/50 focus:border-secondary-fixed focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="bg-black/15 px-5 py-4">
            <div className="flex justify-between text-body-lg text-primary-fixed">
              <span>Subtotal · {piezas} pza{piezas === 1 ? '' : 's'}</span>
              <span className="font-mono">{mxn(subtotal)}</span>
            </div>
            {montoDescuento > 0 && (
              <div className="flex justify-between text-body-lg text-secondary-fixed">
                <span>Descuento</span>
                <span className="font-mono">−{mxn(montoDescuento)}</span>
              </div>
            )}
            <div className="mt-1.5 flex items-end justify-between">
              <span className="text-label-md uppercase tracking-wider text-secondary-fixed">Total</span>
              <span className="font-serif text-[2.6rem] leading-none">{mxn(total)}</span>
            </div>
            {tc ? <p className="text-right font-mono text-label-md text-primary-fixed/70">≈ {usd(total / tc)} · TC {tc.toFixed(2)}</p> : null}
            <button
              type="button"
              onClick={intentarCobrar}
              disabled={!carrito.length}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-secondary-fixed px-5 py-4 text-title-lg font-semibold text-primary shadow-card transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icono nombre="pago" size={20} />
              {caja ? `Cobrar ${mxn(total)}` : 'Abrir caja para cobrar'}
              {caja && <span className="ml-1 rounded border border-primary/30 px-1.5 font-mono text-label-sm">F9</span>}
            </button>
          </div>
        </div>
      </aside>

      {cobrando && (
        <Cobro total={total} tc={tc} onCancelar={() => setCobrando(false)} onCobrar={cobrar} />
      )}
      {ticket && (
        <Ticket
          venta={ticket}
          onCerrar={() => {
            setTicket(null);
            buscador.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/* ================================================================ cobro */
const BILLETES = [100, 200, 500, 1000];

function Cobro({ total, tc, onCancelar, onCobrar }) {
  const [modo, setModo] = useState('EFECTIVO'); // EFECTIVO | TARJETA | TRANSFERENCIA | MIXTO
  const [moneda, setMoneda] = useState('MXN');
  const [recibido, setRecibido] = useState('');
  const [referencia, setReferencia] = useState('');
  const [mixtos, setMixtos] = useState([
    { metodo: 'TARJETA', moneda: 'MXN', monto: '' },
    { metodo: 'EFECTIVO', moneda: 'MXN', monto: '' },
  ]);
  const [enviando, setEnviando] = useState(false);
  const montoRef = useRef(null);

  useEffect(() => {
    montoRef.current?.focus();
  }, [modo, moneda]);

  const aMxn = (monto, mon) => Number(monto || 0) * (mon === 'USD' ? tc || 0 : 1);
  const redondo = (n) => Math.round(n * 100) / 100;

  let pagos = [];
  if (modo === 'EFECTIVO') pagos = [{ metodo: 'EFECTIVO', moneda, monto: Number(recibido || 0) }];
  if (modo === 'TARJETA' || modo === 'TRANSFERENCIA')
    pagos = [{ metodo: modo, moneda: 'MXN', monto: total, referencia: referencia.trim() || null }];
  if (modo === 'MIXTO')
    pagos = mixtos.filter((p) => Number(p.monto) > 0).map((p) => ({ ...p, monto: Number(p.monto) }));

  const entrante = redondo(pagos.reduce((t, p) => t + aMxn(p.monto, p.moneda), 0));
  const noEfectivo = redondo(pagos.filter((p) => p.metodo !== 'EFECTIVO').reduce((t, p) => t + aMxn(p.monto, p.moneda), 0));
  const falta = redondo(Math.max(total - entrante, 0));
  const cambio = redondo(Math.max(entrante - total, 0));
  const excede = noEfectivo > total + 0.001;
  const valido = pagos.length > 0 && falta === 0 && !excede;
  const totalUsd = tc ? Math.ceil((total / tc) * 100) / 100 : null;

  async function enviar() {
    if (!valido || enviando) return;
    setEnviando(true);
    await onCobrar(pagos);
    setEnviando(false);
  }

  return (
    <Modal
      open
      title={`Cobrar ${mxn(total)}`}
      onClose={onCancelar}
      footer={
        <>
          <button type="button" onClick={onCancelar} className={BOTON}>Cancelar</button>
          <button type="button" onClick={enviar} disabled={!valido || enviando} className={BOTON_FUERTE}>
            <Icono nombre="verificado" size={17} className="text-secondary-fixed" />
            {enviando ? 'Registrando…' : cambio > 0 ? `Cobrar · cambio ${mxn(cambio)}` : 'Cobrar'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-4 gap-1.5">
        {['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'MIXTO'].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModo(m)}
            className={`rounded border px-2 py-2.5 text-title-md transition ${
              modo === m
                ? 'border-primary-container bg-primary-container text-on-primary'
                : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
            }`}
          >
            {m === 'MIXTO' ? 'Mixto' : METODOS[m]}
          </button>
        ))}
      </div>

      {modo === 'EFECTIVO' && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-1.5">
            {['MXN', 'USD'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMoneda(m);
                  setRecibido('');
                }}
                className={`rounded border px-4 py-1.5 font-mono text-label-md ${
                  moneda === m ? 'border-primary-container bg-primary-fixed/40 text-primary' : 'border-outline-variant text-on-surface-variant'
                }`}
              >
                {m}
              </button>
            ))}
            {moneda === 'USD' && totalUsd && (
              <span className="self-center text-body-md text-outline">Total en dólares: {usd(totalUsd)} · TC {tc.toFixed(2)}</span>
            )}
          </div>
          <label className="block">
            <span className={ETIQUETA}>Recibido ({moneda})</span>
            <input
              ref={montoRef}
              value={recibido}
              onChange={(e) => setRecibido(e.target.value.replace(/[^\d.]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && enviar()}
              inputMode="decimal"
              className={`${CAMPO} py-3 font-mono text-headline-md`}
              placeholder="0.00"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setRecibido(String(moneda === 'USD' ? totalUsd : total))} className={BOTON}>
              Exacto
            </button>
            {(moneda === 'USD' ? [20, 50, 100] : BILLETES).map((b) => (
              <button
                key={b}
                type="button"
                title="Suma este billete a lo recibido"
                onClick={() => setRecibido(String(Math.round((Number(recibido || 0) + b) * 100) / 100))}
                className={BOTON}
              >
                +{moneda === 'USD' ? usd(b) : mxn(b).replace('.00', '')}
              </button>
            ))}
            {recibido !== '' && (
              <button type="button" onClick={() => setRecibido('')} className={`${BOTON} text-outline`}>
                Borrar
              </button>
            )}
          </div>
        </div>
      )}

      {(modo === 'TARJETA' || modo === 'TRANSFERENCIA') && (
        <div className="mt-4 space-y-3">
          <p className="rounded border border-outline-variant/60 bg-surface-container-low px-4 py-3 text-body-lg">
            Se cobra exacto: <strong className="font-mono">{mxn(total)}</strong>
            {modo === 'TARJETA' ? ' en la terminal bancaria.' : ' por transferencia.'}
          </p>
          <label className="block">
            <span className={ETIQUETA}>{modo === 'TARJETA' ? 'Autorización / últimos 4 (opcional)' : 'Referencia (opcional)'}</span>
            <input
              ref={montoRef}
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && enviar()}
              className={CAMPO}
            />
          </label>
        </div>
      )}

      {modo === 'MIXTO' && (
        <div className="mt-4 space-y-2">
          {mixtos.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_1fr_32px] gap-1.5">
              <select
                value={p.metodo}
                onChange={(e) => setMixtos((a) => a.map((x, j) => (j === i ? { ...x, metodo: e.target.value } : x)))}
                className={CAMPO}
              >
                {Object.entries(METODOS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <select
                value={p.moneda}
                onChange={(e) => setMixtos((a) => a.map((x, j) => (j === i ? { ...x, moneda: e.target.value } : x)))}
                className={CAMPO}
              >
                <option>MXN</option>
                <option>USD</option>
              </select>
              <input
                ref={i === 0 ? montoRef : undefined}
                value={p.monto}
                onChange={(e) => setMixtos((a) => a.map((x, j) => (j === i ? { ...x, monto: e.target.value.replace(/[^\d.]/g, '') } : x)))}
                placeholder="0.00"
                inputMode="decimal"
                className={`${CAMPO} font-mono`}
              />
              <button
                type="button"
                onClick={() => setMixtos((a) => a.filter((_, j) => j !== i))}
                disabled={mixtos.length <= 1}
                className="flex items-center justify-center rounded text-outline hover:text-error disabled:opacity-30"
                aria-label="Quitar"
              >
                <Icono nombre="basura" size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setMixtos((a) => [...a, { metodo: 'EFECTIVO', moneda: 'MXN', monto: '' }])}
            className={BOTON}
          >
            <Icono nombre="add" size={14} /> Otra forma de pago
          </button>
        </div>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
        <div className="rounded border border-outline-variant/50 bg-surface-container-low p-2.5">
          <dt className="text-label-sm uppercase tracking-wider text-on-surface-variant">Recibido</dt>
          <dd className="font-mono text-title-lg">{mxn(entrante)}</dd>
        </div>
        <div className={`rounded border p-2.5 ${falta > 0 ? 'border-estado-cancel-border bg-estado-cancel-bg text-estado-cancel-text' : 'border-outline-variant/50 bg-surface-container-low'}`}>
          <dt className="text-label-sm uppercase tracking-wider">Falta</dt>
          <dd className="font-mono text-title-lg">{mxn(falta)}</dd>
        </div>
        <div className={`rounded border p-2.5 ${cambio > 0 ? 'border-estado-ok-border bg-estado-ok-bg text-estado-ok-text' : 'border-outline-variant/50 bg-surface-container-low'}`}>
          <dt className="text-label-sm uppercase tracking-wider">Cambio</dt>
          <dd className="font-mono text-title-lg">{mxn(cambio)}</dd>
        </div>
      </dl>
      {excede && (
        <p className="mt-2 text-body-md text-error">
          Con tarjeta o transferencia se cobra exacto; el cambio solo sale del efectivo.
        </p>
      )}
    </Modal>
  );
}
