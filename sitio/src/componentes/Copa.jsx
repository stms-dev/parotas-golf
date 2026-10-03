/**
 * La copa de la parota: el marco de toda la pantalla.
 *
 * Son las manchas del logotipo, agrandadas hasta volverse el techo de la
 * página. Lo que les da carácter es dónde se enciman —ahí el color se junta y
 * aclara, como el follaje de verdad contra la luz—, así que van con poco
 * desenfoque: difuminadas se volvían una mancha verde sin forma.
 *
 * No se mueven. El presupuesto de movimiento del sitio se gasta entero en la
 * bola, y una copa flotando de fondo solo competiría con ella.
 */
export default function Copa() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <filter id="copa-borde" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>

      <g filter="url(#copa-borde)" style={{ mixBlendMode: 'screen' }}>
        {/* Arriba: las tres manchas del logotipo, encimadas. */}
        <ellipse cx="300" cy="-78" rx="340" ry="196" fill="#2E7D74" opacity="0.6" />
        <ellipse cx="560" cy="-108" rx="300" ry="210" fill="#5A7A2E" opacity="0.5" />
        <ellipse cx="830" cy="-66" rx="330" ry="180" fill="#3D7A52" opacity="0.52" />
        <ellipse cx="1090" cy="-96" rx="260" ry="190" fill="#6A7F2A" opacity="0.38" />
        {/* Dos hojas sueltas, para que la copa no termine en una línea recta. */}
        <ellipse cx="170" cy="96" rx="130" ry="74" fill="#2E7D74" opacity="0.3" transform="rotate(-14 170 96)" />
        <ellipse cx="985" cy="112" rx="150" ry="70" fill="#4C7A3A" opacity="0.26" transform="rotate(11 985 112)" />

        {/* Abajo: el sotobosque, que cierra la pantalla sin robar atención. */}
        <ellipse cx="70" cy="856" rx="330" ry="180" fill="#1C5342" opacity="0.5" />
        <ellipse cx="1150" cy="880" rx="320" ry="186" fill="#1C5342" opacity="0.42" />
      </g>
    </svg>
  );
}
