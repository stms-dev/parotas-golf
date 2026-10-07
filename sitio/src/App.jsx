/**
 * El sitio entero cabe en una pantalla.
 *
 * No hay secciones apiladas que haya que deslizar: hay un campo dibujado y
 * cinco paradas sobre él. Se elige una, la bola viaja hasta su hoyo y el panel
 * cambia. Deslizar no explica nada de un campo de golf; recorrerlo sí.
 *
 * En celular el mapa se encoge arriba y el panel se queda con la pantalla,
 * porque un mapa a ancho de pulgar no se lee — pero las paradas siguen siendo
 * las mismas y en el mismo orden.
 */
import { useEffect, useState } from 'react';

import Fondo from './componentes/Fondo';
import Salida from './componentes/estaciones/Salida';
import ElCampo from './componentes/estaciones/ElCampo';
import Tarifas from './componentes/estaciones/Tarifas';
import Reservar from './componentes/estaciones/Reservar';
import CasaClub from './componentes/estaciones/CasaClub';
import { api } from './datos/api';
import { CONTACTO, ESTACIONES, fotoDelHoyo } from './datos/campo';
import { useIdioma } from './datos/idioma';
import logo from './assets/logo-las-parotas-claro.png';


/** Las cinco paradas. Se dibujan arriba o abajo según quepan. */
function Paradas({ estacion, onIr, t }) {
  return ESTACIONES.map((e) => {
    const activa = e.id === estacion;
    return (
      <button
        key={e.id}
        onClick={() => onIr(e.id)}
        aria-current={activa ? 'page' : undefined}
        className={`shrink-0 whitespace-nowrap rounded-sm px-3 py-2 font-texto text-menudo font-semibold transition md:text-[0.9rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote ${
          activa ? 'bg-arena/[0.12] text-hoja' : 'text-arena/85 hover:text-arena'
        }`}
      >
        {t(e.clave)}
      </button>
    );
  });
}

