/**
 * Tarifas.
 *
 * Dos columnas honestas —entre semana y fin de semana— porque así cobra el
 * club y así lo tiene que leer el que va a pagar. Nada de "desde $X".
 *
 * El caddie aparece con su precio pero fuera del total, porque el club no lo
 * cobra: el huésped le paga directo. Decirlo aquí evita el momento incómodo en
 * la caseta.
 *
 * Los nombres de las filas y de los extras vienen del diccionario, no de
 * `campo.js`: los precios son los mismos en los dos idiomas, las palabras no.
 * El extra se busca por su `code` —`extra.CADDIE`—, que es el mismo que usa el
 * sistema, así que agregar un extra en el catálogo solo pide su par de frases.
 */
import { EXTRAS, INCLUIDO, TARIFAS, enDolares, enLista, pesos } from '../../datos/campo';
import { useIdioma } from '../../datos/idioma';

const FILAS = [
  { hoyos: 18, quien: 'tarifas.adulto', precios: TARIFAS.adulto18 },
  { hoyos: 9, quien: 'tarifas.adulto', precios: TARIFAS.adulto9 },
  { hoyos: 18, quien: 'tarifas.twilight', precios: TARIFAS.twilight18 },
  { hoyos: 18, quien: 'tarifas.menores', precios: TARIFAS.menor18 },
  // La tarifa local (18 hoyos) ya no sale con precio en la tabla: se trata por
  // evento/residentes. Arriba hay un aviso que lleva a pedir información.
].filter((fila) => fila.precios);

export default function Tarifas({ onIr }) {
  const { t } = useIdioma();

  // Lo que el green fee incluye, en el idioma de quien lee y unido con la
  // conjunción que toca.
  const incluido = enLista(
    INCLUIDO_CLAVES.map((clave) => t(clave)),
    t('lista.union'),
  );

  return (
    <div>
      {/* Hasta arriba de todo: la tarifa local. No lleva precio a propósito —se
          trata directo—, así que en vez de cifra hay un botón que manda a
          Evento privado, donde se pide la información. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-hoja/40 bg-hoja/10 px-4 py-3.5 corta:mb-4 corta:py-3">
        <div className="min-w-0">
          <p className="font-texto text-[0.95rem] font-semibold text-arena">
            {t('tarifas.localTitulo')}
          </p>
          <p className="mt-0.5 font-texto text-menudo text-arena/80">
            {t('tarifas.localTexto')}
          </p>
        </div>
        <button
          onClick={() => onIr('casa')}
          className="shrink-0 rounded-sm bg-hoja px-4 py-2.5 font-texto text-menudo font-bold text-sombra-honda transition hover:bg-brote focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
        >
          {t('tarifas.localBoton')}
        </button>
      </div>

      <h2 className="font-titulo text-rotulo-lg text-arena corta:text-rotulo-md">
        {t('tarifas.titulo')}
      </h2>
      <p className="mt-2.5 max-w-lectura font-texto text-parrafo text-arena/90 corta:mt-2 corta:text-[0.95rem]">
        {t('tarifas.incluye', { incluido })} {t('tarifas.noIncluye')}
      </p>

      <table className="mt-5 w-full border-collapse text-left corta:mt-3">
        <thead>
          <tr className="border-b border-arena/20">
            <th className="pb-2 font-texto text-cifra uppercase font-semibold text-arena/75">
              {t('tarifas.ronda')}
            </th>
            <th className="pb-2 text-right font-texto text-cifra uppercase font-semibold text-arena/75">
              {t('tarifas.semana')}
            </th>
            <th className="pb-2 text-right font-texto text-cifra uppercase font-semibold text-arena/75">
              {t('tarifas.fin')}
            </th>
          </tr>
        </thead>
        <tbody>
          {FILAS.map((fila) => (
            <tr key={`${fila.hoyos}-${fila.quien}`} className="border-b border-arena/10">
              <td className="py-2.5 lg:py-3 corta:py-1.5">
                <span className="block font-texto text-[0.95rem] font-semibold text-arena">
                  {t('tarifas.hoyos', { n: fila.hoyos })}
                </span>
                <span className="font-texto text-menudo text-arena/80">{t(fila.quien)}</span>
              </td>
              <td className="py-2.5 text-right lg:py-3 corta:py-1.5">
                <span className="font-titulo text-rotulo-md text-arena corta:text-[1.15rem]">
                  {pesos(fila.precios.semana)}
                </span>
                <span className="ml-2 font-texto text-menudo text-arena/75">
                  ≈ {enDolares(fila.precios.semana)} USD
                </span>
              </td>
              <td className="py-2.5 text-right lg:py-3 corta:py-1.5">
                {fila.precios.fin == null ? (
                  <span className="font-texto text-menudo text-arena/75">
                    {t('tarifas.soloEntreSemana')}
                  </span>
                ) : (
                  <>
                    <span className="font-titulo text-rotulo-md text-hoja corta:text-[1.15rem]">
                      {pesos(fila.precios.fin)}
                    </span>
                    <span className="ml-2 font-texto text-menudo text-arena/75">
                      ≈ {enDolares(fila.precios.fin)} USD
                    </span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 corta:mt-3">
        <p className="font-texto text-cifra uppercase text-arena/75">{t('tarifas.aparte')}</p>
        <ul className="mt-2.5 space-y-2 corta:mt-2 corta:space-y-1">
          {EXTRAS.map((extra) => (
            <li key={extra.code} className="flex items-baseline justify-between gap-5">
              <span className="font-texto text-[0.95rem] text-arena">
                {t(`extra.${extra.code}`)}
                {/* La insignia es una sola frase para todos los extras, no una
                    por código: dice lo mismo de cualquiera que se pague
                    directo. Con una por código, el día que el club marque otro
                    extra así saldría la clave cruda en la página. */}
                {extra.pagoDirecto && (
                  <span className="ml-2 rounded-sm bg-copa/20 px-2 py-0.5 font-texto text-[0.7rem] font-semibold text-copa">
                    {t('tarifas.pagoDirecto')}
                  </span>
                )}
                <span className="mt-0.5 block font-texto text-menudo text-arena/75">
                  {t(`extra.${extra.code}.nota`, { fin: extra.precioFin ? pesos(extra.precioFin) : '' })}
                </span>
              </span>
              <span className="shrink-0 font-titulo text-rotulo-md text-arena corta:text-[1.15rem]">
                {pesos(extra.precio)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={() => onIr('reservar')}
        className="mt-6 self-start rounded-sm bg-hoja px-7 py-3 corta:mt-4 corta:py-2.5 font-texto text-[0.95rem] font-bold text-sombra-honda transition hover:bg-brote focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
      >
        {t('tarifas.reservar')}
      </button>
    </div>
  );
}

/*
 * Lo incluido se enumera en el mismo orden que en `campo.js`, pero traducido.
 * `INCLUIDO` sigue siendo la lista de verdad —la que dice qué entra en el green
 * fee—; esto solo son sus frases.
 */
const INCLUIDO_CLAVES = ['tarifas.carrito', 'tarifas.scorecard', 'tarifas.tees', 'tarifas.pelotas'];

// Si algún día alguien agrega algo a INCLUIDO y olvida su frase, que se note en
// desarrollo en lugar de salir una lista corta en la página.
if (import.meta.env.DEV && INCLUIDO.length !== INCLUIDO_CLAVES.length) {
  console.warn('INCLUIDO y INCLUIDO_CLAVES no coinciden: falta traducir algo del green fee.');
}
