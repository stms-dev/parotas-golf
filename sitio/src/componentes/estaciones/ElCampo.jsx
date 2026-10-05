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
 * La foto se queda con todo, y el trazo se monta encima como marca de agua, a
 * la izquierda, que es donde vivía cuando había dos columnas y donde la vista
 * lo sigue buscando.
 *
 * De esa marca se ve en reposo lo que sirve para moverse —la vuelta y los
 * hoyos— y el campo entero aparece al acercarse el cursor. El reparto está en
 * `estilos.css`, bajo `.marca`; `Recorrido` solo nombra sus dos capas.
 *
 * Y las flechas se fueron a las orillas, una de cada lado, grandes. Es el
 * gesto de pasar página de toda la vida y no ocupa un renglón propio.
 */
import { useEffect, useRef, useState } from 'react';

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

/** Cuánto dura el pase de una foto a la otra. Igual que en `estilos.css`. */
const PASE_MS = 700;

export default function ElCampo({ hoyoActivo, onElegirHoyo }) {
  const { t } = useIdioma();
  const hoyo = HOYOS.find((h) => h.n === hoyoActivo) || HOYOS[0];
  const foto = fotoDelHoyo(hoyo.n);

  /*
   * Dos fotos a la vez mientras dura el cambio.
   *
   * `puesta` es la que manda y `previa` la que todavía está debajo. Hicieron
   * falta las dos: con una sola capa, la foto nueva entraba sobre el fondo
   * vacío y el deslizamiento enseñaba un hueco oscuro por el borde. Con la
   * anterior quieta debajo, lo que se ve es una foto pasando sobre la otra.
   *
   * `pase` sube con cada cambio y es la llave de React para la capa de
   * arriba: sin ella el navegador reaprovecha el mismo nodo y la animación no
   * se vuelve a correr, así que del segundo hoyo en adelante el cambio
   * volvería a ser de golpe.
   */
  const [capa, setCapa] = useState({ puesta: foto, previa: null, hacia: 1, pase: 0 });
  const ultimo = useRef(hoyo.n);

  useEffect(() => {
    const salto = hoyo.n - ultimo.current;
    ultimo.current = hoyo.n;
    if (salto === 0) return undefined;

    // ¿Entra por la derecha o por la izquierda? Por el camino corto, porque
    // del 18 al 1 se avanza aunque el número baje diecisiete.
    const hacia = ((salto % 18) + 18) % 18 <= 9 ? 1 : -1;

    // La foto entra cuando ya está descargada. Si no, se desliza un rectángulo
    // vacío y la imagen aparece después, al final del viaje.
    let vigente = true;
    const img = new Image();
    img.src = foto;
    const entrar = () => {
      if (!vigente) return;
      setCapa((c) =>
        c.puesta === foto ? c : { puesta: foto, previa: c.puesta, hacia, pase: c.pase + 1 },
      );
    };
    if (img.complete) entrar();
    else {
      img.onload = entrar;
      img.onerror = entrar;
    }
    return () => {
      vigente = false;
    };
  }, [hoyo.n, foto]);

  // Terminado el pase, la de abajo sobra. Se quita para no dejar capas
  // apiladas: quien recorre los dieciocho hoyos pasaría dieciocho veces.
  useEffect(() => {
    if (!capa.previa) return undefined;
    const id = setTimeout(() => setCapa((c) => ({ ...c, previa: null })), PASE_MS + 60);
    return () => clearTimeout(id);
  }, [capa.pase, capa.previa]);

  const anterior = HOYOS[(hoyo.n - 2 + 18) % 18].n;
  const siguiente = HOYOS[hoyo.n % 18].n;

  // Las flechas del teclado también pasan de hoyo, que es como se recorre
  // cualquier galería. En esta parada son suyas: App les cede la tecla.
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
      {/* ---------------------------------------------------------- la foto */}
      {/* La máscara va en el marco y el deslizamiento en las capas de adentro.
          Juntos no funcionaban: al mover la capa se movía también su
          desvanecido, y por un instante aparecía una orilla dura cortando la
          foto de abajo. */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          WebkitMaskImage: BORDES,
          maskImage: BORDES,
          WebkitMaskComposite: 'source-in',
          maskComposite: 'intersect',
        }}
        role="img"
        aria-label={t('campo.foto', { n: hoyo.n })}
      >
        {capa.previa && (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${capa.previa})` }}
          />
        )}
        <div
          key={capa.pase}
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${capa.puesta})`,
            animation: capa.pase
              ? `${capa.hacia > 0 ? 'pasar-adelante' : 'pasar-atras'} ${PASE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1) both`
              : undefined,
          }}
        />
      </div>

      {/* ------------------------------------------------- el trazo, encima */}
      {/*
        Marca de agua, a la izquierda. En reposo solo la vuelta y los hoyos; el
        campo entero al acercarse. Quién se enciende y cuándo está en `.marca`,
        en estilos.css.

        El `drop-shadow` es lo que salva al trazo sobre un cielo blanco: sin
        él, unos puntos claros sobre una foto clara no quedan tenues, quedan
        invisibles. Y el charco de sombra de atrás le pone piso al relieve
        cuando aparece, para que no dependa de lo que haya en la foto ese día;
        va con `marca-fondo`, así que entra y sale con él y en reposo no queda
        una mancha oscura sin nada adentro.

        En celular no va: a ancho de pulgar el trazo se encoge tanto que no se
        atina a un hoyo, y lo que sí funciona ahí son las flechas.
      */}
      <div className="marca pointer-events-none absolute inset-y-0 left-0 hidden w-[32%] max-w-[21rem] items-center justify-center md:flex">
        <div
          aria-hidden="true"
          className="marca-fondo absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 62% 48% at 50% 50%, rgba(10,42,33,0.5), ' +
              'rgba(10,42,33,0.22) 58%, rgba(10,42,33,0) 78%)',
          }}
        />
        <div
          className="pointer-events-auto relative h-[86%] w-full"
          style={{ filter: 'drop-shadow(0 2px 12px rgba(10, 42, 33, 0.95))' }}
        >
          <Recorrido hoyoActivo={hoyo.n} hoyoEstaciones={[]} onElegirHoyo={onElegirHoyo} />
        </div>
      </div>

      {/* --------------------------------------------------- de hoyo en hoyo */}
      <Flecha hacia="anterior" onIr={() => onElegirHoyo(anterior)} etiqueta={t('campo.anterior')} />
      <Flecha hacia="siguiente" onIr={() => onElegirHoyo(siguiente)} etiqueta={t('campo.siguiente')} />

      {/* ------------------------------------------------------- el renglón */}
      {/* Qué hoyo es y de cuántos, abajo a la derecha sobre la foto. Cambió de
          esquina cuando el mapa se pasó a la izquierda: donde estaba, le caía
          encima. Es lo único escrito que queda aquí, y va chico porque la foto
          manda. */}
      <p className="pointer-events-none absolute bottom-1 right-1 font-texto text-menudo uppercase tracking-wider text-arena drop-shadow-[0_1px_6px_rgba(10,42,33,0.95)]">
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
