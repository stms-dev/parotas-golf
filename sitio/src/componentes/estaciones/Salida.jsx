/**
 * La salida: lo primero que ve quien llega al sitio.
 *
 * Abre con el nombre y con la razón del nombre, porque es lo único que este
 * campo tiene y ningún otro: los árboles estaban antes y el trazo se acomodó a
 * ellos. Lo demás —par, diseñador, horario— va chico, de dato, no de pregón.
 */
import { HORARIO, PAR_TOTAL } from '../../datos/campo';
import { useIdioma } from '../../datos/idioma';

export default function Salida({ onIr }) {
  const { t } = useIdioma();

  return (
    <div>
      <p className="font-texto text-cifra uppercase text-copa">
        {t('salida.lugar')}
      </p>

      <h1 className="mt-3 font-titulo text-rotulo-xl text-arena">
        {t('salida.titulo1')}
        <br />
        {t('salida.titulo2')}
      </h1>

      <p className="mt-6 max-w-lectura font-texto text-parrafo text-arena">
        {t('salida.cuerpo')}
      </p>

      <dl className="mt-9 flex flex-wrap gap-x-10 gap-y-5">
        <Dato termino={t('salida.par')} valor={PAR_TOTAL} />
        <Dato termino={t('salida.hoyos')} valor="18" />
        <Dato termino={t('salida.salidas')} valor={`${HORARIO.primera} – ${HORARIO.ultima}`} />
        <Dato termino={t('salida.diseno')} valor="Agustín Pizá" />
      </dl>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <button
          onClick={() => onIr('reservar')}
          className="rounded-sm bg-hoja px-7 py-3.5 font-texto text-[0.95rem] font-bold text-sombra-honda transition hover:bg-brote focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
        >
          {t('salida.reservar')}
        </button>
        <button
          onClick={() => onIr('tarifas')}
          className="font-texto text-[0.95rem] font-semibold text-arena underline decoration-copa decoration-2 underline-offset-[6px] transition hover:text-arena focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
        >
          {t('salida.verTarifas')}
        </button>
      </div>
    </div>
  );
}

function Dato({ termino, valor }) {
  return (
    <div>
      <dt className="font-texto text-cifra uppercase text-arena/75">{termino}</dt>
      <dd className="mt-1 font-titulo text-rotulo-md text-arena">{valor}</dd>
    </div>
  );
}
