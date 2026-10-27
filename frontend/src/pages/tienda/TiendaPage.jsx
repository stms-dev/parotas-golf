/**
 * Tienda (Pro-Shop): punto de venta propio, aparte de check-in, partidas y
 * renta de bastones. Tiene su catálogo, su inventario, su caja y sus reportes.
 * Los hoteles no la ven.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { tiendaApi } from '../../api/client';
import Icono from '../../components/Icono';
import { useAuth } from '../../context/AuthContext';
import { fechaHora, mxn } from '../../utils/format';
import Caja from './Caja';
import { CAMPO, ETIQUETA, useAtiende } from './comun';
import Productos from './Productos';
import Reportes from './Reportes';
import Vender from './Vender';
import Ventas from './Ventas';

const PESTANAS = [
  { id: 'vender', texto: 'Vender', icono: 'carrito' },
  { id: 'productos', texto: 'Productos', icono: 'paquete', admin: true },
  { id: 'ventas', texto: 'Ventas', icono: 'registro' },
  { id: 'caja', texto: 'Caja', icono: 'cajaFuerte' },
  { id: 'reportes', texto: 'Reportes', icono: 'grafica', admin: true },
];

export default function TiendaPage() {
  const { can } = useAuth();
  const admin = can('tienda:administrar');
  const [params, setParams] = useSearchParams();
  const pestanas = PESTANAS.filter((p) => !p.admin || admin);
  const activa = pestanas.find((p) => p.id === params.get('vista'))?.id || 'vender';
  const [atiende, setAtiende] = useAtiende();
  const [caja, setCaja] = useState(undefined); // undefined = cargando, null = cerrada
  // Datos del horario de la caja: a qué hora cierra y si ya pasó.
  const [horario, setHorario] = useState({ cierraA: null, fuera: false });
  // Se lee desde una ref para que el reloj de abajo no se reinicie con cada letra
  // que se escribe en "Atiende".
  const atiendeRef = useRef(atiende);
  atiendeRef.current = atiende;

  // La caja abre sola: pedirla en horario la deja abierta a nombre de quien
  // atiende, así que no hay botón de abrir.
  const cargarCaja = useCallback(() => {
    const nombre = atiendeRef.current.trim();
    tiendaApi
      .cajaActual(nombre.length >= 3 ? { atiende: nombre } : undefined)
      .then((r) => {
        setCaja(r.corte || null);
        setHorario({ cierraA: r.cierra_a || null, fuera: Boolean(r.fuera_de_horario) });
      })
      .catch(() => setCaja(null));
  }, []);

  // La caja se puede cerrar sola a la hora de cierre: se revisa cada minuto
  // y al volver a la ventana, para no seguir mostrando una caja que ya cerró.
  useEffect(() => {
    cargarCaja();
    const reloj = setInterval(cargarCaja, 60000);
    window.addEventListener('focus', cargarCaja);
    return () => {
      clearInterval(reloj);
      window.removeEventListener('focus', cargarCaja);
    };
  }, [cargarCaja]);

  const ir = (id) => {
    cargarCaja();
    setParams(id === 'vender' ? {} : { vista: id }, { replace: true });
  };
  const props = { caja: caja || null, atiende, onCajaCambio: cargarCaja, horario };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="font-serif text-display-lg leading-tight text-primary">Tienda</h1>
          <p className="text-body-lg text-outline">Pro-Shop: venta de mostrador, inventario y su propia caja.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          <label>
            <span className={ETIQUETA}>Atiende</span>
            <input
              value={atiende}
              onChange={(e) => setAtiende(e.target.value)}
              placeholder="Su nombre"
              className={`${CAMPO.replace('w-full', 'w-52')} ${atiende.trim().length < 3 ? 'border-estado-pend-border bg-estado-pend-bg' : ''}`}
            />
          </label>
          <EstadoCaja caja={caja} horario={horario} onVer={() => ir('caja')} />
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-outline-variant/60">
        {pestanas.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => ir(p.id)}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-title-md transition ${
              activa === p.id
                ? 'border-secondary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-primary'
            }`}
          >
            <Icono nombre={p.icono} size={17} className={activa === p.id ? 'text-secondary' : ''} />
            {p.texto}
          </button>
        ))}
      </nav>

      {caja === undefined ? (
        <p className="py-16 text-center text-body-lg text-outline">Cargando…</p>
      ) : (
        <>
          {activa === 'vender' && <Vender {...props} />}
          {activa === 'productos' && <Productos atiende={atiende} />}
          {activa === 'ventas' && <Ventas {...props} />}
          {activa === 'caja' && <Caja {...props} puedeAdministrar={admin} />}
          {activa === 'reportes' && <Reportes />}
        </>
      )}

    </div>
  );
}

function EstadoCaja({ caja, horario, onVer }) {
  if (caja === undefined) return null;
  if (!caja) {
    return (
      <span className="flex items-center gap-2 rounded border border-outline-variant/60 bg-surface-container-low px-3 py-2 text-body-md text-outline">
        <Icono nombre="candado" size={15} />
        {horario?.fuera
          ? `Caja cerrada desde las ${horario.cierraA}`
          : 'Caja sin abrir'}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onVer}
      title={`Abierta por ${caja.abierto_por_nombre} · ${fechaHora(caja.abierto_en)}`}
      className="flex items-center gap-3 rounded border border-estado-ok-border bg-estado-ok-bg px-3 py-1.5 text-left transition hover:brightness-95"
    >
      <span className="h-2.5 w-2.5 rounded-full bg-estado-ok-text" />
      <span>
        <span className="block text-label-sm uppercase tracking-wider text-estado-ok-text">Caja abierta · #{caja.id}</span>
        <span className="block font-mono text-title-md text-on-surface">
          {mxn(caja.ventas_total)} · {caja.ventas_cuenta} venta{caja.ventas_cuenta === 1 ? '' : 's'}
        </span>
      </span>
    </button>
  );
}
