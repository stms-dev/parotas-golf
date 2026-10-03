/**
 * El campo: la tarjeta de hoyos.
 *
 * En vez de galería, la tarjeta. Un golfista lee una tarjeta de hoyos de un
 * vistazo y sabe a qué va: dónde están los pares 3, dónde se puede atacar,
 * cómo cierra. Y cada número es además un botón — al tocarlo la bola viaja a
 * ese hoyo en el mapa. Aquí es donde van sus fotos después: una por hoyo,
 * clavada en el lugar al que pertenece, en lugar de un carrusel sin orden.
 */
import { HOYOS, PAR_TOTAL } from '../../datos/campo';

export default function ElCampo({ hoyoActivo, onElegirHoyo }) {
  const ida = HOYOS.slice(0, 9);
  const vuelta = HOYOS.slice(9);
  const parIda = ida.reduce((s, h) => s + h.par, 0);
  const parVuelta = vuelta.reduce((s, h) => s + h.par, 0);

  return (
    <div>
      <h2 className="font-titulo text-rotulo-lg text-arena">La tarjeta</h2>
      <p className="mt-3 max-w-lectura font-texto text-parrafo text-arena/75">
        Nueve de ida que suben hacia el cerro y nueve de vuelta que bajan de
        regreso a la casa club. Toque un hoyo para verlo en el trazo.
      </p>

      <div className="mt-8 space-y-5">
        <Nueve titulo="Ida" hoyos={ida} par={parIda} hoyoActivo={hoyoActivo} onElegirHoyo={onElegirHoyo} />
        <Nueve titulo="Vuelta" hoyos={vuelta} par={parVuelta} hoyoActivo={hoyoActivo} onElegirHoyo={onElegirHoyo} />
      </div>

      <p className="mt-7 font-texto text-menudo text-arena/55">
        Par {PAR_TOTAL} · el recorrido completo se juega en unas cuatro horas y
        media, con carrito compartido incluido.
      </p>
    </div>
  );
}

function Nueve({ titulo, hoyos, par, hoyoActivo, onElegirHoyo }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-texto text-cifra uppercase text-arena/45">{titulo}</span>
        <span className="font-texto text-menudo text-arena/55">par {par}</span>
      </div>

      <div className="flex gap-[3px]">
        {hoyos.map((h) => {
          const activo = h.n === hoyoActivo;
          return (
            <button
              key={h.n}
              onClick={() => onElegirHoyo(h.n)}
              className={`group flex-1 rounded-sm border px-1 py-2.5 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote ${
                activo
                  ? 'border-hoja bg-hoja text-sombra-honda'
                  : 'border-arena/15 bg-arena/[0.055] text-arena hover:border-copa/60 hover:bg-arena/10'
              }`}
              aria-label={`Hoyo ${h.n}, par ${h.par}`}
              aria-pressed={activo}
            >
              <span className="block font-titulo text-[0.95rem] font-semibold leading-none">
                {h.n}
              </span>
              <span
                className={`mt-1.5 block font-texto text-[0.68rem] font-semibold leading-none ${
                  activo ? 'text-sombra-honda/70' : 'text-arena/45'
                }`}
              >
                {h.par}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
