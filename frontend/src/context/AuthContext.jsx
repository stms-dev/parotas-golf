/**
 * Sesión y permisos en el cliente.
 *
 * Nota: esto solo controla qué se muestra. El backend valida cada permiso otra
 * vez; ocultar un botón nunca es la seguridad real.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, tokenStore } from '../api/client';

const AuthContext = createContext(null);

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
