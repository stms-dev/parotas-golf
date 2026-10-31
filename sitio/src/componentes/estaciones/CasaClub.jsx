/**
 * Charter y torneos privados.
 *
 * La pantalla hace una sola cosa: invitar a escribirle al club. Una pregunta y
 * un botón. El botón abre WhatsApp con el número que el club tiene en
 * Configuración; si no hay número, abre el correo. Si tampoco hay correo, no
 * se pinta: un botón que no lleva a ningún lado es peor que no tenerlo.
 *
 * El acceso de hoteles y personal ya no vive aquí: entran por «Acceder» del
 * encabezado.
 */
import { contactoDe, enlaceWhatsApp } from '../../datos/campo';
import { useIdioma } from '../../datos/idioma';

export default function CasaClub({ campo = null }) {
  const { t } = useIdioma();
  const contacto = contactoDe(campo);
  const hayTelefono = /\d{7,}/.test(String(contacto.telefono || '').replace(/\D/g, ''));
  const enlace = hayTelefono
    ? enlaceWhatsApp(contacto.telefono)
    : contacto.correo
      ? `mailto:${contacto.correo}`
      : null;

  return (
    <div>
      <h2 className="font-titulo text-rotulo-lg text-arena">{t('evento.titulo')}</h2>

      <p className="mt-4 max-w-lectura font-texto text-parrafo text-arena">
        {t('evento.invitacion')}
      </p>

      {enlace && (
        <a
          href={enlace}
          {...(hayTelefono ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="mt-6 inline-block rounded-sm bg-hoja px-7 py-3 font-texto text-[0.95rem] font-bold text-sombra-honda transition hover:bg-brote focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
        >
          {t('evento.boton')}
        </a>
      )}
    </div>
  );
}
