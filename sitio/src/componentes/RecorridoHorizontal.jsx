/**
 * El mapa del campo, estilo circuito.
 *
 * Nada de terreno verde ni texturas: solo el esqueleto del recorrido, como un
 * plano de metro. Los dieciocho hoyos son nodos (círculo + número) unidos por
 * una línea redondeada que sigue el orden de juego, con la casa club al pie.
 * El fondo es transparente: el circuito flota sobre la foto del hoyo.
 *
 * El hoyo activo se enciende en verde; los demás van en crema. Todos son
 * tocables, y además se puede saltar de hoyo con las flechas que pone El Campo
 * a los costados.
 *
 * Orientación:
 *   - 'auto' (por defecto): decide según el contenedor (ancho → horizontal).
 *   - 'horizontal' / 'vertical': se fuerza. El Campo lo pide 'horizontal'.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { CASA_CLUB, HOYOS, VISTA } from '../datos/campo';
import { useIdioma } from '../datos/idioma';

// Centro del viewBox original: alrededor de él gira el circuito al ponerse
// horizontal.
const CX = VISTA.x + VISTA.ancho / 2;
const CY = VISTA.y + VISTA.alto / 2;

const VB_VERTICAL = `${VISTA.x} ${VISTA.y} ${VISTA.ancho} ${VISTA.alto}`;
const VB_HORIZONTAL = '-66 556 1396 424';

/** Catmull-Rom → Bézier: la línea suave que une los hoyos en orden. */
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

export default function RecorridoHorizontal({
  hoyoActivo,
  onElegirHoyo,
  orientacion = 'auto',
}) {
  const { t } = useIdioma();
  const contenedor = useRef(null);
  const [autoApaisado, setAutoApaisado] = useState(false);
  const [enfocado, setEnfocado] = useState(null);

  const d = useMemo(() => rutaEntreHoyos(HOYOS), []);

  const apaisado =
    orientacion === 'horizontal' ? true : orientacion === 'vertical' ? false : autoApaisado;

  useEffect(() => {
    if (orientacion !== 'auto') return undefined;
    const el = contenedor.current;
    if (!el) return undefined;
    const obs = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setAutoApaisado(width > height * 1.5);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [orientacion]);

  const viewBox = apaisado ? VB_HORIZONTAL : VB_VERTICAL;
  const giro = apaisado ? `rotate(-90, ${CX}, ${CY})` : undefined;

  return (
    <div ref={contenedor} className="h-full w-full">
      <svg
        viewBox={viewBox}
        className="h-full w-full overflow-visible"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t('mapa.alt')}
      >
        <defs>
          {/* Sombra suave para que el circuito se lea sobre cualquier foto. */}
          <filter id="sombraCircuito" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="3" floodColor="#06140F" floodOpacity="0.6" />
          </filter>
          <filter id="brilloHoyo" x="-160%" y="-160%" width="420%" height="420%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        <g transform={giro} filter="url(#sombraCircuito)">
          {/* La línea del recorrido: trazo grueso y redondeado, tipo circuito.
              Un velo oscuro debajo le da contraste; la línea crema va encima. */}
          <path d={d} fill="none" stroke="#06140F" strokeOpacity="0.4" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
          <path d={d} fill="none" stroke="#E7DEC9" strokeOpacity="0.55" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />

          {/* La casa club, al pie del recorrido. */}
          <g transform={`translate(${CASA_CLUB[0]} ${CASA_CLUB[1]})`}>
            <path d="M-15 8 L0 -9 L15 8 Z" fill="#E7DEC9" />
            <rect x="-11" y="7" width="22" height="15" fill="#E7DEC9" />
          </g>

          {/* Los 18 hoyos: cada uno un nodo tocable. */}
          {HOYOS.map((h_) => {
            const activo = h_.n === hoyoActivo;
            // Con el mapa girado, los números quedan de lado: se contrarrotan.
            const contraGiro = apaisado ? `rotate(90, ${h_.x}, ${h_.y + 7})` : undefined;
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
                {/* Blanco de toque generoso. */}
                <circle cx={h_.x} cy={h_.y} r="34" fill="transparent" />

                {activo && (
                  <circle cx={h_.x} cy={h_.y} r="22" fill="#DCE86B" opacity="0.5" filter="url(#brilloHoyo)" />
                )}
                {enfocado === h_.n && (
                  <circle cx={h_.x} cy={h_.y} r="30" fill="none" stroke="#DCE86B" strokeWidth="3" strokeOpacity="0.9" />
                )}

                <circle
                  cx={h_.x}
                  cy={h_.y}
                  r={activo ? 23 : 16}
                  fill={activo ? '#DCE86B' : '#0A2A21'}
                  fillOpacity={activo ? 1 : 0.85}
                  stroke={activo ? '#DCE86B' : '#E7DEC9'}
                  strokeOpacity={activo ? 1 : 0.7}
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
                  fontWeight="700"
                  fill={activo ? '#0A2A21' : '#E7DEC9'}
                  fillOpacity={activo ? 1 : 0.85}
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
