import { Link } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { ROL } from '../utils/format';

/**
 * Pantalla de acceso denegado.
 *
 * Se prefiere sobre un redireccionamiento callado: si alguien llega aquí por
 * un enlace viejo o un marcador, conviene que entienda que su perfil no tiene
 * ese alcance, en vez de creer que el sistema falló.
 */
export default function ForbiddenPage() {
  const { user, homeRoute } = useAuth();

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="font-serif text-5xl text-primary">Sin acceso</p>
      <p className="mt-3 text-on-surface-variant">
        Su perfil de <strong>{ROL[user?.role] || user?.role}</strong> no tiene alcance sobre esta
        sección.
      </p>
      <p className="mt-1 text-body-lg text-outline">
        Si necesita consultarla, solicítelo a la Administración del club.
      </p>
      <Link
        to={homeRoute || '/'}
        className="mt-6 inline-block rounded bg-primary-container px-5 py-2 text-body-lg text-white hover:bg-primary"
      >
        Volver a mi panel
      </Link>
    </div>
  );
}
