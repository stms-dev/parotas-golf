/**
 * Los avisos del sitio, sobre SweetAlert2.
 *
 * El sistema de operación ya usa esta librería con su propia paleta; aquí se
 * repite la idea pero con los colores del sitio, que es oscuro. Un diálogo
 * blanco de fábrica encima de esta página se vería como si lo hubiera abierto
 * otro programa.
 *
 * Como en el sistema, ninguna pantalla llama a Swal directamente: así cambiar
 * el tono de un botón o el texto de "Entendido" se hace en un solo lugar.
 *
 * El botón recibe su texto de quien llama. Estas funciones no son componentes
 * —se invocan desde un `catch`, desde un `finally`, desde donde haga falta— y
 * no tienen manera de leer el idioma del contexto de React. Pasárselo cuesta
 * un argumento y evita el único renglón que se quedaría en español con la
 * página en inglés. Si no se pasa, «Entendido».
 */
import Swal from 'sweetalert2';

const SOMBRA = '#0A2A21'; // el fondo del sitio
const ARENA = '#F2EBDC'; // el texto
const HOJA = '#B7D44A'; // el verde de los botones

const base = {
  background: SOMBRA,
  color: ARENA,
  confirmButtonColor: HOJA,
  // Sin esto la página brinca al abrir el diálogo, porque la librería le
  // quita la barra de desplazamiento al cuerpo.
  heightAuto: false,
  customClass: {
    popup: 'rounded-sm border border-arena/15',
    title: 'font-titulo',
    htmlContainer: 'font-texto',
    confirmButton: 'font-texto font-bold text-sombra-honda rounded-sm',
    cancelButton: 'font-texto rounded-sm',
  },
};

export function aviso(titulo, texto, boton = 'Entendido') {
  return Swal.fire({
    ...base,
    icon: 'info',
    title: titulo,
    html: texto,
    confirmButtonText: boton,
  });
}

export function problema(titulo, texto, boton = 'Entendido') {
  return Swal.fire({
    ...base,
    icon: 'warning',
    title: titulo,
    html: texto,
    confirmButtonText: boton,
  });
}

export function logrado(titulo, texto, boton = 'Entendido') {
  return Swal.fire({
    ...base,
    icon: 'success',
    title: titulo,
    html: texto,
    confirmButtonText: boton,
  });
}
