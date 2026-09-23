/**
 * Historial del tipo de cambio operativo. Cada cambio es una fila nueva (el
 * anterior no se borra), así que aquí se ve qué valor rigió, desde cuándo,
 * quién lo puso y cuánto se movió contra el anterior.
 */
import { useEffect, useState } from 'react';

import { catalogApi } from '../api/client';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { fechaHora } from '../utils/format';

export default function HistorialTipoCambio({ limite = 15, compacto = false }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);

  function cargar() {
    catalogApi
      .exchangeRateHistory({ limit: limite })
      .then((lista) => {
        setFilas(lista);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(cargar, [limite]);
  useRealtimeEvent([EVENTOS.TIPO_CAMBIO_ACTUALIZADO], cargar);

  if (error) return <p className="text-body-md text-error">{error}</p>;
  if (filas === null) return <p className="text-body-md text-outline">Cargando historial…</p>;
  if (filas.length === 0) return <p className="text-body-md text-outline">Sin cambios registrados.</p>;

  return (
    <div className={`overflow-x-auto ${compacto ? 'max-h-[260px] overflow-y-auto' : ''}`}>
      <table className="w-full text-left text-body-md">
        <thead className="sticky top-0 bg-surface-container-lowest">
          <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            <th className="pb-2">Vigente desde</th>
            <th className="pb-2 text-right">1 USD</th>
            <th className="pb-2 text-right">Cambio</th>
            <th className="pb-2 pl-4">Lo puso</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant/30">
          {filas.map((f, i) => {
            const anterior = filas[i + 1];
            const delta = anterior ? Number(f.rate) - Number(anterior.rate) : null;
            return (
              <tr key={f.id}>
                <td className="py-2 font-mono text-on-surface-variant">
                  {fechaHora(f.effective_from || f.created_at)}
                  {i === 0 && (
                    <span className="ml-2 rounded bg-estado-ok-bg px-1.5 py-0.5 font-sans text-label-sm uppercase tracking-wider text-estado-ok-text">
                      Actual
                    </span>
                  )}
                </td>
                <td className="py-2 text-right font-mono text-primary">
                  ${Number(f.rate).toFixed(2)}
                </td>
                <td
                  className={`py-2 text-right font-mono ${
                    delta === null
                      ? 'text-outline'
                      : delta > 0
                        ? 'text-estado-pend-text'
                        : delta < 0
                          ? 'text-estado-ok-text'
                          : 'text-outline'
                  }`}
                >
                  {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`}
                </td>
                <td className="py-2 pl-4 text-on-surface-variant">{f.created_by_name || 'Sistema'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
