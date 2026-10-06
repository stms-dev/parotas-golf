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
 *    La excepción es El campo, que le pasa una foto `fija`: ahí el fondo es
 *    el del hoyo que se está mirando y no se releva solo. Un paisaje ajeno
 *    cambiando detrás del hoyo que uno está viendo es un parpadeo que
 *    distrae, y además desperdicia la ocasión de que las dos imágenes sean
 *    del mismo sitio.
 *
 * `hero` es el modo de la portada: las fotos elegidas para el landing se
 * muestran nítidas, sin desenfoque, porque son la atracción — lo que se ve al
 * llegar. El overlay oscuro sigue, pero sin el blur de CSS.
 *
 * Quien pidió menos movimiento (`prefers-reduced-motion`) se queda con una
 * sola foto, fija.
 */
import { useEffect, useRef, useState } from 'react';

import { FONDOS, FOTOS_HERO } from '../datos/campo';

/** Cada cuánto se releva la foto si nadie toca nada. */
const RELEVO_MS = 8000;

/** Una al azar del conjunto dado, pero nunca la que ya está puesta. */
function otraQueNoSea(actual, conjunto) {
  if (conjunto.length < 2) return conjunto[0];
  let siguiente = actual;
  while (siguiente === actual) {
    siguiente = conjunto[Math.floor(Math.random() * conjunto.length)];
  }
  return siguiente;
}

export default function Fondo({ cambiarCon, fija, hero }) {
  const conjunto = hero ? FOTOS_HERO : FONDOS;

  // Dos capas que se turnan: la de abajo sostiene la imagen vieja mientras la
  // de arriba aparece. Con una sola, el cambio sería un parpadeo.
  const [capas, setCapas] = useState(() => {
    const primera = conjunto[Math.floor(Math.random() * conjunto.length)];
    return { debajo: primera, encima: null };
  });
  const encimaVisible = useRef(false);
  const quieto =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function relevar() {
    setCapas((c) => {
      const actual = encimaVisible.current ? c.encima : c.debajo;
      const nueva = otraQueNoSea(actual, conjunto);
      encimaVisible.current = !encimaVisible.current;
      return encimaVisible.current
        ? { debajo: c.debajo, encima: nueva }
        : { debajo: nueva, encima: c.encima };
    });
  }

  // Al cambiar de parada.
  const primeraVez = useRef(true);
  useEffect(() => {
    if (quieto || fija) return;
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    relevar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cambiarCon, fija]);

  // Y solo, para quien se queda leyendo.
  useEffect(() => {
    if (quieto || fija) return undefined;
    const t = setInterval(relevar, RELEVO_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fija]);

  // Con `fija` el fondo deja de ser un paisaje cualquiera y pasa a ser el del
  // hoyo que se está mirando, desenfocado. En El campo eso tiene sentido: el
  // fondo acompaña a la foto en vez de competir con ella, y dejar que cambiara
  // solo cada ocho segundos mientras alguien mira un hoyo era un parpadeo
  // detrás de lo que estaba viendo.
  const capa = (url, visible) =>
    url ? (
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-[1100ms] ease-rodada"
        style={{
          backgroundImage: `url(${url})`,
          opacity: visible ? 1 : 0,
          // En modo hero las fotos van nítidas: son la atracción, no el
          // telón. En las demás paradas el desenfoque sigue porque el texto
          // manda y la foto acompaña.
          ...(hero
            ? { transform: 'scale(1.02)' }
            : {
                filter: 'blur(6px) saturate(0.95)',
                transform: 'scale(1.05)',
              }),
        }}
      />
    ) : null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-sombra">
      {fija ? capa(fija, true) : (
        <>
          {capa(capas.debajo, !encimaVisible.current)}
          {capa(capas.encima, encimaVisible.current)}
        </>
      )}

      {/* Lo que hace legible el texto de encima.
          En modo hero: solo un velo oscuro parejo, sin el degradado pesado
          de arriba y abajo. La foto se ve más, el título se lee de sobra
          porque es grande y con sombra. En las demás paradas: cortina +
          degradado como siempre. */}
      {hero ? (
        <div className="absolute inset-0 bg-sombra/[0.48]" />
      ) : (
        <>
          <div className="absolute inset-0 bg-sombra/[0.42]" />
          <div className="absolute inset-0 bg-gradient-to-b from-sombra/70 via-sombra/15 to-sombra/75" />
        </>
      )}
    </div>
  );
}
