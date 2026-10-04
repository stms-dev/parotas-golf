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

/** El desvanecido de las cuatro orillas, como una sola máscara. */
const BORDES = [
  'linear-gradient(to right, transparent 0, #000 7%, #000 93%, transparent 100%)',
  'linear-gradient(to bottom, transparent 0, #000 6%, #000 94%, transparent 100%)',
].join(', ');

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        <h2 className="font-titulo text-rotulo-lg text-arena">
          Hoyo {hoyo.n}
        </h2>
        <p className="font-texto text-menudo uppercase tracking-wider text-arena/45">
          Par {hoyo.par} · {hoyo.n <= 9 ? 'la ida' : 'la vuelta'}
        </p>
      </div>

      {/* --------------------------------------------------------- la foto */}
      <figure className="relative mt-4 min-h-[13rem] flex-1">
        <div
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-700"
          style={{
            backgroundImage: `url(${puesta})`,
            opacity: lista ? 1 : 0.25,
            // Las orillas se apagan hacia el fondo en vez de cortarse a filo.
            //
            // Son dos degradados rectos —uno horizontal y otro vertical— que
            // se cruzan: cada uno se apaga en su último dieciseisavo y el
            // centro queda intacto. Con un degradado radial el resultado era
            // un ojo de buey que se comía media foto; aquí solo se desvanece
            // el borde, que es de lo que se trataba.
            WebkitMaskImage: BORDES,
            maskImage: BORDES,
            WebkitMaskComposite: 'source-in',
            maskComposite: 'intersect',
          }}
          role="img"
          aria-label={`El campo en el hoyo ${hoyo.n}`}
        />
      </figure>

      {/* ------------------------------------------------------ el paso a paso */}
      <div className="mt-4 flex shrink-0 items-center justify-between gap-4">
        <Flecha hacia="anterior" onIr={() => onElegirHoyo(anterior)} numero={anterior} />

        {/* Los dieciocho, como una regla: dice dónde va uno sin ocupar sitio. */}
        <ol className="flex min-w-0 flex-1 items-end justify-center gap-[3px]">
          {HOYOS.map((h) => {
            const aqui = h.n === hoyo.n;
            return (
              <li key={h.n} className="flex-1">
                <button
                  onClick={() => onElegirHoyo(h.n)}
                  aria-label={`Hoyo ${h.n}, par ${h.par}`}
                  aria-current={aqui ? 'true' : undefined}
                  title={`Hoyo ${h.n} · par ${h.par}`}
                  className={`block w-full rounded-[1px] transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote ${
                    aqui ? 'h-6 bg-hoja' : 'h-3 bg-arena/25 hover:h-5 hover:bg-arena/50'
                  }`}
                />
              </li>
            );
          })}
        </ol>

        <Flecha hacia="siguiente" onIr={() => onElegirHoyo(siguiente)} numero={siguiente} />
      </div>

      <p className="mt-3 shrink-0 font-texto text-menudo text-arena/45">
        Toque cualquier hoyo para verlo. Par 72 en total; la vuelta completa
        se juega en unas cuatro horas y media, con carrito compartido
        incluido.
      </p>
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
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-arena/25 font-texto text-arena/70 transition hover:border-hoja hover:text-hoja focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote"
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
