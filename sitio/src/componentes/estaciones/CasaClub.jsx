/**
 * Evento privado: cómo apalabrar un torneo, y de paso cómo llamar al club.
 *
 * Era «Casa club» y traía los mismos datos —horario, teléfono, correo, dónde
 * está—. El contenido no cambió; cambió para qué está. Un turista que quiere
 * jugar ya tiene su camino en Reservar; quien llega hasta esta parada suele
 * venir con otra pregunta, la de traer a un grupo, y la respuesta a esa es
 * hablar con alguien del club. Así que los datos de contacto dejan de ser un
 * pie de página y pasan a ser lo que la pantalla ofrece.
 *
 * El acceso del personal y de los hoteles se queda abajo, como liga discreta:
 * el concierge lo tiene en favoritos desde el primer día y no necesita un
 * botón en la portada.
 */
import { CONTACTO as CONTACTO_BASE, contactoDe, enlaceWhatsApp } from '../../datos/campo';
import { useIdioma } from '../../datos/idioma';

export default function CasaClub({ campo = null }) {
  const { t } = useIdioma();
  const contacto = contactoDe(campo);

  return (
    <div>
      <h2 className="font-titulo text-rotulo-lg text-arena">{t('evento.titulo')}</h2>

      <p className="mt-3 max-w-lectura font-texto text-parrafo text-arena">
        {t('evento.invitacion')}
      </p>

      <p className="mt-4 max-w-lectura font-texto text-parrafo text-arena/90">
        {t('evento.cuerpo')}
      </p>

      <dl className="mt-8 space-y-5">
        <Renglon termino={t('evento.telefono')}>
          <a
            href={enlaceWhatsApp(contacto.telefono)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-copa decoration-2 underline-offset-[6px] transition hover:text-hoja"
          >
            {contacto.telefono}
          </a>
        </Renglon>
        <Renglon termino={t('evento.correo')}>
          <a
            href={`mailto:${contacto.correo}`}
            className="underline decoration-copa decoration-2 underline-offset-[6px] transition hover:text-hoja"
          >
            {contacto.correo}
          </a>
        </Renglon>
        <Renglon termino={t('evento.donde')}>{contacto.domicilio}</Renglon>
      </dl>

      <div className="mt-10 border-t border-arena/15 pt-5">
        {/* La frase viene partida del diccionario porque lleva un enlace en
            medio, y en inglés ese enlace no cae en el mismo lugar. */}
        <p className="font-texto text-menudo text-arena/80">
          {t('evento.acceso').split('{enlace}')[0]}
          <a
            href={CONTACTO_BASE.acceso}
            className="font-semibold text-arena underline decoration-arena/30 underline-offset-4 transition hover:text-hoja"
          >
            {t('evento.acceso.enlace')}
          </a>
          {t('evento.acceso').split('{enlace}')[1]}
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
