/**
 * Reportes de la tienda: cuánto se vendió, cuánto se ganó, qué se mueve y qué
 * no, a qué hora y quién vende. Las gráficas son barras simples en CSS.
 */
import { useEffect, useState } from 'react';

import { tiendaApi } from '../../api/client';
import Icono from '../../components/Icono';
import { error as avisoError } from '../../utils/avisos';
import { fechaCorta, hoy, mxn } from '../../utils/format';
import { BOTON, CAMPO, Cifra, ETIQUETA, METODOS, TARJETA, plural } from './comun';

function rango(tipo) {
  const fin = hoy();
  const d = new Date(`${fin}T12:00:00`);
  const iso = (x) => x.toISOString().slice(0, 10);
  if (tipo === 'hoy') return [fin, fin];
  if (tipo === '7') return [iso(new Date(d.getTime() - 6 * 864e5)), fin];
  if (tipo === '30') return [iso(new Date(d.getTime() - 29 * 864e5)), fin];
  if (tipo === 'mes') return [`${fin.slice(0, 8)}01`, fin];
  if (tipo === 'anio') return [`${fin.slice(0, 4)}-01-01`, fin];
  return [fin, fin];
}

const ATAJOS = [
  ['hoy', 'Hoy'],
  ['7', '7 días'],
  ['30', '30 días'],
  ['mes', 'Este mes'],
  ['anio', 'Este año'],
];

