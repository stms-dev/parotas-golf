/**
 * Logotipo del club.
 *
 * Se centraliza aquí para que un cambio de imagen se haga en un solo archivo
 * y no haya que perseguirlo por las pantallas. Los archivos se importan en vez
 * de referenciarse por ruta para que Vite los empaquete con huella: si mañana
 * se reemplaza el logo, el navegador no sirve el viejo desde su caché.
 */
import logo from '../assets/logo-las-parotas.png';
import arbol from '../assets/logo-parota-arbol.png';

export const NOMBRE_CLUB = 'Las Parotas';
export const SUBTITULO_CLUB = 'Club de Golf · Huatulco';

/**
 * @param {number} alto  Altura en píxeles; el ancho se ajusta solo.
 * @param {boolean} soloArbol  Usa la copa del árbol sin el texto, para
 *   espacios estrechos como el menú plegado, donde el nombre no se leería.
 *   Es un archivo aparte y no un recorte por CSS: recortar una imagen ancha
 *   dentro de un cuadro le come los costados al árbol.
 */
export default function Logo({ alto = 44, soloArbol = false, className = '' }) {
  const src = soloArbol ? arbol : logo;
  return (
    <img
      src={src}
      alt={soloArbol ? '' : `${NOMBRE_CLUB} · ${SUBTITULO_CLUB}`}
      aria-hidden={soloArbol || undefined}
      style={{ height: alto }}
      className={`w-auto ${className}`}
    />
  );
}
