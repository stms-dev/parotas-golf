/**
 * Productos: catálogo, precios, existencias y kardex.
 *
 * La existencia nunca se escribe a mano: entra con una ENTRADA de mercancía o
 * se corrige con un AJUSTE por conteo, y cada uno queda con quién y por qué.
 */
import { useEffect, useMemo, useState } from 'react';

import { tiendaApi } from '../../api/client';
import Icono from '../../components/Icono';
import { Modal, Paginador, usePaginacion } from '../../components/ui';
import { error as avisoError, notificar } from '../../utils/avisos';
import { fechaHora, mxn } from '../../utils/format';
import { Avisos, BOTON, BOTON_FUERTE, CAMPO, Cifra, ETIQUETA, Existencia, TARJETA, plural } from './comun';

const FILTROS = [
  ['todos', 'Todos'],
  ['surtir', 'Por comprar'],
  ['pasar', 'Pasar a tienda'],
  ['maximo', 'Sobre máximo'],
  ['agotados', 'Agotados'],
  ['sinprecio', 'Sin precio'],
  ['baja', 'Dados de baja'],
];

export default function Productos({ atiende }) {
  const [productos, setProductos] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [termino, setTermino] = useState('');
  const [categoria, setCategoria] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [editando, setEditando] = useState(null); // producto | 'nuevo'
  const [moviendo, setMoviendo] = useState(null); // {producto, tipo}
  const [kardex, setKardex] = useState(null);
  const [margen, setMargen] = useState(false);
  const [contando, setContando] = useState(false);

  async function cargar() {
    const [lista, res] = await Promise.all([
      tiendaApi.productos({ inactivos: true }),
      tiendaApi.resumen(),
    ]).catch(() => [[], null]);
    setProductos(lista);
    setResumen(res);
  }

  useEffect(() => {
    cargar();
  }, []);

  const categorias = resumen?.categorias || [];
  const visibles = useMemo(() => {
    const t = termino.trim().toLowerCase();
    return productos.filter((p) => {
      if (filtro === 'baja' ? p.activo : !p.activo) return false;
      if (filtro === 'surtir' && !p.por_surtir) return false;
      if (filtro === 'agotados' && p.existencia_total > 0) return false;
      if (filtro === 'pasar' && !p.pasar_a_tienda) return false;
      if (filtro === 'maximo' && !p.sobre_maximo) return false;
      if (filtro === 'sinprecio' && p.precio != null) return false;
      if (categoria && p.categoria !== categoria) return false;
      return (
        !t ||
        p.codigo.toLowerCase().includes(t) ||
        p.descripcion.toLowerCase().includes(t) ||
        (p.marca || '').toLowerCase().includes(t)
      );
    });
  }, [productos, termino, categoria, filtro]);
  // El catálogo es largo: de 15 en 15. Exportar a CSV sigue llevándose todos los filtrados.
  const pag = usePaginacion(visibles, 15, `${termino}|${categoria}|${filtro}`);

  function exportar() {
    const filas = [
      ['Codigo', 'Descripcion', 'Categoria', 'Marca', 'Talla', 'Costo', 'Precio', 'Tienda', 'Bodega', 'Total', 'Minimo', 'Maximo', 'Comprar', 'Activo'],
      ...visibles.map((p) => [p.codigo, p.descripcion, p.categoria, p.marca || '', p.talla || '', p.costo, p.precio ?? '', p.existencia, p.existencia_bodega, p.existencia_total, p.minimo, p.maximo, p.compra_sugerida, p.activo ? 'Si' : 'No']),
    ];
    const csv = filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventario-tienda-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-gutter">
      {resumen && (
        <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Cifra label="Piezas" valor={resumen.piezas} pie={`${resumen.piezas_tienda} en tienda · ${resumen.piezas_bodega} en bodega`} />
          <Cifra label="Valor al costo" valor={mxn(resumen.valor_costo)} pie="lo que costó lo que hay" oscuro />
          <Cifra label="Valor a la venta" valor={mxn(resumen.valor_venta)} pie="si se vendiera todo" />
          <Cifra
            label="Por comprar"
            valor={resumen.por_surtir}
            pie={`en el mínimo o menos · ${resumen.sin_existencia} agotados`}
            tono={resumen.por_surtir ? 'text-error' : undefined}
          />
          <Cifra
            label="Pasar a tienda"
            valor={resumen.pasar_a_tienda}
            pie="anaquel vacío, hay en bodega"
            tono={resumen.pasar_a_tienda ? 'text-estado-pend-text' : undefined}
          />
          <Cifra
            label="Sin precio"
            valor={resumen.sin_precio}
            pie="no se pueden vender"
            tono={resumen.sin_precio ? 'text-error' : undefined}
          />
        </section>
      )}

      <section className={`${TARJETA} p-4`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="relative min-w-[260px] flex-1">
            <Icono nombre="buscar" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
            <input
              value={termino}
              onChange={(e) => setTermino(e.target.value)}
              placeholder="Código, descripción o marca"
              className={`${CAMPO} pl-9`}
            />
          </label>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={CAMPO.replace('w-full', 'w-auto')}>
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button type="button" onClick={exportar} className={BOTON}>
            <Icono nombre="descarga" size={15} /> CSV
          </button>
          <button type="button" onClick={() => setContando(true)} className={BOTON}>
            <Icono nombre="codigoBarras" size={15} /> Conteo físico
          </button>
          <button type="button" onClick={() => setMargen(true)} className={BOTON}>
            <Icono nombre="etiquetaPrecio" size={15} /> Precio por margen
          </button>
          <button type="button" onClick={() => setEditando('nuevo')} className={BOTON_FUERTE}>
            <Icono nombre="add" size={16} className="text-secondary-fixed" /> Nuevo producto
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTROS.map(([k, t]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFiltro(k)}
              className={`rounded-full border px-3 py-1 text-label-md transition ${
                filtro === k
                  ? 'border-primary-container bg-primary-container text-on-primary'
                  : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              {t}
            </button>
          ))}
          <span className="ml-auto self-center text-body-md text-outline">{visibles.length} productos</span>
        </div>
      </section>

      <section className={TARJETA}>
        <div className="overflow-x-auto">
        <table className="tabla-lineas min-w-[1060px] text-left">
          <thead>
            <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
              <th className="px-4 py-3">Producto</th>
              <th className="px-3 py-3 text-right">Costo</th>
              <th className="px-3 py-3 text-right">Precio</th>
              <th className="px-3 py-3 text-right" title="Ganancia sobre el costo">Sobre costo</th>
              <th className="px-3 py-3">Tienda</th>
              <th className="px-3 py-3 text-right">Bodega</th>
              <th className="px-3 py-3 text-right">Total</th>
              <th className="px-3 py-3 text-right" title="Mínimo / máximo del total">Mín / Máx</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pag.visibles.map((p) => {
              const margen = p.precio != null && Number(p.costo) > 0
                ? ((Number(p.precio) - Number(p.costo)) / Number(p.costo)) * 100
                : null;
              return (
                <tr key={p.id} className={`align-top ${p.activo ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-3">
                    <p className="text-title-md text-primary">{p.descripcion}</p>
                    <p className="font-mono text-label-md text-outline">
                      {p.codigo} · {p.categoria}
                      {[p.marca, p.talla].filter(Boolean).length ? ` · ${[p.marca, p.talla].filter(Boolean).join(' · ')}` : ''}
                    </p>
                    <Avisos producto={p} />
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-body-md">{mxn(p.costo)}</td>
                  <td className="px-3 py-3 text-right font-mono text-body-md">
                    {p.precio != null ? mxn(p.precio) : <span className="text-error">Sin precio</span>}
                  </td>
                  <td className={`px-3 py-3 text-right font-mono text-body-md ${margen != null && margen < 0 ? 'text-error' : 'text-on-surface-variant'}`}>
                    {margen == null ? '—' : `${margen.toFixed(0)}%`}
                  </td>
                  <td className="px-3 py-3"><Existencia producto={p} /></td>
                  <td className="px-3 py-3 text-right font-mono text-body-md">{p.existencia_bodega}</td>
                  <td className="px-3 py-3 text-right font-mono text-title-md">{p.existencia_total}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-body-md text-on-surface-variant">
                    {p.minimo || p.maximo ? `${p.minimo || 0} / ${p.maximo || '—'}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Accion icono="add" texto="Entrada" onClick={() => setMoviendo({ producto: p, tipo: 'ENTRADA' })} />
                      <Accion icono="intercambiar" texto="Pasar" onClick={() => setMoviendo({ producto: p, tipo: 'TRASPASO' })} />
                      <Accion icono="arqueo" titulo="Ajuste por conteo" onClick={() => setMoviendo({ producto: p, tipo: 'AJUSTE' })} />
                      <Accion icono="historial" titulo="Kardex" onClick={() => setKardex(p)} />
                      <Accion icono="ajustes" titulo="Editar" onClick={() => setEditando(p)} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {!visibles.length && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-body-lg text-outline">Ningún producto con ese filtro.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <Paginador pag={pag} etiqueta="productos" />
      </section>

      {editando && (
        <EditarProducto
          producto={editando === 'nuevo' ? null : editando}
          categorias={categorias}
          atiende={atiende}
          onCerrar={() => setEditando(null)}
          onListo={() => {
            setEditando(null);
            cargar();
          }}
        />
      )}
      {moviendo && (
        <Movimiento
          {...moviendo}
          atiende={atiende}
          onCerrar={() => setMoviendo(null)}
          onListo={() => {
            setMoviendo(null);
            cargar();
          }}
        />
      )}
      {kardex && <Kardex producto={kardex} onCerrar={() => setKardex(null)} />}
      {contando && (
        <Conteo
          productos={productos.filter((p) => p.activo)}
          categorias={categorias}
          atiende={atiende}
          onCerrar={() => setContando(false)}
          onListo={() => {
            setContando(false);
            cargar();
          }}
        />
      )}
      {margen && (
        <PrecioPorMargen
          categorias={categorias}
          onCerrar={() => setMargen(false)}
          onListo={() => {
            setMargen(false);
            cargar();
          }}
        />
      )}
    </div>
  );
}

function Accion({ icono, texto, titulo, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo || texto}
      className="flex items-center gap-1 rounded border border-outline-variant/60 px-2 py-1 text-label-md text-on-surface-variant transition hover:border-primary-container hover:text-primary"
    >
      <Icono nombre={icono} size={14} /> {texto && <span>{texto}</span>}
    </button>
  );
}

/* ---------------------------------------------------------- alta / edición */
function EditarProducto({ producto, categorias, atiende, onCerrar, onListo }) {
  const nuevo = !producto;
  const [f, setF] = useState({
    codigo: producto?.codigo || '',
    descripcion: producto?.descripcion || '',
    categoria: producto?.categoria || categorias[0] || 'Accesorios',
    marca: producto?.marca || '',
    talla: producto?.talla || '',
    costo: producto?.costo ?? '',
    precio: producto?.precio ?? '',
    minimo: producto?.minimo ?? 0,
    maximo: producto?.maximo ?? 0,
    existencia_inicial: 0,
    bodega_inicial: 0,
    activo: producto?.activo ?? true,
  });
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const margen = Number(f.precio) > 0 && Number(f.costo) > 0 ? ((Number(f.precio) - Number(f.costo)) / Number(f.costo)) * 100 : null;

  async function guardar() {
    if (f.descripcion.trim().length < 2) return avisoError('Falta la descripción', '');
    if (f.costo === '' || Number(f.costo) < 0) return avisoError('Falta el costo', '');
    if (nuevo && atiende.trim().length < 3) return avisoError('¿Quién registra?', 'Escriba arriba quién atiende.');
    if (Number(f.maximo) > 0 && Number(f.maximo) < Number(f.minimo)) {
      return avisoError('Revise mínimo y máximo', 'El máximo no puede ser menor que el mínimo.');
    }
    setGuardando(true);
    const cuerpo = {
      codigo: f.codigo.trim() || null,
      descripcion: f.descripcion,
      categoria: f.categoria,
      marca: f.marca || null,
      talla: f.talla || null,
      costo: Number(f.costo),
      precio: f.precio === '' ? null : Number(f.precio),
      minimo: Number(f.minimo) || 0,
      maximo: Number(f.maximo) || 0,
    };
    try {
      if (nuevo) {
        await tiendaApi.crear(
          { ...cuerpo, existencia_inicial: Number(f.existencia_inicial) || 0, bodega_inicial: Number(f.bodega_inicial) || 0 },
          atiende.trim(),
        );
        notificar('Producto dado de alta');
      } else {
        await tiendaApi.actualizar(producto.id, { ...cuerpo, codigo: f.codigo.trim() || producto.codigo, activo: f.activo });
        notificar('Producto actualizado');
      }
      onListo();
    } catch (err) {
      avisoError('No se guardó', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open
      title={nuevo ? 'Nuevo producto' : 'Editar producto'}
      onClose={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className={BOTON}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={guardando} className={BOTON_FUERTE}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className={ETIQUETA}>Código de barras</span>
          <input value={f.codigo} onChange={set('codigo')} placeholder={nuevo ? 'Escanéelo, o déjelo vacío para uno interno' : ''} className={`${CAMPO} font-mono`} autoFocus={nuevo} />
        </label>
        <label className="sm:col-span-2">
          <span className={ETIQUETA}>Descripción</span>
          <input value={f.descripcion} onChange={set('descripcion')} className={CAMPO} />
        </label>
        <label>
          <span className={ETIQUETA}>Categoría</span>
          <input value={f.categoria} onChange={set('categoria')} list="tienda-categorias" className={CAMPO} />
          <datalist id="tienda-categorias">
            {categorias.map((c) => <option key={c} value={c} />)}
          </datalist>
        </label>
        <label>
          <span className={ETIQUETA}>Marca</span>
          <input value={f.marca} onChange={set('marca')} className={CAMPO} />
        </label>
        <label>
          <span className={ETIQUETA}>Talla / modelo</span>
          <input value={f.talla} onChange={set('talla')} className={CAMPO} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className={ETIQUETA}>Mínimo</span>
            <input type="number" min="0" value={f.minimo} onChange={set('minimo')} className={CAMPO} />
          </label>
          <label>
            <span className={ETIQUETA}>Máximo</span>
            <input type="number" min="0" value={f.maximo} onChange={set('maximo')} className={CAMPO} />
          </label>
        </div>
        <label>
          <span className={ETIQUETA}>Costo</span>
          <input type="number" min="0" step="0.01" value={f.costo} onChange={set('costo')} className={`${CAMPO} font-mono`} />
        </label>
        <label>
          <span className={ETIQUETA}>Precio de venta</span>
          <input type="number" min="0" step="0.01" value={f.precio} onChange={set('precio')} className={`${CAMPO} font-mono`} />
        </label>
        <p className="sm:col-span-2 text-body-md text-outline">
          Mínimo y máximo cuentan tienda + bodega: con el mínimo o menos se marca para comprar, y la compra sugerida
          es lo que falta para llegar al máximo.
        </p>
        <p className="sm:col-span-2 text-body-md text-outline">
          {f.precio === '' ? 'Sin precio no se puede vender.' : `Gana ${mxn(Number(f.precio) - Number(f.costo || 0))} por pieza${margen == null ? '' : ` · ${margen.toFixed(0)}% sobre el costo`}`}
        </p>
        {nuevo ? (
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            <label>
              <span className={ETIQUETA}>Piezas en tienda</span>
              <input type="number" min="0" value={f.existencia_inicial} onChange={set('existencia_inicial')} className={CAMPO} />
            </label>
            <label>
              <span className={ETIQUETA}>Piezas en bodega</span>
              <input type="number" min="0" value={f.bodega_inicial} onChange={set('bodega_inicial')} className={CAMPO} />
            </label>
          </div>
        ) : (
          <label className="flex items-center gap-2 text-body-lg sm:col-span-2">
            <input type="checkbox" checked={f.activo} onChange={set('activo')} />
            Activo (desmarque para darlo de baja sin borrar su historial)
          </label>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------ entrada / ajuste */
const LUGARES = { TIENDA: 'Tienda', BODEGA: 'Bodega' };

function Movimiento({ producto, tipo, atiende, onCerrar, onListo }) {
  const entrada = tipo === 'ENTRADA';
  const traspaso = tipo === 'TRASPASO';
  const ajuste = tipo === 'AJUSTE';
  // Entrada: por omisión llega a bodega. Traspaso: por omisión de bodega a tienda.
  const [lugar, setLugar] = useState(entrada ? 'BODEGA' : 'TIENDA');
  const en = (l) => (l === 'TIENDA' ? producto.existencia : producto.existencia_bodega);
  const origen = lugar === 'TIENDA' ? 'BODEGA' : 'TIENDA';
  const [cantidad, setCantidad] = useState(ajuste ? String(producto.existencia) : '');
  const [costo, setCosto] = useState(String(producto.costo));
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const n = Number(cantidad || 0);

  function cambiarLugar(l) {
    setLugar(l);
    if (ajuste) setCantidad(String(en(l)));
  }

  const despues = { TIENDA: producto.existencia, BODEGA: producto.existencia_bodega };
  if (entrada) despues[lugar] += n;
  if (ajuste) despues[lugar] = n;
  if (traspaso) {
    despues[lugar] += n;
    despues[origen] -= n;
  }
  const invalido = traspaso ? n <= 0 || n > en(origen) : entrada ? n <= 0 : false;

  async function guardar() {
    if (atiende.trim().length < 3) return avisoError('¿Quién registra?', 'Escriba arriba quién atiende.');
    setGuardando(true);
    try {
      await tiendaApi.mover(producto.id, {
        tipo,
        ubicacion: lugar,
        cantidad: n,
        motivo: motivo.trim() || null,
        costo_unitario: entrada && costo !== '' ? Number(costo) : null,
        atendio: atiende.trim(),
      });
      notificar(
        entrada ? `Entrada de ${n} a ${LUGARES[lugar].toLowerCase()}` : traspaso ? `${n} pasadas a ${LUGARES[lugar].toLowerCase()}` : 'Ajuste registrado',
      );
      onListo();
    } catch (err) {
      avisoError('No se registró', err.message);
    } finally {
      setGuardando(false);
    }
  }

  const titulo = entrada ? 'Entrada de mercancía' : traspaso ? 'Pasar entre bodega y tienda' : 'Ajuste por conteo';
  return (
    <Modal
      open
      title={titulo}
      onClose={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className={BOTON}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={guardando || invalido} className={BOTON_FUERTE}>
            {guardando ? 'Guardando…' : 'Registrar'}
          </button>
        </>
      }
    >
      <p className="text-title-md text-primary">{producto.descripcion}</p>
      <p className="font-mono text-label-md text-outline">
        {producto.codigo} · tienda {producto.existencia} · bodega {producto.existencia_bodega}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(traspaso
          ? [['TIENDA', 'Bodega → Tienda'], ['BODEGA', 'Tienda → Bodega']]
          : [['TIENDA', entrada ? 'Llega a tienda' : 'Conté la tienda'], ['BODEGA', entrada ? 'Llega a bodega' : 'Conté la bodega']]
        ).map(([l, t]) => (
          <button
            key={l}
            type="button"
            onClick={() => cambiarLugar(l)}
            className={`rounded-full border px-3 py-1 text-label-md ${
              lugar === l ? 'border-primary-container bg-primary-container text-on-primary' : 'border-outline-variant text-on-surface-variant'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>
          <span className={ETIQUETA}>
            {entrada ? 'Piezas que llegaron' : traspaso ? `Piezas a pasar (hay ${en(origen)})` : 'Piezas contadas'}
          </span>
          <input type="number" min="0" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className={`${CAMPO} font-mono text-title-lg`} autoFocus />
        </label>
        {traspaso && (
          <div className="flex items-end">
            <button type="button" onClick={() => setCantidad(String(en(origen)))} className={BOTON}>
              Todas ({en(origen)})
            </button>
          </div>
        )}
        {entrada && (
          <label>
            <span className={ETIQUETA}>Costo unitario de este lote</span>
            <input type="number" min="0" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} className={`${CAMPO} font-mono`} />
          </label>
        )}
        <label className="sm:col-span-2">
          <span className={ETIQUETA}>
            {entrada ? 'Nota (proveedor, factura…)' : ajuste ? 'Motivo del ajuste (obligatorio)' : 'Nota (opcional)'}
          </span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CAMPO} />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {['TIENDA', 'BODEGA'].map((l) => (
          <div key={l} className={`rounded p-2 ${despues[l] < 0 ? 'bg-estado-cancel-bg' : 'bg-surface-container-low'}`}>
            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{LUGARES[l]}</p>
            <p className="font-mono text-title-lg">
              {en(l)} → <strong>{despues[l]}</strong>
            </p>
          </div>
        ))}
        <div className="rounded bg-primary-container p-2 text-on-primary">
          <p className="text-label-sm uppercase tracking-wider text-secondary-fixed">Total</p>
          <p className="font-mono text-title-lg">{despues.TIENDA + despues.BODEGA}</p>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ kardex */
const TIPOS = {
  ENTRADA: 'Entrada',
  AJUSTE: 'Ajuste',
  TRASPASO: 'Traspaso',
  VENTA: 'Venta',
  CANCELACION: 'Cancelación',
};

function Kardex({ producto, onCerrar }) {
  const [movs, setMovs] = useState(null);
  useEffect(() => {
    tiendaApi.movimientos({ producto_id: producto.id }).then(setMovs).catch(() => setMovs([]));
  }, [producto.id]);
  return (
    <Modal open title={`Kardex · ${producto.descripcion}`} onClose={onCerrar}>
      {!movs ? (
        <p className="text-body-lg text-outline">Cargando…</p>
      ) : !movs.length ? (
        <p className="text-body-lg text-outline">Sin movimientos todavía.</p>
      ) : (
        <ul className="divide-y divide-outline-variant/40">
          {movs.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 py-2.5">
              <div>
                <p className="text-title-md">
                  {TIPOS[m.tipo] || m.tipo}
                  <span
                    className={`ml-1.5 rounded px-1.5 py-px text-label-sm uppercase tracking-wider ${
                      m.ubicacion === 'BODEGA' ? 'bg-secondary-fixed text-on-secondary-fixed' : 'bg-primary-fixed text-on-primary-fixed'
                    }`}
                  >
                    {m.ubicacion === 'BODEGA' ? 'Bodega' : 'Tienda'}
                  </span>
                  {m.venta_folio && <span className="ml-1.5 font-mono text-label-md text-secondary">{m.venta_folio}</span>}
                </p>
                <p className="text-body-md text-outline">
                  {fechaHora(m.created_at)} · {m.atendio || m.usuario_nombre || '—'}
                  {m.motivo ? ` · ${m.motivo}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-mono text-title-md ${m.cantidad < 0 ? 'text-error' : 'text-estado-ok-text'}`}>
                  {m.cantidad > 0 ? '+' : ''}
                  {m.cantidad}
                </p>
                <p className="font-mono text-label-md text-outline">
                  quedan {m.existencia_despues} en {m.ubicacion === 'BODEGA' ? 'bodega' : 'tienda'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------- precio masivo */
function PrecioPorMargen({ categorias, onCerrar, onListo }) {
  const [margen, setMargen] = useState('60');
  const [redondeo, setRedondeo] = useState('10');
  const [soloSinPrecio, setSoloSinPrecio] = useState(true);
  const [categoria, setCategoria] = useState('');
  const [guardando, setGuardando] = useState(false);
  const ejemplo = Math.ceil((100 * (1 + Number(margen || 0) / 100)) / Number(redondeo || 1)) * Number(redondeo || 1);

  async function aplicar() {
    setGuardando(true);
    try {
      const r = await tiendaApi.precioPorMargen({
        margen_pct: Number(margen),
        redondear_a: Number(redondeo),
        solo_sin_precio: soloSinPrecio,
        categoria: categoria || null,
      });
      notificar(`Precio puesto a ${r.actualizados} productos`);
      onListo();
    } catch (err) {
      avisoError('No se aplicó', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open
      title="Precio por margen"
      onClose={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className={BOTON}>Cancelar</button>
          <button type="button" onClick={aplicar} disabled={guardando || !Number(margen)} className={BOTON_FUERTE}>
            {guardando ? 'Aplicando…' : 'Aplicar'}
          </button>
        </>
      }
    >
      <p className="text-body-lg text-on-surface-variant">
        Precio = costo + margen, redondeado hacia arriba. Útil para poner precio de un jalón a lo que llegó solo con costo.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label>
          <span className={ETIQUETA}>Margen sobre el costo (%)</span>
          <input type="number" min="1" value={margen} onChange={(e) => setMargen(e.target.value)} className={`${CAMPO} font-mono`} />
        </label>
        <label>
          <span className={ETIQUETA}>Redondear a múltiplos de</span>
          <select value={redondeo} onChange={(e) => setRedondeo(e.target.value)} className={CAMPO}>
            {[1, 5, 10, 50].map((n) => <option key={n} value={n}>${n}</option>)}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className={ETIQUETA}>Categoría</span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={CAMPO}>
            <option value="">Todas</option>
            {categorias.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-body-lg sm:col-span-2">
          <input type="checkbox" checked={soloSinPrecio} onChange={(e) => setSoloSinPrecio(e.target.checked)} />
          Solo a los que no tienen precio (no tocar los que ya tienen)
        </label>
      </div>
      <p className="mt-3 rounded bg-surface-container-low px-3 py-2 text-body-lg">
        Ejemplo: algo que costó {mxn(100)} se venderá en <strong>{mxn(ejemplo)}</strong>.
      </p>
    </Modal>
  );
}

/* ---------------------------------------------------------- conteo físico */
function Conteo({ productos, categorias, atiende, onCerrar, onListo }) {
  const [contado, setContado] = useState({}); // id → número (texto)
  const [categoria, setCategoria] = useState('');
  const [termino, setTermino] = useState('');
  const [codigo, setCodigo] = useState('');
  const [ultimo, setUltimo] = useState(null);
  const [motivo, setMotivo] = useState('Conteo físico');
  const [lugar, setLugar] = useState('TIENDA');
  const en = (p) => (lugar === 'TIENDA' ? p.existencia : p.existencia_bodega);
  const [guardando, setGuardando] = useState(false);

  const visibles = productos.filter((p) => {
    const t = termino.trim().toLowerCase();
    return (!categoria || p.categoria === categoria) &&
      (!t || p.codigo.toLowerCase().includes(t) || p.descripcion.toLowerCase().includes(t));
  });
  const capturados = Object.entries(contado).filter(([, v]) => v !== '');
  const cambios = capturados.filter(([id, v]) => {
    const p = productos.find((x) => x.id === Number(id));
    return p && Number(v) !== en(p);
  });

  // Cada escaneo suma una pieza: se cuenta pasando el lector por el anaquel.
  function escanear(e) {
    e.preventDefault();
    const c = codigo.trim().toLowerCase();
    if (!c) return;
    const p = productos.find((x) => x.codigo.toLowerCase() === c);
    setCodigo('');
    if (!p) return avisoError('Código no encontrado', codigo);
    setContado((prev) => ({ ...prev, [p.id]: String(Number(prev[p.id] || 0) + 1) }));
    setUltimo(p.id);
  }

  async function guardar() {
    if (atiende.trim().length < 3) return avisoError('¿Quién contó?', 'Escriba arriba quién atiende.');
    setGuardando(true);
    try {
      const r = await tiendaApi.conteo({
        filas: capturados.map(([id, v]) => ({ producto_id: Number(id), contado: Number(v) || 0, ubicacion: lugar })),
        motivo: motivo.trim() || null,
        atendio: atiende.trim(),
      });
      notificar(`Conteo guardado · ${r.ajustados} productos ajustados`);
      onListo();
    } catch (err) {
      avisoError('No se guardó el conteo', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open
      ancho="max-w-3xl"
      title={`Conteo físico · ${lugar === 'TIENDA' ? 'tienda' : 'bodega'}`}
      onClose={onCerrar}
      footer={
        <>
          <span className="mr-auto self-center text-body-md text-outline">
            {capturados.length} contados · {cambios.length} con diferencia
          </span>
          <button type="button" onClick={onCerrar} className={BOTON}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={guardando || !capturados.length} className={BOTON_FUERTE}>
            {guardando ? 'Guardando…' : 'Guardar conteo'}
          </button>
        </>
      }
    >
      <p className="text-body-md text-on-surface-variant">
        Escriba cuántas piezas hay de cada producto, o pase el lector: cada escaneo suma una. Solo se ajusta lo que no
        coincide con el sistema, y cada ajuste queda en el kardex.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">Estoy contando:</span>
        {[
          ['TIENDA', 'La tienda'],
          ['BODEGA', 'La bodega'],
        ].map(([l, t]) => (
          <button
            key={l}
            type="button"
            onClick={() => {
              if (capturados.length && l !== lugar && !window.confirm('Cambiar de lugar borra lo capturado. ¿Seguir?')) return;
              setLugar(l);
              setContado({});
            }}
            className={`rounded-full border px-3 py-1 text-label-md ${
              lugar === l ? 'border-primary-container bg-primary-container text-on-primary' : 'border-outline-variant text-on-surface-variant'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <form onSubmit={escanear} className="mt-3 flex gap-2">
        <label className="relative flex-1">
          <Icono nombre="codigoBarras" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Escanear para sumar 1" className={`${CAMPO} pl-9 font-mono`} autoFocus />
        </label>
        <input value={termino} onChange={(e) => setTermino(e.target.value)} placeholder="Filtrar" className={CAMPO.replace('w-full', 'w-40')} />
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={CAMPO.replace('w-full', 'w-40')}>
          <option value="">Todas</option>
          {categorias.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
      <ul className="mt-3 divide-y divide-outline-variant/40 rounded border border-outline-variant/50">
        {visibles.map((p) => {
          const v = contado[p.id] ?? '';
          const dif = v === '' ? null : Number(v) - en(p);
          return (
            <li key={p.id} className={`flex items-center gap-3 px-3 py-2 ${ultimo === p.id ? 'bg-secondary-fixed/40' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-lg">{p.descripcion}</p>
                <p className="font-mono text-label-md text-outline">{p.codigo} · sistema: {en(p)}</p>
              </div>
              <span className={`w-12 text-right font-mono text-label-md ${dif == null || dif === 0 ? 'text-outline' : dif > 0 ? 'text-estado-ok-text' : 'text-error'}`}>
                {dif == null ? '' : dif === 0 ? '=' : `${dif > 0 ? '+' : ''}${dif}`}
              </span>
              <input
                type="number"
                min="0"
                value={v}
                onChange={(e) => setContado({ ...contado, [p.id]: e.target.value })}
                className={`${CAMPO.replace('w-full', 'w-24')} py-1 text-right font-mono`}
              />
            </li>
          );
        })}
      </ul>
      <label className="mt-3 block">
        <span className={ETIQUETA}>Motivo</span>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CAMPO} />
      </label>
    </Modal>
  );
}
