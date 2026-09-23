/**
 * Inventario del Pro-Shop.
 *
 * Simple a propósito: buscar un producto (a mano o con el lector de código de
 * barras), ver cuánto hay y moverlo. La existencia nunca se escribe directo:
 * sale de las entradas, salidas y ajustes, y cada uno queda con quién lo hizo.
 *
 * El lector de código de barras funciona como un teclado que escribe el código
 * y da Enter: por eso el buscador tiene el foco al entrar y, si el código
 * coincide exacto con un producto, lo abre solo.
 */
import { useEffect, useRef, useState } from 'react';

import { inventoryApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Alert, Spinner } from '../components/ui';
import Icono from '../components/Icono';
import { error as avisoError, exito } from '../utils/avisos';
import { fechaHora, mxn } from '../utils/format';

const CATEGORIAS = ['Pelotas', 'Guantes', 'Gorras', 'Playeras', 'Bermudas', 'Toallas', 'Accesorios'];

const TIPOS = {
  ENTRADA: { texto: 'Entrada', ayuda: 'Llegó mercancía', signo: '+' },
  SALIDA: { texto: 'Salida', ayuda: 'Se vendió o se usó', signo: '−' },
  AJUSTE: { texto: 'Ajuste por conteo', ayuda: 'Lo que hay de verdad en el anaquel', signo: '=' },
};

