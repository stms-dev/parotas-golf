/**
 * Resumen ejecutivo.
 *
 * Una sola pantalla para la dirección: cuánto se vendió, por concepto y por
 * día, y cuántas partidas hay detrás de ese ingreso. Todo en pesos, sin
 * decimales. Lo primero que se ve (cifras, tendencia y resumen por concepto)
 * cabe sin bajar; el detalle día por día queda plegado.
 *
 * Se cuenta lo que entró el día del cobro. «Partidas» son las reservas
 * distintas detrás del ingreso; en cuponeras, los pases vendidos.
 */
import { useEffect, useMemo, useState } from 'react';

import { treasuryApi } from '../api/client';
import { Alert, Spinner } from '../components/ui';
import { fechaLocal } from '../utils/format';

const PESOS = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});
const pesos = (n) => PESOS.format(Math.round(Number(n || 0)));
const entero = (n) => new Intl.NumberFormat('es-MX').format(Math.round(Number(n || 0)));

// Un color por concepto. El mismo orden en la gráfica, la leyenda y la tabla.
const COLORES = {
  CUPONERAS: '#1f5d46',
  RESERVAS_EN_LINEA: '#c9a227',
  TRANSFERENCIAS: '#3b6ea5',
  PRO_SHOP: '#b5533c',
  ALIMENTOS_BEBIDAS: '#7a5ea8',
  OTROS: '#8a8f98',
};

const ATAJOS = [
  { key: 'mes', label: 'Este mes' },
  { key: 'anterior', label: 'Mes anterior' },
  { key: 'semana', label: 'Últimos 7 días' },
  { key: 'hoy', label: 'Hoy' },
];

