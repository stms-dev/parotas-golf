/**
 * El recorrido: el mapa del campo, que aquí hace de navegación.
 *
 * La idea es que la página no se recorra con la rueda del ratón sino jugando:
 * se elige una estación y la bola viaja por el trazo hasta ese hoyo, igual que
 * una vuelta de verdad. Por eso el trazo no es un adorno de fondo — es la
 * interfaz, y de paso explica el campo mejor que una galería.
 *
 * El viaje se calcula sobre el propio `<path>` con getPointAtLength, así que
 * si se cambian las coordenadas de los hoyos la bola sigue el trazo nuevo sin
 * tocar nada de este archivo.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { CASA_CLUB, HOYOS } from '../datos/campo';

/** Un hoyo: de la salida al green, con una curva suave en medio. */
function trazoDeHoyo(hoyo) {
  const [sx, sy] = hoyo.salida;
  const [gx, gy] = hoyo.green;
  const [cx, cy] = hoyo.curva;
  return `M ${sx} ${sy} Q ${cx} ${cy} ${gx} ${gy}`;
}

/** El trazo completo, incluidas las caminatas entre un green y la salida que sigue. */
function trazoCompleto() {
  let d = '';
  HOYOS.forEach((hoyo, i) => {
    const [sx, sy] = hoyo.salida;
    const [gx, gy] = hoyo.green;
    const [cx, cy] = hoyo.curva;
    d += i === 0 ? `M ${sx} ${sy} ` : `L ${sx} ${sy} `;
    d += `Q ${cx} ${cy} ${gx} ${gy} `;
  });
  return d.trim();
}

