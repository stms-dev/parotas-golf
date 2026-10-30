/**
 * Ventas totales.
 *
 * Lo cobrado, separado por sección (Green Fee, replay, tienda) y por forma de
 * pago (efectivo en pesos, dólares, tarjeta, transferencia). Sirve para dos
 * cosas: ver el detalle de un día y, con el mismo cálculo, juntar por semana,
 * mes o año; y saber cuánto debe haber en caja, cuánto llegó por transferencia
 * y cuántos dólares se recibieron.
 *
 * Las cifras son las que entraron a la caja: en efectivo ya está descontado el
 * cambio que se regresó, y los dólares conservan el tipo de cambio con el que
 * se cobraron.
 */
import { useEffect, useMemo, useState } from 'react';

import { treasuryApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Alert, Paginador, Spinner, usePaginacion } from '../components/ui';
import { fechaLocal, mxn, usd } from '../utils/format';

const AGRUPACIONES = [
  { key: 'dia', label: 'Día' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
  { key: 'anio', label: 'Año' },
];

const ATAJOS = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'semana', label: 'Últimos 7 días' },
  { key: 'mes', label: 'Este mes' },
  { key: 'anio', label: 'Este año' },
];

const COLUMNAS = [
  ['efectivo_mxn', 'Efectivo MXN'],
  ['efectivo_usd', 'Dólares'],
  ['tarjeta', 'Tarjeta'],
  ['transferencia', 'Transferencia'],
  ['pago_en_linea', 'Pago en línea'],
  ['total', 'Total'],
];

function rangoDe(clave) {
  const fin = new Date();
  const inicio = new Date();
  if (clave === 'semana') inicio.setDate(fin.getDate() - 6);
  if (clave === 'mes') inicio.setDate(1);
  if (clave === 'anio') {
    inicio.setMonth(0);
    inicio.setDate(1);
  }
  return { start: fechaLocal(inicio), end: fechaLocal(fin) };
}

/** Suma de las fuentes elegidas dentro de un conjunto de totales. */
function sumar(porFuente, claves) {
  const salida = { efectivo_mxn: 0, efectivo_usd: 0, efectivo_usd_en_mxn: 0, tarjeta: 0, transferencia: 0, pago_en_linea: 0, total: 0, operaciones: 0 };
  for (const c of claves) {
    const f = porFuente?.[c];
    if (!f) continue;
    for (const k of Object.keys(salida)) salida[k] += Number(f[k] || 0);
  }
  return salida;
}

function Celda({ fila, columna }) {
  if (columna === 'efectivo_usd') {
    const dolares = Number(fila.efectivo_usd);
    return dolares ? (
      <>
        <span className="block font-mono text-body-lg text-primary">{usd(dolares)}</span>
        <span className="block font-mono text-label-sm text-outline">{mxn(fila.efectivo_usd_en_mxn)}</span>
      </>
    ) : (
      <span className="text-outline">—</span>
    );
  }
  const valor = Number(fila[columna]);
  return valor ? (
    <span className={`font-mono ${columna === 'total' ? 'text-body-lg font-semibold text-primary' : 'text-body-lg text-on-surface'}`}>
      {mxn(valor)}
    </span>
  ) : (
    <span className="text-outline">—</span>
  );
}

