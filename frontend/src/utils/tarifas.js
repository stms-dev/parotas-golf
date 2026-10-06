/**
 * Elegir la tarifa correcta según el día.
 *
 * Replica la regla del servidor (PricingService.resolve_rate): primero la
 * tarifa del día de la salida, lunes a jueves o viernes a domingo, y si no hay,
 * la que vale todos los días. Tiene que ser la misma regla: si la pantalla
 * eligiera otra, el hotel vería un total y el servidor cobraría otro.
 */

/** "2026-09-25" → 'FIN_DE_SEMANA'. El viernes ya cuenta como fin de semana. */
export function tipoDeDia(fechaISO) {
  if (!fechaISO) return 'ENTRE_SEMANA';
  const d = new Date(`${String(fechaISO).slice(0, 10)}T00:00:00`);
  // getDay(): domingo = 0 … sábado = 6. Viernes, sábado y domingo cobran más.
  const dia = d.getDay();
  return dia === 0 || dia >= 5 ? 'FIN_DE_SEMANA' : 'ENTRE_SEMANA';
}

export function tarifaDelDia(
  tarifas,
  { modalidad, hoyos, categoria = 'ADULTO', fecha, twilight = false },
) {
  // El local solo tiene precio donde el club se lo dio (18 hoyos, lun a jue);
  // donde no, paga como adulto. Igual que el servidor.
  if (categoria === 'LOCAL') {
    const local = tarifaDelDia(tarifas, { modalidad, hoyos, categoria: 'LOCAL_EXACTA', fecha, twilight });
    return local || tarifaDelDia(tarifas, { modalidad, hoyos, categoria: 'ADULTO', fecha, twilight });
  }
  const buscada = categoria === 'LOCAL_EXACTA' ? 'LOCAL' : categoria;
  const candidatas = (tarifas || []).filter(
    (r) =>
      r.modality === modalidad &&
      Number(r.holes) === Number(hoyos) &&
      r.category === buscada,
  );
  const dia = tipoDeDia(fecha);
  // Primero la franja (twilight si la salida lo es), luego el día; la misma
  // cascada que PricingService.resolve_rate.
  const franjas = twilight ? ['TWILIGHT', 'TODAS'] : ['TODAS'];
  for (const franja of franjas) {
    const enFranja = candidatas.filter((r) => (r.time_band || 'TODAS') === franja);
    const t =
      enFranja.find((r) => r.day_type === dia) ||
      enFranja.find((r) => !r.day_type || r.day_type === 'TODOS');
    if (t) return t;
  }
  return null;
}

export function esFinDeSemana(fechaISO) {
  return tipoDeDia(fechaISO) === 'FIN_DE_SEMANA';
}
