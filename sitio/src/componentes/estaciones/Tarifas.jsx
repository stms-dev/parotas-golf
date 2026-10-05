/**
 * Tarifas.
 *
 * Dos columnas honestas —entre semana y fin de semana— porque así cobra el
 * club y así lo tiene que leer el que va a pagar. Nada de "desde $X".
 *
 * El caddie aparece con su precio pero fuera del total, porque el club no lo
 * cobra: el huésped le paga directo. Decirlo aquí evita el momento incómodo en
 * la caseta.
 */
import { EXTRAS, INCLUIDO, TARIFAS, enDolares, enLista, pesos } from '../../datos/campo';

const FILAS = [
  { etiqueta: '18 hoyos', detalle: 'Adulto', precios: TARIFAS.adulto18 },
  { etiqueta: '9 hoyos', detalle: 'Adulto', precios: TARIFAS.adulto9 },
  { etiqueta: '18 hoyos', detalle: 'Menores de 16', precios: TARIFAS.menor18 },
];

export default function Tarifas({ onIr }) {
  return (
    <div>
      <h2 className="font-titulo text-rotulo-lg text-arena corta:text-rotulo-md">Tarifas</h2>
      <p className="mt-2.5 max-w-lectura font-texto text-parrafo text-arena/90 corta:mt-2 corta:text-[0.95rem]">
        El green fee incluye {enLista(INCLUIDO)}. Precios por
        jugador, en pesos.
      </p>

      <table className="mt-5 w-full border-collapse text-left corta:mt-3">
        <thead>
          <tr className="border-b border-arena/20">
            <th className="pb-2 font-texto text-cifra uppercase font-semibold text-arena/75">Ronda</th>
            <th className="pb-2 text-right font-texto text-cifra uppercase font-semibold text-arena/75">
              Lun a jue
            </th>
            <th className="pb-2 text-right font-texto text-cifra uppercase font-semibold text-arena/75">
              Vie a dom
            </th>
          </tr>
        </thead>
        <tbody>
          {FILAS.map((fila) => (
            <tr key={`${fila.etiqueta}-${fila.detalle}`} className="border-b border-arena/10">
              <td className="py-2.5 lg:py-3 corta:py-1.5">
                <span className="block font-texto text-[0.95rem] font-semibold text-arena">
                  {fila.etiqueta}
                </span>
                <span className="font-texto text-menudo text-arena/80">{fila.detalle}</span>
              </td>
              <td className="py-2.5 text-right lg:py-3 corta:py-1.5">
                <span className="font-titulo text-rotulo-md text-arena corta:text-[1.15rem]">{pesos(fila.precios.semana)}</span>
                <span className="ml-2 font-texto text-menudo text-arena/75">
                  ≈ {enDolares(fila.precios.semana)} USD
                </span>
              </td>
              <td className="py-2.5 text-right lg:py-3 corta:py-1.5">
                <span className="font-titulo text-rotulo-md text-hoja corta:text-[1.15rem]">{pesos(fila.precios.fin)}</span>
                <span className="ml-2 font-texto text-menudo text-arena/75">
                  ≈ {enDolares(fila.precios.fin)} USD
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 corta:mt-3">
        <p className="font-texto text-cifra uppercase text-arena/75">Aparte del green fee</p>
        <ul className="mt-2.5 space-y-2 corta:mt-2 corta:space-y-1">
          {EXTRAS.map((extra) => (
            <li key={extra.code} className="flex items-baseline justify-between gap-5">
              <span className="font-texto text-[0.95rem] text-arena">
                {extra.nombre}
                {extra.pagoDirecto && (
                  <span className="ml-2 rounded-sm bg-copa/20 px-2 py-0.5 font-texto text-[0.7rem] font-semibold text-copa">
                    se le paga directo
                  </span>
                )}
                <span className="mt-0.5 block font-texto text-menudo text-arena/75">{extra.nota}</span>
              </span>
              <span className="shrink-0 font-titulo text-rotulo-md text-arena corta:text-[1.15rem]">{pesos(extra.precio)}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={() => onIr('reservar')}
        className="mt-6 self-start rounded-sm bg-hoja px-7 py-3 corta:mt-4 corta:py-2.5 font-texto text-[0.95rem] font-bold text-sombra-honda transition hover:bg-brote focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
      >
        Reservar una salida
      </button>
    </div>
  );
}
