/**
 * Casa club: dónde está el campo y cómo llamarle.
 *
 * Último hoyo del recorrido, que es justo donde se vuelve. Aquí va el acceso
 * del personal y de los hoteles, como liga discreta: el concierge lo tiene en
 * favoritos desde el primer día y no necesita un botón en la portada.
 */
import { CONTACTO, HORARIO } from '../../datos/campo';

export default function CasaClub() {
  return (
    <div>
      <h2 className="font-titulo text-rotulo-lg text-arena">Casa club</h2>
      <p className="mt-3 max-w-lectura font-texto text-parrafo text-arena/90">
        El campo abre su primera salida a las {HORARIO.primera} y la última sale
        a las {HORARIO.ultima}. Cierra a las {HORARIO.cierre}, así que una
        salida tardía puede no alcanzar los 18 hoyos.
      </p>

      <dl className="mt-8 space-y-5">
        <Renglon termino="Teléfono">
          <a
            href={`tel:${CONTACTO.telefono.replace(/\s/g, '')}`}
            className="underline decoration-copa decoration-2 underline-offset-[6px] transition hover:text-hoja"
          >
            {CONTACTO.telefono}
          </a>
        </Renglon>
        <Renglon termino="Correo">
          <a
            href={`mailto:${CONTACTO.correo}`}
            className="underline decoration-copa decoration-2 underline-offset-[6px] transition hover:text-hoja"
          >
            {CONTACTO.correo}
          </a>
        </Renglon>
        <Renglon termino="Dónde">{CONTACTO.domicilio}</Renglon>
      </dl>

      <div className="mt-10 border-t border-arena/15 pt-5">
        <p className="font-texto text-menudo text-arena/80">
          ¿Trabaja en el club o en un hotel con convenio? Entre por{' '}
          <a
            href={CONTACTO.acceso}
            className="font-semibold text-arena underline decoration-arena/30 underline-offset-4 transition hover:text-hoja"
          >
            el sistema de reservas
          </a>{' '}
          — el botón «Acceder» de arriba.
        </p>
      </div>
    </div>
  );
}

function Renglon({ termino, children }) {
  return (
    <div>
      <dt className="font-texto text-cifra uppercase text-arena/75">{termino}</dt>
      <dd className="mt-1 font-texto text-[1.05rem] text-arena">{children}</dd>
    </div>
  );
}