export default function Reportes() {
  const [[desde, hasta], setRango] = useState(rango('mes'));
  const [atajo, setAtajo] = useState('mes');
  const [r, setR] = useState(null);
  const [inv, setInv] = useState(null);

  async function cargar() {
    setR(null);
    try {
      const [rep, res] = await Promise.all([tiendaApi.reportes({ desde, hasta }), tiendaApi.resumen()]);
      setR(rep);
      setInv(res);
    } catch (err) {
      avisoError('No se cargó el reporte', err.message);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  function exportar() {
    if (!r) return;
    const filas = [
      ['Reporte de tienda', `${desde} a ${hasta}`],
      [],
      ['Ventas', r.ventas], ['Total', r.total], ['Costo', r.costo], ['Utilidad', r.utilidad],
      ['Margen %', r.margen_pct], ['Piezas', r.piezas], ['Ticket promedio', r.ticket_promedio],
      ['Descuentos', r.descuentos], ['Canceladas', r.canceladas],
      [],
      ['Fecha', 'Ventas', 'Total', 'Utilidad'],
      ...r.por_dia.map((d) => [d.fecha, d.ventas, d.total, d.utilidad]),
      [],
      ['Codigo', 'Producto', 'Categoria', 'Piezas', 'Importe', 'Utilidad'],
      ...r.top_productos.map((p) => [p.codigo, p.descripcion, p.categoria, p.piezas, p.importe, p.utilidad]),
    ];
    const csv = filas.map((f) => f.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte-tienda-${desde}-a-${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-gutter">
      <section className={`${TARJETA} flex flex-wrap items-end gap-2.5 p-4`}>
        <div className="flex flex-wrap gap-1.5">
          {ATAJOS.map(([k, t]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setAtajo(k);
                setRango(rango(k));
              }}
              className={`rounded-full border px-3 py-1.5 text-label-md transition ${
                atajo === k
                  ? 'border-primary-container bg-primary-container text-on-primary'
                  : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="ml-auto">
          <span className={ETIQUETA}>Desde</span>
          <input type="date" value={desde} max={hasta} onChange={(e) => { setAtajo(''); setRango([e.target.value, hasta]); }} className={CAMPO} />
        </label>
        <label>
          <span className={ETIQUETA}>Hasta</span>
          <input type="date" value={hasta} min={desde} onChange={(e) => { setAtajo(''); setRango([desde, e.target.value]); }} className={CAMPO} />
        </label>
        <button type="button" onClick={exportar} disabled={!r} className={BOTON}>
          <Icono nombre="descarga" size={15} /> CSV
        </button>
      </section>

      {!r ? (
        <p className="py-16 text-center text-body-lg text-outline">Cargando reporte…</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Cifra label="Vendido" valor={mxn(r.total)} pie={`${plural(r.ventas, 'venta')} · ${plural(r.piezas, 'pieza')}`} oscuro />
            <Cifra label="Utilidad" valor={mxn(r.utilidad)} pie={`margen ${Number(r.margen_pct).toFixed(1)}% · costo ${mxn(r.costo)}`} tono="text-estado-ok-text" />
            <Cifra label="Ticket promedio" valor={mxn(r.ticket_promedio)} pie={`descuentos ${mxn(r.descuentos)}`} />
            <Cifra
              label="Canceladas"
              valor={r.canceladas}
              pie={r.canceladas ? `${mxn(r.canceladas_total)} cancelado` : 'ninguna'}
              tono={r.canceladas ? 'text-error' : undefined}
            />
          </section>

          <section className={`${TARJETA} p-5`}>
            <h3 className="text-title-lg text-primary">Ventas por día</h3>
            <PorDia dias={r.por_dia} />
          </section>

          <div className="grid gap-gutter xl:grid-cols-[1.6fr_1fr]">
            <section className={`${TARJETA} p-5`}>
              <h3 className="text-title-lg text-primary">Lo que más se vende</h3>
              {r.top_productos.length ? (
                <table className="mt-3 w-full text-left">
                  <thead>
                    <tr className="border-b border-outline-variant/50 text-label-sm uppercase tracking-wider text-on-surface-variant">
                      <th className="py-2">#</th>
                      <th className="py-2">Producto</th>
                      <th className="py-2 pl-3 text-right">Piezas</th>
                      <th className="py-2 pl-3 text-right">Importe</th>
                      <th className="py-2 pl-3 text-right">Utilidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.top_productos.map((p, i) => (
                      <tr key={p.producto_id ?? p.codigo} className="border-b border-outline-variant/30">
                        <td className="py-2 pr-2 font-mono text-label-md text-outline">{i + 1}</td>
                        <td className="py-2">
                          <p className="text-title-md">{p.descripcion}</p>
                          <p className="font-mono text-label-md text-outline">{p.codigo} · {p.categoria}</p>
                        </td>
                        <td className="py-2 pl-3 text-right font-mono">{p.piezas}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right font-mono">{mxn(p.importe)}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right font-mono text-estado-ok-text">{mxn(p.utilidad)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Vacio />
              )}
            </section>

            <div className="space-y-gutter">
              <section className={`${TARJETA} p-5`}>
                <h3 className="text-title-lg text-primary">Cómo pagan</h3>
                <Barras filas={r.por_metodo.map((m) => ({ k: METODOS[m.metodo] || m.metodo, v: Number(m.total) }))} formato={mxn} />
              </section>
              <section className={`${TARJETA} p-5`}>
                <h3 className="text-title-lg text-primary">Por categoría</h3>
                <Barras
                  filas={r.por_categoria.map((c) => ({ k: c.categoria, v: Number(c.total), pie: `${c.piezas} pzs · gana ${mxn(c.utilidad)}` }))}
                  formato={mxn}
                />
              </section>
            </div>
          </div>

          <div className="grid gap-gutter lg:grid-cols-2">
            <section className={`${TARJETA} p-5`}>
              <h3 className="text-title-lg text-primary">Horas de más venta</h3>
              <PorHora horas={r.por_hora} />
            </section>
            <section className={`${TARJETA} p-5`}>
              <h3 className="text-title-lg text-primary">Quién vende</h3>
              <Barras filas={r.por_vendedor.map((x) => ({ k: x.atendio, v: Number(x.total), pie: plural(x.ventas, 'venta') }))} formato={mxn} />
            </section>
          </div>
        </>
      )}

      {inv && (
        <section className={`${TARJETA} p-5`}>
          <h3 className="text-title-lg text-primary">Inventario hoy</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Cifra label="Valor al costo" valor={mxn(inv.valor_costo)} pie={`${plural(inv.piezas, 'pieza')} · ${inv.piezas_tienda} tienda · ${inv.piezas_bodega} bodega`} />
            <Cifra label="Valor a la venta" valor={mxn(inv.valor_venta)} pie={`ganancia posible ${mxn(Number(inv.valor_venta) - Number(inv.valor_costo))}`} />
            <Cifra label="Por comprar" valor={inv.por_surtir} pie={`${inv.sin_existencia} agotados`} tono={inv.por_surtir ? 'text-error' : undefined} />
            <Cifra label="Pasar a tienda" valor={inv.pasar_a_tienda} pie={`${inv.sobre_maximo} sobre el máximo`} tono={inv.pasar_a_tienda ? 'text-estado-pend-text' : undefined} />
          </div>
        </section>
      )}
    </div>
  );
}

function Vacio() {
  return <p className="py-8 text-center text-body-lg text-outline">Sin ventas en este periodo.</p>;
}

function Barras({ filas, formato = (x) => x }) {
  if (!filas.length) return <Vacio />;
  const max = Math.max(...filas.map((f) => f.v), 1);
  return (
    <ul className="mt-3 space-y-2.5">
      {filas.map((f) => (
        <li key={f.k}>
          <div className="flex justify-between gap-2 text-body-md">
            <span className="truncate">{f.k}</span>
            <span className="font-mono">{formato(f.v)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-surface-container-high">
            <div className="h-2 rounded-full bg-primary-container" style={{ width: `${(f.v / max) * 100}%` }} />
          </div>
          {f.pie && <p className="mt-0.5 text-label-md text-outline">{f.pie}</p>}
        </li>
      ))}
    </ul>
  );
}

function PorDia({ dias }) {
  if (!dias.length) return <Vacio />;
  const max = Math.max(...dias.map((d) => Number(d.total)), 1);
  return (
    <div className="mt-4 overflow-x-auto">
      <div className="flex h-56 min-w-full items-end gap-1" style={{ minWidth: `${dias.length * 22}px` }}>
        {dias.map((d) => {
          const total = Number(d.total);
          const util = Number(d.utilidad);
          return (
            <div key={d.fecha} className="group relative flex h-full flex-1 flex-col items-center justify-end">
              <div className="pointer-events-none absolute -top-1 z-10 hidden -translate-y-full whitespace-nowrap rounded bg-inverse-surface px-2 py-1 text-label-md text-inverse-on-surface group-hover:block">
                {fechaCorta(d.fecha)} · {mxn(total)} · {d.ventas} ventas
              </div>
              <div className="relative w-full max-w-[38px] rounded-t bg-primary-container/85" style={{ height: `${(total / max) * 100}%`, minHeight: total ? 3 : 0 }}>
                <div className="absolute bottom-0 w-full rounded-t bg-secondary-fixed" style={{ height: total ? `${(util / total) * 100}%` : 0 }} />
              </div>
              <span className="mt-1 text-[10px] text-outline">{d.fecha.slice(8, 10)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 flex gap-4 text-label-md text-outline">
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-primary-container/85" /> Venta</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-secondary-fixed" /> Utilidad</span>
      </p>
    </div>
  );
}

function PorHora({ horas }) {
  if (!horas.length) return <Vacio />;
  const mapa = Object.fromEntries(horas.map((h) => [h.hora, h]));
  const min = Math.min(7, ...horas.map((h) => h.hora));
  const maxH = Math.max(19, ...horas.map((h) => h.hora));
  const lista = Array.from({ length: maxH - min + 1 }, (_, i) => mapa[min + i] || { hora: min + i, total: 0, ventas: 0 });
  const max = Math.max(...lista.map((h) => Number(h.total)), 1);
  return (
    <div className="mt-4 flex h-44 items-end gap-1">
      {lista.map((h) => (
        <div key={h.hora} className="flex h-full flex-1 flex-col items-center justify-end" title={`${h.hora}:00 · ${mxn(h.total)} · ${h.ventas} ventas`}>
          <div className="w-full rounded-t bg-secondary" style={{ height: `${(Number(h.total) / max) * 100}%`, minHeight: Number(h.total) ? 3 : 0 }} />
          <span className="mt-1 text-[10px] text-outline">{h.hora}</span>
        </div>
      ))}
    </div>
  );
}
