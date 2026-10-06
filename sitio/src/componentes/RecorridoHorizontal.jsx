/**
 * El mapa del campo para la galería de hoyos.
 *
 * Es el mismo dibujo de Recorrido.jsx — el trazado del campo real — pero
 * vestido como un plano de arquitecto de golf: curvas de nivel, franjas de
 * corte en el fairway, un grano de papel, el borde de arbolado punteado y los
 * adornos de plano (brújula, barra de escala y marcas de esquina). Todo eso es
 * decoración; no cambia los datos del campo.
 *
 * Orientación:
 *   - 'auto' (por defecto): decide según el contenedor. Si es más ancho que
 *     alto se pone horizontal (gira 90°); si no, vertical.
 *   - 'horizontal' / 'vertical': se fuerza, sin importar el contenedor. El
 *     Campo lo monta en 'horizontal' porque lo quiere apaisado y al centro.
 *
 * Todos los hoyos son igual de tocables: aquí el visitante va hoyo por hoyo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { AGUA, CASA_CLUB, HOYOS, SILUETA, VISTA } from '../datos/campo';
import { useIdioma } from '../datos/idioma';

// --------------------------------------------------------- geometría del giro
// Centro del viewBox original. Alrededor de este punto giran las coordenadas
// cuando el mapa se pone horizontal, y también se escalan las curvas de nivel.
const CX = VISTA.x + VISTA.ancho / 2; // 632
const CY = VISTA.y + VISTA.alto / 2; // 768

// El viewBox normal y el girado -90°. El girado se calculó rotando las cuatro
// esquinas del original alrededor de (CX, CY) y enmarcando el resultado.
const VB_VERTICAL = `${VISTA.x} ${VISTA.y} ${VISTA.ancho} ${VISTA.alto}`;
const VB_HORIZONTAL = '-66 556 1396 424';

// Extensión de cada viewBox, para colgar los adornos de plano (brújula,
// escala, esquinas) en el marco sin que el giro los tuerza.
const MARCO_VERTICAL = { x0: VISTA.x, y0: VISTA.y, x1: VISTA.x + VISTA.ancho, y1: VISTA.y + VISTA.alto };
const MARCO_HORIZONTAL = { x0: -66, y0: 556, x1: 1330, y1: 980 };

// Escalas de las curvas de nivel. <1 van por dentro de la silueta (recortadas);
// >1 asoman por las orillas como cotas de elevación.
const CURVAS_DENTRO = [0.9, 0.78, 0.66, 0.54, 0.42];
const CURVAS_FUERA = [1.05, 1.11, 1.18];
const escalaDesdeCentro = (s) => `translate(${CX} ${CY}) scale(${s}) translate(${-CX} ${-CY})`;

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
export default function RecorridoHorizontal({
  hoyoActivo,
  onElegirHoyo,
  orientacion = 'auto',
}) {
  const { t } = useIdioma();
  const contenedor = useRef(null);
  const ruta = useRef(null);
  const [autoApaisado, setAutoApaisado] = useState(false);
  const [enfocado, setEnfocado] = useState(null);
  const [bola, setBola] = useState(() => {
    const h_ = HOYOS.find((x) => x.n === hoyoActivo) || HOYOS[0];
    return { x: h_.x, y: h_.y };
  });

  const d = useMemo(() => rutaEntreHoyos(HOYOS), []);

  // La orientación forzada manda; si es 'auto', decide el contenedor —así
  // funciona igual en cualquier sitio donde se monte.
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
  const marco = apaisado ? MARCO_HORIZONTAL : MARCO_VERTICAL;

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

          {/* Recorte con la forma del campo: toda la textura interior
              (franjas, curvas, grano) vive dentro de esta silueta. */}
          <clipPath id="clipSiluetaRecH">
            <path d={SILUETA} />
          </clipPath>

          {/* Franjas de corte del fairway, como las que deja la podadora. */}
          <pattern
            id="rayasRecH"
            width="54"
            height="54"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(9)"
          >
            <rect width="54" height="54" fill="transparent" />
            <rect width="27" height="54" fill="#3C825F" opacity="0.16" />
          </pattern>

          {/* Grano de papel, para que no se vea plano. */}
          <filter id="granoRecH">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>

        <g transform={giro}>
          {/* Curvas de nivel que asoman por las orillas, como cotas. */}
          {CURVAS_FUERA.map((s) => (
            <path
              key={`cf-${s}`}
              d={SILUETA}
              transform={escalaDesdeCentro(s)}
              fill="none"
              stroke="#C9BFA3"
              strokeOpacity="0.10"
              strokeWidth="1.6"
            />
          ))}

          {/* Terreno */}
          <path d={SILUETA} fill="#14362A" opacity="0.75" filter="url(#orillaRecH)" />
          <path d={SILUETA} fill="url(#luzRecH)" />

          {/* Texturas dentro del campo: franjas de corte, curvas de nivel y
              grano, todo recortado a la silueta. */}
          <g clipPath="url(#clipSiluetaRecH)">
            <rect x={VISTA.x - 200} y={VISTA.y - 200} width={VISTA.ancho + 400} height={VISTA.alto + 400} fill="url(#rayasRecH)" />
            {CURVAS_DENTRO.map((s) => (
              <path
                key={`cd-${s}`}
                d={SILUETA}
                transform={escalaDesdeCentro(s)}
                fill="none"
                stroke="#E7DEC9"
                strokeOpacity="0.09"
                strokeWidth="1.6"
              />
            ))}
            <rect
              x={VISTA.x - 200}
              y={VISTA.y - 200}
              width={VISTA.ancho + 400}
              height={VISTA.alto + 400}
              filter="url(#granoRecH)"
              opacity="0.06"
              style={{ mixBlendMode: 'overlay' }}
            />
          </g>

          {/* Borde de arbolado: una línea gruesa oscura difuminada por fuera y
              un punteado encima, para que la orilla se lea como copa de árbol. */}
          <path d={SILUETA} fill="none" stroke="#0E2C20" strokeOpacity="0.55" strokeWidth="13" filter="url(#orillaRecH)" />
          <path d={SILUETA} fill="none" stroke="#17382A" strokeOpacity="0.7" strokeWidth="3.5" strokeDasharray="2 8" strokeLinecap="round" />

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

        {/* --------------------------------------------- adornos de plano
            Van fuera del giro para quedar siempre derechos, colgados del
            marco del viewBox vigente. Son decoración: brújula, escala y
            marcas de esquina. */}
        <AdornosPlano marco={marco} />
      </svg>
    </div>
  );
}

