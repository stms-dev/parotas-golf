/**
 * El campo de fondo: fotos reales, desenfocadas y a media luz.
 *
 * Reemplaza a la mancha de color que había antes. La idea es la misma —dar
 * atmósfera sin estorbar— pero ahora lo que se insinúa detrás del texto es el
 * campo de verdad: su pasto, sus parotas, su cerro.
 *
 * Tres reglas, y las tres son por legibilidad:
 *
 * 1. **Desenfoque, pero el justo.** Una foto nítida detrás de un párrafo pelea
 *    con él: el ojo persigue las ramas en vez de leer. Pasado de desenfoque,
 *    en cambio, deja de ser el campo y se vuelve una mancha de color. El punto
 *    está en que se reconozca el lugar sin poder leerlo.
 * 2. **Oscurecida de verdad.** El sitio escribe en claro sobre oscuro. Sin una
 *    capa encima, un cielo blanco en la foto se come un renglón entero.
 * 3. **Cambia seguido, pero sin brincos.** Una foto nueva cada vez que se
 *    cambia de parada, y un relevo cada ocho segundos para quien se queda
 *    leyendo. El cruce dura algo más de un segundo: lo bastante para que no
 *    sea un corte seco y lo bastante poco para que no parezca que la página
 *    se quedó pensando.
 *
 * Quien pidió menos movimiento (`prefers-reduced-motion`) se queda con una
 * sola foto, fija.
 */
import { useEffect, useRef, useState } from 'react';

import { FONDOS } from '../datos/campo';

/** Cada cuánto se releva la foto si nadie toca nada. */
const RELEVO_MS = 8000;

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
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-[1100ms] ease-rodada"
        style={{
          backgroundImage: `url(${url})`,
          opacity: visible ? 1 : 0,
          // El desenfoque va aquí y no en un filtro de CSS sobre el padre para
          // que no arrastre al contenido. `scale` tapa el borde transparente
          // que el desenfoque deja en las orillas.
          filter: 'blur(6px) saturate(0.95)',
          transform: 'scale(1.05)',
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
      <div className="absolute inset-0 bg-sombra/[0.42]" />
      <div className="absolute inset-0 bg-gradient-to-b from-sombra/70 via-sombra/15 to-sombra/75" />
    </div>
  );
}
