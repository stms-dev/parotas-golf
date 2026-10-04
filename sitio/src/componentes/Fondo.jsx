/**
 * El campo de fondo: fotos reales, desenfocadas y a media luz.
 *
 * Reemplaza a la mancha de color que había antes. La idea es la misma —dar
 * atmósfera sin estorbar— pero ahora lo que se insinúa detrás del texto es el
 * campo de verdad: su pasto, sus parotas, su cerro.
 *
 * Tres reglas, y las tres son por legibilidad:
 *
 * 1. **Desenfoque fuerte.** Una foto nítida detrás de un párrafo pelea con él:
 *    el ojo persigue las ramas en vez de leer. Desenfocada deja color y luz,
 *    que es lo único que se le pide.
 * 2. **Oscurecida de verdad.** El sitio escribe en claro sobre oscuro. Sin una
 *    capa encima, un cielo blanco en la foto se come un renglón entero.
 * 3. **Cambia despacio y con calma.** Una foto nueva cada vez que se cambia de
 *    parada, y si alguien se queda quieto, un relevo lento. Nunca de golpe:
 *    dos capas que se cruzan, porque un corte seco en el fondo distrae tanto
 *    como un movimiento brusco.
 *
 * Quien pidió menos movimiento (`prefers-reduced-motion`) se queda con una
 * sola foto, fija.
 */
import { useEffect, useRef, useState } from 'react';

import { FONDOS } from '../datos/campo';

/** Cada cuánto se releva la foto si nadie toca nada. */
const RELEVO_MS = 14000;

/** Una al azar, pero nunca la que ya está puesta. */
function otraQueNoSea(actual) {
  if (FONDOS.length < 2) return FONDOS[0];
  let siguiente = actual;
  while (siguiente === actual) {
    siguiente = FONDOS[Math.floor(Math.random() * FONDOS.length)];
  }
  return siguiente;
}

export default function Fondo({ cambiarCon }) {
  // Dos capas que se turnan: la de abajo sostiene la imagen vieja mientras la
  // de arriba aparece. Con una sola, el cambio sería un parpadeo.
  const [capas, setCapas] = useState(() => {
    const primera = FONDOS[Math.floor(Math.random() * FONDOS.length)];
    return { debajo: primera, encima: null };
  });
  const encimaVisible = useRef(false);
  const quieto =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function relevar() {
    setCapas((c) => {
      const actual = encimaVisible.current ? c.encima : c.debajo;
      const nueva = otraQueNoSea(actual);
      encimaVisible.current = !encimaVisible.current;
      return encimaVisible.current
        ? { debajo: c.debajo, encima: nueva }
        : { debajo: nueva, encima: c.encima };
    });
  }

  // Al cambiar de parada.
  const primeraVez = useRef(true);
  useEffect(() => {
    if (quieto) return;
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    relevar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cambiarCon]);

  // Y solo, para quien se queda leyendo.
  useEffect(() => {
    if (quieto) return undefined;
    const t = setInterval(relevar, RELEVO_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capa = (url, visible) =>
    url ? (
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-[2200ms] ease-rodada"
        style={{
          backgroundImage: `url(${url})`,
          opacity: visible ? 1 : 0,
          // El desenfoque va aquí y no en un filtro de CSS sobre el padre para
          // que no arrastre al contenido. `scale` tapa el borde transparente
          // que el desenfoque deja en las orillas.
          filter: 'blur(26px) saturate(0.85)',
          transform: 'scale(1.12)',
        }}
      />
    ) : null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-sombra">
      {capa(capas.debajo, !encimaVisible.current)}
      {capa(capas.encima, encimaVisible.current)}

      {/* Lo que hace legible el texto de encima, en dos capas.
          La cortina pareja asienta el tono general; el degradado carga la
          tinta arriba y abajo, que es donde viven el encabezado y el pie.
          Entre las dos dejan ver que hay una foto —que es el punto— sin que
          un cielo blanco se coma un renglón. Bajar más la cortina se ve
          bonito en una foto oscura y arruina la siguiente. */}
      <div className="absolute inset-0 bg-sombra/[0.58]" />
      <div className="absolute inset-0 bg-gradient-to-b from-sombra/75 via-sombra/25 to-sombra/80" />
    </div>
  );
}
