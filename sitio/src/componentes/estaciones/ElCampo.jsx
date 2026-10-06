/**
 * El campo: el mapa y tres fotos del hoyo en cuadrícula 2×2.
 *
 * En desktop la pantalla se parte en cuatro cuadrantes:
 *
 *   ┌──────────┬──────────┐
 *   │  mapa    │  foto 1  │
 *   ├──────────┼──────────┤
 *   │  foto 2  │  foto 3  │
 *   └──────────┴──────────┘
 *
 * La foto principal va arriba a la derecha, al lado del mapa, y las dos
 * secundarias abajo. Se navega tocando un hoyo en el mapa: no hay flechas.
 * El cambio de hoyo entra con un desvanecido suave.
 *
 * En celular el mapa se queda arriba como franja horizontal y las tres fotos
 * se apilan debajo, con la principal más grande.
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

  return (
    <div className="flex w-full flex-1 flex-col gap-3">
      {/* ------------------------------------------------------- el mapa */}
      {/* En celular: franja horizontal arriba, separada de las fotos.
          En desktop: se integra como cuadrante superior izquierdo del grid. */}
      <div className="relative shrink-0 lg:hidden">
        <div className="h-[18svh]">
          <RecorridoHorizontal
            hoyoActivo={hoyo.n}
            onElegirHoyo={onElegirHoyo}
          />
        </div>
        <p className="pointer-events-none mt-1 text-center font-texto text-menudo text-arena/70">
          {t('campo.cuenta', { n: String(hoyo.n).padStart(2, '0') })} ·{' '}
          {t('campo.par', {
            par: hoyo.par,
            mitad: hoyo.n <= 9 ? t('campo.ida') : t('campo.vuelta'),
          })}
        </p>
      </div>

      {/* ------------------------------------------------- grid 2×2 */}
      {/* Desktop: cuadrícula de cuatro cuadrantes (mapa + 3 fotos).
          Celular: solo las tres fotos (el mapa ya está arriba). */}
      <div
        className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2 lg:gap-3"
        style={{
          opacity: visible ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease`,
        }}
      >
        {/* Cuadrante superior izquierdo: el mapa (solo desktop). */}
        <div className="relative hidden overflow-hidden rounded-sm lg:block">
          <RecorridoHorizontal
            hoyoActivo={hoyo.n}
            onElegirHoyo={onElegirHoyo}
          />
          <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center font-texto text-menudo text-arena/70">
            {t('campo.cuenta', { n: String(hoyo.n).padStart(2, '0') })} ·{' '}
            {t('campo.par', {
              par: hoyo.par,
              mitad: hoyo.n <= 9 ? t('campo.ida') : t('campo.vuelta'),
            })}
          </p>
        </div>

        {/* Foto principal — arriba derecha en desktop, ocupa dos columnas
            en celular para que siga siendo la más grande. */}
        <div
          className="col-span-2 overflow-hidden rounded-sm bg-sombra-clara lg:col-span-1"
          role="img"
          aria-label={t('campo.foto', { n: hoyo.n })}
        >
          <img
            src={listas[0]}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>

        {/* Foto secundaria izquierda. */}
        <div className="overflow-hidden rounded-sm bg-sombra-clara">
          <img
            src={listas[1]}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>

        {/* Foto secundaria derecha. */}
        <div className="overflow-hidden rounded-sm bg-sombra-clara">
          <img
            src={listas[2]}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
