/**
 * La salida: lo primero que ve quien llega al sitio.
 *
 * Abre con el nombre y con la razón del nombre, porque es lo único que este
 * campo tiene y ningún otro: los árboles estaban antes y el trazo se acomodó a
 * ellos. Lo demás —par, diseñador, horario— va chico, de dato, no de pregón.
 */
import { HORARIO, PAR_TOTAL } from '../../datos/campo';

export default function Salida({ onIr }) {
  return (
    <div>
      <p className="font-texto text-cifra uppercase text-copa">
        Bahías de Huatulco, Oaxaca
      </p>

      <h1 className="mt-3 font-titulo text-rotulo-xl text-arena">
        Dieciocho hoyos
        <br />
        bajo las parotas
      </h1>

      <p className="mt-6 max-w-lectura font-texto text-parrafo text-arena/80">
        Las parotas ya estaban aquí cuando se trazó el campo: árboles de copa
        ancha que dan sombra a media hectárea cada uno. En lugar de tumbarlas,
        Agustín Pizá acomodó el recorrido entre ellas. Por eso ningún hoyo se
        parece al anterior, y por eso el campo se llama como se llama.
      </p>

      <dl className="mt-9 flex flex-wrap gap-x-10 gap-y-5">
        <Dato termino="Par" valor={PAR_TOTAL} />
        <Dato termino="Hoyos" valor="18" />
        <Dato termino="Salidas" valor={`${HORARIO.primera} – ${HORARIO.ultima}`} />
        <Dato termino="Diseño" valor="Agustín Pizá" />
      </dl>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <button
          onClick={() => onIr('reservar')}
          className="rounded-sm bg-hoja px-7 py-3.5 font-texto text-[0.95rem] font-bold text-sombra-honda transition hover:bg-brote focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
        >
          Reservar una salida
        </button>
        <button
          onClick={() => onIr('tarifas')}
          className="font-texto text-[0.95rem] font-semibold text-arena/80 underline decoration-copa decoration-2 underline-offset-[6px] transition hover:text-arena focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
        >
          Ver tarifas
        </button>
      </div>
    </div>
  );
}

function Dato({ termino, valor }) {
  return (
    <div>
      <dt className="font-texto text-cifra uppercase text-arena/45">{termino}</dt>
      <dd className="mt-1 font-titulo text-rotulo-md text-arena">{valor}</dd>
    </div>
  );
}
