import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface-container-low px-4 text-center">
      <p className="font-serif text-6xl text-primary">404</p>
      <p className="text-on-surface-variant">La página que busca no existe o no tiene acceso a ella.</p>
      <Link to="/" className="mt-2 rounded bg-primary-container px-5 py-2 text-body-lg text-white hover:bg-primary">
        Volver al panel
      </Link>
    </div>
  );
}
