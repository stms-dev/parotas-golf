/**
 * El campo: el circuito del recorrido al centro y las fotos del hoyo, grandes,
 * alrededor.
 *
 * El mapa es ahora un circuito pequeño (solo nodos + línea), así que las fotos
 * se llevan el espacio y se ven grandes. A los costados hay flechas ‹ › para
 * saltar de hoyo; también se puede tocar un hoyo en el circuito. Arriba se lee
 * siempre "Hoyo N / Par X".
 *
 *   ‹            [ foto 1 (principal) ]            ›
 *                   ( circuito chico )
 *                [ foto 2 ]   [ foto 3 ]
 *
 * El cambio de hoyo entra con un desvanecido suave, que toca solo a las fotos.
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

  // Saltar al hoyo anterior / siguiente, dando la vuelta en los extremos.
  const idx = HOYOS.findIndex((h) => h.n === hoyo.n);
  const irHoyo = (paso) => onElegirHoyo(HOYOS[(idx + paso + HOYOS.length) % HOYOS.length].n);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* ======================================================= ESCRITORIO */}
      <div className="group relative hidden min-h-0 flex-1 lg:block">
        {/* Etiqueta del hoyo, siempre visible, arriba a la izquierda. */}
        <EtiquetaHoyo hoyo={hoyo} t={t} className="absolute left-0 top-0 z-40" />

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

        {/* El circuito, chico y al centro. Al pasar el cursor sube al frente
            (tapa las fotos) para poder tocar cualquier hoyo; al salir, las
            fotos vuelven a montarse encima. */}
        <div className="absolute inset-x-[22%] inset-y-[26%] z-0 group-hover:z-30">
          <RecorridoHorizontal
            hoyoActivo={hoyo.n}
            onElegirHoyo={onElegirHoyo}
            orientacion="horizontal"
          />
        </div>

        {/* Fotos grandes, montadas sobre las orillas del circuito. */}
        <FotoFlotante
          src={listas[0]}
          etiqueta={t('campo.foto', { n: hoyo.n })}
          estilo={fade}
          className="absolute left-1/2 top-0 z-10 w-[36%] -translate-x-1/2"
        />
        <FotoFlotante
          src={listas[1]}
          estilo={fade}
          className="absolute bottom-0 left-[9%] z-10 w-[33%]"
        />
        <FotoFlotante
          src={listas[2]}
          estilo={fade}
          className="absolute bottom-0 right-[9%] z-10 w-[33%]"
        />
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

/** "Hoyo N" grande y "Par X" debajo. Se usa en web y en celular. */
function EtiquetaHoyo({ hoyo, t, centrado = false, className = '' }) {
  return (
    <div className={`pointer-events-none ${centrado ? 'text-center' : ''} ${className}`}>
      <p className="font-titulo text-rotulo-md leading-none text-arena [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
        {t('campo.rotHoyo', { n: hoyo.n })}
      </p>
      <p className="mt-1 font-texto text-menudo text-arena/85 [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
        {t('campo.rotPar', { par: hoyo.par })}
      </p>
    </div>
  );
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

/** Una foto montada sobre el circuito: marco claro + sombra para que flote. */
function FotoFlotante({ src, etiqueta, estilo, className = '' }) {
  return (
    <figure
      className={`overflow-hidden rounded-sm border-[3px] border-arena/90 shadow-[0_16px_38px_rgba(0,0,0,0.5)] ${className}`}
      style={estilo}
      role="img"
      aria-label={etiqueta || undefined}
    >
      <div className="aspect-[16/10] w-full bg-sombra-clara">
        <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
      </div>
    </figure>
  );
}

/** Una foto del hoyo a cuadro completo (celular). */
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