export default function InventoryPage() {
  const { can } = useAuth();
  const puedeMover = can('inventory:manage');

  const [items, setItems] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [term, setTerm] = useState('');
  const [categoria, setCategoria] = useState('');
  const [soloPorSurtir, setSoloPorSurtir] = useState(false);
  const [abierto, setAbierto] = useState(null);
  const [alta, setAlta] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const buscador = useRef(null);

  async function cargar(conSpinner = true) {
    if (conSpinner) setLoading(true);
    setError(null);
    try {
      const [lista, res] = await Promise.all([
        inventoryApi.items({
          term: term.trim() || undefined,
          category: categoria || undefined,
          por_surtir: soloPorSurtir || undefined,
        }),
        inventoryApi.summary(),
      ]);
      setItems(lista);
      setResumen(res);
      return lista;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, [categoria, soloPorSurtir]);

  useEffect(() => {
    buscador.current?.focus();
  }, []);

  async function buscar(e) {
    e?.preventDefault();
    const lista = await cargar(false);
    // Un código leído con la pistola coincide exacto: se abre directo.
    const exacto = lista.find((i) => i.code === term.trim());
    if (exacto) setAbierto(exacto.id);
  }

  const seleccionado = items.find((i) => i.id === abierto) || null;

  return (
    <div className="space-y-gutter">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="font-serif text-display-lg leading-tight text-primary">Inventario</h1>
          <p className="text-body-lg text-outline">
            Mercancía del Pro-Shop. Busque por código de barras, nombre o marca.
          </p>
        </div>
        {puedeMover && (
          <button onClick={() => setAlta((v) => !v)} className={BOTON_FUERTE}>
            <Icono nombre="add" size={16} className="text-secondary-fixed" />
            {alta ? 'Cancelar' : 'Nuevo producto'}
          </button>
        )}
      </header>

      {error && (
        <Alert tone="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* ------------------------------------------------------ cómo va */}
      {resumen && (
        <section className="grid gap-gutter sm:grid-cols-2 xl:grid-cols-4">
          <Cifra
            label="Productos"
            valor={resumen.productos}
            pie={`${resumen.piezas} piezas en existencia`}
          />
          <Cifra
            label="Valor al costo"
            valor={mxn(resumen.valor_costo)}
            pie="lo que costó lo que hay"
            oscuro
          />
          <Cifra
            label="Por surtir"
            valor={resumen.por_surtir}
            pie={`${resumen.sin_existencia} sin existencia`}
            tono={resumen.por_surtir > 0 ? 'text-estado-pend-text' : undefined}
          />
          <Cifra
            label="Pendientes de capturar"
            valor={resumen.sin_precio_venta}
            pie={`sin precio de venta · ${resumen.sin_codigo} sin código de barras`}
          />
        </section>
      )}

      {alta && (
        <AltaDeProducto
          onListo={() => {
            setAlta(false);
            cargar(false);
          }}
        />
      )}

      {/* --------------------------------------------------- búsqueda */}
      <section className="space-y-3 rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-4 shadow-card">
        <form onSubmit={buscar} className="flex flex-wrap gap-2.5">
          <label className="relative flex min-w-[280px] flex-1 items-center">
            <Icono
              nombre="qr_code_2"
              size={17}
              className="pointer-events-none absolute left-3 text-outline"
            />
            <input
              ref={buscador}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Escanee el código o escriba el producto"
              className="w-full rounded border border-outline-variant bg-surface-container-low py-2.5 pl-10 pr-3 text-body-lg focus:border-primary-container focus:bg-surface-container-lowest focus:outline-none"
            />
          </label>
          <button type="submit" className={BOTON}>
            Buscar
          </button>
          {(term || categoria || soloPorSurtir) && (
            <button
              type="button"
              onClick={() => {
                setTerm('');
                setCategoria('');
                setSoloPorSurtir(false);
                setTimeout(() => cargar(false), 0);
              }}
              className={BOTON}
            >
              Limpiar
            </button>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {['', ...CATEGORIAS].map((c) => (
            <button
              key={c || 'todas'}
              onClick={() => setCategoria(c)}
              className={`rounded border px-3 py-1.5 text-label-sm uppercase tracking-wider transition ${
                categoria === c
                  ? 'border-primary-container bg-primary-container text-on-primary'
                  : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              {c || 'Todas'}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-body-md text-on-surface-variant">
            <input
              type="checkbox"
              checked={soloPorSurtir}
              onChange={(e) => setSoloPorSurtir(e.target.checked)}
              className="h-4 w-4 accent-[#16382C]"
            />
            Solo lo que hay que surtir
          </label>
        </div>
      </section>

      <div className="grid gap-gutter xl:grid-cols-12">
        {/* ------------------------------------------------------ tabla */}
        <section
          className={`overflow-hidden rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card ${
            seleccionado ? 'xl:col-span-8' : 'xl:col-span-12'
          }`}
        >
          {loading ? (
            <div className="py-12">
              <Spinner />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant">
                    {['Código', 'Producto', 'Costo', 'Venta', 'Hay'].map((c, i) => (
                      <th
                        key={c}
                        className={`whitespace-nowrap px-3 py-2.5 text-label-sm uppercase tracking-wider ${
                          i === 1 ? 'w-full' : ''
                        } ${i >= 2 ? 'text-right' : ''}`}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr
                      key={i.id}
                      onClick={() => setAbierto(i.id === abierto ? null : i.id)}
                      className={`cursor-pointer border-t border-outline-variant/30 transition ${
                        i.id === abierto
                          ? 'bg-primary-fixed/30'
                          : 'hover:bg-surface-container-low/70'
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-label-sm">
                        <span className={i.has_barcode ? 'text-primary' : 'text-outline'}>
                          {i.code}
                        </span>
                        {!i.has_barcode && (
                          <span
                            className="ml-1.5 rounded bg-estado-pend-bg px-1 py-0.5 text-estado-pend-text"
                            title="No trae código de barras: conviene pegarle etiqueta"
                          >
                            sin etiqueta
                          </span>
                        )}
                      </td>
                      <td className="max-w-0 px-3 py-2.5">
                        <span className="block truncate text-body-lg text-on-surface" title={i.description}>
                          {i.description}
                        </span>
                        <span className="block truncate text-label-sm uppercase tracking-wider text-outline">
                          {i.category}
                          {i.brand ? ` · ${i.brand}` : ''}
                          {i.size ? ` · ${i.size}` : ''}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-body-md text-on-surface-variant">
                        {mxn(i.purchase_price)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-body-md">
                        {i.sale_price != null ? (
                          <span className="text-primary">{mxn(i.sale_price)}</span>
                        ) : (
                          <span className="text-outline">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <span
                          className={`inline-block min-w-[2.5rem] rounded px-2 py-0.5 text-center font-mono text-title-md ${
                            i.por_surtir
                              ? 'bg-estado-pend-bg text-estado-pend-text'
                              : i.stock === 0
                                ? 'text-outline'
                                : 'text-primary'
                          }`}
                        >
                          {i.stock}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-body-lg text-outline">
                        {term ? `Nada coincide con «${term}».` : 'Sin productos en esta vista.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ------------------------------------------------ ficha abierta */}
        {seleccionado && (
          <Ficha
            key={seleccionado.id}
            item={seleccionado}
            puedeMover={puedeMover}
            onCerrar={() => setAbierto(null)}
            onCambio={() => cargar(false)}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ la ficha */

function Ficha({ item, puedeMover, onCerrar, onCambio }) {
  const [tipo, setTipo] = useState('ENTRADA');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [precios, setPrecios] = useState({
    sale_price: item.sale_price ?? '',
    min_stock: item.min_stock,
  });
  const [historial, setHistorial] = useState([]);
  const [guardando, setGuardando] = useState(false);

  function cargarHistorial() {
    inventoryApi.movements(item.id).then(setHistorial).catch(() => setHistorial([]));
  }

  useEffect(() => {
    cargarHistorial();
  }, [item.id]);

  async function mover() {
    const n = Number(cantidad);
    if (!Number.isInteger(n) || n < 0 || (tipo !== 'AJUSTE' && n === 0)) {
      await avisoError('Cantidad inválida', 'Escriba cuántas piezas, en número entero.');
      return;
    }
    setGuardando(true);
    try {
      const r = await inventoryApi.move(item.id, {
        kind: tipo,
        quantity: n,
        reason: motivo.trim() || null,
      });
      await exito(
        `${TIPOS[tipo].texto} registrada`,
        `${item.code}: ahora hay <b>${r.stock}</b> pieza${r.stock === 1 ? '' : 's'}.`,
      );
      setCantidad('');
      setMotivo('');
      cargarHistorial();
      onCambio();
    } catch (err) {
      await avisoError('No se registró', err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function guardarPrecios() {
    setGuardando(true);
    try {
      await inventoryApi.update(item.id, {
        sale_price: precios.sale_price === '' ? null : Number(precios.sale_price).toFixed(2),
        min_stock: Number(precios.min_stock) || 0,
      });
      await exito('Datos guardados', item.code);
      onCambio();
    } catch (err) {
      await avisoError('No se guardó', err.message);
    } finally {
      setGuardando(false);
    }
  }

  const margen =
    item.sale_price != null && Number(item.purchase_price) > 0
      ? ((Number(item.sale_price) - Number(item.purchase_price)) / Number(item.purchase_price)) *
        100
      : null;

  return (
    <aside className="space-y-3 rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card xl:col-span-4 xl:self-start">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-label-sm text-outline">{item.code}</p>
          <p className="text-title-lg leading-snug text-primary">{item.description}</p>
        </div>
        <button onClick={onCerrar} className="text-outline hover:text-on-surface" aria-label="Cerrar">
          <Icono nombre="cancelar" size={18} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Dato label="Hay" valor={item.stock} fuerte />
        <Dato label="Costo" valor={mxn(item.purchase_price)} />
        <Dato
          label="Ganancia"
          valor={margen == null ? '—' : `${margen.toFixed(0)}%`}
        />
      </div>

      {puedeMover && (
        <>
          <div className="rounded border border-outline-variant/60 bg-surface-container-low p-3">
            <p className="mb-2 text-label-sm uppercase tracking-wider text-primary">
              Mover mercancía
            </p>
            <div className="mb-2 grid grid-cols-3 gap-1.5">
              {Object.entries(TIPOS).map(([k, t]) => (
                <button
                  key={k}
                  onClick={() => setTipo(k)}
                  className={`rounded border px-2 py-1.5 text-label-sm uppercase tracking-wider transition ${
                    tipo === k
                      ? 'border-primary-container bg-primary-container text-on-primary'
                      : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {t.signo} {k === 'AJUSTE' ? 'Conteo' : t.texto}
                </button>
              ))}
            </div>
            <p className="mb-2 text-body-md text-outline">{TIPOS[tipo].ayuda}</p>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                value={cantidad}
                placeholder={tipo === 'AJUSTE' ? 'contadas' : 'piezas'}
                onChange={(e) => setCantidad(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && mover()}
                className={`${CAMPO} w-28 text-right font-mono`}
              />
              <input
                value={motivo}
                placeholder={tipo === 'AJUSTE' ? 'motivo (obligatorio)' : 'nota (opcional)'}
                onChange={(e) => setMotivo(e.target.value)}
                className={CAMPO}
              />
            </div>
            <button
              onClick={mover}
              disabled={guardando}
              className={`${BOTON_FUERTE} mt-2 w-full`}
            >
              {guardando ? 'Guardando…' : `Registrar ${TIPOS[tipo].texto.toLowerCase()}`}
            </button>
          </div>

          <div className="rounded border border-outline-variant/60 bg-surface-container-low p-3">
            <p className="mb-2 text-label-sm uppercase tracking-wider text-primary">
              Precio y mínimo
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className={ETIQUETA}>Precio de venta</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={precios.sale_price}
                  placeholder="sin definir"
                  onChange={(e) => setPrecios({ ...precios, sale_price: e.target.value })}
                  className={`${CAMPO} text-right font-mono`}
                />
              </label>
              <label>
                <span className={ETIQUETA}>Avisar al llegar a</span>
                <input
                  type="number"
                  min="0"
                  value={precios.min_stock}
                  onChange={(e) => setPrecios({ ...precios, min_stock: e.target.value })}
                  className={`${CAMPO} text-right font-mono`}
                />
              </label>
            </div>
            <button onClick={guardarPrecios} disabled={guardando} className={`${BOTON} mt-2 w-full justify-center`}>
              Guardar
            </button>
          </div>
        </>
      )}

      <div>
        <p className="mb-1.5 text-label-sm uppercase tracking-wider text-primary">Movimientos</p>
        {historial.length === 0 ? (
          <p className="text-body-md text-outline">Todavía no se ha movido.</p>
        ) : (
          <ul className="divide-y divide-outline-variant/30">
            {historial.slice(0, 12).map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-2 py-1.5 text-body-md">
                <span className="min-w-0">
                  <span className="text-on-surface">{TIPOS[m.kind]?.texto || m.kind}</span>
                  {m.reason && <span className="text-outline"> · {m.reason}</span>}
                  <span className="block text-label-sm text-outline">
                    {fechaHora(m.created_at)}
                    {m.user_name ? ` · ${m.user_name}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-right font-mono">
                  <span className={m.quantity >= 0 ? 'text-estado-ok-text' : 'text-error'}>
                    {m.quantity >= 0 ? '+' : ''}
                    {m.quantity}
                  </span>
                  <span className="block text-label-sm text-outline">quedan {m.stock_after}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/* -------------------------------------------------------- alta de producto */

function AltaDeProducto({ onListo }) {
  const [form, setForm] = useState({
    code: '',
    description: '',
    category: 'Playeras',
    brand: '',
    size: '',
    purchase_price: '',
    sale_price: '',
  });
  const [guardando, setGuardando] = useState(false);

  async function crear() {
    if (!form.code.trim() || form.description.trim().length < 3 || form.purchase_price === '') {
      await avisoError('Faltan datos', 'Hace falta el código, la descripción y el costo.');
      return;
    }
    setGuardando(true);
    try {
      await inventoryApi.create({
        code: form.code.trim(),
        description: form.description.trim(),
        category: form.category,
        brand: form.brand.trim() || null,
        size: form.size.trim() || null,
        purchase_price: Number(form.purchase_price).toFixed(2),
        sale_price: form.sale_price === '' ? null : Number(form.sale_price).toFixed(2),
      });
      await exito('Producto dado de alta', `${form.code}. Entra con 0 piezas: registre la entrada.`);
      onListo();
    } catch (err) {
      await avisoError('No se pudo dar de alta', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="grid gap-2.5 rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card sm:grid-cols-4">
      <label>
        <span className={ETIQUETA}>Código de barras</span>
        <input
          value={form.code}
          autoFocus
          placeholder="escanéelo aquí"
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          className={`${CAMPO} font-mono`}
        />
      </label>
      <label className="sm:col-span-3">
        <span className={ETIQUETA}>Descripción</span>
        <input
          value={form.description}
          placeholder="GORRA MARCA: NIKE - LEGACY 91 - TALLA: UNITALLA"
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className={CAMPO}
        />
      </label>
      <label>
        <span className={ETIQUETA}>Categoría</span>
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className={CAMPO}
        >
          {CATEGORIAS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        <span className={ETIQUETA}>Marca</span>
        <input
          value={form.brand}
          onChange={(e) => setForm({ ...form, brand: e.target.value })}
          className={CAMPO}
        />
      </label>
      <label>
        <span className={ETIQUETA}>Talla</span>
        <input
          value={form.size}
          onChange={(e) => setForm({ ...form, size: e.target.value })}
          className={CAMPO}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className={ETIQUETA}>Costo</span>
          <input
            type="number"
            step="0.01"
            value={form.purchase_price}
            onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
            className={`${CAMPO} text-right font-mono`}
          />
        </label>
        <label>
          <span className={ETIQUETA}>Venta</span>
          <input
            type="number"
            step="0.01"
            value={form.sale_price}
            onChange={(e) => setForm({ ...form, sale_price: e.target.value })}
            className={`${CAMPO} text-right font-mono`}
          />
        </label>
      </div>
      <div className="sm:col-span-4">
        <button onClick={crear} disabled={guardando} className={`${BOTON_FUERTE} w-full`}>
          {guardando ? 'Guardando…' : 'Dar de alta el producto'}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- piezas */

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
    <div className="rounded border border-outline-variant/50 bg-surface-container-low px-2.5 py-2">
      <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className={`font-mono ${fuerte ? 'text-title-lg text-primary' : 'text-body-lg'}`}>{valor}</p>
    </div>
  );
}

const CAMPO =
  'w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-lg text-on-surface focus:border-primary-container focus:outline-none';

const ETIQUETA = 'mb-1 block text-label-sm uppercase tracking-wider text-on-surface-variant';

const BOTON =
  'flex items-center gap-1.5 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-label-sm uppercase tracking-wider text-on-surface-variant transition hover:bg-surface-container-low';

const BOTON_FUERTE =
  'flex items-center justify-center gap-2 rounded bg-primary-container px-4 py-2.5 text-title-md text-on-primary shadow-card transition hover:bg-primary disabled:opacity-60';
