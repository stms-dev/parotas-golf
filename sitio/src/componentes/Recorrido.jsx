/**
 * El campo, dibujado de su propia lámina.
 *
 * Esto ya no es un trazo inventado para que se vea bonito: la silueta, los
 * cuerpos de agua y los dieciocho hoyos están donde están en la foto aérea del
 * club. Es un campo largo y angosto —sube por un cañón hasta la laguna del 4 y
 * baja abriéndose en dos dedos al sur—, y el dibujo respeta esa forma aunque
 * sea incómoda de acomodar en una pantalla ancha. Estirarlo para llenar el
 * hueco sería dibujar otro campo.
 *
 * La bola recorre los hoyos en el orden en que se juegan. Esa línea no es
 * adorno: es el orden de la vuelta, y se ve de un vistazo que la ida sube y la
 * vuelta baja.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { AGUA, CASA_CLUB, HOYOS, SILUETA, VISTA } from '../datos/campo';
import { useIdioma } from '../datos/idioma';

/** Una curva suave que pasa por todos los hoyos, en orden de juego. */
function rutaEntreHoyos(hoyos) {
  if (hoyos.length < 2) return '';
  const p = hoyos.map((h) => [h.x, h.y]);
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const anterior = p[i - 1] || p[i];
    const actual = p[i];
    const siguiente = p[i + 1];
    const posterior = p[i + 2] || siguiente;
    // Catmull-Rom convertido a Bézier: pasa exactamente por cada hoyo en vez
    // de quedarse cerca, que es lo que haría una curva cuadrática suelta.
    //
    // El divisor es la tensión. Con 6 —el valor de libro— la curva se pasa de
    // vuelta en los giros cerrados del sur y la línea se salía del terreno,
    // que en un mapa de un campo de golf es decir una mentira. Con 11 se
    // ciñe: sigue siendo curva, pero por dentro.
    const T = 11;
    const c1 = [actual[0] + (siguiente[0] - anterior[0]) / T, actual[1] + (siguiente[1] - anterior[1]) / T];
    const c2 = [siguiente[0] - (posterior[0] - actual[0]) / T, siguiente[1] - (posterior[1] - actual[1]) / T];
    d += `C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${siguiente[0]} ${siguiente[1]}`;
  }
  return d;
}

