/**
 * Código de barras Code 128 (juego B) dibujado en SVG.
 *
 * El lector del mostrador solo entiende códigos de barras lineales, no QR. Code
 * 128 cubre letras, números y guion, que es lo que lleva el folio (CUP-0007), y
 * lo leen todos los lectores comunes. Se dibuja en SVG para que imprima nítido
 * en cualquier tamaño y no dependa de una librería ni de la red.
 */

// Anchos (barra, espacio, barra, espacio, barra, espacio) de los 107 símbolos.
// 0–102 son los caracteres, 103–105 los inicios A/B/C y 106 el final.
const PATRONES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const INICIO_B = 104;
const FINAL = 106;

/** Los módulos (1 = barra, 0 = espacio) de un texto. */
export function modulosCode128(texto) {
  const valores = [INICIO_B];
  for (const ch of String(texto)) {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`Carácter no válido para el código de barras: ${ch}`);
    valores.push(v);
  }
  const suma = valores.reduce((t, v, i) => t + (i === 0 ? v : v * i), 0);
  valores.push(suma % 103, FINAL);

  const bits = [];
  valores.forEach((v) => {
    [...PATRONES[v]].forEach((ancho, i) => {
      for (let n = 0; n < Number(ancho); n += 1) bits.push(i % 2 === 0 ? 1 : 0);
    });
  });
  return bits;
}

/**
 * <CodigoBarras valor="CUP-0007" /> — con zona en blanco a los lados (la
 * necesita el lector) y el texto debajo.
 */
export default function CodigoBarras({ valor, alto = 70, modulo = 2, texto = true, className = '' }) {
  let bits;
  try {
    bits = modulosCode128(valor);
  } catch {
    return null;
  }
  const margen = 10; // módulos de zona en blanco, a cada lado
  const ancho = (bits.length + margen * 2) * modulo;
  const barras = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === 1) {
      let j = i;
      while (j < bits.length && bits[j] === 1) j += 1;
      barras.push(<rect key={i} x={(i + margen) * modulo} y={0} width={(j - i) * modulo} height={alto} />);
      i = j;
    } else {
      i += 1;
    }
  }
  const total = alto + (texto ? 22 : 0);
  return (
    <svg
      viewBox={`0 0 ${ancho} ${total}`}
      className={className}
      role="img"
      aria-label={`Código de barras ${valor}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={ancho} height={total} fill="#fff" />
      <g fill="#000">{barras}</g>
      {texto && (
        <text x={ancho / 2} y={alto + 17} textAnchor="middle" fontFamily="monospace" fontSize="16" fill="#000">
          {valor}
        </text>
      )}
    </svg>
  );
}
