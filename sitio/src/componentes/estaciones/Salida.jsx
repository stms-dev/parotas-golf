/**
 * La salida: lo primero que ve quien llega al sitio.
 *
 * Es la portada y tiene que atrapar. El nombre del campo llena la pantalla —
 * "LAS PAROTAS" en Fraunces, enorme— con "Campo de Golf" debajo, más pequeño,
 * como subtítulo de lugar. Todo centrado sobre la foto hero, que va nítida con
 * un velo oscuro encima.
 *
 * Los datos (par, hoyos, diseñador, horario) van debajo, chicos, porque son
 * contexto: nadie viene por el número de par, pero quien ya está interesado
 * quiere verlo sin buscarlo.
 *
 * El estilo busca lo que hacen los sitios de arquitectura y hospitalidad de
 * lujo: foto a sangre, tipografía dramática, nada que sobre.
 */
import { HORARIO, PAR_TOTAL } from '../../datos/campo';
import { useIdioma } from '../../datos/idioma';

export default function Salida() {
  const { t } = useIdioma();

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      {/* El subtítulo de lugar, arriba del nombre. */}
      <p className="font-texto text-cifra uppercase tracking-[0.25em] text-arena/70">
        {t('salida.lugar')}
      </p>

      {/* LAS PAROTAS — el nombre que tiene que quedarse. */}
      <h1
        className="mt-4 font-titulo text-arena corta:mt-2"
        style={{
          fontSize: 'clamp(3.2rem, 10vw, 7.5rem)',
          lineHeight: '0.88',
          letterSpacing: '-0.03em',
        }}
      >
        LAS PAROTAS
      </h1>

      {/* "Campo de Golf" — lo que es, no quién es. */}
      <p
        className="mt-3 font-texto uppercase tracking-[0.3em] text-arena/80 corta:mt-2"
        style={{
          fontSize: 'clamp(0.85rem, 1.8vw, 1.3rem)',
        }}
      >
        {t('salida.subtitulo')}
      </p>

      {/* La línea que separa el nombre del resto. */}
      <div className="mx-auto mt-8 h-px w-16 bg-hoja/50 corta:mt-5" />

      {/* El párrafo de enganche, centrado y acotado. */}
      <p className="mt-6 max-w-[48ch] font-texto text-parrafo text-arena/90 corta:mt-4 corta:text-[0.95rem]">
        {t('salida.cuerpo')}
      </p>

      {/* Los datos duros: par, hoyos, salidas, diseñador. En fila, chicos. */}
      <dl className="mt-8 flex flex-wrap justify-center gap-x-10 gap-y-4 corta:mt-5">
        <Dato termino={t('salida.par')} valor={PAR_TOTAL} />
        <Dato termino={t('salida.hoyos')} valor="18" />
        <Dato termino={t('salida.salidas')} valor={`${HORARIO.primera} – ${HORARIO.ultima}`} />
        <Dato termino={t('salida.diseno')} valor="Agustín Pizá" />
      </dl>
    </div>
  );
}

function Dato({ termino, valor }) {
  return (
    <div>
      <dt className="font-texto text-cifra uppercase text-arena/60">{termino}</dt>
      <dd className="mt-1 font-titulo text-rotulo-md text-arena">{valor}</dd>
    </div>
  );
}
