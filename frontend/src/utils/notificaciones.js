/**
 * Qué dice cada aviso de tiempo real. Lo usan igual el aviso emergente y la
 * campanita, para que lo que aparece un momento en pantalla sea lo mismo que
 * queda guardado en la lista.
 */
import { EVENTOS } from './eventos';
import { ESTADO_RESERVA } from './format';

/** Los que alguien querría notar. La disponibilidad solo refresca vistas. */
export const RELEVANTES = [
  EVENTOS.RESERVA_CREADA,
  EVENTOS.RESERVA_ACTUALIZADA,
  EVENTOS.RESERVA_CANCELADA,
  EVENTOS.CHECKIN_REGISTRADO,
  EVENTOS.TIPO_CAMBIO_ACTUALIZADO,
  EVENTOS.EVENTO_CREADO,
  EVENTOS.EVENTO_LIBERADO,
  EVENTOS.CAJA_CERRADA,
];

function etiqueta(estado) {
  return (ESTADO_RESERVA[estado]?.label || String(estado || '')).toLowerCase();
}

/**
 * Texto del aviso, o null si este perfil no debe verlo. El hotel lee el
 * estado con sus cuatro nombres; el campo, con los suyos.
 */
export function describir(mensaje, esHotel) {
  const p = mensaje.payload || {};
  // Avisos que el servidor manda solo para el hotel (su reserva quedó
  // confirmada al pagarse). El campo ya se enteró por el check-in.
  if (p.para_hotel && !esHotel) return null;

  switch (mensaje.type) {
    case EVENTOS.RESERVA_CREADA:
      return esHotel
        ? `Reserva ${p.folio} registrada · ${p.fecha || ''} ${p.hora || ''} · pendiente`
        : `Nueva reserva ${p.folio} · ${p.hotel || ''} · ${p.hora || ''}`;
    case EVENTOS.RESERVA_ACTUALIZADA: {
      const estado = esHotel ? p.estado_hotel || p.estado : p.estado;
      if (esHotel && estado === 'CONFIRMADA') {
        return `${p.folio} confirmada · ${p.titular || ''} ya pagó en el campo`;
      }
      return `${p.folio} ahora está ${etiqueta(estado)}`;
    }
    case EVENTOS.RESERVA_CANCELADA:
      return `${p.folio} fue cancelada · cupo liberado`;
    case EVENTOS.CHECKIN_REGISTRADO:
      return p.estado === 'EN_JUEGO'
        ? `${p.folio} pagada · ${p.jugadores_presentes}/${p.jugadores_total} jugadores · en juego`
        : `${p.folio} en mostrador · ${p.jugadores_presentes}/${p.jugadores_total} jugadores`;
    case EVENTOS.CAJA_CERRADA:
      return `Cierre de caja por ${p.responsable} · diferencia $${p.diferencia}`;
    case EVENTOS.TIPO_CAMBIO_ACTUALIZADO:
      return `Tipo de cambio: ${p.anterior || '—'} → ${p.nuevo}`;
    case EVENTOS.EVENTO_CREADO:
      return `${p.nombre} bloquea ${p.franjas_bloqueadas} horarios el ${p.fecha}`;
    case EVENTOS.EVENTO_LIBERADO:
      return `${p.nombre} liberado · ${p.franjas_liberadas} horarios disponibles`;
    default:
      return null;
  }
}
