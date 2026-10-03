import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import AppRouter from './router';
import { AuthProvider } from './context/AuthContext';
import { RealtimeProvider } from './context/RealtimeContext';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Todas las rutas del sistema cuelgan de /sistema: la raíz del dominio
        es el sitio público. Sin esto, /recepcion buscaría en la raíz y caería
        en el sitio. */}
    <BrowserRouter basename="/sistema">
      <AuthProvider>
        {/* El canal de tiempo real vive dentro de la sesión: se conecta al
            iniciar sesión y se cierra al salir. */}
        <RealtimeProvider>
          <AppRouter />
        </RealtimeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
