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
import Recorrido from './componentes/Recorrido';
import Salida from './componentes/estaciones/Salida';
import ElCampo from './componentes/estaciones/ElCampo';
import Tarifas from './componentes/estaciones/Tarifas';
import Reservar from './componentes/estaciones/Reservar';
import CasaClub from './componentes/estaciones/CasaClub';
import { api } from './datos/api';
import { CONTACTO, ESTACIONES, HOYOS } from './datos/campo';
import logo from './assets/logo-las-parotas.png';

const HOYOS_ESTACION = ESTACIONES.map((e) => e.hoyo);

/** Las cinco paradas. Se dibujan arriba o abajo según quepan. */
function Paradas({ estacion, onIr }) {
  return ESTACIONES.map((e) => {
    const activa = e.id === estacion;
    return (
      <button
        key={e.id}
        onClick={() => onIr(e.id)}
        aria-current={activa ? 'page' : undefined}
        className={`shrink-0 whitespace-nowrap rounded-sm px-3 py-2 font-texto text-menudo font-semibold transition md:text-[0.9rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote ${
          activa ? 'bg-arena/[0.12] text-hoja' : 'text-arena/65 hover:text-arena'
        }`}
      >
        {e.nombre}
      </button>
    );
  });
}

export default function App() {
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
  useEffect(() => {
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
    salida: <Salida onIr={irA} />,
    campo: <ElCampo hoyoActivo={hoyo} onElegirHoyo={setHoyo} />,
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

  const parDelHoyo = HOYOS.find((h) => h.n === hoyo)?.par;

  return (
    <div className="relative min-h-[100svh] overflow-hidden bg-sombra">
      {/* El campo pone su propia foto, grande y nítida; otro paisaje detrás
          sería una foto encima de otra. En las demás paradas el fondo es lo
          único que hay, y es lo que le da aire al sitio. */}
      {estacion !== 'campo' && <Fondo cambiarCon={estacion} />}

      <div className="relative mx-auto flex h-[100svh] max-w-[1480px] flex-col px-5 py-4 sm:px-8 sm:py-5 lg:py-7">
        {/* ------------------------------------------------------ encabezado */}
        <header className="flex shrink-0 items-center justify-between gap-5">
          <button onClick={() => irA('salida')} className="shrink-0" aria-label="Ir al inicio">
            <img
              src={logo}
              alt="Las Parotas, Club de Golf Huatulco"
              className="h-10 w-auto brightness-0 invert sm:h-12"
            />
          </button>

          {/* En pantalla ancha las paradas van arriba; en celular bajan al pie,
              al alcance del pulgar, porque arriba no caben sin cortarse. */}
          <div className="flex items-center gap-2 sm:gap-4">
            <nav className="hidden items-center gap-1.5 md:flex">
              <Paradas estacion={estacion} onIr={irA} />
            </nav>

            {/* Va aparte de las paradas, con su contorno, porque no es una
                parada: es la puerta de salida del sitio. Mezclarlo con las
                otras prometería que la bola viaja hasta allá, y lo que hace es
                mandar al sistema de reservas, donde entran los hoteles con
                convenio y el personal del club. */}
            <a
              href={CONTACTO.acceso}
              className="shrink-0 rounded-sm border border-arena/30 px-3.5 py-2 font-texto text-menudo font-semibold text-arena/85 transition hover:border-hoja hover:text-hoja md:px-4 md:text-[0.9rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote"
            >
              Acceder
            </a>
          </div>
        </header>

        {/* ----------------------------------------------- mapa y contenido */}
        <main className="mt-4 flex min-h-0 flex-1 flex-col gap-4 lg:mt-7 lg:flex-row lg:items-stretch lg:gap-10">
          {/* El mapa. En celular se queda con una franja; en escritorio, con
              la mitad, que es cuando de verdad se puede leer el trazo. */}
          <div className={`relative shrink-0 transition-[height] duration-500 ease-rodada lg:h-auto lg:w-[15rem] xl:w-[17rem] ${
              // Llenar un formulario en un celular necesita pantalla. El mapa
              // es contexto; la reserva es la tarea. En una pantalla ancha
              // caben los dos, pero en un celular el mapa se quita de en
              // medio: con él puesto solo cabía un jugador a la vez, y la
              // reserva es justo la pantalla donde no se puede estar
              // deslizando a ciegas.
              // En celular el mapa estorba en dos paradas. En Reservar,
              // porque el formulario necesita la pantalla. En El campo,
              // porque a ancho de pulgar el trazo se encoge tanto que los
              // números no se leen ni se atinan — y para elegir hoyo está la
              // regla de dieciocho barras del panel, que ahí sí se toca.
              estacion === 'reservar' || estacion === 'campo'
                ? 'hidden lg:block'
                : 'h-[29svh]'
            }`}>
            <Recorrido
              hoyoActivo={hoyo}
              hoyoEstaciones={HOYOS_ESTACION}
              onElegirHoyo={setHoyo}
            />
            {estacion !== 'campo' && (
              // En celular el mapa va centrado y angosto, y esta leyenda
              // pegada a la izquierda quedaba huérfana en un hueco vacío.
              <p className="pointer-events-none absolute bottom-0 left-0 hidden font-texto text-menudo text-arena/40 lg:block">
                Hoyo {hoyo} · par {parDelHoyo}
              </p>
            )}
          </div>

          {/* El panel. Tiene su propio desplazamiento para que la página nunca
              crezca: lo que se mueve es el contenido, no el sitio.
              `safe center` centra cuando el contenido cabe y lo pega arriba
              cuando no — sin él, un panel largo se corta por el encabezado. */}
          <section
            key={estacion}
            className={`panel flex min-h-0 flex-1 flex-col overflow-y-auto ${
              // El campo quiere toda la pantalla: su foto es el contenido, y
              // cuanto más grande, mejor. Las demás paradas son texto y
              // formularios, y un renglón de mil pixeles de ancho no se lee:
              // se topan para que la línea quede del largo de una lectura
              // cómoda, y se centra su contenido cuando cabe.
              estacion === 'campo'
                ? ''
                : '[justify-content:safe_center] lg:max-w-[54rem]'
            }`}
          >
            {paneles[estacion]}
          </section>
        </main>

        {/* ---------------------------------------------------------- pie */}
        <footer className="mt-3 shrink-0 border-t border-arena/12 pt-3">
          {/* Las paradas, en celular. */}
          <nav className="-mx-1 mb-3 flex items-center gap-1 overflow-x-auto md:hidden">
            <Paradas estacion={estacion} onIr={irA} />
          </nav>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-texto text-menudo text-arena/40">
              Club de Golf Huatulco · Bahías de Huatulco, Oaxaca
            </p>
            <span className="font-texto text-menudo text-arena/40">
              Español · <span className="text-arena/25">English</span>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
