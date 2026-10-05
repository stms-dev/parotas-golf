/**
 * El campo: la foto del hoyo, a toda pantalla, con el trazo encima.
 *
 * Las versiones anteriores le daban media pantalla al mapa y la otra media a
 * la foto, y la foto siempre salía perdiendo: en un campo de golf lo que vende
 * es cómo se ve, y lo que se veía era un rectángulo de la mitad del tamaño que
 * podía tener. Pero el mapa tampoco sobraba — es como se elige hoyo y es lo
 * único que dice dónde queda cada uno.
 *
 * La salida fue dejar de tratarlos como dos cosas que compiten por el espacio.
 * La foto se queda con todo, y el trazo se monta encima como marca de agua:
 * apenas un fantasma verde que no estorba la vista y que, sin embargo, sigue
 * respondiendo al dedo hoyo por hoyo. Se enciende al acercarse el cursor, para
 * quien lo busque.
 *
 * Y las flechas se fueron a las orillas, una de cada lado, grandes. Es el
 * gesto de pasar página de toda la vida y no ocupa un renglón propio.
 */
import { useEffect, useState } from 'react';

import Recorrido from '../Recorrido';
import { HOYOS, fotoDelHoyo } from '../../datos/campo';
import { useIdioma } from '../../datos/idioma';

/**
 * El desvanecido de las cuatro orillas, como una sola máscara.
 *
 * Los dos degradados —uno horizontal y otro vertical— se cruzan, y cada uno
 * lleva varias paradas en vez de dos. Esa es toda la gracia: un degradado de
 * transparente a opaco en línea recta deja una banda que el ojo encuentra, y
 * entonces se sigue viendo dónde termina el rectángulo. Con las paradas
 * repartidas en curva no hay ningún punto donde el cambio se note.
 */
function orilla(eje, largo) {
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

const BORDES = [orilla('to right', 7), orilla('to bottom', 8)].join(', ');

export default function ElCampo({ hoyoActivo, onElegirHoyo }) {
  const { t } = useIdioma();
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

  // Las flechas del teclado también pasan de hoyo, que es como se recorre
  // cualquier galería.
  useEffect(() => {
    function teclado(e) {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') onElegirHoyo(anterior);
      if (e.key === 'ArrowRight') onElegirHoyo(siguiente);
    }
    window.addEventListener('keydown', teclado);
    return () => window.removeEventListener('keydown', teclado);
  }, [anterior, siguiente, onElegirHoyo]);

  return (
    <div className="relative flex min-h-0 w-full flex-1 items-center">
      {/* ----------------------------------------------------------- la foto */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-700"
        style={{
          backgroundImage: `url(${puesta})`,
          opacity: lista ? 1 : 0.2,
          WebkitMaskImage: BORDES,
          maskImage: BORDES,
          WebkitMaskComposite: 'source-in',
          maskComposite: 'intersect',
        }}
        role="img"
        aria-label={t('campo.foto', { n: hoyo.n })}
      />

      {/* ------------------------------------------------- el trazo, encima */}
      {/*
        Marca de agua: se ve lo justo para saber que está ahí, y se enciende al
        acercarse.

        Lo difícil de una marca de agua sobre foto es que la foto cambia debajo.
        El primer intento era solo opacidad baja, y el resultado fue peor que
        tenue: sobre los árboles del 5 se leía bien y sobre el cielo blanco del
        mismo hoyo desaparecía por completo. Una marca que a veces está y a
        veces no, no es discreta: es un error.

        Lo que la sostiene son dos cosas. El `drop-shadow` le da filo propio, no
        prestado del fondo. Y detrás va un charco de sombra muy suave —una
        elipse que se desvanece antes de llegar a sus orillas, así que no se lee
        como un recuadro— que le pone piso al trazo pase lo que pase en la foto.
        Cae justo en la orilla derecha, donde la foto ya se está desvaneciendo,
        y por eso no se nota como algo agregado.

        En celular no va: a ancho de pulgar el trazo se encoge tanto que no se
        atina a un hoyo, y lo que sí funciona ahí son las flechas.
      */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[32%] max-w-[21rem] items-center justify-center md:flex">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 62% 48% at 50% 50%, rgba(10,42,33,0.5), ' +
              'rgba(10,42,33,0.22) 58%, rgba(10,42,33,0) 78%)',
          }}
        />
        <div
          className="pointer-events-auto relative h-[86%] w-full opacity-[0.26] transition-opacity duration-500 hover:opacity-95 focus-within:opacity-95"
          style={{ filter: 'drop-shadow(0 2px 12px rgba(10, 42, 33, 0.95))' }}
        >
          <Recorrido hoyoActivo={hoyo.n} hoyoEstaciones={[]} onElegirHoyo={onElegirHoyo} />
        </div>
      </div>

      {/* --------------------------------------------------- de hoyo en hoyo */}
      <Flecha hacia="anterior" onIr={() => onElegirHoyo(anterior)} etiqueta={t('campo.anterior')} />
      <Flecha hacia="siguiente" onIr={() => onElegirHoyo(siguiente)} etiqueta={t('campo.siguiente')} />

      {/* ------------------------------------------------------- el renglón */}
      {/* Qué hoyo es y de cuántos, abajo a la izquierda sobre la foto. Es lo
          único escrito que queda aquí, y va chico porque la foto manda. */}
      <p className="pointer-events-none absolute bottom-1 left-1 font-texto text-menudo uppercase tracking-wider text-arena drop-shadow-[0_1px_6px_rgba(10,42,33,0.95)]">
        {t('campo.cuenta', { n: String(hoyo.n).padStart(2, '0') })} ·{' '}
        {t('campo.par', {
          par: hoyo.par,
          mitad: hoyo.n <= 9 ? t('campo.ida') : t('campo.vuelta'),
        })}
      </p>
    </div>
  );
}

function Flecha({ hacia, onIr, etiqueta }) {
  const atras = hacia === 'anterior';
  return (
    <button
      onClick={onIr}
      aria-label={etiqueta}
      title={etiqueta}
      className={`absolute top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-arena/25 bg-sombra/40 text-arena backdrop-blur-sm transition hover:border-hoja hover:bg-sombra/70 hover:text-hoja focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote sm:h-14 sm:w-14 ${
        atras ? 'left-0 sm:left-1' : 'right-0 sm:right-1'
      }`}
    >
      <svg viewBox="0 0 16 16" className="h-6 w-6" aria-hidden="true">
        <path
          d={atras ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
