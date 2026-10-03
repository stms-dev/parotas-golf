/**
 * Acceso al portal.
 *
 * El perfil lo determina la cuenta, no un selector: elegirlo a mano solo
 * invita a errores y no aporta seguridad, porque quien decide qué puede ver
 * cada quien es el servidor.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import Logo from '../components/Logo';
import { Alert, Button, Field, Input } from '../components/ui';

/** El sitio público del club. Se configura al desplegar; en local apunta al
 *  sitio corriendo con `npm run dev` dentro de /sitio. */
const SITIO_PUBLICO = import.meta.env.VITE_SITIO_PUBLICO || 'http://localhost:5180';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const sesion = await login(email, password);
      // Cada rol entra directo a su pantalla: recepción al mostrador, el
      // hotel a su panel. Nadie aterriza en algo que no le corresponde.
      navigate(sesion.home_route || '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-container-low px-4">
      <div className="w-full max-w-md space-y-4">
        <div className="rounded-lg border border-outline-variant/50 bg-white px-8 py-8 text-center shadow-sm">
          <Logo alto={104} className="mx-auto" />
          <p className="mt-4 text-body-md uppercase tracking-widest text-secondary">
            Sistema de gestión y tee times
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-outline-variant/50 bg-white p-6 shadow-sm"
        >
          {error && (
            <Alert tone="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Field label="Correo electrónico" required>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="usuario@lasparotas.mx"
              autoComplete="username"
              required
            />
          </Field>

          <Field label="Contraseña" required>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-body-md text-outline hover:text-on-surface"
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </Field>

          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Verificando…' : 'Acceder al portal'}
          </Button>
        </form>
        {/* Los usuarios de prueba viven en el README, no aquí: en producción
            esta pantalla la ve cualquiera que abra la dirección. */}

        {/* La salida de regreso. Al público general le llega esta pantalla por
            equivocación —el botón de socios del sitio lo trae aquí— y sin una
            liga de vuelta se queda atorado en un formulario que no puede
            llenar. */}
        <p className="mt-6 border-t border-outline-variant/40 pt-5 text-center text-body-md text-outline">
          ¿Buscaba reservar una salida?{' '}
          <a
            href={SITIO_PUBLICO}
            className="font-semibold text-primary underline decoration-outline-variant underline-offset-4 transition hover:text-primary-container"
          >
            Volver al sitio del club
          </a>
        </p>
      </div>
    </div>
  );
}
