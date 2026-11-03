/**
 * Merma: piezas que se pierden (dañadas, caducas, robadas, de muestra).
 *
 * Flujo con control:
 *   1. Quien atiende registra la merma: producto, cantidad, motivo, justificación
 *      y, si la tiene, evidencia (foto o PDF). Queda PENDIENTE; el inventario
 *      todavía no se mueve.
 *   2. Un administrador la autoriza o la rechaza. Solo al autorizar salen las
 *      piezas del inventario.
 *   3. Una merma autorizada solo la cancela un administrador, con nota, y las
 *      piezas regresan.
 */
import { useEffect, useMemo, useState } from 'react';

import { tiendaApi } from '../../api/client';
import Icono from '../../components/Icono';
import { Modal, Paginador, usePaginacion } from '../../components/ui';
import { confirmar, error as avisoError, exito } from '../../utils/avisos';
import { fechaHora, hoy, mxn } from '../../utils/format';
import { BOTON, BOTON_FUERTE, CAMPO, ETIQUETA, TARJETA, plural } from './comun';

const MOTIVOS = {
  DANADO: 'Dañado',
  CADUCADO: 'Caducado',
  ROBO: 'Robo o extravío',
  MUESTRA: 'Muestra o uso interno',
  OTRO: 'Otro',
};

const ESTADOS = {
  PENDIENTE: { texto: 'Por autorizar', clase: 'bg-estado-pend-bg text-estado-pend-text' },
  AUTORIZADA: { texto: 'Autorizada', clase: 'bg-estado-ok-bg text-estado-ok-text' },
  RECHAZADA: { texto: 'Rechazada', clase: 'bg-surface-container-high text-on-surface-variant' },
  CANCELADA: { texto: 'Cancelada', clase: 'bg-estado-cancel-bg text-estado-cancel-text' },
};

const TOPE_MB = 3;

/** Foto → JPEG de máximo 1600 px; así pesa poco aunque venga de un celular. PDF tal cual. */
function leerEvidencia(archivo) {
  return new Promise((resolve, reject) => {
    if (archivo.type === 'application/pdf') {
      if (archivo.size > TOPE_MB * 1024 * 1024) return reject(new Error(`El PDF pesa más de ${TOPE_MB} MB`));
      const lector = new FileReader();
      lector.onload = () => resolve({ base64: lector.result, nombre: archivo.name });
      lector.onerror = () => reject(new Error('No se pudo leer el archivo'));
      lector.readAsDataURL(archivo);
      return;
    }
    if (!archivo.type.startsWith('image/')) return reject(new Error('Sube una foto o un PDF'));
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(img.width * escala);
      lienzo.height = Math.round(img.height * escala);
      lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
      URL.revokeObjectURL(url);
      resolve({ base64: lienzo.toDataURL('image/jpeg', 0.82), nombre: archivo.name.replace(/\.\w+$/, '') + '.jpg' });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo abrir la imagen'));
    };
    img.src = url;
  });
}

