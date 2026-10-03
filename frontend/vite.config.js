import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Configuración de desarrollo.
 *
 * Para exponer el sistema por un túnel (ngrok, Cloudflare Tunnel, etc.) basta
 * con llenar `VITE_PUBLIC_HOST` en el `.env`. Con eso se resuelven las dos
 * cosas que rompen un túnel y que no son obvias:
 *
 *  1. Vite 6 rechaza toda petición cuyo encabezado Host no reconoce, para que
 *     un sitio ajeno no pueda apuntar a tu servidor local. El dominio del
 *     túnel hay que autorizarlo explícitamente o se recibe un
 *     "Blocked request. This host is not allowed."
 *  2. El recargado en caliente abre su propio WebSocket. Si no se le dice que
 *     del otro lado hay HTTPS en el puerto 443, el navegador intenta
 *     `ws://dominio:5173`, que no existe, y la página queda recargándose sola.
 *
 * Solo se toca el frontend: un único túnel al 5173 alcanza, porque el proxy
 * de abajo reenvía `/api` al backend desde el servidor, no desde el navegador.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Se acepta con o sin protocolo: "midominio.ngrok.app" y
  // "https://midominio.ngrok.app" funcionan igual.
  const publicHost = (env.VITE_PUBLIC_HOST || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

  return {
    // El sistema no vive en la raíz del dominio: ahí está el sitio público del
    // club. Esto hace que los archivos compilados se pidan a /sistema/assets/…
    // en lugar de /assets/…, que es donde no están.
    base: '/sistema/',
    plugins: [react()],
    server: {
      port: 5173,
      // Escucha en todas las interfaces: el túnel y los dispositivos de la
      // misma red pueden entrar, no solo el navegador de esta máquina.
      host: true,

      // Se autoriza el dominio del túnel y cualquier subdominio de ngrok
      // (los efímeros cambian de nombre en cada arranque).
      allowedHosts: publicHost
        ? [publicHost, '.ngrok-free.app', '.ngrok.app', '.ngrok.io']
        : undefined,

      // El túnel termina el TLS: hacia afuera es wss por el 443.
      hmr: publicHost ? { protocol: 'wss', host: publicHost, clientPort: 443 } : undefined,

      proxy: {
        // El front habla con /api y Vite lo reenvía al backend en desarrollo.
        // ws: true es indispensable: sin eso el proxy reenvía las peticiones
        // HTTP pero no el WebSocket de /api/ws, y el tiempo real queda mudo.
        '/api': {
          target: env.VITE_BACKEND_ORIGIN || 'http://localhost:8000',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
