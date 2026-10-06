/**
 * El mapa del campo para la galería de hoyos.
 *
 * Es el mismo dibujo de Recorrido.jsx — el trazado del campo real — pero se
 * adapta a su contenedor: cuando el espacio es más ancho que alto (celular,
 * franja arriba) gira 90° para que la vuelta se lea de izquierda a derecha,
 * como una barra de progreso. Cuando es más alto que ancho (desktop, columna
 * a la izquierda) se queda vertical.
 *
 * Todos los hoyos son igual de tocables: no hay "paradas" resaltadas como en
 * Recorrido, porque aquí el visitante va hoyo por hoyo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { AGUA, CASA_CLUB, HOYOS, SILUETA, VISTA } from '../datos/campo';
import { useIdioma } from '../datos/idioma';

// --------------------------------------------------------- geometría del giro
// Centro del viewBox original. Alrededor de este punto giran las coordenadas
// cuando el mapa se pone horizontal.
const CX = VISTA.x + VISTA.ancho / 2; // 632
const CY = VISTA.y + VISTA.alto / 2; // 768

// El viewBox normal y el girado -90°. El girado se calculó rotando las cuatro
// esquinas del original alrededor de (CX, CY) y enmarcando el resultado.
const VB_VERTICAL = `${VISTA.x} ${VISTA.y} ${VISTA.ancho} ${VISTA.alto}`;
const VB_HORIZONTAL = '-66 556 1396 424';

// ------------------------------------------------------------- la ruta suave
/** Catmull-Rom → Bézier, igual que en Recorrido. */
function rutaEntreHoyos(hoyos) {
  if (hoyos.length < 2) return '';
  const p = hoyos.map((h_) => [h_.x, h_.y]);
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const anterior = p[i - 1] || p[i];
    const actual = p[i];
    const siguiente = p[i + 1];
    const posterior = p[i + 2] || siguiente;
    const T = 11;
    const c1 = [
      actual[0] + (siguiente[0] - anterior[0]) / T,
      actual[1] + (siguiente[1] - anterior[1]) / T,
    ];
    const c2 = [
      siguiente[0] - (posterior[0] - actual[0]) / T,
      siguiente[1] - (posterior[1] - actual[1]) / T,
    ];
    d += `C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${siguiente[0]} ${siguiente[1]}`;
  }
  return d;
}

const suave = (t_) => (t_ < 0.5 ? 4 * t_ * t_ * t_ : 1 - (-2 * t_ + 2) ** 3 / 2);

