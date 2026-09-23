/**
 * Indicador de conexión y avisos emergentes.
 *
 * Que la pantalla se actualice sola sin decir por qué desconcierta. El
 * indicador responde a "¿esto está al día?" y el aviso explica qué cambió.
 */
import { useEffect, useState } from 'react';

import { useAuth } from '../context/AuthContext';
import { useRealtime, useRealtimeEvent } from '../context/RealtimeContext';
import { RELEVANTES, describir } from '../utils/notificaciones';

const ESTILOS = {
  conectado: { color: 'bg-estado-ok-text', texto: 'Conectado', clase: 'text-estado-ok-text' },
  conectando: { color: 'bg-estado-pend-text animate-pulse', texto: 'Conectando', clase: 'text-estado-pend-text' },
  reconectando: { color: 'bg-estado-pend-text animate-pulse', texto: 'Reconectando', clase: 'text-estado-pend-text' },
  desconectado: { color: 'bg-surface-dim', texto: 'Sin conexión', clase: 'text-outline' },
};

export function RealtimeIndicator() {
  const { estado } = useRealtime();
  const estilo = ESTILOS[estado] || ESTILOS.desconectado;

  return (
    <span className={`flex items-center gap-1.5 text-body-md ${estilo.clase}`} title={`Canal de tiempo real: ${estado}`}>
      <span className={`h-2 w-2 rounded-full ${estilo.color}`} />
      {estilo.texto}
    </span>
  );
}

export function RealtimeToasts() {
  const { isHotel } = useAuth();
  const [avisos, setAvisos] = useState([]);

  // Solo se anuncian los cambios que alguien querría notar. Los avisos de
  // disponibilidad llegan de a muchos y solo sirven para refrescar la vista,
  // así que no se muestran como notificación.
  useRealtimeEvent(RELEVANTES, (mensaje) => {
    const texto = describir(mensaje, isHotel);
    if (!texto) return;
    const aviso = { id: `${mensaje.type}-${Date.now()}-${Math.random()}`, texto, tipo: mensaje.type };
    setAvisos((actuales) => [...actuales.slice(-3), aviso]);
  });

  useEffect(() => {
    if (avisos.length === 0) return undefined;
    const timer = setTimeout(() => setAvisos((actuales) => actuales.slice(1)), 6000);
    return () => clearTimeout(timer);
  }, [avisos]);

  if (avisos.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {avisos.map((aviso) => (
        <div
          key={aviso.id}
          className="pointer-events-auto flex items-start gap-3 rounded border border-outline-variant bg-white px-4 py-3 text-body-lg shadow-lg"
        >
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-estado-ok-text" />
          <div>
            <p className="text-on-surface">{aviso.texto}</p>
            <p className="text-[11px] uppercase tracking-wide text-outline">Actualización automática</p>
          </div>
          <button
            onClick={() => setAvisos((actuales) => actuales.filter((item) => item.id !== aviso.id))}
            className="text-outline-variant hover:text-on-surface-variant"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
