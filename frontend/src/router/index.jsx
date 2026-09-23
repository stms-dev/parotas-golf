/**
 * Rutas y guards por permiso.
 *
 * TODAS las rutas llevan guard, no solo las del menú: esconder un enlace no
 * impide que alguien escriba la URL. Y aun con el guard puesto, la seguridad
 * real está en el backend, que vuelve a validar cada endpoint.
 *
 * Cada rol aterriza en su propia pantalla inicial (`home_route`), porque
 * mandar a recepción al panel de agenda solo produciría un rebote.
 */
import { Navigate, Route, Routes } from 'react-router-dom';

import AppLayout from '../layouts/AppLayout';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/ui';

import LoginPage from '../pages/LoginPage';
import DashboardPage from '../pages/DashboardPage';
import HotelPanelPage from '../pages/HotelPanelPage';
import TeeSheetPage from '../pages/TeeSheetPage';
import PartidasPage from '../pages/PartidasPage';
import NewReservationPage from '../pages/NewReservationPage';
import ReservationDetailPage from '../pages/ReservationDetailPage';
import CheckInPage from '../pages/CheckInPage';
import SolicitudesPage from '../pages/SolicitudesPage';
import FinancePage from '../pages/FinancePage';
import SettingsPage from '../pages/SettingsPage';
import AdminPage from '../pages/AdminPage';
import InventoryPage from '../pages/InventoryPage';
import AuditPage from '../pages/AuditPage';
import NotFoundPage from '../pages/NotFoundPage';
import ForbiddenPage from '../pages/ForbiddenPage';

export const PERMISOS = {
  PANEL: 'screen:panel',
  TEE_SHEET: 'screen:tee_sheet',
  RESERVAS: 'screen:reservations',
  NUEVA_RESERVA: 'screen:new_reservation',
  CHECKIN: 'screen:checkin',
  SOLICITUDES: 'screen:requests',
  FINANZAS: 'screen:finance',
  CONFIGURACION: 'screen:settings',
  PRECIOS: 'screen:settings',
  HOTELES: 'catalog:view_hotels',
  AUDITORIA: 'screen:audit',
  CONTROL: 'user:manage',
  INVENTARIO: 'screen:inventory',
};

function Protected({ children, permission, anyOf }) {
  const { isAuthenticated, loading, can } = useAuth();

  if (loading) return <Spinner label="Verificando sesión…" />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const permitido =
    (!permission || can(permission)) && (!anyOf || anyOf.some((item) => can(item)));

  // No se redirige en silencio: se dice que no tiene acceso y se ofrece el
  // camino de vuelta. Un rebote sin explicación parece una falla del sistema.
  if (!permitido) return <ForbiddenPage />;

  return children;
}

/** Raíz: manda a cada rol a donde trabaja.
 *
 * El hotel y el campo comparten ruta pero no pantalla: el panel del hotel
 * muestra salidas, el del campo muestra la operación completa.
 */
function Home() {
  const { homeRoute, can, isHotel } = useAuth();

  if (homeRoute && homeRoute !== '/') return <Navigate to={homeRoute} replace />;
  if (isHotel) return <HotelPanelPage />;
  if (can(PERMISOS.PANEL)) return <DashboardPage />;
  if (can(PERMISOS.CHECKIN)) return <Navigate to="/recepcion" replace />;
  if (can(PERMISOS.FINANZAS)) return <Navigate to="/finanzas" replace />;
  return <ForbiddenPage />;
}

export default function AppRouter() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <Spinner label="Cargando sistema…" />;

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />

      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route path="/" element={<Home />} />

        <Route
          path="/tee-sheet"
          element={
            <Protected permission={PERMISOS.TEE_SHEET}>
              <TeeSheetPage />
            </Protected>
          }
        />

        <Route
          path="/reservas"
          element={
            <Protected permission={PERMISOS.RESERVAS}>
              <PartidasPage />
            </Protected>
          }
        />

        <Route
          path="/reservas/nueva"
          element={
            <Protected permission={PERMISOS.NUEVA_RESERVA}>
              <NewReservationPage />
            </Protected>
          }
        />

        {/* El detalle es accesible para quien ve la lista global y también
            para un hotel, que llega a él desde su propio panel. El backend
            devuelve 404 si la reserva no es suya. */}
        <Route
          path="/reservas/:id"
          element={
            <Protected anyOf={[PERMISOS.RESERVAS, PERMISOS.PANEL, PERMISOS.CHECKIN]}>
              <ReservationDetailPage />
            </Protected>
          }
        />

        <Route
          path="/solicitudes"
          element={
            <Protected permission={PERMISOS.SOLICITUDES}>
              <SolicitudesPage />
            </Protected>
          }
        />

        <Route
          path="/recepcion"
          element={
            <Protected permission={PERMISOS.CHECKIN}>
              <CheckInPage />
            </Protected>
          }
        />

        <Route
          path="/finanzas"
          element={
            <Protected permission={PERMISOS.FINANZAS}>
              <FinancePage />
            </Protected>
          }
        />

        {/* El tablero de hoteles vive dentro de Partidas: era la misma lista
            de reservas contada por hotel. Se conserva la ruta para no romper
            un enlace guardado. */}
        <Route path="/hoteles" element={<Navigate to="/reservas" replace />} />

        {/* Precios y Configuración eran dos pantallas con los mismos
            catálogos. Quedó una sola. */}
        <Route
          path="/precios"
          element={
            <Protected permission={PERMISOS.PRECIOS}>
              <SettingsPage />
            </Protected>
          }
        />
        <Route path="/configuracion" element={<Navigate to="/precios" replace />} />

        <Route
          path="/inventario"
          element={
            <Protected permission={PERMISOS.INVENTARIO}>
              <InventoryPage />
            </Protected>
          }
        />

        {/* Tablero de la Administración: toca la base, no opera el día. */}
        <Route
          path="/control"
          element={
            <Protected permission={PERMISOS.CONTROL}>
              <AdminPage />
            </Protected>
          }
        />

        <Route
          path="/auditoria"
          element={
            <Protected permission={PERMISOS.AUDITORIA}>
              <AuditPage />
            </Protected>
          }
        />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