/** Brújula, barra de escala y marcas de esquina — el vestido de plano. */
function AdornosPlano({ marco }) {
  const { x0, y0, x1, y1 } = marco;
  const m = 22; // margen desde la orilla
  const tick = 26; // largo de las marcas de esquina

  const esquinas = [
    { x: x0 + m, y: y0 + m, sx: 1, sy: 1 },
    { x: x1 - m, y: y0 + m, sx: -1, sy: 1 },
    { x: x0 + m, y: y1 - m, sx: 1, sy: -1 },
    { x: x1 - m, y: y1 - m, sx: -1, sy: -1 },
  ];

  return (
    <g stroke="#E7DEC9" strokeOpacity="0.45" fill="none" strokeWidth="1.6">
      {/* Marcas de esquina, tipo plano técnico. */}
      {esquinas.map((e, i) => (
        <path
          key={i}
          d={`M${e.x} ${e.y + e.sy * tick} L${e.x} ${e.y} L${e.x + e.sx * tick} ${e.y}`}
          strokeLinecap="round"
        />
      ))}

      {/* Brújula arriba a la derecha. */}
      <g transform={`translate(${x1 - 58} ${y0 + 58})`}>
        <circle r="20" strokeOpacity="0.4" />
        <path d="M0 -14 L6 7 L0 2 L-6 7 Z" fill="#E7DEC9" fillOpacity="0.6" stroke="none" />
        <text
          x="0"
          y="-24"
          textAnchor="middle"
          className="font-texto"
          fontSize="13"
          fill="#E7DEC9"
          fillOpacity="0.65"
          stroke="none"
        >
          N
        </text>
      </g>

      {/* Barra de escala abajo a la izquierda. */}
      <g transform={`translate(${x0 + 40} ${y1 - 40})`}>
        <line x1="0" y1="0" x2="160" y2="0" strokeOpacity="0.5" />
        <line x1="0" y1="-6" x2="0" y2="6" strokeOpacity="0.5" />
        <line x1="80" y1="-4" x2="80" y2="4" strokeOpacity="0.5" />
        <line x1="160" y1="-6" x2="160" y2="6" strokeOpacity="0.5" />
        <text x="0" y="-11" className="font-texto" fontSize="12" fill="#E7DEC9" fillOpacity="0.6" stroke="none">
          0
        </text>
        <text
          x="160"
          y="-11"
          textAnchor="end"
          className="font-texto"
          fontSize="12"
          fill="#E7DEC9"
          fillOpacity="0.6"
          stroke="none"
        >
          200 m
        </text>
      </g>
    </g>
  );
}
