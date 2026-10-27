/**
 * Caja de la tienda: su propio fondo y su propio corte, aparte de la caja de
 * green fees. Se abre con un fondo, se vende, y al cerrar se cuenta el
 * efectivo: el sistema dice cuánto debería haber y la diferencia queda guardada.
 */
import { useEffect, useMemo, useState } from 'react';

import { catalogApi, tiendaApi } from '../../api/client';
import Icono from '../../components/Icono';
import { Modal, Paginador, usePaginacion } from '../../components/ui';
import { error as avisoError, notificar } from '../../utils/avisos';
import { fecha, fechaHora, mxn } from '../../utils/format';
import { BOTON, BOTON_FUERTE, CAMPO, Cifra, ETIQUETA, TARJETA, plural } from './comun';

const DENOMINACIONES = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];

export default function Caja({ caja, atiende, onCajaCambio, horario, puedeAdministrar }) {
  const [cortes, setCortes] = useState([]);
  const [cerrando, setCerrando] = useState(false);
  const [imprimir, setImprimir] = useState(null);
  const [arqueando, setArqueando] = useState(null);
  const [ajustandoFondo, setAjustandoFondo] = useState(false);
  const [horaCierre, setHoraCierre] = useState('22:00');

  useEffect(() => {
    catalogApi
      .settings()
      .then((l) => setHoraCierre(l.find((x) => x.key === 'cierre_automatico_caja')?.value || '22:00'))
      .catch(() => {});
  }, []);
  const pendientes = cortes.filter((c) => c.pendiente_arqueo);
  const pagCortes = usePaginacion(cortes, 8);

  function cargarCortes() {
    if (!puedeAdministrar) return;
    tiendaApi.cortes().then(setCortes).catch(() => setCortes([]));
  }

  useEffect(() => {
    cargarCortes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caja?.id, caja?.estado]);

  return (
    <div className="space-y-gutter">
      {caja ? (
        <section className={`${TARJETA} p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-label-sm uppercase tracking-wider text-estado-ok-text">● Caja abierta</p>
              <h2 className="font-serif text-headline-lg text-primary">Corte #{caja.id} · {fecha(caja.fecha)}</h2>
              <p className="text-body-md text-outline">
                Se abrió sola con {caja.abierto_por_nombre} · {fechaHora(caja.abierto_en)} · fondo {mxn(caja.fondo_inicial)}
                {' '}
                <button type="button" onClick={() => setAjustandoFondo(true)} className="underline underline-offset-2 hover:text-primary">
                  cambiar fondo
                </button>
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-body-md text-on-surface-variant">
                <Icono nombre="reloj" size={15} /> Si nadie la cierra, se cierra sola a las <strong>{horaCierre}</strong> y queda
                pendiente contar el efectivo.
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setImprimir(caja)} className={BOTON}>
                <Icono nombre="imprimir" size={15} /> Corte parcial
              </button>
              <button type="button" onClick={() => setCerrando(true)} className={BOTON_FUERTE}>
                <Icono nombre="candado" size={16} className="text-secondary-fixed" /> Cerrar caja
              </button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Cifra label="Vendido" valor={mxn(caja.ventas_total)} pie={`${plural(caja.ventas_cuenta, 'venta')} · ${plural(caja.canceladas, 'cancelada')}`} oscuro />
            <Cifra label="Efectivo en cajón" valor={mxn(caja.efectivo_esperado)} pie={`fondo + ${mxn(caja.efectivo_ventas)} de ventas`} />
            <Cifra label="Tarjeta" valor={mxn(caja.tarjeta_total)} pie="vouchers de la terminal" />
            <Cifra label="Transferencia" valor={mxn(caja.transferencia_total)} />
            <Cifra label="Utilidad" valor={mxn(caja.utilidad)} pie="venta menos costo" tono="text-estado-ok-text" />
          </div>
        </section>
      ) : (
        <section className={`${TARJETA} flex flex-col items-center gap-3 p-10 text-center`}>
          <Icono nombre="cajaFuerte" size={40} className="text-outline" />
          <h2 className="font-serif text-headline-lg text-primary">
            {horario?.fuera ? `La caja cerró a las ${horario.cierraA}` : 'La caja de la tienda no está abierta'}
          </h2>
          <p className="max-w-md text-body-lg text-on-surface-variant">
            {horario?.fuera
              ? 'Ya no admite ventas por hoy. Mañana se abre sola con la primera venta, a nombre de quien atienda.'
              : 'Se abre sola con la primera venta, a nombre de quien atienda. Si acaba de entrar, espere un momento.'}{' '}
            Es independiente de la caja de green fees.
          </p>
        </section>
      )}

      {pendientes.length > 0 && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-estado-pend-border bg-estado-pend-bg px-5 py-4">
          <p className="text-body-lg text-estado-pend-text">
            <strong>{pendientes.length === 1 ? 'Un corte se cerró solo' : `${pendientes.length} cortes se cerraron solos`}</strong>{' '}
            a la hora de cierre y falta contar el efectivo.
          </p>
          <button type="button" onClick={() => setArqueando(pendientes[pendientes.length - 1])} className={BOTON_FUERTE}>
            <Icono nombre="arqueo" size={16} className="text-secondary-fixed" /> Contar corte #{pendientes[pendientes.length - 1].id}
          </button>
        </section>
      )}

      {ajustandoFondo && caja && (
        <FondoDeCambio
          caja={caja}
          onCerrar={() => setAjustandoFondo(false)}
          onListo={() => {
            setAjustandoFondo(false);
            onCajaCambio?.();
          }}
        />
      )}

      {puedeAdministrar && (
        <section className={TARJETA}>
          <div className="flex items-center justify-between px-4 pt-4">
            <h3 className="text-title-lg text-primary">Cortes anteriores</h3>
            <button type="button" onClick={cargarCortes} className="text-outline transition hover:text-primary" title="Actualizar">
              <Icono nombre="refrescar" size={17} />
            </button>
          </div>
          <div className="mt-2 overflow-x-auto">
          <table className="tabla-lineas min-w-[880px] text-left">
            <thead>
              <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                <th className="px-4 py-3">Corte</th>
                <th className="px-3 py-3">Abrió / cerró</th>
                <th className="px-3 py-3 text-right">Ventas</th>
                <th className="px-3 py-3 text-right">Efectivo esperado</th>
                <th className="px-3 py-3 text-right">Contado</th>
                <th className="px-3 py-3 text-right">Diferencia</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {pagCortes.visibles.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="text-title-md text-primary">#{c.id} · {fecha(c.fecha)}</p>
                    <p className={`text-label-sm uppercase tracking-wider ${c.estado === 'ABIERTO' ? 'text-estado-ok-text' : 'text-outline'}`}>
                      {c.estado === 'ABIERTO' ? 'Abierto' : 'Cerrado'}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-body-md">
                    <p>{c.abierto_por_nombre} · {fechaHora(c.abierto_en)}</p>
                    {c.cerrado_en && <p className="text-outline">{c.cerrado_por_nombre} · {fechaHora(c.cerrado_en)}</p>}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-body-md">
                    {mxn(c.ventas_total)}
                    <p className="text-label-md text-outline">{plural(c.ventas_cuenta, 'venta')}</p>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-body-md">{mxn(c.efectivo_esperado)}</td>
                  <td className="px-3 py-3 text-right font-mono text-body-md">{c.efectivo_contado != null ? mxn(c.efectivo_contado) : '—'}</td>
                  <td className="px-3 py-3 text-right">
                    {c.pendiente_arqueo ? (
                      <button
                        type="button"
                        onClick={() => setArqueando(c)}
                        className="rounded border border-estado-pend-border bg-estado-pend-bg px-2 py-1 text-label-md text-estado-pend-text hover:brightness-95"
                      >
                        Contar efectivo
                      </button>
                    ) : (
                      <Diferencia valor={c.diferencia} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => setImprimir(c)} className="text-outline transition hover:text-primary" title="Imprimir corte">
                      <Icono nombre="imprimir" size={17} />
                    </button>
                  </td>
                </tr>
              ))}
              {!cortes.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-body-lg text-outline">Todavía no hay cortes.</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
          <Paginador pag={pagCortes} etiqueta="cortes" />
        </section>
      )}

      {cerrando && caja && (
        <CerrarCaja
          caja={caja}
          atiende={atiende}
          onCerrar={() => setCerrando(false)}
          onListo={(corte) => {
            setCerrando(false);
            onCajaCambio?.();
            setImprimir(corte);
          }}
        />
      )}
      {arqueando && (
        <CerrarCaja
          caja={arqueando}
          arqueo
          atiende={atiende}
          onCerrar={() => setArqueando(null)}
          onListo={(corte) => {
            setArqueando(null);
            cargarCortes();
            setImprimir(corte);
          }}
        />
      )}
      {imprimir && <HojaCorte corte={imprimir} onCerrar={() => setImprimir(null)} />}
    </div>
  );
}

function Diferencia({ valor }) {
  if (valor == null) return <span className="text-outline">—</span>;
  const n = Number(valor);
  const tono = n === 0 ? 'text-estado-ok-text' : n > 0 ? 'text-estado-pend-text' : 'text-error';
  return (
    <span className={`font-mono text-title-md ${tono}`}>
      {n === 0 ? 'Cuadra' : `${n > 0 ? 'Sobran ' : 'Faltan '}${mxn(Math.abs(n))}`}
    </span>
  );
}

/* --------------------------------------------------------------- cerrar */
function CerrarCaja({ caja, atiende, onCerrar, onListo, arqueo = false }) {
  const [conteo, setConteo] = useState({});
  const [directo, setDirecto] = useState('');
  const [porBilletes, setPorBilletes] = useState(true);
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);

  const contado = useMemo(
    () => (porBilletes ? DENOMINACIONES.reduce((t, d) => t + d * Number(conteo[d] || 0), 0) : Number(directo || 0)),
    [conteo, directo, porBilletes],
  );
  const diferencia = Math.round((contado - Number(caja.efectivo_esperado)) * 100) / 100;

  async function cerrar() {
    if (atiende.trim().length < 3) return avisoError('¿Quién cierra?', 'Escriba arriba quién atiende.');
    if (diferencia !== 0 && notas.trim().length < 3) {
      return avisoError('Explique la diferencia', 'Si no cuadra, escriba una nota con lo que pasó.');
    }
    setGuardando(true);
    try {
      const cuerpo = { efectivo_contado: contado, atendio: atiende.trim(), notas: notas.trim() || null };
      const corte = arqueo ? await tiendaApi.arqueo(caja.id, cuerpo) : await tiendaApi.cerrarCaja(cuerpo);
      notificar(arqueo ? `Arqueo del corte #${caja.id} guardado` : 'Caja de tienda cerrada');
      onListo(corte);
    } catch (err) {
      avisoError('No se cerró', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open
      title={arqueo ? `Contar efectivo · corte #${caja.id}` : 'Cerrar caja de la tienda'}
      onClose={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className={BOTON}>Cancelar</button>
          <button type="button" onClick={cerrar} disabled={guardando} className={BOTON_FUERTE}>
            {guardando ? 'Guardando…' : arqueo ? 'Guardar arqueo' : 'Cerrar caja'}
          </button>
        </>
      }
    >
      <div className="flex gap-1.5">
        {[
          [true, 'Contar billetes'],
          [false, 'Escribir el total'],
        ].map(([v, t]) => (
          <button
            key={t}
            type="button"
            onClick={() => setPorBilletes(v)}
            className={`rounded-full border px-3 py-1 text-label-md ${
              porBilletes === v ? 'border-primary-container bg-primary-container text-on-primary' : 'border-outline-variant text-on-surface-variant'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {porBilletes ? (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {DENOMINACIONES.map((d) => (
            <label key={d} className="flex items-center gap-2">
              <span className="w-14 text-right font-mono text-body-md text-on-surface-variant">${d >= 1 ? d : '0.50'}</span>
              <input
                type="number"
                min="0"
                value={conteo[d] ?? ''}
                onChange={(e) => setConteo({ ...conteo, [d]: e.target.value })}
                className={`${CAMPO} py-1 font-mono`}
                placeholder="0"
              />
            </label>
          ))}
        </div>
      ) : (
        <label className="mt-3 block">
          <span className={ETIQUETA}>Efectivo contado en el cajón</span>
          <input type="number" min="0" step="0.5" value={directo} onChange={(e) => setDirecto(e.target.value)} className={`${CAMPO} font-mono text-title-lg`} autoFocus />
        </label>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-surface-container-low p-2">
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">Debería haber</p>
          <p className="font-mono text-title-lg">{mxn(caja.efectivo_esperado)}</p>
        </div>
        <div className="rounded bg-surface-container-low p-2">
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">Contado</p>
          <p className="font-mono text-title-lg">{mxn(contado)}</p>
        </div>
        <div className={`rounded p-2 ${diferencia === 0 ? 'bg-estado-ok-bg' : diferencia > 0 ? 'bg-estado-pend-bg' : 'bg-estado-cancel-bg'}`}>
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">Diferencia</p>
          <Diferencia valor={diferencia} />
        </div>
      </div>
      <p className="mt-2 text-body-md text-outline">
        Tarjeta {mxn(caja.tarjeta_total)} y transferencia {mxn(caja.transferencia_total)} se cuadran con la terminal y el banco.
      </p>
      <label className="mt-3 block">
        <span className={ETIQUETA}>Notas {diferencia !== 0 && '(obligatorio si no cuadra)'}</span>
        <input value={notas} onChange={(e) => setNotas(e.target.value)} className={CAMPO} />
      </label>
    </Modal>
  );
}

/* ------------------------------------------------------- hoja imprimible */
function HojaCorte({ corte, onCerrar }) {
  const fila = (a, b, fuerte) => (
    <div className={`flex justify-between ${fuerte ? 'font-semibold' : ''}`}>
      <span>{a}</span>
      <span>{b}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4">
      <div className="my-4 w-full max-w-sm">
        <div className="no-imprimir mb-3 flex items-center justify-between gap-2">
          <p className="text-title-lg text-white">Corte #{corte.id}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => window.print()} className="flex items-center gap-1.5 rounded bg-primary-container px-4 py-2 text-title-md text-on-primary shadow-card hover:bg-primary">
              <Icono nombre="imprimir" size={16} className="text-secondary-fixed" /> Imprimir
            </button>
            <button type="button" onClick={onCerrar} className="rounded border border-white/40 px-4 py-2 text-title-md text-white hover:bg-white/10">
              Cerrar
            </button>
          </div>
        </div>
        <div className="documento-imprimible ticket rounded-lg bg-white p-6 font-mono text-[12.5px] leading-snug text-black shadow-modal">
          <div className="text-center">
            <p className="font-serif text-[18px] font-semibold">Las Parotas</p>
            <p className="text-[11px] uppercase tracking-widest">Pro-Shop · {corte.estado === 'ABIERTO' ? 'Corte parcial' : 'Corte de caja'}</p>
          </div>
          <div className="my-3 border-t border-dashed border-black/50" />
          {fila('Corte', `#${corte.id}`)}
          {fila('Fecha', fecha(corte.fecha))}
          {fila('Abrió', corte.abierto_por_nombre)}
          {fila('Apertura', fechaHora(corte.abierto_en))}
          {corte.cerrado_en && fila('Cerró', corte.cerrado_por_nombre)}
          {corte.cerrado_en && fila('Cierre', fechaHora(corte.cerrado_en))}
          {corte.estado === 'ABIERTO' && fila('Impreso', fechaHora(new Date().toISOString()))}
          <div className="my-3 border-t border-dashed border-black/50" />
          {fila('Ventas', corte.ventas_cuenta)}
          {fila('Canceladas', corte.canceladas)}
          {fila('Total vendido', mxn(corte.ventas_total), true)}
          <div className="my-3 border-t border-dashed border-black/50" />
          {fila('Fondo inicial', mxn(corte.fondo_inicial))}
          {fila('Efectivo de ventas', mxn(corte.efectivo_ventas))}
          {fila('Efectivo esperado', mxn(corte.efectivo_esperado), true)}
          {corte.efectivo_contado != null && fila('Efectivo contado', mxn(corte.efectivo_contado))}
          {corte.diferencia != null && fila('Diferencia', mxn(corte.diferencia), true)}
          <div className="my-3 border-t border-dashed border-black/50" />
          {fila('Tarjeta', mxn(corte.tarjeta_total))}
          {fila('Transferencia', mxn(corte.transferencia_total))}
          {corte.notas && <p className="mt-3">Notas: {corte.notas}</p>}
          <div className="mt-10 grid grid-cols-2 gap-4 text-center text-[10px]">
            <p className="border-t border-black pt-1">Entrega</p>
            <p className="border-t border-black pt-1">Recibe</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** El fondo de cambio del cajón: la caja abre en cero y aquí se pone el real. */
function FondoDeCambio({ caja, onCerrar, onListo }) {
  const [fondo, setFondo] = useState(String(Number(caja.fondo_inicial || 0)));
  const [guardando, setGuardando] = useState(false);

  async function guardar(e) {
    e?.preventDefault();
    if (fondo === '' || Number(fondo) < 0) return avisoError('Fondo inválido', 'Escriba la cantidad de cambio que hay en el cajón.');
    setGuardando(true);
    try {
      await tiendaApi.fondoCaja({ fondo_inicial: Number(fondo) });
      notificar('Fondo actualizado');
      onListo();
    } catch (err) {
      avisoError('No se pudo guardar', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open
      title="Fondo de cambio"
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
      <form onSubmit={guardar}>
        <p className="text-body-lg text-on-surface-variant">
          La caja se abrió sola con el fondo en cero. Cuente el cambio que hay en el cajón y escríbalo aquí para que el
          corte cuadre.
        </p>
        <label className="mt-4 block">
          <span className={ETIQUETA}>Fondo de cambio</span>
          <input
            type="number" min="0" step="0.5" value={fondo}
            onChange={(e) => setFondo(e.target.value)}
            className={`${CAMPO} font-mono text-title-lg`} autoFocus
          />
        </label>
      </form>
    </Modal>
  );
}
