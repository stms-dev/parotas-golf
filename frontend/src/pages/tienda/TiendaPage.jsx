/**
 * Tienda (Pro-Shop): punto de venta propio, aparte de check-in, partidas y
 * renta de bastones. Tiene su catálogo, su inventario, su caja y sus reportes.
 * Los hoteles no la ven.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { tiendaApi } from '../../api/client';
import Icono from '../../components/Icono';
import { Modal } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { error as avisoError, notificar } from '../../utils/avisos';
import { fechaHora, mxn } from '../../utils/format';
import Caja from './Caja';
import { BOTON, BOTON_FUERTE, CAMPO, ETIQUETA, useAtiende } from './comun';
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
  const [abriendo, setAbriendo] = useState(false);

  const cargarCaja = useCallback(() => {
    tiendaApi
      .cajaActual()
      .then((r) => setCaja(r.corte || null))
      .catch(() => setCaja(null));
  }, []);

  useEffect(() => {
    cargarCaja();
  }, [cargarCaja]);

  const ir = (id) => setParams(id === 'vender' ? {} : { vista: id }, { replace: true });
  const props = { caja: caja || null, atiende, onCajaCambio: cargarCaja, onAbrirCaja: () => setAbriendo(true) };

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
          <EstadoCaja caja={caja} onAbrir={() => setAbriendo(true)} onVer={() => ir('caja')} />
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

      {abriendo && (
        <AbrirCaja
          atiende={atiende}
          onCerrar={() => setAbriendo(false)}
          onListo={() => {
            setAbriendo(false);
            cargarCaja();
          }}
        />
      )}
    </div>
  );
}

function EstadoCaja({ caja, onAbrir, onVer }) {
  if (caja === undefined) return null;
  if (!caja) {
    return (
      <button type="button" onClick={onAbrir} className={BOTON_FUERTE}>
        <Icono nombre="llave" size={16} className="text-secondary-fixed" /> Abrir caja
      </button>
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

function AbrirCaja({ atiende, onCerrar, onListo }) {
  const [fondo, setFondo] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function abrir(e) {
    e?.preventDefault();
    if (atiende.trim().length < 3) return avisoError('¿Quién abre la caja?', 'Escriba arriba su nombre en "Atiende".');
    setGuardando(true);
    try {
      await tiendaApi.abrirCaja({ fondo_inicial: Number(fondo || 0), atendio: atiende.trim() });
      notificar('Caja de tienda abierta');
      onListo();
    } catch (err) {
      avisoError('No se abrió la caja', err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open
      title="Abrir caja de la tienda"
      onClose={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className={BOTON}>Cancelar</button>
          <button type="button" onClick={abrir} disabled={guardando} className={BOTON_FUERTE}>
            {guardando ? 'Abriendo…' : 'Abrir caja'}
          </button>
        </>
      }
    >
      <form onSubmit={abrir}>
        <p className="text-body-lg text-on-surface-variant">
          Cuente el cambio que hay en el cajón de la tienda. Esta caja es aparte de la de green fees.
        </p>
        <label className="mt-4 block">
          <span className={ETIQUETA}>Fondo de cambio</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={fondo}
            onChange={(e) => setFondo(e.target.value)}
            placeholder="0.00"
            className={`${CAMPO} font-mono text-title-lg`}
            autoFocus
          />
        </label>
        <p className="mt-2 text-body-md text-outline">La abre: {atiende.trim() || '— (escriba su nombre arriba)'}</p>
      </form>
    </Modal>
  );
}
