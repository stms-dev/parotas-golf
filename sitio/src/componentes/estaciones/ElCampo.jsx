/**
 * El campo: la foto del hoyo que se está mirando.
 *
 * Antes aquí vivía la tarjeta de hoyos —dos hileras de dieciocho botones con
 * su par—, y era información que nadie venía a buscar: quien entra al sitio
 * del club quiere ver cómo se ve el campo, no calcular su vuelta. La tarjeta
 * se fue.
 *
 * Lo que queda es el campo mirándose a sí mismo: a la izquierda el trazo con
 * los dieciocho hoyos, a la derecha la foto del que esté señalado. Se toca un
 * hoyo en el mapa y la foto cambia; la bola viaja hasta allá. Es la misma
 * mecánica de todo el sitio —recorrer en vez de deslizar— pero aquí con lo
 * único que de verdad vende un campo de golf, que son sus fotos.
 *
 * La foto no va cortada a cuchillo: las orillas se desvanecen hacia el fondo.
 * Un rectángulo con filo encima de un fondo difuminado se ve pegado; así
 * parece que la imagen sale del fondo en vez de estar puesta sobre él.
 */
import { useEffect, useState } from 'react';

import { HOYOS, fotoDelHoyo } from '../../datos/campo';

/** El desvanecido de las cuatro orillas, como una sola máscara.
 *
 * Los dos degradados —uno horizontal y otro vertical— se cruzan, y cada uno
 * lleva varias paradas en vez de dos. Esa es toda la gracia: un degradado de
 * transparente a opaco en línea recta deja una banda que el ojo encuentra, y
 * entonces se sigue viendo dónde termina el rectángulo. Con las paradas
 * repartidas en curva —despacio al principio, de golpe en medio, despacio al
 * final— no hay ningún punto donde el cambio se note, y la foto se disuelve
 * de verdad en lugar de apagarse.
 *
 * Corto y suave: se come menos de un décimo de la foto por lado. Probé con un
 * quinto y el remedio fue peor —la imagen se deshacía y los cielos claros se
 * derramaban—. Lo que quita el filo no es la distancia, es la curva.
 */
function orilla(eje, largo) {
  // Una curva suave repartida en seis paradas. En el centro no hay nada: la
  // foto queda intacta de `largo` a `100 - largo`.
  const curva = [
    [0, 0],
    [0.18, 0.03],
    [0.38, 0.14],
    [0.58, 0.38],
    [0.78, 0.7],
    [1, 1],
  ];
  const paradas = [
    ...curva.map(([d, o]) => `rgba(0,0,0,${o}) ${(d * largo).toFixed(2)}%`),
    ...curva
      .slice()
      .reverse()
      .map(([d, o]) => `rgba(0,0,0,${o}) ${(100 - d * largo).toFixed(2)}%`),
  ];
  return `linear-gradient(${eje}, ${paradas.join(', ')})`;
}

const BORDES = [orilla('to right', 9), orilla('to bottom', 8)].join(', ');

export default function ElCampo({ hoyoActivo, onElegirHoyo }) {
  const hoyo = HOYOS.find((h) => h.n === hoyoActivo) || HOYOS[0];
  const foto = fotoDelHoyo(hoyo.n);

  // La foto nueva aparece cuando ya está descargada, no antes: si no, se ve
  // el hueco y luego el golpe de la imagen entrando.
  const [puesta, setPuesta] = useState(foto);
  const [lista, setLista] = useState(false);

  useEffect(() => {
    let vigente = true;
    setLista(false);
    const img = new Image();
    img.src = foto;
    const mostrar = () => {
      if (!vigente) return;
      setPuesta(foto);
      setLista(true);
    };
    if (img.complete) mostrar();
    else {
      img.onload = mostrar;
      img.onerror = mostrar;
    }
    return () => {
      vigente = false;
    };
  }, [foto]);

  const anterior = HOYOS[(hoyo.n - 2 + 18) % 18].n;
  const siguiente = HOYOS[hoyo.n % 18].n;

  return (
    <div className="flex h-full min-h-0 flex-col [justify-content:safe_center] py-2">
      {/* Sin título: el mapa de al lado ya trae ese número encendido, y
          repetirlo le robaba aire a la foto. Del encabezado solo sobrevive el
          par, que es el dato que no está en ninguna otra parte. */}
      <p className="shrink-0 text-right font-texto text-cifra uppercase tracking-wider text-arena/75">
        Par {hoyo.par} · {hoyo.n <= 9 ? 'la ida' : 'la vuelta'}
      </p>

      {/* --------------------------------------------------------- la foto */}
      <figure className="relative mt-2 w-full shrink-0">
        <div
          className="aspect-[3/2] max-h-[62svh] w-full bg-cover bg-center transition-opacity duration-700"
          style={{
            backgroundImage: `url(${puesta})`,
            opacity: lista ? 1 : 0.2,
            // Dos degradados que se cruzan y se apagan en curva. Nada
            // encima: la sombra interior que probé la dejaba plana.
            WebkitMaskImage: BORDES,
            maskImage: BORDES,
            WebkitMaskComposite: 'source-in',
            maskComposite: 'intersect',
          }}
          role="img"
          aria-label={`El campo en el hoyo ${hoyo.n}`}
        />
      </figure>

      {/* ------------------------------------------------- de un hoyo a otro */}
      {/* Dos flechas y la cuenta. La regla de dieciocho barras que hubo aquí
          dejaba saltar a cualquier hoyo, pero era un renglón de ruido debajo
          de la foto; para saltar está el mapa, que además dice dónde queda
          cada hoyo en el campo. */}
      <div className="mt-5 flex w-full shrink-0 items-center justify-center gap-7">
        <Flecha hacia="anterior" onIr={() => onElegirHoyo(anterior)} numero={anterior} />
        <span className="font-texto text-[0.95rem] tabular-nums tracking-widest text-arena/80">
          {String(hoyo.n).padStart(2, '0')} / 18
        </span>
        <Flecha hacia="siguiente" onIr={() => onElegirHoyo(siguiente)} numero={siguiente} />
      </div>
    </div>
  );
}

function Flecha({ hacia, onIr, numero }) {
  const atras = hacia === 'anterior';
  return (
    <button
      onClick={onIr}
      aria-label={`Hoyo ${numero}`}
      title={`Hoyo ${numero}`}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-arena/25 font-texto text-arena/90 transition hover:border-hoja hover:text-hoja focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
        <path
          d={atras ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
