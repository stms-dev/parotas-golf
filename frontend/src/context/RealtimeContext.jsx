/**
 * Canal de tiempo real.
 *
 * Una sola conexión por sesión, compartida por todas las pantallas. Cada
 * pantalla se suscribe a los tipos de evento que le interesan y se desuscribe
 * al desmontarse; abrir un socket por componente sería desperdiciar conexiones
 * y duplicar avisos.
 *
 * Reconecta sola con espera creciente: si el servidor se reinicia o se cae el
 * wifi del club, la pantalla se vuelve a enganchar sin que nadie recargue.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { tokenStore } from '../api/client';
import { RELEVANTES, describir } from '../utils/notificaciones';
import { useAuth } from './AuthContext';

const RealtimeContext = createContext(null);

const ESTADOS = {
  CONECTANDO: 'conectando',
  CONECTADO: 'conectado',
  RECONECTANDO: 'reconectando',
  DESCONECTADO: 'desconectado',
};

const ESPERA_MAXIMA = 30000;
const MAX_NOTIFICACIONES = 40;

/** Cada perfil guarda sus propios avisos en este navegador. */
function llaveDe(user) {
  return user ? `notificaciones_${user.id || user.email}` : null;
}

function leerGuardadas(llave) {
  if (!llave) return [];
  try {
    const crudo = localStorage.getItem(llave);
    const lista = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}
const INTERVALO_PING = 25000;

function urlDelSocket(token) {
  const protocolo = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = import.meta.env.VITE_WS_URL;
  if (base) return `${base}?token=${encodeURIComponent(token)}`;
  return `${protocolo}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`;
}

export function RealtimeProvider({ children }) {
  const { isAuthenticated, user, isHotel } = useAuth();

  const [estado, setEstado] = useState(ESTADOS.DESCONECTADO);
  const [ultimoEvento, setUltimoEvento] = useState(null);

  // Lo que llega por el canal queda en la campanita de este perfil, no solo
  // en el aviso que se esfuma a los seis segundos.
  const llave = llaveDe(user);
  const [notificaciones, setNotificaciones] = useState(() => leerGuardadas(llave));
  const esHotelRef = useRef(isHotel);
  esHotelRef.current = isHotel;

  useEffect(() => {
    setNotificaciones(leerGuardadas(llave));
  }, [llave]);

  useEffect(() => {
    if (!llave) return;
    try {
      localStorage.setItem(llave, JSON.stringify(notificaciones));
    } catch {
      // Sin almacenamiento, la lista vive mientras la pestaña esté abierta.
    }
  }, [llave, notificaciones]);

  const anotar = useCallback((mensaje) => {
    if (!RELEVANTES.includes(mensaje.type)) return;
    const texto = describir(mensaje, esHotelRef.current);
    if (!texto) return;
    setNotificaciones((actuales) =>
      [
        {
          id: `${mensaje.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          tipo: mensaje.type,
          texto,
          fecha: new Date().toISOString(),
          leida: false,
        },
        ...actuales,
      ].slice(0, MAX_NOTIFICACIONES),
    );
  }, []);

  const marcarLeidas = useCallback(() => {
    setNotificaciones((actuales) => actuales.map((n) => (n.leida ? n : { ...n, leida: true })));
  }, []);

  const limpiarNotificaciones = useCallback(() => setNotificaciones([]), []);

  const socketRef = useRef(null);
  const suscriptoresRef = useRef(new Map());
  const intentosRef = useRef(0);
  const reconexionRef = useRef(null);
  const pingRef = useRef(null);
  const cerradoAdredeRef = useRef(false);

  /** Reparte el evento entre las pantallas suscritas a ese tipo. */
  const repartir = useCallback((mensaje) => {
    setUltimoEvento(mensaje);
    anotar(mensaje);
    suscriptoresRef.current.forEach(({ tipos, callback }) => {
      if (tipos.length === 0 || tipos.includes(mensaje.type)) {
        try {
          callback(mensaje);
        } catch (error) {
          // Una pantalla que falla al procesar no debe tumbar a las demás.
          console.error('Error procesando evento de tiempo real', error);
        }
      }
    });
  }, [anotar]);

  const conectar = useCallback(() => {
    const token = tokenStore.get();
    if (!token) return;

    cerradoAdredeRef.current = false;
    setEstado(intentosRef.current === 0 ? ESTADOS.CONECTANDO : ESTADOS.RECONECTANDO);

    // Si quedó un socket anterior (React monta dos veces en desarrollo, o una
    // reconexión se cruzó), se suelta antes de abrir otro: dos sockets vivos
    // entregan cada aviso dos veces.
    const anterior = socketRef.current;
    if (anterior && anterior.readyState <= WebSocket.OPEN) {
      anterior.onclose = null;
      anterior.onmessage = null;
      anterior.close();
    }
    clearInterval(pingRef.current);

    const socket = new WebSocket(urlDelSocket(token));
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) return;
      intentosRef.current = 0;
      setEstado(ESTADOS.CONECTADO);
      // Ping periódico: mantiene viva la conexión a través de proxies que
      // cierran sockets inactivos.
      pingRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      }, INTERVALO_PING);
    };

    socket.onmessage = (evento) => {
      if (socketRef.current !== socket) return;
      try {
        const mensaje = JSON.parse(evento.data);
        if (mensaje.type === 'pong') return;
        repartir(mensaje);
      } catch (error) {
        console.error('Mensaje de tiempo real ilegible', error);
      }
    };

    socket.onclose = (evento) => {
      // Un socket que ya fue reemplazado no reconecta: el nuevo manda.
      if (socketRef.current !== socket) return;
      clearInterval(pingRef.current);
      if (cerradoAdredeRef.current) {
        setEstado(ESTADOS.DESCONECTADO);
        return;
      }
      // 4001 = token inválido. Reintentar no sirve de nada.
      if (evento.code === 4001) {
        setEstado(ESTADOS.DESCONECTADO);
        return;
      }
      setEstado(ESTADOS.RECONECTANDO);
      const espera = Math.min(1000 * 2 ** intentosRef.current, ESPERA_MAXIMA);
      intentosRef.current += 1;
      reconexionRef.current = setTimeout(conectar, espera);
    };

    socket.onerror = () => {
      // El cierre se maneja en onclose; aquí no hace falta nada más.
    };
  }, [repartir]);

  useEffect(() => {
    if (!isAuthenticated) {
      cerradoAdredeRef.current = true;
      clearTimeout(reconexionRef.current);
      clearInterval(pingRef.current);
      socketRef.current?.close();
      setEstado(ESTADOS.DESCONECTADO);
      return undefined;
    }

    conectar();
    return () => {
      cerradoAdredeRef.current = true;
      clearTimeout(reconexionRef.current);
      clearInterval(pingRef.current);
      socketRef.current?.close();
    };
  }, [isAuthenticated, conectar]);

  /** Suscribe una pantalla. Devuelve la función para darse de baja. */
  const suscribir = useCallback((tipos, callback) => {
    const id = Symbol('suscriptor');
    suscriptoresRef.current.set(id, { tipos: tipos || [], callback });
    return () => suscriptoresRef.current.delete(id);
  }, []);

  const value = useMemo(
    () => ({
      estado,
      ultimoEvento,
      suscribir,
      conectado: estado === ESTADOS.CONECTADO,
      notificaciones,
      noLeidas: notificaciones.filter((n) => !n.leida).length,
      marcarLeidas,
      limpiarNotificaciones,
    }),
    [estado, ultimoEvento, suscribir, notificaciones, marcarLeidas, limpiarNotificaciones],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime debe usarse dentro de RealtimeProvider');
  return context;
}

/**
 * Suscripción puntual desde una pantalla.
 *
 *   useRealtimeEvent(['disponibilidad.cambiada'], () => recargar());
 */
export function useRealtimeEvent(tipos, callback) {
  const { suscribir } = useRealtime();
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return suscribir(tipos, (mensaje) => callbackRef.current(mensaje));
    // La lista de tipos se serializa para no re-suscribir en cada render.
  }, [suscribir, JSON.stringify(tipos)]);
}

export { EVENTOS } from '../utils/eventos';
