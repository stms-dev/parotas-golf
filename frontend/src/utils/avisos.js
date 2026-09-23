/**
 * Avisos del sistema, sobre SweetAlert2.
 *
 * Se centralizan aquí para que todos los diálogos usen la misma paleta y el
 * mismo idioma. Ningún componente llama a Swal directamente: así, cambiar el
 * estilo o el texto de un botón se hace en un solo lugar.
 *
 * Los colores salen de DESIGN.md, no del tema por omisión de la librería:
 * verde campo para confirmar, latón para advertir.
 */
import Swal from 'sweetalert2';

const VERDE = '#16382C'; // primary-container
const LATON = '#725B38'; // secondary
const ROJO = '#8C2F2F'; // error

/** Clases compartidas: la tipografía y los bordes del resto del sistema. */
const clases = {
  popup: 'lp-popup',
  title: 'lp-titulo',
  htmlContainer: 'lp-cuerpo',
  confirmButton: 'lp-boton lp-boton-ok',
  cancelButton: 'lp-boton lp-boton-cancelar',
  denyButton: 'lp-boton lp-boton-cancelar',
  actions: 'lp-acciones',
  icon: 'lp-icono',
};

const base = {
  buttonsStyling: false,
  customClass: clases,
  reverseButtons: true,
  confirmButtonColor: VERDE,
  cancelButtonColor: LATON,
  heightAuto: false, // evita que la página brinque al abrir el diálogo
};

export function exito(titulo, texto) {
  return Swal.fire({ ...base, icon: 'success', title: titulo, html: texto, confirmButtonText: 'Entendido' });
}

export function error(titulo, texto) {
  return Swal.fire({
    ...base,
    icon: 'error',
    title: titulo,
    html: texto,
    confirmButtonText: 'Cerrar',
    confirmButtonColor: ROJO,
  });
}

export function advertencia(titulo, texto) {
  return Swal.fire({ ...base, icon: 'warning', title: titulo, html: texto, confirmButtonText: 'Entendido' });
}

/** Pregunta de sí o no. Devuelve true solo si el usuario confirmó. */
export async function confirmar({ titulo, texto, confirmar: textoOk = 'Confirmar', cancelar = 'Cancelar', icono = 'question' }) {
  const r = await Swal.fire({
    ...base,
    icon: icono,
    title: titulo,
    html: texto,
    showCancelButton: true,
    confirmButtonText: textoOk,
    cancelButtonText: cancelar,
    focusCancel: true,
  });
  return r.isConfirmed;
}

/** Aviso discreto en una esquina, para lo que no merece interrumpir. */
export function notificar(titulo, icono = 'success') {
  return Swal.fire({
    ...base,
    toast: true,
    position: 'top-end',
    icon: icono,
    title: titulo,
    showConfirmButton: false,
    timer: 3200,
    timerProgressBar: true,
  });
}

export function cargando(titulo = 'Procesando…') {
  return Swal.fire({
    ...base,
    title: titulo,
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => Swal.showLoading(),
  });
}

export const cerrar = () => Swal.close();