export default function VentasTotalesPage() {
  // Quien no ve el total del campo (recepción) ve solo su corte del día.
  const { can } = useAuth();
  const soloMio = !can('finance:sales_totals');
  const [atajo, setAtajo] = useState('hoy');
  const [aMano, setAMano] = useState({ start: '', end: '' });
  const [agrupar, setAgrupar] = useState('dia');
  // A qué día se asigna un cobro: al día que entró el dinero o al día de juego.
  const [base, setBase] = useState('cobro');
  const [seccion, setSeccion] = useState('TODAS');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const rapido = rangoDe(atajo);
  const completo = aMano.start && aMano.end;
  const start = completo ? aMano.start : rapido.start;
  const end = completo ? aMano.end : rapido.end;
  const invertido = aMano.start && aMano.end && aMano.start > aMano.end;

  useEffect(() => {
    if (invertido) return undefined;
    let vigente = true;
    setCargando(true);
    setError(null);
    (soloMio ? treasuryApi.miDia() : treasuryApi.ventas({ start, end, group: agrupar, base }))
      .then((d) => vigente && setDatos(d))
      .catch((e) => vigente && setError(e.message))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [start, end, agrupar, base, invertido, soloMio]);

  const fuentes = datos?.fuentes || [];
  const elegidas = seccion === 'TODAS' ? fuentes.map((f) => f.clave) : [seccion];

  const filas = useMemo(
    () => (datos?.periodos || []).map((p) => ({ ...p, vista: sumar(p.por_fuente, elegidas) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datos, seccion],
  );
  const total = useMemo(() => sumar(datos?.totales?.por_fuente, elegidas), [datos, seccion]); // eslint-disable-line react-hooks/exhaustive-deps

  const pag = usePaginacion([...filas].reverse(), 10, `${start}|${end}|${agrupar}|${seccion}`);

  function exportar() {
    const cab = ['Periodo', 'Sección', 'Efectivo MXN', 'Dólares (USD)', 'Dólares en MXN', 'Tarjeta', 'Transferencia', 'Pago en línea', 'Total'];
    const lineas = [cab];
    for (const p of datos?.periodos || []) {
      for (const f of fuentes) {
        const v = p.por_fuente[f.clave];
        lineas.push([p.etiqueta, f.nombre, v.efectivo_mxn, v.efectivo_usd, v.efectivo_usd_en_mxn, v.tarjeta, v.transferencia, v.pago_en_linea, v.total]);
      }
    }
    const csv = lineas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas-${start}-a-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="font-serif text-display-lg leading-tight text-primary">
            {soloMio ? 'Mi corte del día' : 'Ventas totales'}
          </h1>
          <p className="text-body-lg text-outline">
            {soloMio
              ? 'Lo que usted ha cobrado hoy, por sección y por forma de pago.'
              : 'Lo cobrado por sección y por forma de pago, para ver el día o juntarlo por semana, mes y año.'}
          </p>
        </div>
        <div className={`flex flex-wrap items-end gap-3 ${soloMio ? 'hidden' : ''}`}>
          <div className="flex overflow-hidden rounded border border-outline-variant bg-surface-container-lowest">
            {ATAJOS.map((a) => (
              <button
                key={a.key}
                onClick={() => {
                  setAtajo(a.key);
                  setAMano({ start: '', end: '' });
                }}
                className={`px-3 py-2 text-title-md transition ${
                  !completo && atajo === a.key
                    ? 'bg-primary-container text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <label className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            Contar cada cobro por
            <select
              value={base}
              onChange={(e) => setBase(e.target.value)}
              className="mt-1 block rounded border border-outline-variant bg-surface-container-lowest px-2.5 py-2 text-body-md normal-case text-on-surface"
            >
              <option value="cobro">Día en que se cobró (caja)</option>
              <option value="juego">Día de juego (operación)</option>
            </select>
          </label>
          <label className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            Del
            <input
              type="date"
              value={aMano.start}
              max={aMano.end || undefined}
              onChange={(e) => setAMano({ ...aMano, start: e.target.value })}
              className="mt-1 block rounded border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 font-mono text-body-md normal-case text-on-surface"
            />
          </label>
          <label className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            Al
            <input
              type="date"
              value={aMano.end}
              min={aMano.start || undefined}
              onChange={(e) => setAMano({ ...aMano, end: e.target.value })}
              className="mt-1 block rounded border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 font-mono text-body-md normal-case text-on-surface"
            />
          </label>
        </div>
      </header>

      {invertido && <Alert tone="error">La fecha inicial no puede ser posterior a la final.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {cargando && !datos ? (
        <Spinner />
      ) : datos ? (
        <>
          {/* --- Lo que hay que saber del periodo, en una fila */}
          <section className="grid gap-gutter sm:grid-cols-2 xl:grid-cols-6">
            <Resumen titulo="Total cobrado" valor={mxn(datos.totales.general.total)} pie={`${datos.totales.general.operaciones} cobros`} oscuro />
            <Resumen titulo="Efectivo en pesos" valor={mxn(datos.totales.general.efectivo_mxn)} pie="en caja, sin el cambio" />
            <Resumen
              titulo="Dólares"
              valor={usd(Number(datos.totales.general.efectivo_usd))}
              pie={`equivalen a ${mxn(datos.totales.general.efectivo_usd_en_mxn)} al tipo de cambio de cada cobro`}
            />
            <Resumen titulo="Tarjeta" valor={mxn(datos.totales.general.tarjeta)} pie="a depositar" />
            <Resumen titulo="Transferencia" valor={mxn(datos.totales.general.transferencia)} pie="a conciliar" />
            <Resumen titulo="Pago en línea" valor={mxn(datos.totales.general.pago_en_linea)} pie="sitio web · se concilia con Stripe" />
          </section>

          {/* --- Cada sección con su propio detalle */}
          <section className="grid gap-gutter lg:grid-cols-3">
            {fuentes.map((f) => {
              const t = datos.totales.por_fuente[f.clave];
              return (
                <div key={f.clave} className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-5 shadow-card">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-label-md uppercase tracking-wider text-primary">{f.nombre}</h2>
                    <span className="text-label-sm text-outline">{t.operaciones} cobros</span>
                  </div>
                  <p className="mt-2 font-serif text-display-lg leading-none text-primary">{mxn(t.total)}</p>
                  <dl className="mt-4 divide-y divide-outline-variant/30 text-body-md">
                    <Linea etiqueta="Efectivo MXN" valor={mxn(t.efectivo_mxn)} />
                    <Linea
                      etiqueta="Dólares"
                      valor={Number(t.efectivo_usd) ? `${usd(Number(t.efectivo_usd))} · ${mxn(t.efectivo_usd_en_mxn)}` : '—'}
                    />
                    <Linea etiqueta="Tarjeta" valor={mxn(t.tarjeta)} />
                    <Linea etiqueta="Transferencia" valor={mxn(t.transferencia)} />
                    <Linea etiqueta="Pago en línea" valor={mxn(t.pago_en_linea)} />
                  </dl>
                </div>
              );
            })}
          </section>

          {/* --- El detalle por periodo */}
          <section className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/40 px-5 py-4">
              <h2 className="text-label-md uppercase tracking-wider text-primary">Detalle por periodo</h2>
              <div className="flex flex-wrap items-center gap-3">
                <Selector
                  opciones={[{ key: 'TODAS', label: 'Todas las secciones' }, ...fuentes.map((f) => ({ key: f.clave, label: f.nombre }))]}
                  valor={seccion}
                  onElegir={setSeccion}
                />
                <Selector opciones={AGRUPACIONES} valor={agrupar} onElegir={setAgrupar} />
                <button
                  onClick={exportar}
                  className="rounded border border-outline-variant px-3.5 py-2 text-label-sm uppercase tracking-wider text-on-surface-variant transition hover:bg-surface-container-low"
                >
                  Exportar CSV
                </button>
              </div>
            </div>

            <div className="caja-lineas m-5 mt-4">
              <div className="overflow-x-auto">
                <table className="tabla-lineas text-left">
                  <thead>
                    <tr>
                      <th className="text-label-sm uppercase tracking-wider text-outline">Periodo</th>
                      {COLUMNAS.map(([, nombre]) => (
                        <th key={nombre} className="text-right text-label-sm uppercase tracking-wider text-outline">
                          {nombre}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pag.visibles.map((p) => (
                      <tr key={p.clave} className="align-top">
                        <td className="text-body-lg text-on-surface">{p.etiqueta}</td>
                        {COLUMNAS.map(([k]) => (
                          <td key={k} className="whitespace-nowrap text-right">
                            <Celda fila={p.vista} columna={k} />
                          </td>
                        ))}
                      </tr>
                    ))}
                    {filas.length === 0 && (
                      <tr>
                        <td colSpan={COLUMNAS.length + 1} className="px-4 py-10 text-center text-body-lg text-outline">
                          Sin cobros en este periodo.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {filas.length > 0 && (
                    <tfoot>
                      <tr className="bg-surface-container-low">
                        <td className="text-label-md uppercase tracking-wider text-primary">Suma del periodo</td>
                        {COLUMNAS.map(([k]) => (
                          <td key={k} className="whitespace-nowrap text-right">
                            <Celda fila={total} columna={k} />
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <Paginador pag={pag} etiqueta="periodos" />
            </div>

            <p className="mx-5 mb-5 rounded bg-surface-container-low px-3.5 py-2.5 text-body-md text-outline">
              Son cobros recibidos, no ventas por cobrar. En efectivo ya está descontado el cambio. Los dólares se
              muestran en dólares y, debajo, lo que valían en pesos al tipo de cambio con el que se cobraron;
              cambiar el tipo de cambio hoy no modifica estas cifras.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Resumen({ titulo, valor, pie, oscuro = false }) {
  return (
    <div
      className={`rounded-lg border p-5 shadow-card ${
        oscuro ? 'border-primary-container bg-primary-container text-on-primary' : 'border-outline-variant/40 bg-surface-container-lowest'
      }`}
    >
      <p className={`text-label-sm uppercase tracking-wider ${oscuro ? 'text-primary-fixed' : 'text-on-surface-variant'}`}>{titulo}</p>
      <p className={`mt-1.5 font-serif text-headline-lg leading-none ${oscuro ? 'text-on-primary' : 'text-primary'}`}>{valor}</p>
      <p className={`mt-2 text-body-md ${oscuro ? 'text-primary-fixed/80' : 'text-outline'}`}>{pie}</p>
    </div>
  );
}

function Linea({ etiqueta, valor }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-on-surface-variant">{etiqueta}</dt>
      <dd className="font-mono text-on-surface">{valor}</dd>
    </div>
  );
}

function Selector({ opciones, valor, onElegir }) {
  return (
    <div className="flex overflow-hidden rounded border border-outline-variant bg-surface-container-lowest">
      {opciones.map((o) => (
        <button
          key={o.key}
          onClick={() => onElegir(o.key)}
          className={`px-3 py-1.5 text-label-md transition ${
            valor === o.key ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-low'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
