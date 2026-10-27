/**
 * Sesión y permisos en el cliente.
 *
 * Nota: esto solo controla qué se muestra. El backend valida cada permiso otra
 * vez; ocultar un botón nunca es la seguridad real.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AVISO_DE_SESION, EVENTO_TOKEN_RENOVADO, authApi, tokenStore } from '../api/client';

const AuthContext = createContext(null);

// La sesión se cierra después de este tiempo SIN USO. El servidor lo impone
// con la vida del token (15 minutos, ACCESS_TOKEN_EXPIRE_MINUTES); aquí solo se
// avisa y se sale antes de que el primer clic salga con error.
const MINUTOS_SIN_USO = 15;
// Mientras la persona trabaja, el token se renueva como mucho una vez por
// minuto. Así el límite real de inactividad queda entre 14 y 15 minutos.
const RENOVAR_CADA_MS = 60 * 1000;
const MARCA_DE_ACTIVIDAD = 'las_parotas_ultima_actividad';
const EVENTOS_DE_ACTIVIDAD = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'];

function ultimaActividad() {
  try {
    return Number(localStorage.getItem(MARCA_DE_ACTIVIDAD)) || 0;
  } catch {
    return 0;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => tokenStore.getUser());
  const [permissions, setPermissions] = useState([]);
  const [homeRoute, setHomeRoute] = useState('/');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then((data) => {
        setUser(data.user);
        setPermissions(data.permissions);
        setHomeRoute(data.home_route || '/');
        tokenStore.setUser(data.user);
      })
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await authApi.login(email, password);
    tokenStore.set(data.access_token);
    tokenStore.setUser(data.user);
    setUser(data.user);
    setPermissions(data.permissions);
    setHomeRoute(data.home_route || '/');
    return data;
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setPermissions([]);
    setHomeRoute('/');
  }, []);

  // ---- Sesión: renovar mientras se trabaja, cerrar si nadie toca nada ----
  //
  // La marca de actividad vive en localStorage y no en una variable: con dos
  // pestañas abiertas, trabajar en una tiene que mantener viva la sesión de
  // las dos, porque comparten el mismo token.
  useEffect(() => {
    if (!user) return undefined;

    let ultimaRenovacion = 0; // la primera actividad renueva: el token puede venir viejo
    let renovando = false;
    let ultimaMarca = 0;

    const alActuar = () => {
      const ahora = Date.now();
      if (ahora - ultimaMarca > 5000) {
        ultimaMarca = ahora;
        try {
          localStorage.setItem(MARCA_DE_ACTIVIDAD, String(ahora));
        } catch { /* sin almacenamiento, solo cuenta esta pestaña */ }
      }
      if (renovando || ahora - ultimaRenovacion < RENOVAR_CADA_MS || !tokenStore.get()) return;
      renovando = true;
      ultimaRenovacion = ahora;
      authApi
        .refresh()
        .then((r) => {
          if (!tokenStore.get()) return; // se cerró la sesión mientras tanto
          tokenStore.set(r.access_token);
          window.dispatchEvent(new Event(EVENTO_TOKEN_RENOVADO));
        })
        .catch(() => {
          // Si el servidor rechaza la renovación, la sesión ya no sirve: el
          // cliente HTTP manda a la pantalla de acceso con su aviso.
        })
        .finally(() => {
          renovando = false;
        });
    };

    alActuar();
    EVENTOS_DE_ACTIVIDAD.forEach((e) => window.addEventListener(e, alActuar, { passive: true }));

    const vigilante = setInterval(() => {
      const parado = Date.now() - Math.max(ultimaActividad(), ultimaMarca);
      if (parado >= MINUTOS_SIN_USO * 60 * 1000) {
        try {
          sessionStorage.setItem(
            AVISO_DE_SESION,
            `Su sesión se cerró por pasar ${MINUTOS_SIN_USO} minutos sin uso.`,
          );
        } catch { /* solo se pierde el aviso */ }
        logout();
      }
    }, 15 * 1000);

    return () => {
      EVENTOS_DE_ACTIVIDAD.forEach((e) => window.removeEventListener(e, alActuar));
      clearInterval(vigilante);
    };
  }, [user, logout]);

  const can = useCallback((permission) => permissions.includes(permission), [permissions]);

  const value = useMemo(
    () => ({
      user,
      permissions,
      homeRoute,
      loading,
      login,
      logout,
      can,
      isAuthenticated: Boolean(user),
      isHotel: user?.role === 'HOTEL',
      // Recepción atiende el mostrador: solo levanta reservas de público
      // general. Asignarle una reserva a un hotel con convenio le genera
      // comisión a ese hotel, y eso lo decide operaciones.
      isRecepcion: user?.role === 'RECEPCION',
      // La Administración tiene su propio menú: no es un operador con más
      // permisos, hace otro trabajo.
      isAdmin: user?.role === 'SUPER_ADMIN',
    }),
    [user, permissions, homeRoute, loading, login, logout, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
