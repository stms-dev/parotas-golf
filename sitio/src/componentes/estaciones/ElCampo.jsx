/**
 * El campo: el mapa grande al centro y las fotos del hoyo encimadas sobre él.
 *
 * En escritorio es una composición, no una cuadrícula: el mapa apaisado ocupa
 * el centro y las tres fotos del hoyo flotan **por encima** de sus orillas —una
 * arriba al centro, dos abajo en las esquinas— con marco claro y sombra, para
 * que se vean montadas y no apachurradas en casillas fijas.
 *
 *            ┌───────────────┐
 *            │    foto 1     │        (principal, arriba al centro)
 *   ┌────────┴───────────────┴────────┐
 *   │          M A P A  (centro,       │
 *   │  ┌──────┐   horizontal)  ┌──────┐│
 *   └──┤foto 2├────────────────┤foto 3├┘
 *      └──────┘                └──────┘
 *
 * El mapa es el protagonista y se navega tocando un hoyo. El cambio de hoyo
 * entra con un desvanecido suave, que toca solo a las fotos; el mapa se queda
 * quieto porque ya anima su bola.
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

  // El fade solo toca a las fotos; el mapa se queda quieto.
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
      {/* ======================================================= ESCRITORIO
          Composición encimada: el mapa al centro, las fotos sobre sus bordes. */}
      <div className="group relative hidden min-h-0 flex-1 lg:block">
        {/* El mapa, al centro y apaisado. Deja margen arriba y abajo para que
            las fotos puedan montarse sobre sus orillas. Al pasar el cursor por
            encima, el mapa sube al frente (tapa las fotos) para poder tocar
            cualquier hoyo, incluso los que quedan debajo de una foto; al quitar
            el cursor, las fotos vuelven a montarse encima. */}
        <div className="absolute inset-x-[6%] inset-y-[12%] z-0 group-hover:z-30">
          <RecorridoHorizontal
            hoyoActivo={hoyo.n}
            onElegirHoyo={onElegirHoyo}
            orientacion="horizontal"
          />
        </div>

        {/* El rótulo del hoyo, sobre el mapa, en una zona despejada. */}
        <Rotulo texto={rotulo} className="absolute left-1/2 top-[6%] -translate-x-1/2" />

        {/* Foto principal: arriba al centro, montada sobre el borde de arriba. */}
        <FotoFlotante
          src={listas[0]}
          etiqueta={t('campo.foto', { n: hoyo.n })}
          estilo={fade}
          className="absolute left-1/2 top-0 z-10 w-[29%] -translate-x-1/2"
        />

        {/* Foto 2: abajo a la izquierda. */}
        <FotoFlotante
          src={listas[1]}
          estilo={fade}
          className="absolute bottom-0 left-[2%] z-10 w-[27%]"
        />

        {/* Foto 3: abajo a la derecha. */}
        <FotoFlotante
          src={listas[2]}
          estilo={fade}
          className="absolute bottom-0 right-[2%] z-10 w-[27%]"
        />
      </div>

      {/* =========================================================== CELULAR
          Sin mapa: la foto manda. Una tira de números para navegar. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:hidden">
        <SelectorHoyos hoyo={hoyo} onElegir={onElegirHoyo} rotulo={rotulo} t={t} />

        <div className="min-h-0 flex-[1.7]" style={fade}>
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

/** Una foto montada sobre el mapa: marco claro + sombra para que flote. */
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

/** El rótulo "01 de 18 · Par 5 · la ida", sobre una pastilla legible. */
function Rotulo({ texto, className = '' }) {
  return (
    <div className={`pointer-events-none z-20 rounded-full bg-sombra/60 px-3 py-1 backdrop-blur-sm ${className}`}>
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
