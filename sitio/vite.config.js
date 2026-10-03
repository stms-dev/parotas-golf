import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El sitio público vive aparte del sistema de operación a propósito: se
// despliega como archivos estáticos y se edita sin volver a desplegar la
// aplicación con la que trabaja la caseta.
export default defineConfig({
  plugins: [react()],
  server: { port: 5180, host: true },
});