export default function Merma({ atiende, puedeAutorizar, onCambio }) {
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [estado, setEstado] = useState('');
  const [lista, setLista] = useState(null);
  const [nueva, setNueva] = useState(false);
  const [viendo, setViendo] = useState(null); // evidencia abierta
  const [resolviendo, setResolviendo] = useState(null); // { merma, accion }
  const pag = usePaginacion(lista || [], 12, `${desde}|${hasta}|${estado}`);

  async function cargar() {
    setLista(null);
    try {
      setLista(await tiendaApi.mermas({ desde, hasta, estado: estado || undefined }));
    } catch (err) {
      avisoError('No se cargaron las mermas', err.message);
      setLista([]);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, estado]);

  const totales = useMemo(() => {
    const ok = (lista || []).filter((m) => m.estado === 'AUTORIZADA');
    return {
      piezas: ok.reduce((t, m) => t + m.cantidad, 0),
      costo: ok.reduce((t, m) => t + Number(m.costo_total || 0), 0),
      pendientes: (lista || []).filter((m) => m.estado === 'PENDIENTE').length,
    };
  }, [lista]);

  async function abrirEvidencia(m) {
    try {
      const { url, tipo } = await tiendaApi.evidenciaMerma(m.id);
      setViendo({ folio: m.folio, url, tipo });
    } catch (err) {
      avisoError('No se pudo abrir la evidencia', err.message);
    }
  }

  function cerrarEvidencia() {
    if (viendo?.url) URL.revokeObjectURL(viendo.url);
    setViendo(null);
  }

  async function autorizar(m) {
    const ok = await confirmar({
      titulo: `¿Autorizar ${m.folio}?`,
      texto: `Saldrán ${plural(m.cantidad, 'pieza')} de «${m.producto_descripcion}» del inventario.`,
      confirmar: 'Autorizar',
    });
    if (!ok) return;
    try {
      await tiendaApi.autorizarMerma(m.id, {});
      exito('Merma autorizada', 'Las piezas ya salieron del inventario.');
      cargar();
      onCambio?.();
    } catch (err) {
      avisoError('No se pudo autorizar', err.message);
    }
  }

  function descargar() {
    const filas = [
      ['Folio', 'Fecha', 'Producto', 'Cantidad', 'Motivo', 'Justificación', 'Registró', 'Estado', 'Resolvió', 'Fecha resolución', 'Nota', 'Costo'],
      ...(lista || []).map((m) => [
        m.folio, m.created_at, m.producto_descripcion, m.cantidad, m.motivo_nombre, m.justificacion,
        m.solicito_nombre, ESTADOS[m.estado]?.texto || m.estado, m.resolvio_nombre || '', m.resuelta_en || '',
        m.nota_resolucion || '', m.costo_total ?? '',
      ]),
    ];
    const csv = filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `merma-tienda-${desde}_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-gutter">
      <section className={`${TARJETA} p-4`}>
        <div className="flex flex-wrap items-end gap-2.5">
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
              {Object.entries(ESTADOS).map(([k, v]) => (
                <option key={k} value={k}>{v.texto}</option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex gap-2">
            <button onClick={descargar} disabled={!lista?.length} className={BOTON}>
              <Icono nombre="descarga" size={15} /> Excel (CSV)
            </button>
            <button onClick={() => setNueva(true)} className={BOTON_FUERTE}>
              <Icono nombre="add" size={16} /> Registrar merma
            </button>
          </div>
        </div>
        <p className="mt-3 text-body-md text-on-surface-variant">
          {plural(totales.piezas, 'pieza')} autorizadas · {mxn(totales.costo)} al costo
          {totales.pendientes > 0 && ` · ${plural(totales.pendientes, 'solicitud')} por autorizar`}
        </p>
      </section>

      <section className="caja-lineas">
        <div className="overflow-x-auto">
          <table className="tabla-lineas min-w-[980px] text-left">
            <thead>
              <tr className="text-label-sm uppercase tracking-wider text-outline">
                <th className="px-3 py-3">Folio</th>
                <th className="px-3 py-3">Producto</th>
                <th className="px-3 py-3 text-right">Cant.</th>
                <th className="px-3 py-3">Motivo y justificación</th>
                <th className="px-3 py-3">Registró</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {lista === null && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-outline">Cargando…</td></tr>
              )}
              {lista?.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-outline">Sin mermas en este periodo</td></tr>
              )}
              {pag.visibles.map((m) => {
                const est = ESTADOS[m.estado] || { texto: m.estado, clase: '' };
                return (
                  <tr key={m.id} className="align-top">
                    <td className="px-3 py-3">
                      <span className="block font-mono text-body-md">{m.folio}</span>
                      <span className="text-label-sm text-outline">{fechaHora(m.created_at)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="block text-body-lg">{m.producto_descripcion}</span>
                      <span className="font-mono text-label-sm text-outline">{m.producto_codigo}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-body-md">
                      {m.cantidad}
                      {m.ubicacion && <span className="block text-label-sm text-outline">{m.ubicacion === 'TIENDA' ? 'tienda' : 'bodega'}</span>}
                    </td>
                    <td className="max-w-[300px] px-3 py-3">
                      <span className="block text-body-lg font-semibold">{m.motivo_nombre}</span>
                      <span className="text-body-md text-on-surface-variant">{m.justificacion}</span>
                    </td>
                    <td className="px-3 py-3 text-body-md">{m.solicito_nombre}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-block rounded px-2 py-0.5 text-label-sm ${est.clase}`}>{est.texto}</span>
                      {m.resolvio_nombre && (
                        <span className="mt-1 block text-label-sm text-outline">
                          {m.estado === 'RECHAZADA' ? 'Rechazó' : m.estado === 'CANCELADA' ? 'Canceló' : 'Autorizó'}: {m.resolvio_nombre}
                        </span>
                      )}
                      {m.nota_resolucion && <span className="block text-label-sm text-on-surface-variant">«{m.nota_resolucion}»</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {m.tiene_evidencia && (
                          <button onClick={() => abrirEvidencia(m)} className={BOTON}>Evidencia</button>
                        )}
                        {puedeAutorizar && m.estado === 'PENDIENTE' && (
                          <>
                            <button onClick={() => autorizar(m)} className={BOTON_FUERTE}>Autorizar</button>
                            <button onClick={() => setResolviendo({ merma: m, accion: 'rechazar' })} className={BOTON}>Rechazar</button>
                          </>
                        )}
                        {puedeAutorizar && m.estado === 'AUTORIZADA' && (
                          <button onClick={() => setResolviendo({ merma: m, accion: 'cancelar' })} className={BOTON}>Cancelar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Paginador pag={pag} etiqueta="mermas" />
      </section>

      {nueva && (
        <NuevaMerma
          atiende={atiende}
          onClose={() => setNueva(false)}
          onListo={() => {
            setNueva(false);
            cargar();
            onCambio?.();
          }}
        />
      )}

      {resolviendo && (
        <Resolver
          {...resolviendo}
          onClose={() => setResolviendo(null)}
          onListo={() => {
            setResolviendo(null);
            cargar();
            onCambio?.();
          }}
        />
      )}

      <Modal open={!!viendo} title={viendo ? `Evidencia ${viendo.folio}` : ''} onClose={cerrarEvidencia} ancho="max-w-3xl">
        {viendo?.tipo === 'application/pdf' ? (
          <iframe title="Evidencia" src={viendo.url} className="h-[60vh] w-full rounded border border-outline-variant" />
        ) : (
          viendo && <img src={viendo.url} alt="Evidencia de la merma" className="mx-auto max-h-[60vh] rounded" />
        )}
      </Modal>
    </div>
  );
}

function Resolver({ merma, accion, onClose, onListo }) {
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const rechazar = accion === 'rechazar';

  async function enviar() {
    setEnviando(true);
    try {
      if (rechazar) await tiendaApi.rechazarMerma(merma.id, { nota: nota.trim() });
      else await tiendaApi.cancelarMerma(merma.id, { nota: nota.trim() });
      exito(rechazar ? 'Merma rechazada' : 'Merma cancelada', rechazar ? 'El inventario no se movió.' : 'Las piezas regresaron al inventario.');
      onListo();
    } catch (err) {
      avisoError('No se pudo completar', err.message);
      setEnviando(false);
    }
  }

  return (
    <Modal
      open
      title={`${rechazar ? 'Rechazar' : 'Cancelar'} ${merma.folio}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={BOTON}>Volver</button>
          <button onClick={enviar} disabled={enviando || nota.trim().length < 3} className={BOTON_FUERTE}>
            {rechazar ? 'Rechazar merma' : 'Cancelar merma'}
          </button>
        </>
      }
    >
      <p className="mb-3 text-body-md text-on-surface-variant">
        {plural(merma.cantidad, 'pieza')} de «{merma.producto_descripcion}».
        {!rechazar && ' Al cancelar, las piezas regresan al inventario y queda constancia de quién lo hizo.'}
      </p>
      <label>
        <span className={ETIQUETA}>{rechazar ? 'Motivo del rechazo' : 'Motivo de la cancelación'}</span>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} maxLength={300} className={CAMPO} />
      </label>
    </Modal>
  );
}

function NuevaMerma({ atiende, onClose, onListo }) {
  const [productos, setProductos] = useState([]);
  const [termino, setTermino] = useState('');
  const [producto, setProducto] = useState(null);
  const [cantidad, setCantidad] = useState('1');
  const [ubicacion, setUbicacion] = useState('');
  const [motivo, setMotivo] = useState('DANADO');
  const [justificacion, setJustificacion] = useState('');
  const [quien, setQuien] = useState(atiende);
  const [evidencia, setEvidencia] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    tiendaApi.productos({}).then(setProductos).catch(() => setProductos([]));
  }, []);

  const coincidencias = useMemo(() => {
    const t = termino.trim().toLowerCase();
    if (!t) return [];
    return productos
      .filter((p) => p.codigo.toLowerCase().includes(t) || p.descripcion.toLowerCase().includes(t))
      .slice(0, 6);
  }, [productos, termino]);

  async function elegirArchivo(e) {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    try {
      setEvidencia(await leerEvidencia(archivo));
    } catch (err) {
      avisoError('Evidencia no válida', err.message);
    }
  }

  const n = Number(cantidad);
  const listo =
    producto && Number.isInteger(n) && n >= 1 && justificacion.trim().length >= 5 && quien.trim().length >= 3 &&
    (motivo !== 'ROBO' || evidencia);

  async function enviar() {
    setEnviando(true);
    try {
      await tiendaApi.solicitarMerma({
        producto_id: producto.id,
        cantidad: n,
        ubicacion: ubicacion || null,
        motivo_tipo: motivo,
        justificacion: justificacion.trim(),
        atendio: quien.trim(),
        evidencia_base64: evidencia?.base64 || null,
        evidencia_nombre: evidencia?.nombre || null,
      });
      exito('Merma registrada', 'Queda por autorizar; el inventario no se mueve hasta entonces.');
      onListo();
    } catch (err) {
      avisoError('No se pudo registrar', err.message);
      setEnviando(false);
    }
  }

  return (
    <Modal
      open
      title="Registrar merma"
      onClose={onClose}
      ancho="max-w-xl"
      footer={
        <>
          <button onClick={onClose} className={BOTON}>Cancelar</button>
          <button onClick={enviar} disabled={!listo || enviando} className={BOTON_FUERTE}>Enviar a autorización</button>
        </>
      }
    >
      <div className="space-y-3">
        {producto ? (
          <div className="flex items-start justify-between gap-3 rounded border border-outline-variant bg-surface-container-low px-3 py-2">
            <div>
              <p className="text-body-lg font-semibold">{producto.descripcion}</p>
              <p className="font-mono text-label-sm text-outline">
                {producto.codigo} · tienda {producto.existencia} · bodega {producto.existencia_bodega}
              </p>
            </div>
            <button onClick={() => setProducto(null)} className="text-body-md text-primary underline">Cambiar</button>
          </div>
        ) : (
          <label className="relative block">
            <span className={ETIQUETA}>Producto</span>
            <input
              value={termino}
              onChange={(e) => setTermino(e.target.value)}
              placeholder="Código o nombre"
              className={CAMPO}
              autoFocus
            />
            {coincidencias.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded border border-outline-variant bg-surface-container-lowest shadow-modal">
                {coincidencias.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setProducto(p)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-container-low"
                    >
                      <span className="text-body-lg">{p.descripcion}</span>
                      <span className="font-mono text-label-sm text-outline">{p.codigo}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={ETIQUETA}>Cantidad</span>
            <input type="number" min={1} step={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} className={CAMPO} />
          </label>
          <label>
            <span className={ETIQUETA}>Lugar (opcional)</span>
            <select value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} className={CAMPO}>
              <option value="">Sin especificar</option>
              <option value="TIENDA">Tienda</option>
              <option value="BODEGA">Bodega</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className={ETIQUETA}>Motivo</span>
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CAMPO}>
            {Object.entries(MOTIVOS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={ETIQUETA}>Justificación</span>
          <textarea
            value={justificacion}
            onChange={(e) => setJustificacion(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Qué pasó con las piezas"
            className={CAMPO}
          />
        </label>

        <div>
          <span className={ETIQUETA}>Evidencia {motivo === 'ROBO' ? '(obligatoria)' : '(opcional)'}</span>
          <div className="flex items-center gap-2">
            <label className={`${BOTON} cursor-pointer`}>
              <Icono nombre="add" size={15} /> {evidencia ? 'Cambiar archivo' : 'Foto o PDF'}
              <input type="file" accept="image/*,application/pdf" onChange={elegirArchivo} className="hidden" data-testid="merma-archivo" />
            </label>
            {evidencia && (
              <span className="flex items-center gap-2 text-body-md text-on-surface-variant">
                {evidencia.nombre}
                <button onClick={() => setEvidencia(null)} className="text-error underline">Quitar</button>
              </span>
            )}
          </div>
        </div>

        <label className="block">
          <span className={ETIQUETA}>Quién registra</span>
          <input value={quien} onChange={(e) => setQuien(e.target.value)} placeholder="Escribe tu nombre" className={CAMPO} />
        </label>
      </div>
    </Modal>
  );
}