function rangoDe(clave) {
  const hoy = new Date();
  if (clave === 'hoy') return { start: fechaLocal(hoy), end: fechaLocal(hoy) };
  if (clave === 'semana') {
    const ini = new Date();
    ini.setDate(hoy.getDate() - 6);
    return { start: fechaLocal(ini), end: fechaLocal(hoy) };
  }
  if (clave === 'anterior') {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    return { start: fechaLocal(ini), end: fechaLocal(fin) };
  }
  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  return { start: fechaLocal(ini), end: fechaLocal(hoy) };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function corta(iso) {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MESES[Number(m) - 1]}`;
}

/** Barras apiladas por concepto y, encima, la tendencia: promedio de 7 días. */
function Grafica({ dias, conceptos }) {
  const ancho = 640;
  const alto = 210;
  const m = { izq: 52, der: 8, arr: 10, abajo: 24 };
  const w = ancho - m.izq - m.der;
  const h = alto - m.arr - m.abajo;

  const tope = Math.max(1, ...dias.map((d) => d.total));
  const magnitud = 10 ** Math.floor(Math.log10(tope));
  const maximo = Math.ceil(tope / magnitud) * magnitud;
  const paso = w / Math.max(dias.length, 1);
  const barra = Math.max(Math.min(paso * 0.72, 28), 2);
  const y = (v) => m.arr + h - (v / maximo) * h;

  const promedio = dias.map((_, i) => {
    const ventana = dias.slice(Math.max(0, i - 6), i + 1);
    return ventana.reduce((a, d) => a + d.total, 0) / ventana.length;
  });
  const linea = promedio
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(m.izq + paso * i + paso / 2).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');
  const cadaCuanto = Math.ceil(dias.length / 8);

  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="w-full" role="img" aria-label="Ventas por día y tendencia">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={m.izq} x2={ancho - m.der} y1={y(maximo * f)} y2={y(maximo * f)} stroke="currentColor" opacity="0.12" />
          <text x={m.izq - 6} y={y(maximo * f) + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.65">
            {pesos(maximo * f)}
          </text>
        </g>
      ))}
      {dias.map((d, i) => {
        let acumulado = 0;
        const x = m.izq + paso * i + (paso - barra) / 2;
        return (
          <g key={d.fecha}>
            <title>{`${corta(d.fecha)} · ${pesos(d.total)} · ${d.partidas} partidas`}</title>
            {conceptos.map((c) => {
              const v = d.por_concepto[c.clave].monto;
              if (!v) return null;
              const y0 = y(acumulado + v);
              const alturaBarra = y(acumulado) - y0;
              acumulado += v;
              return <rect key={c.clave} x={x} y={y0} width={barra} height={Math.max(alturaBarra, 0.5)} fill={COLORES[c.clave]} />;
            })}
            {i % cadaCuanto === 0 && (
              <text x={x + barra / 2} y={alto - 8} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.65">
                {corta(d.fecha)}
              </text>
            )}
          </g>
        );
      })}
      <path d={linea} fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="4 3" opacity="0.8" />
    </svg>
  );
}

function Cifra({ titulo, valor, nota }) {
  return (
    <div className="rounded border border-outline-variant/50 bg-surface-container-lowest px-4 py-3">
      <p className="text-label-sm uppercase tracking-wider text-outline">{titulo}</p>
      <p className="text-headline-sm font-semibold tabular-nums text-primary">{valor}</p>
      {nota && <p className="text-body-md text-on-surface-variant">{nota}</p>}
    </div>
  );
}

export default function ResumenEjecutivoPage() {
  const [atajo, setAtajo] = useState('mes');
  const [rango, setRango] = useState(() => rangoDe('mes'));
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [verDetalle, setVerDetalle] = useState(false);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError('');
    treasuryApi
      .resumenEjecutivo(rango)
      .then((r) => vigente && setDatos(r))
      .catch((e) => vigente && setError(e?.message || 'No se pudo cargar el resumen'))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [rango]);

  const elegir = (clave) => {
    setAtajo(clave);
    setRango(rangoDe(clave));
  };

  const dias = datos?.dias || [];
  const conceptos = datos?.conceptos || [];
  const total = datos?.totales?.total || 0;
  const partidas = datos?.totales?.partidas || 0;
  const diasConVenta = useMemo(() => dias.filter((d) => d.total > 0).length, [dias]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-sm font-semibold text-primary">Resumen ejecutivo</h1>
          <p className="text-body-md text-on-surface-variant">
            Ventas por concepto, en pesos. Se cuenta el día en que entró el dinero.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ATAJOS.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => elegir(a.key)}
              className={`rounded border px-3 py-1.5 text-body-md transition ${
                atajo === a.key
                  ? 'border-primary bg-primary-container text-on-primary'
                  : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {a.label}
            </button>
          ))}
          <input
            type="date"
            value={rango.start}
            max={rango.end}
            onChange={(e) => { setAtajo(''); setRango({ ...rango, start: e.target.value }); }}
            className="rounded border border-outline-variant bg-transparent px-2 py-1.5 text-body-md"
            aria-label="Desde"
          />
          <input
            type="date"
            value={rango.end}
            min={rango.start}
            onChange={(e) => { setAtajo(''); setRango({ ...rango, end: e.target.value }); }}
            className="rounded border border-outline-variant bg-transparent px-2 py-1.5 text-body-md"
            aria-label="Hasta"
          />
        </div>
      </header>

      {error && <Alert tone="error">{error}</Alert>}
      {cargando && !datos && <Spinner label="Cargando resumen…" />}

      {datos && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Cifra titulo="Ventas del periodo" valor={pesos(total)} />
            <Cifra titulo="Partidas" valor={entero(partidas)} nota="reservas y pases" />
            <Cifra
              titulo="Promedio por día"
              valor={pesos(dias.length ? total / dias.length : 0)}
              nota={`${diasConVenta} de ${dias.length} días con venta`}
            />
            <Cifra
              titulo="Por partida"
              valor={pesos(partidas ? total / partidas : 0)}
              nota="ingreso entre partidas"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
            <section className="rounded border border-outline-variant/50 bg-surface-container-lowest p-4 text-on-surface">
              <h2 className="mb-1 text-title-md text-primary">Ventas por día</h2>
              <Grafica dias={dias} conceptos={conceptos} />
              <p className="mt-1 text-body-md text-on-surface-variant">
                Barras: ventas del día por concepto. Línea punteada: tendencia (promedio de 7 días).
              </p>
            </section>

            <section className="rounded border border-outline-variant/50 bg-surface-container-lowest p-4">
              <h2 className="mb-2 text-title-md text-primary">Por concepto</h2>
              <table className="w-full text-body-md tabular-nums">
                <thead>
                  <tr className="text-left text-label-sm uppercase tracking-wider text-outline">
                    <th className="pb-1 font-medium">Concepto</th>
                    <th className="pb-1 text-right font-medium">Pesos</th>
                    <th className="pb-1 text-right font-medium">%</th>
                    <th className="pb-1 text-right font-medium">Partidas</th>
                  </tr>
                </thead>
                <tbody>
                  {conceptos.map((c) => {
                    const t = datos.totales.por_concepto[c.clave];
                    return (
                      <tr key={c.clave} className="border-t border-outline-variant/30">
                        <td className="py-1.5">
                          <span
                            className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                            style={{ background: COLORES[c.clave] }}
                          />
                          {c.nombre}
                        </td>
                        <td className="py-1.5 text-right">{pesos(t.monto)}</td>
                        <td className="py-1.5 text-right text-on-surface-variant">
                          {total ? Math.round((t.monto / total) * 100) : 0}%
                        </td>
                        <td className="py-1.5 text-right">{t.partidas ? entero(t.partidas) : '—'}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-outline-variant font-semibold">
                    <td className="py-1.5">Total</td>
                    <td className="py-1.5 text-right">{pesos(total)}</td>
                    <td className="py-1.5 text-right">100%</td>
                    <td className="py-1.5 text-right">{entero(partidas)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>

          <section className="rounded border border-outline-variant/50 bg-surface-container-lowest">
            <button
              type="button"
              onClick={() => setVerDetalle((v) => !v)}
              aria-expanded={verDetalle}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-title-md text-primary"
            >
              Detalle día por día
              <span className="text-body-md text-on-surface-variant">{verDetalle ? 'Ocultar' : 'Mostrar'}</span>
            </button>
            {verDetalle && (
              <div className="overflow-x-auto border-t border-outline-variant/30 px-4 pb-4">
                <table className="w-full min-w-[720px] text-body-md tabular-nums">
                  <thead>
                    <tr className="text-right text-label-sm uppercase tracking-wider text-outline">
                      <th className="py-2 text-left font-medium">Día</th>
                      {conceptos.map((c) => (
                        <th key={c.clave} className="py-2 font-medium">{c.nombre}</th>
                      ))}
                      <th className="py-2 font-medium">Total</th>
                      <th className="py-2 font-medium">Partidas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...dias].reverse().map((d) => (
                      <tr key={d.fecha} className="border-t border-outline-variant/30 text-right">
                        <td className="py-1.5 text-left">{corta(d.fecha)}</td>
                        {conceptos.map((c) => {
                          const v = d.por_concepto[c.clave];
                          return (
                            <td key={c.clave} className="py-1.5">
                              {v.monto ? pesos(v.monto) : '—'}
                              {v.partidas > 0 && (
                                <span className="ml-1 text-label-sm text-outline">({v.partidas})</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-1.5 font-semibold">{d.total ? pesos(d.total) : '—'}</td>
                        <td className="py-1.5">{d.partidas || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-body-md text-on-surface-variant">
                  Entre paréntesis, las partidas de ese concepto. En cuponeras son los pases vendidos.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
