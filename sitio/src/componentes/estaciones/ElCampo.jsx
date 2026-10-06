/**
 * El campo: el mapa grande al centro, en horizontal, y las fotos del hoyo
 * alrededor.
 *
 * En escritorio la pantalla se arma en tres franjas:
 *
 *   ┌───────────┬───────────┐
 *   │  foto 2   │  foto 3   │   ← dos secundarias arriba
 *   ├───────────┴───────────┤
 *   │   M A P A  (grande,   │   ← el mapa, al centro, horizontal
 *   │     horizontal)       │
 *   ├───────────────────────┤
 *   │  foto 1 (principal)   │   ← la principal, abajo, ancha
 *   └───────────────────────┘
 *
 * El mapa es el protagonista: va al centro, apaisado y vestido de plano
 * (curvas de nivel, franjas de corte, brújula y escala). Se navega tocando un
 * hoyo en el mapa. El cambio de hoyo entra con un desvanecido suave.
 *
 * En celular el mapa NO aparece —le quita protagonismo a las fotos—. En su
 * lugar hay una tira delgada de números para cambiar de hoyo, la foto
 * principal grande y las dos secundarias debajo.
 */
import { useEffect, useRef, useState } from 'react';

import RecorridoHorizontal from '../RecorridoHorizontal';
import { GALERIA_HOYO, HOYOS } from '../../datos/campo';
import { useIdioma } from '../../datos/idioma';

/** Cuánto dura el fade en ms. Va rápido para que no se sienta lento. */
const FADE_MS = 500;

export default function ElCampo({ hoyoActivo, onElegirHoyo }) {
  const { t } = useIdioma();
  const hoyo = HOYOS.find((h) => h.n === hoyoActivo) || HOYOS[0];
  const fotos = GALERIA_HOYO[hoyo.n] || GALERIA_HOYO[1];

  // Precarga para que el fade no enseñe un hueco gris.
  const [listas, setListas] = useState(fotos);
  const [visible, setVisible] = useState(true);
  const pendiente = useRef(null);

  useEffect(() => {
    // Si son las mismas fotos, no hay nada que hacer.
    if (fotos.every((f, i) => f === listas[i])) return undefined;

    // Fade out, cambiar, fade in.
    setVisible(false);
    pendiente.current = fotos;

    // Precargar las tres fotos antes de mostrarlas.
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
      // Esperar a que termine el fade out antes de cambiar.
      setTimeout(() => {
        if (!vigente) return;
        setListas(pendiente.current);
        // Dar un frame para que el navegador pinte las fotos nuevas antes del fade in.
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

  // El fade solo toca a las fotos; el mapa se queda quieto (ya anima su bola).
  const fade = {
    opacity: visible ? 1 : 0,
    transition: `opacity ${FADE_MS}ms ease`,
  };

  const rotulo = `${t('campo.cuenta', { n: String(hoyo.n).padStart(2, '0') })} · ${t(
    'campo.par',
    { par: hoyo.par, mitad: hoyo.n <= 9 ? t('campo.ida') : t('campo.vuelta') },
  )}`;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* ======================================================= ESCRITORIO */}
      <div className="hidden min-h-0 flex-1 flex-col gap-3 lg:flex">
        {/* Arriba: las dos secundarias. */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3" style={fade}>
          <Foto src={listas[1]} />
          <Foto src={listas[2]} />
        </div>

        {/* Centro: el mapa, grande y horizontal. */}
        <div className="relative min-h-0 flex-[1.5] overflow-hidden rounded-sm">
          <RecorridoHorizontal
            hoyoActivo={hoyo.n}
            onElegirHoyo={onElegirHoyo}
            orientacion="horizontal"
          />
          <Rotulo texto={rotulo} className="absolute bottom-2 left-1/2 -translate-x-1/2" />
        </div>

        {/* Abajo: la principal, ancha. */}
        <div className="min-h-0 flex-1" style={fade}>
          <Foto src={listas[0]} etiqueta={t('campo.foto', { n: hoyo.n })} />
        </div>
      </div>

      {/* =========================================================== CELULAR */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:hidden">
        {/* Tira de hoyos: lo mínimo para navegar, sin robarle cuadro a la foto. */}
        <SelectorHoyos hoyo={hoyo} onElegir={onElegirHoyo} rotulo={rotulo} t={t} />

        {/* La principal, grande. */}
        <div className="min-h-0 flex-[1.7]" style={fade}>
          <Foto src={listas[0]} etiqueta={t('campo.foto', { n: hoyo.n })} />
        </div>

        {/* Las dos secundarias. */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2.5" style={fade}>
          <Foto src={listas[1]} />
          <Foto src={listas[2]} />
        </div>
      </div>
    </div>
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

/** El rótulo "01 de 18 · Par 5 · la ida", sobre una pastilla legible. */
function Rotulo({ texto, className = '' }) {
  return (
    <div className={`pointer-events-none rounded-full bg-sombra/60 px-3 py-1 backdrop-blur-sm ${className}`}>
      <p className="font-texto text-menudo text-arena/85">{texto}</p>
    </div>
  );
}

/** Tira de números para cambiar de hoyo en celular (no es el mapa). */
function SelectorHoyos({ hoyo, onElegir, rotulo, t }) {
  return (
    <div className="shrink-0">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {HOYOS.map((h) => {
          const activo = h.n === hoyo.n;
          return (
            <button
              key={h.n}
              onClick={() => onElegir(h.n)}
              aria-pressed={activo}
              aria-label={t('mapa.unHoyo', { n: h.n, par: h.par })}
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-texto text-[0.8rem] font-semibold transition ${
                activo
                  ? 'bg-hoja text-sombra-honda'
                  : 'border border-arena/30 text-arena/70 hover:border-hoja hover:text-hoja'
              }`}
            >
              {h.n}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-center font-texto text-menudo text-arena/70">{rotulo}</p>
    </div>
  );
}