// ----------------------------------------------------------------- componente
export default function RecorridoHorizontal({ hoyoActivo, onElegirHoyo }) {
  const { t } = useIdioma();
  const contenedor = useRef(null);
  const ruta = useRef(null);
  const [apaisado, setApaisado] = useState(false);
  const [enfocado, setEnfocado] = useState(null);
  const [bola, setBola] = useState(() => {
    const h_ = HOYOS.find((x) => x.n === hoyoActivo) || HOYOS[0];
    return { x: h_.x, y: h_.y };
  });

  const d = useMemo(() => rutaEntreHoyos(HOYOS), []);

  // ¿Apaisado o vertical? Lo decide el contenedor, no una media query: así
  // funciona igual en cualquier sitio donde se monte.
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return undefined;
    const obs = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setApaisado(width > height * 1.5);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // La bola viaja por la ruta hasta el hoyo elegido — igual que en Recorrido.
  useEffect(() => {
    const camino = ruta.current;
    const destino = HOYOS.find((h_) => h_.n === hoyoActivo);
    if (!camino || !destino) return undefined;

    const largo = camino.getTotalLength();
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
      const progreso = Math.min((ahora - arranque) / duracion, 1);
      const p = camino.getPointAtLength(desde + (mejor - desde) * suave(progreso));
      setBola({ x: p.x, y: p.y });
      if (progreso < 1) requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoyoActivo, d]);

  const viewBox = apaisado ? VB_HORIZONTAL : VB_VERTICAL;
  const giro = apaisado ? `rotate(-90, ${CX}, ${CY})` : undefined;

  return (
    <div ref={contenedor} className="h-full w-full">
      <svg
        viewBox={viewBox}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t('mapa.alt')}
      >
        <defs>
          <radialGradient id="luzRecH" cx="50%" cy="38%" r="72%">
            <stop offset="0%" stopColor="#2F6B4F" />
            <stop offset="100%" stopColor="#17402F" />
          </radialGradient>
          <filter id="orillaRecH" x="-12%" y="-6%" width="124%" height="112%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id="brilloBolaRecH" x="-260%" y="-260%" width="620%" height="620%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        <g transform={giro}>
          {/* Terreno */}
          <path d={SILUETA} fill="#14362A" opacity="0.75" filter="url(#orillaRecH)" />
          <path d={SILUETA} fill="url(#luzRecH)" />

          {/* Agua */}
          {AGUA.map((d_, i) => (
            <path key={i} d={d_} fill="#2E6E79" opacity="0.92" />
          ))}

          {/* Casa club */}
          <g transform={`translate(${CASA_CLUB[0]} ${CASA_CLUB[1]})`} opacity="0.85">
            <path d="M-13 7 L0 -7 L13 7 Z" fill="#F2EBDC" />
            <rect x="-10" y="6" width="20" height="13" fill="#F2EBDC" />
          </g>

          {/* La bola, debajo de los hoyos. */}
          <circle cx={bola.x} cy={bola.y} r="20" fill="#DCE86B" opacity="0.55" filter="url(#brilloBolaRecH)" />
          <circle cx={bola.x} cy={bola.y} r="8" fill="#FFFFFF" />

          {/* El punteado de la vuelta */}
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

          {/* Los 18 hoyos */}
          {HOYOS.map((h_) => {
            const activo = h_.n === hoyoActivo;
            // Cuando el mapa está girado, los números quedan de lado.
            // Se contrarrota cada etiqueta para que se lean derechos.
            const contraGiro = apaisado
              ? `rotate(90, ${h_.x}, ${h_.y + 7})`
              : undefined;
            return (
              <g
                key={h_.n}
                onClick={() => onElegirHoyo?.(h_.n)}
                onFocus={() => setEnfocado(h_.n)}
                onBlur={() => setEnfocado(null)}
                className="cursor-pointer outline-none"
                role="button"
                tabIndex={0}
                aria-label={t('mapa.unHoyo', { n: h_.n, par: h_.par })}
                onKeyDown={(e) =>
                  (e.key === 'Enter' || e.key === ' ') &&
                  (e.preventDefault(), onElegirHoyo?.(h_.n))
                }
              >
                {/* Blanco de toque generoso */}
                <circle cx={h_.x} cy={h_.y} r="34" fill="transparent" />
                {enfocado === h_.n && (
                  <circle
                    cx={h_.x}
                    cy={h_.y}
                    r="30"
                    fill="none"
                    stroke="#DCE86B"
                    strokeWidth="3"
                    strokeOpacity="0.9"
                  />
                )}
                <circle
                  cx={h_.x}
                  cy={h_.y}
                  r={activo ? 23 : 17}
                  fill={activo ? '#DCE86B' : '#0A2A21'}
                  fillOpacity={activo ? 1 : 0.5}
                  stroke={activo ? '#DCE86B' : '#F2EBDC'}
                  strokeOpacity={activo ? 1 : 0.4}
                  strokeWidth="3"
                  className="transition-all duration-300"
                />
                <text
                  x={h_.x}
                  y={h_.y + 7}
                  textAnchor="middle"
                  transform={contraGiro}
                  className="pointer-events-none select-none font-texto"
                  fontSize="20"
                  fontWeight="600"
                  fill={activo ? '#0A2A21' : '#F2EBDC'}
                  fillOpacity={activo ? 1 : 0.7}
                >
                  {h_.n}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
