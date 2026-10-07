/**
 * El campo: el mapa y las fotos del hoyo, en cuadrícula.
 *
 * En escritorio, tal como el mockup del club:
 *
 *   ‹  ┌───────────────┬───────────────┐  ›
 *      │     MAPA       │    foto 1     │
 *      │  Hoyo N/Par X  │               │
 *      ├───────────────┼───────────────┤
 *      │     foto 2     │    foto 3     │
 *      └───────────────┴───────────────┘
 *
 * El mapa va arriba a la izquierda —completo, sin fotos encima, así que todos
 * los hoyos se ven y se tocan— con la etiqueta "Hoyo N / Par X" debajo. A la
 * derecha una foto; debajo del mapa otra; debajo de esa foto, la tercera. A los
 * costados, flechas ‹ › para saltar de hoyo. El cambio de hoyo entra con un
 * desvanecido suave (solo las fotos; el mapa anima su bola).
 *
 * En celular no hay mapa —la foto manda—: una barra con ‹ Hoyo N · Par X › para
 * navegar, la foto principal grande y las dos secundarias debajo.
 */
import { useEffect, useRef, useState } from 'react';

import RecorridoHorizontal from '../RecorridoHorizontal';
import { GALERIA_HOYO, HOYOS } from '../../datos/campo';
import { useIdioma } from '../../datos/idioma';

const FADE_MS = 500;

export default function ElCampo({ hoyoActivo, onElegirHoyo }) {
  const { t } = useIdioma();
  const hoyo = HOYOS.find((h) => h.n === hoyoActivo) || HOYOS[0];
  const fotos = GALERIA_HOYO[hoyo.n] || GALERIA_HOYO[1];

  const [listas, setListas] = useState(fotos);
  const [visible, setVisible] = useState(true);
  const pendiente = useRef(null);

  useEffect(() => {
    if (fotos.every((f, i) => f === listas[i])) return undefined;
    setVisible(false);
    pendiente.current = fotos;

    let vigente = true;
    const promesas = fotos.map(
      (src) =>
        new Promise((ok) => {
          const img = new Image();
          img.src = src;
          if (img.complete) ok();
          else {
            img.onload = ok;
            img.onerror = ok;
          }
        }),
    );
    Promise.all(promesas).then(() => {
      if (!vigente) return;
      setTimeout(() => {
        if (!vigente) return;
        setListas(pendiente.current);
        requestAnimationFrame(() => {
          if (vigente) setVisible(true);
        });
      }, FADE_MS);
    });
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoyo.n]);

  const fade = { opacity: visible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` };

  const idx = HOYOS.findIndex((h) => h.n === hoyo.n);
  const irHoyo = (paso) => onElegirHoyo(HOYOS[(idx + paso + HOYOS.length) % HOYOS.length].n);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* ======================================================= ESCRITORIO */}
      <div className="relative hidden min-h-0 flex-1 lg:block">
        {/* Flechas para cambiar de hoyo, a los costados de todo. */}
        <Flecha
          hacia="izq"
          onClick={() => irHoyo(-1)}
          etiqueta={t('campo.anterior')}
          className="absolute left-0 top-1/2 z-40 -translate-y-1/2"
        />
        <Flecha
          hacia="der"
          onClick={() => irHoyo(1)}
          etiqueta={t('campo.siguiente')}
          className="absolute right-0 top-1/2 z-40 -translate-y-1/2"
        />

        {/* Cuadrícula 2×2: cada casilla en su renglón, así las de abajo quedan
            parejas. Hueco a los lados para las flechas. */}
        <div className="grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-3 px-14">
          {/* [1,1] Mapa + etiqueta debajo (sin recuadro oscuro). */}
          <div className="flex min-h-0 flex-col">
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <RecorridoHorizontal
                hoyoActivo={hoyo.n}
                onElegirHoyo={onElegirHoyo}
                orientacion="horizontal"
              />
            </div>
            <EtiquetaHoyo hoyo={hoyo} t={t} centrado className="mt-1 shrink-0" />
          </div>

          {/* [1,2] Foto principal. */}
          <div className="min-h-0" style={fade}>
            <Foto src={listas[0]} etiqueta={t('campo.foto', { n: hoyo.n })} />
          </div>

          {/* [2,1] Foto, debajo del mapa. */}
          <div className="min-h-0" style={fade}>
            <Foto src={listas[1]} />
          </div>

          {/* [2,2] Foto, debajo de la principal. */}
          <div className="min-h-0" style={fade}>
            <Foto src={listas[2]} />
          </div>
        </div>
      </div>

      {/* =========================================================== CELULAR */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:hidden">
        {/* Barra de navegación: ‹ Hoyo N · Par X › */}
        <div className="flex shrink-0 items-center justify-between gap-3">
          <Flecha hacia="izq" onClick={() => irHoyo(-1)} etiqueta={t('campo.anterior')} />
          <EtiquetaHoyo hoyo={hoyo} t={t} centrado />
          <Flecha hacia="der" onClick={() => irHoyo(1)} etiqueta={t('campo.siguiente')} />
        </div>

        <div className="min-h-0 flex-[1.9]" style={fade}>
          <Foto src={listas[0]} etiqueta={t('campo.foto', { n: hoyo.n })} />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2.5" style={fade}>
          <Foto src={listas[1]} />
          <Foto src={listas[2]} />
        </div>
      </div>
    </div>
  );
}

/** "Hoyo N" grande y "Par X" debajo. Pastilla oscura (web) o texto (celular). */
function EtiquetaHoyo({ hoyo, t, centrado = false, pill = false, className = '' }) {
  const cuerpo = (
    <>
      <p className="font-titulo text-rotulo-md leading-none text-arena [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
        {t('campo.rotHoyo', { n: hoyo.n })}
      </p>
      <p className="mt-0.5 font-texto text-menudo text-arena/85 [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
        {t('campo.rotPar', { par: hoyo.par })}
      </p>
    </>
  );
  if (pill) {
    return (
      <div className={`pointer-events-none rounded-sm bg-sombra/65 px-5 py-2 text-center backdrop-blur-sm ${className}`}>
        {cuerpo}
      </div>
    );
  }
  return <div className={`pointer-events-none ${centrado ? 'text-center' : ''} ${className}`}>{cuerpo}</div>;
}

/** Flecha ‹ / › para cambiar de hoyo. */
function Flecha({ hacia, onClick, etiqueta, className = '' }) {
  const d = hacia === 'izq' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19';
  return (
    <button
      onClick={onClick}
      aria-label={etiqueta}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border border-arena/30 bg-sombra/50 text-arena backdrop-blur-sm transition hover:border-hoja hover:text-hoja focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
}

/** Una foto del hoyo, recortada a su cuadro. */
function Foto({ src, etiqueta }) {
  return (
    <div
      className="h-full w-full overflow-hidden rounded-sm bg-sombra-clara"
      role="img"
      aria-label={etiqueta || undefined}
    >
      <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
    </div>
  );
}
