import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { publicApi } from '../api/client';

export default function PublicPassPage() {
  const { token } = useParams();
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('Identificando pase...');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('Pase inválido.');
      return;
    }

    publicApi
      .scanPass(token)
      .then((response) => {
        setState('success');
        setMessage(response.message);
      })
      .catch((error) => {
        setState('error');
        setMessage(error.message);
      });
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-6 py-10">
      <section className="w-full max-w-md rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-8 text-center shadow-card">
        <p className="mb-3 text-label-md uppercase tracking-wider text-secondary">Las Parotas</p>
        <h1 className="font-serif text-headline-lg text-primary">
          {state === 'success' ? 'Pase identificado' : state === 'error' ? 'No se pudo identificar' : 'Procesando pase'}
        </h1>
        <p className="mt-4 text-body-lg text-on-surface-variant">{message}</p>
        {state === 'success' && (
          <p className="mt-6 text-body-md text-outline">
            La reserva aparecerá en la computadora de recepción.
          </p>
        )}
      </section>
    </main>
  );
}