const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export default function Recorrido({ hoyoActivo, hoyoEstaciones = [], onElegirHoyo }) {
  const { t } = useIdioma();
  const ruta = useRef(null);
  const [enfocado, setEnfocado] = useState(null);
  const [bola, setBola] = useState(() => {
    const h = HOYOS.find((x) => x.n === hoyoActivo) || HOYOS[0];
    return { x: h.x, y: h.y };
  });

  const d = useMemo(() => rutaEntreHoyos(HOYOS), []);

  // La bola viaja por la ruta hasta el hoyo elegido, en vez de aparecer allá.
  // El viaje es el punto: enseña que los hoyos son una secuencia.
  useEffect(() => {
    const camino = ruta.current;
    const destino = HOYOS.find((h) => h.n === hoyoActivo);
    if (!camino || !destino) return undefined;

    const largo = camino.getTotalLength();
    // ¿A qué altura del camino cae este hoyo? Se busca por aproximación,
    // porque el SVG no sabe decir "dónde está este punto de la curva".
    let mejor = 0;
    let menor = Infinity;
    for (let i = 0; i <= 600; i++) {
      const l = (largo * i) / 600;
      const p = camino.getPointAtLength(l);
      const dist = (p.x - destino.x) ** 2 + (p.y - destino.y) ** 2;
      if (dist < menor) {
        menor = dist;
        mejor = l;
      }
    }

    const quieto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (quieto) {
      setBola({ x: destino.x, y: destino.y });
      return undefined;
    }

    // De dónde sale: del punto del camino más cercano a donde está ahora.
    let desde = 0;
    let cerca = Infinity;
    for (let i = 0; i <= 600; i++) {
      const l = (largo * i) / 600;
      const p = camino.getPointAtLength(l);
      const dist = (p.x - bola.x) ** 2 + (p.y - bola.y) ** 2;
      if (dist < cerca) {
        cerca = dist;
        desde = l;
      }
    }

    let vivo = true;
    const arranque = performance.now();
    const duracion = 700 + Math.min(Math.abs(mejor - desde) / largo, 1) * 700;

    function paso(ahora) {
      if (!vivo) return;
      const t = Math.min((ahora - arranque) / duracion, 1);
      const p = camino.getPointAtLength(desde + (mejor - desde) * suave(t));
      setBola({ x: p.x, y: p.y });
      if (t < 1) requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
    return () => {
      vivo = false;
    };
    // `bola` a propósito fuera: solo se relanza cuando cambia el hoyo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoyoActivo, d]);

  return (
    <svg
      viewBox={`${VISTA.x} ${VISTA.y} ${VISTA.ancho} ${VISTA.alto}`}
      className="h-full w-full"
      role="img"
      aria-label={t('mapa.alt')}
    >
      <defs>
        <radialGradient id="luzDelCampo" cx="50%" cy="38%" r="72%">
          <stop offset="0%" stopColor="#2F6B4F" />
          <stop offset="100%" stopColor="#17402F" />
        </radialGradient>
        <filter id="orillaSuave" x="-12%" y="-6%" width="124%" height="112%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="brilloBola" x="-260%" y="-260%" width="620%" height="620%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* El terreno. Primero una copia desenfocada por debajo: le quita el
          filo de recorte y lo asienta sobre el fondo en vez de pegarlo. */}
      <path d={SILUETA} fill="#14362A" opacity="0.75" filter="url(#orillaSuave)" />
      <path d={SILUETA} fill="url(#luzDelCampo)" />

      {AGUA.map((d_, i) => (
        <path key={i} d={d_} fill="#2E6E79" opacity="0.92" />
      ))}

      {/* La vuelta completa, del 1 al 18, como un rastro de puntos.
          Probé la cinta ancha de calles y pesaba demasiado: se comía el
          terreno y los hoyos quedaban nadando encima. El punteado fino dice
          lo mismo —este es el orden de la vuelta— y deja que el protagonista
          siga siendo la forma del campo. */}
      <path
        ref={ruta}
        d={d}
        fill="none"
        stroke="#DCE86B"
        strokeOpacity="0.3"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="1 14"
      />

      {/* La casa club. */}
      <g transform={`translate(${CASA_CLUB[0]} ${CASA_CLUB[1]})`} opacity="0.85">
        <path d="M-13 7 L0 -7 L13 7 Z" fill="#F2EBDC" />
        <rect x="-10" y="6" width="20" height="13" fill="#F2EBDC" />
      </g>

      {/* La bola, por debajo de los hoyos: puesta encima tapaba justo el
          número del hoyo al que acababa de llegar. */}
      <circle cx={bola.x} cy={bola.y} r="20" fill="#DCE86B" opacity="0.55" filter="url(#brilloBola)" />
      <circle cx={bola.x} cy={bola.y} r="8" fill="#FFFFFF" />

      {/* Los hoyos. El activo y los de parada se ven; los demás se insinúan,
          para que el mapa no sea una constelación de puntos iguales. */}
      {HOYOS.map((h) => {
        const activo = h.n === hoyoActivo;
        const parada = hoyoEstaciones.includes(h.n);
        return (
          <g
            key={h.n}
            onClick={() => onElegirHoyo?.(h.n)}
            onFocus={() => setEnfocado(h.n)}
            onBlur={() => setEnfocado(null)}
            className="cursor-pointer outline-none"
            role="button"
            tabIndex={0}
            aria-label={t('mapa.unHoyo', { n: h.n, par: h.par })}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onElegirHoyo?.(h.n))}
          >
            {/* Blanco de toque generoso: en un celular el dedo no acierta a
                un punto de siete pixeles. */}
            <circle cx={h.x} cy={h.y} r="34" fill="transparent" />
            {enfocado === h.n && (
              <circle
                cx={h.x}
                cy={h.y}
                r="30"
                fill="none"
                stroke="#DCE86B"
                strokeWidth="3"
                strokeOpacity="0.9"
              />
            )}
            <circle
              cx={h.x}
              cy={h.y}
              r={activo ? 23 : 17}
              fill={activo ? '#DCE86B' : '#0A2A21'}
              fillOpacity={activo ? 1 : 0.5}
              stroke={activo ? '#DCE86B' : '#F2EBDC'}
              strokeOpacity={activo ? 1 : parada ? 0.75 : 0.4}
              strokeWidth="3"
              className="transition-all duration-300"
            />
            <text
              x={h.x}
              y={h.y + 7}
              textAnchor="middle"
              className="pointer-events-none select-none font-texto"
              fontSize="20"
              fontWeight="600"
              fill={activo ? '#0A2A21' : '#F2EBDC'}
              fillOpacity={activo ? 1 : parada ? 0.95 : 0.7}
            >
              {h.n}
            </text>
          </g>
        );
      })}

    </svg>
  );
}