export default function App() {
  const { idioma, cambiar, t } = useIdioma();
  const [estacion, setEstacion] = useState('salida');
  // Horario, tarifas y reglas, leídos del sistema. Si no contesta se queda en
  // null y las pantallas usan los datos de campo.js: la presentación no se
  // cae porque el backend esté dormido, solo se apaga el formulario.
  const [campo, setCampo] = useState(null);
  // Se vuelve de Stripe con ?reserva=LP-1234&pago=listo. Se lee una sola vez,
  // al abrir, y se limpia la dirección para que recargar no reviva la pantalla
  // de confirmación de una reserva vieja.
  const [llegada, setLlegada] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    const folio = q.get('reserva');
    if (!folio) return null;
    return { folio, cancelado: q.get('pago') === 'cancelado' };
  });
  // El hoyo que mira el mapa. Normalmente es el de la estación, pero el
  // visitante puede tocar cualquier hoyo de la tarjeta y la bola va para allá
  // sin cambiar de panel: se puede husmear el campo sin perder el hilo.
  const [hoyo, setHoyo] = useState(ESTACIONES[0].hoyo);

  useEffect(() => {
    api.campo().then(setCampo).catch(() => setCampo(null));
  }, []);

  // Quien vuelve de pagar aterriza directo en su confirmación, no en la
  // portada: viene a ver si su salida quedó.
  useEffect(() => {
    if (!llegada) return;
    irA('reservar');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  function irA(id) {
    const destino = ESTACIONES.find((e) => e.id === id);
    if (!destino) return;
    setEstacion(id);
    setHoyo(destino.hoyo);
  }

  // Flechas para moverse entre paradas, como en cualquier presentación.
  //
  // Menos en El campo. Ahí las flechas ya tienen dueño —pasan de hoyo— y
  // durante un rato las dos cosas escucharon la misma tecla: una flecha
  // derecha adelantaba el hoyo *y* además saltaba a Tarifas, así que el
  // visitante se salía de la galería sin haber pedido salirse. La tecla es
  // una sola; en esa pantalla es de los hoyos.
  useEffect(() => {
    if (estacion === 'campo') return undefined;
    function teclado(e) {
      if (e.target.matches('input, textarea, select')) return;
      const i = ESTACIONES.findIndex((x) => x.id === estacion);
      if (e.key === 'ArrowRight' && i < ESTACIONES.length - 1) irA(ESTACIONES[i + 1].id);
      if (e.key === 'ArrowLeft' && i > 0) irA(ESTACIONES[i - 1].id);
    }
    window.addEventListener('keydown', teclado);
    return () => window.removeEventListener('keydown', teclado);
  }, [estacion]);

  const paneles = {
    salida: <Salida />,
    tarifas: <Tarifas onIr={irA} />,
    reservar: (
      <Reservar
        campo={campo}
        llegada={llegada}
        onLimpiarLlegada={() => setLlegada(null)}
      />
    ),
    casa: <CasaClub />,
  };


  return (
    <div className="relative min-h-[100svh] overflow-hidden bg-sombra">
      {/* La foto de fondo, nítida (HD), en todas las ventanas: en la portada
          las fotos hero; en El campo, la del hoyo que se mira; en las demás,
          una al azar que se releva sola. Siempre en alta definición. */}
      <Fondo
        cambiarCon={estacion}
        fija={estacion === 'campo' ? fotoDelHoyo(hoyo) : null}
        hero={estacion === 'salida'}
        nitido
      />

      <div className="relative mx-auto flex h-[100svh] max-w-[1480px] flex-col px-5 py-4 sm:px-8 sm:py-5 lg:py-7">
        {/* ------------------------------------------------------ encabezado */}
        <header className="shrink-0">
          <div className="flex items-center justify-between gap-5">
            <button onClick={() => irA('salida')} className="shrink-0" aria-label={t('nav.irAlInicio')}>
              <img
                src={logo}
                alt="Las Parotas, Club de Golf Huatulco"
                className="h-11 w-auto sm:h-14"
              />
            </button>

            <div className="flex items-center gap-2 sm:gap-4">
              {/* En pantalla ancha las paradas caben junto al logo. */}
              <nav className="hidden items-center gap-1.5 md:flex">
                <Paradas estacion={estacion} onIr={irA} t={t} />
              </nav>

              {/* Va aparte de las paradas, con su contorno, porque no es una
                  parada: es la puerta de salida del sitio. Mezclarlo con las
                  otras prometería que la bola viaja hasta allá, y lo que hace
                  es mandar al sistema de reservas, donde entran los hoteles
                  con convenio y el personal del club. */}
              <a
                href={CONTACTO.acceso}
                className="shrink-0 rounded-sm border border-arena/30 px-3.5 py-2 font-texto text-menudo font-semibold text-arena transition hover:border-hoja hover:text-hoja md:px-4 md:text-[0.9rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote"
              >
                {t('nav.acceder')}
              </a>
            </div>
          </div>

          {/* En celular no caben en el mismo renglón, así que bajan uno —pero
              siguen arriba, junto al logo, que es donde uno busca el menú. Un
              rato estuvieron al pie, al alcance del pulgar; el problema es que
              ahí competían con el pie del sitio y quedaban enterradas bajo el
              contenido. */}
          <nav className="-mx-1 mt-3 flex items-center gap-1 overflow-x-auto md:hidden">
            <Paradas estacion={estacion} onIr={irA} t={t} />
          </nav>
        </header>

        {/* ----------------------------------------------- mapa y contenido */}
        {/*
          El campo se sale del reparto de todas las demás paradas.
          En el resto hay dos columnas: el trazo a la izquierda, el texto a la
          derecha. Ahí el mapa es contexto y el texto es el contenido.
          En El campo el contenido es la foto, y una foto quiere la pantalla
          entera. Así que el trazo se va de su columna y se monta encima de la
          foto como marca de agua: sigue estando —y sigue pudiéndose tocar
          hoyo por hoyo— pero ya no le quita la mitad del espacio.
        */}
        {estacion === 'salida' ? (
          /* La portada: todo el espacio para el nombre y el hero. Sin mapa,
             sin columnas — solo el contenido centrado sobre la foto. */
          <main className="flex min-h-0 flex-1">
            <section key="salida" className="panel flex min-h-0 flex-1">
              {paneles.salida}
            </section>
          </main>
        ) : estacion === 'campo' ? (
          <main className="mt-4 flex min-h-0 flex-1 lg:mt-6">
            <ElCampo hoyoActivo={hoyo} onElegirHoyo={setHoyo} />
          </main>
        ) : (
          /* Las demás paradas (green fees, evento, reservar) ya no llevan el
             mapa: el trazo del campo se queda solo en El campo, que es donde
             se recorre hoyo por hoyo. Aquí el contenido se lleva el centro. */
          <main className="mt-4 flex min-h-0 flex-1 lg:mt-7 lg:w-full lg:max-w-[46rem] lg:self-center">
            {/* El panel. Tiene su propio desplazamiento para que la página
                nunca crezca: lo que se mueve es el contenido, no el sitio.
                `safe center` centra cuando el contenido cabe y lo pega arriba
                cuando no — sin él, un panel largo se corta por el
                encabezado. */}
            <section
              key={estacion}
              className="panel flex min-h-0 flex-1 flex-col [justify-content:safe_center] overflow-y-auto"
            >
              {paneles[estacion]}
            </section>
          </main>
        )}

        {/* ---------------------------------------------------------- pie */}
        <footer className="mt-3 shrink-0 border-t border-arena/12 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-texto text-menudo text-arena/75">
              <span className="font-semibold text-arena/90">{t('pie.nombre')}</span>
              {' · '}
              {t('pie.lugar')}
              {' · '}
              <a href={`mailto:${CONTACTO.correo}`} className="underline decoration-arena/25 underline-offset-4 transition hover:text-hoja">
                {CONTACTO.correo}
              </a>
              {' · '}
              <a href={`https://wa.me/${CONTACTO.telefono.replace(/[\s+]/g, '')}`} className="underline decoration-arena/25 underline-offset-4 transition hover:text-hoja">
                {CONTACTO.telefono}
              </a>
            </p>

            {/* El cambio de idioma. Estuvo un buen rato aquí como adorno —dos
                palabras que no hacían nada—; ahora son botones. Se quedan al
                pie porque quien llega en inglés ya lo tiene en inglés desde que
                abre: el navegador dice en qué idioma viene, y el que ya eligió
                una vez no vuelve a elegir. Esto es para la excepción. */}
            <div className="flex items-center gap-2 font-texto text-menudo">
              <Idioma cual="es" actual={idioma} onCambiar={cambiar}>
                Español
              </Idioma>
              <span aria-hidden="true" className="text-arena/40">
                ·
              </span>
              <Idioma cual="en" actual={idioma} onCambiar={cambiar}>
                English
              </Idioma>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Uno de los dos idiomas, al pie.
 *
 * El que ya está puesto no es un botón: es la etiqueta de dónde está uno. Si
 * los dos se vieran iguales y los dos se pudieran pulsar, no habría nada que
 * dijera en qué idioma se está leyendo.
 */
function Idioma({ cual, actual, onCambiar, children }) {
  if (cual === actual) {
    return (
      <span aria-current="true" className="font-semibold text-arena">
        {children}
      </span>
    );
  }
  return (
    <button
      onClick={() => onCambiar(cual)}
      lang={cual}
      className="text-arena/70 underline decoration-arena/25 underline-offset-4 transition hover:text-hoja focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote"
    >
      {children}
    </button>
  );
}