const prefiereQuieto = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Recorrido({ hoyoActivo, hoyoEstaciones, onElegirHoyo }) {
  const rutaRef = useRef(null);
  const animRef = useRef(null);
  const [bola, setBola] = useState(HOYOS[0].green);
  // Dónde cae cada green a lo largo del trazo, en unidades de longitud. Se
  // mide una sola vez, cuando el SVG ya existe en el documento.
  const [marcas, setMarcas] = useState(null);
  const [asomado, setAsomado] = useState(null);

  const d = useMemo(() => trazoCompleto(), []);
  const hoyo = HOYOS.find((h) => h.n === hoyoActivo) || HOYOS[0];

  useLayoutEffect(() => {
    const ruta = rutaRef.current;
    if (!ruta) return;
    const total = ruta.getTotalLength();
    // Se recorre el trazo buscando el punto más cercano al green de cada hoyo.
    // Es aproximado a propósito: basta para que la bola pare donde debe, y
    // evita tener que medir cada segmento por separado.
    const puntos = [];
    const paso = total / 900;
    for (let l = 0; l <= total; l += paso) {
      const p = ruta.getPointAtLength(l);
      puntos.push({ l, x: p.x, y: p.y });
    }
    setMarcas(
      HOYOS.map((h) => {
        const [gx, gy] = h.green;
        let mejor = puntos[0];
        let dist = Infinity;
        for (const p of puntos) {
          const dd = (p.x - gx) ** 2 + (p.y - gy) ** 2;
          if (dd < dist) {
            dist = dd;
            mejor = p;
          }
        }
        return { n: h.n, l: mejor.l };
      }),
    );
  }, [d]);

  // El viaje. Se anima la posición a lo largo del trazo, no en línea recta:
  // la bola pasa por los hoyos de en medio, que es lo que lo hace legible.
  useEffect(() => {
    const ruta = rutaRef.current;
    if (!ruta || !marcas) return;

    const destino = marcas.find((m) => m.n === hoyoActivo);
    if (!destino) return;

    const ponerEn = (l) => {
      const p = ruta.getPointAtLength(l);
      setBola([p.x, p.y]);
    };

    if (prefiereQuieto()) {
      ponerEn(destino.l);
      animRef.current = { l: destino.l };
      return;
    }

    const desde = animRef.current?.l ?? destino.l;
    const hasta = destino.l;
    if (Math.abs(hasta - desde) < 0.5) {
      ponerEn(hasta);
      animRef.current = { l: hasta };
      return;
    }

    // Más largo el viaje, más tarda, pero no proporcional: ir del 1 al 18 no
    // puede sentirse eterno.
    const duracion = Math.min(1500, 420 + Math.abs(hasta - desde) * 0.32);
    const arranque = performance.now();
    let vivo = true;

    const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

    const cuadro = (ahora) => {
      if (!vivo) return;
      const t = Math.min((ahora - arranque) / duracion, 1);
      const l = desde + (hasta - desde) * suave(t);
      ponerEn(l);
      animRef.current = { l };
      if (t < 1) requestAnimationFrame(cuadro);
    };
    requestAnimationFrame(cuadro);
    return () => {
      vivo = false;
    };
  }, [hoyoActivo, marcas]);

  // La cámara se acerca al hoyo activo, pero deja ver el resto del campo: si
  // se encuadrara solo el hoyo, se perdería la noción de dónde se está.
  const escala = 1.1;
  const [cx, cy] = hoyo.green;
  const tx = (497 - cx) * (escala - 1) * 0.78;
  const ty = (368 - cy) * (escala - 1) * 0.78;

  return (
    // El encuadre se ajusta al trazo, no al revés: así el campo llena su
    // columna en lugar de quedar chiquito en medio de un lienzo vacío.
    <svg
      viewBox="30 -20 940 800"
      className="h-full w-full"
      role="img"
      aria-label="Trazo de los 18 hoyos del campo"
    >
      <defs>
        <radialGradient id="luz" cx="50%" cy="42%" r="66%">
          <stop offset="0%" stopColor="#1C5342" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#0F3528" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#0A2A21" stopOpacity="0" />
        </radialGradient>
        <filter id="brillo" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* La luz que se cuela por la copa, sobre el centro del campo. */}
      <ellipse cx="497" cy="368" rx="420" ry="330" fill="url(#luz)" />

      <g
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${escala})`,
          transformOrigin: '497px 368px',
          transition: 'transform 1.1s cubic-bezier(0.33, 0.02, 0.18, 1)',
        }}
      >
        {/* Las caminatas del green de un hoyo a la salida del siguiente. Van
            como segmentos sueltos y no como un trazo continuo: dibujadas de
            corrido, el campo se leía como un lazo cerrado y no como 18 hoyos. */}
        {HOYOS.slice(0, -1).map((h, i) => (
          <line
            key={`paso-${h.n}`}
            x1={h.green[0]}
            y1={h.green[1]}
            x2={HOYOS[i + 1].salida[0]}
            y2={HOYOS[i + 1].salida[1]}
            stroke="#2A6A54"
            strokeWidth="1.2"
            strokeDasharray="2 6"
            opacity="0.42"
          />
        ))}

        {/* Cada calle, con su ancho. Es lo que hace que se lea como campo y no
            como un diagrama de flujo. */}
        {HOYOS.map((h) => {
          const activo = h.n === hoyoActivo;
          const señalado = h.n === asomado;
          const esEstacion = hoyoEstaciones.includes(h.n);
          return (
            <g key={h.n}>
              <path
                d={trazoDeHoyo(h)}
                fill="none"
                stroke={activo ? '#3E9A74' : '#1C5844'}
                strokeWidth={activo ? 17 : 13}
                strokeLinecap="round"
                opacity={activo ? 1 : señalado ? 0.9 : 0.68}
                style={{ transition: 'stroke 500ms ease, stroke-width 500ms ease, opacity 500ms ease' }}
              />
              {/* El green, al final de la calle. */}
              <circle
                cx={h.green[0]}
                cy={h.green[1]}
                r={activo ? 11 : 8}
                fill={activo ? '#B7D44A' : '#2E7D5F'}
                opacity={activo ? 1 : 0.9}
                style={{ transition: 'r 500ms ease, fill 500ms ease' }}
              />

              {/* El número del hoyo. Los que son estación se marcan distinto:
                  son los que llevan a algún lado. */}
              {/* En celular el mapa es del tamaño de una tarjeta: dieciocho
                  números ahí no se leen, estorban. Se dejan solo los de las
                  paradas, que son los que llevan a algún lado. */}
              <text
                x={h.salida[0]}
                y={h.salida[1] - 14}
                textAnchor="middle"
                className={`select-none font-texto ${esEstacion ? '' : 'hidden md:block'}`}
                fontSize={esEstacion ? 15 : 12}
                fontWeight={esEstacion ? 700 : 500}
                fill={activo ? '#DCE86B' : esEstacion ? '#8FC9B4' : '#4E8A74'}
                style={{ transition: 'fill 400ms ease' }}
              >
                {h.n}
              </text>

              {/* Área de clic generosa: el trazo de 13px es muy flaco para el dedo. */}
              <path
                d={trazoDeHoyo(h)}
                fill="none"
                stroke="transparent"
                strokeWidth="34"
                strokeLinecap="round"
                className="cursor-pointer"
                onClick={() => onElegirHoyo(h.n)}
                onMouseEnter={() => setAsomado(h.n)}
                onMouseLeave={() => setAsomado(null)}
              />
            </g>
          );
        })}

        {/* La casa club. */}
        <g>
          <rect
            x={CASA_CLUB[0] - 15}
            y={CASA_CLUB[1] - 11}
            width="30"
            height="22"
            rx="3"
            fill="#F2EBDC"
            opacity="0.92"
          />
          <path
            d={`M ${CASA_CLUB[0] - 19} ${CASA_CLUB[1] - 11} L ${CASA_CLUB[0]} ${CASA_CLUB[1] - 23} L ${CASA_CLUB[0] + 19} ${CASA_CLUB[1] - 11} Z`}
            fill="#F2EBDC"
            opacity="0.92"
          />
        </g>

        {/* La bola. */}
        <g style={{ transform: `translate(${bola[0]}px, ${bola[1]}px)` }}>
          <circle r="13" fill="#DCE86B" opacity="0.26" filter="url(#brillo)" />
          <circle r="5.5" fill="#FFFFFF" />
        </g>
      </g>

      {/* El trazo que se mide, fuera de la vista. */}
      <path ref={rutaRef} d={d} fill="none" stroke="none" />

      {/* Par y distancia del hoyo sobre el que se pasa el cursor. */}
      {asomado && (
        <g
          style={{
            transform: `translate(${HOYOS[asomado - 1].green[0] * escala + tx - (escala - 1) * 497}px, ${
              HOYOS[asomado - 1].green[1] * escala + ty - (escala - 1) * 368
            }px)`,
          }}
          className="pointer-events-none"
        >
          <rect x="14" y="-16" width="74" height="26" rx="13" fill="#061913" opacity="0.92" />
          <text
            x="51"
            y="2"
            textAnchor="middle"
            className="font-texto"
            fontSize="13"
            fontWeight="600"
            fill="#DCE86B"
          >
            Hoyo {asomado} · par {HOYOS[asomado - 1].par}
          </text>
        </g>
      )}
    </svg>
  );
}
