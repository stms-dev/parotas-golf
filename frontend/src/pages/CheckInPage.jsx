/**
 * Recepción & Check-In.
 *
 * Es la única pantalla donde se valida el PGA. El identificador se captura en
 * Nueva Reserva, así que aquí ya viene puesto: el mostrador no lo escribe, solo
 * ve la credencial física y decide si es válida o no. El beneficio cae
 * exclusivamente sobre la tarifa del portador; no es un código promocional ni
 * se extiende a su grupo.
 *
 * De arriba hacia abajo:
 *   1. Caja en vivo y estado de las salidas del día.
 *   2. Búsqueda por folio o pase QR (un pase por partida, no por jugador).
 *   3. Flujo de atención de la salida seleccionada.
 *   4. Detalle de la partida y servicios · liquidación y cobro multimoneda.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { bookingApi, catalogApi, checkinApi, dashboardApi, treasuryApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { EVENTOS, useRealtimeEvent } from '../context/RealtimeContext';
import { Alert, Spinner } from '../components/ui';
import Icono from '../components/Icono';
import { Recibo, ReciboReplay, Responsiva } from '../components/Documentos';
import { confirmar, error as avisoError, exito } from '../utils/avisos';
import { esFinDeSemana } from '../utils/tarifas';
import { METODO_PAGO, categoria, TASA_IVA, desgloseIva, hora, hoy, mxn, usd } from '../utils/format';

/**
 * Los cuatro momentos de una partida en el mostrador:
 *   1. Llegó el folio o el pase QR del hotel.
 *   2. Está en el mostrador, falta cobrarle.
 *   3. Ya pagó: queda en juego (el hotel la ve confirmada).
 *   4. Salida del campo: se finaliza, o se cobra un replay y luego se finaliza.
 */
const PASOS = ['Reserva del hotel', 'En mostrador', 'En juego', 'Salida del campo'];

/** Lo que no se agrega en el mostrador como servicio adicional. */
const NO_SON_SERVICIOS = ['REPLAY', 'ACOMPANANTE'];

/** El precio de hoy: la zona de práctica cuesta más de viernes a domingo. */
const precioDeHoy = (servicio) =>
  Number(esFinDeSemana(hoy()) && servicio.weekend_price ? servicio.weekend_price : servicio.price);

/** Los tres métodos, en el orden en que se usan en el mostrador. */
const METODOS = [
  { valor: 'EFECTIVO', icono: 'cajaFuerte', destino: 'Caja mostrador' },
  { valor: 'TARJETA', icono: 'pago', destino: 'Terminal TPV' },
  { valor: 'TRANSFERENCIA', icono: 'enviar', destino: 'Depósito bancario' },
];

const MONTOS_VACIOS = {
  EFECTIVO: { MXN: '', USD: '' },
  TARJETA: { MXN: '', USD: '' },
  TRANSFERENCIA: { MXN: '', USD: '' },
};

/**
 * En qué punto del flujo está la partida. Pagada completa pasa sola a "en
 * juego"; finalizada, los cuatro pasos quedan hechos.
 */
function pasoActual(status) {
  if (status === 'PENDIENTE' || status === 'CONFIRMADA') return 1;
  if (status === 'CHECK_IN') return 2;
  if (status === 'EN_JUEGO') return 3;
  if (status === 'COMPLETADA') return 5;
  return 1;
}

/**
 * Cuánto baja el beneficio PGA sobre una tarifa. El porcentaje lo fija la
 * Administración en Precios & Tarifas; aquí solo se traduce a pesos para poder
 * ver el total antes de cobrar.
 */
function descuentoPga(config, tarifaBase) {
  if (!config) return 0;
  const base = Number(tarifaBase) || 0;
  const valor = Number(config.value) || 0;
  const bruto = config.discount_type === 'PORCENTAJE' ? (base * valor) / 100 : valor;
  return Number(Math.min(bruto, base).toFixed(2));
}

/**
 * Agrupa a los jugadores conservando el orden: quien trae credencial ocupa una
 * tarjeta completa porque necesita los controles de validación, y los demás se
 * acomodan de dos en dos. Así la lista no crece de más cuando salen cuatro.
 */
function bloquesDeJugadores(players) {
  const bloques = [];
  players.forEach((player) => {
    if (player.pga_code) {
      bloques.push({ tipo: 'pga', players: [player] });
      return;
    }
    const ultimo = bloques[bloques.length - 1];
    if (ultimo?.tipo === 'simple') ultimo.players.push(player);
    else bloques.push({ tipo: 'simple', players: [player] });
  });
  return bloques;
}

export default function CheckInPage() {
  const { can } = useAuth();
  const [termino, setTerm] = useState('');
  const [reservation, setReservation] = useState(null);
  const [account, setAccount] = useState(null);
  const [services, setServices] = useState([]);
  /** Cuánto descuenta el PGA; lo fija la Administración. */
  const [pgaConfig, setPgaConfig] = useState(null);
  const [rate, setRate] = useState(null);
  const [cash, setCash] = useState(null);
  const [panel, setPanel] = useState(null);

  /** Quién está atendiendo, por su nombre: la cuenta la comparten los turnos. */
  const [atiende, setAtiende] = useState(() => {
    try {
      return localStorage.getItem('ultimo_atendio') || '';
    } catch {
      return '';
    }
  });

  const [arrivals, setArrivals] = useState({});
  /** Por jugador: { decision: 'valida' | 'invalida' | null }. */
  const [pga, setPga] = useState({});
  const [addedServices, setAddedServices] = useState([]);
  const [modalidad, setModalidad] = useState('unico');
  const [moneda, setMoneda] = useState('MXN');
  /** En pago único, el método que quedó elegido. */
  const [metodo, setMetodo] = useState('EFECTIVO');
  /** Monto por método y moneda: un mismo método puede recibir las dos. */
  const [montos, setMontos] = useState(MONTOS_VACIOS);
  const [referencia, setReferencia] = useState('');
  /** Qué documento está abierto: 'responsiva' | 'recibo' | { replay } | null. */
  const [documento, setDocumento] = useState(null);
  /** Replay en captura. Es por partida: solo importa si se está cobrando. */
  const [replay, setReplay] = useState(false);
  /** Llegada de cada acompañante, igual que la de los jugadores. */
  const [llegadasAcomp, setLlegadasAcomp] = useState({});
  /** Horarios libres para el replay (null = aún no se consultan) y el elegido. */
  const [salidasReplay, setSalidasReplay] = useState(null);
  const [salidaReplay, setSalidaReplay] = useState(null);

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  function refrescarEncabezado() {
    catalogApi.exchangeRate().then(setRate).catch(() => {});
    treasuryApi.currentCash().then(setCash).catch(() => {});
    dashboardApi.get({ target: hoy() }).then(setPanel).catch(() => {});
  }

  useEffect(() => {
    catalogApi.services().then(setServices).catch(() => {});
    catalogApi.pgaConfig().then(setPgaConfig).catch(() => setPgaConfig(null));
    refrescarEncabezado();
  }, []);

  useRealtimeEvent(
    [EVENTOS.PAGO_REGISTRADO, EVENTOS.CHECKIN_REGISTRADO, EVENTOS.RESERVA_ACTUALIZADA],
    () => refrescarEncabezado(),
  );

  // Escanearon el pase con el celular: la partida se abre sola en esta
  // pantalla, sin que nadie teclee el folio.
  useRealtimeEvent([EVENTOS.PASE_ESCANEADO], (mensaje) => {
    const reservationId = mensaje.payload?.reservation_id;
    if (reservationId) buscar(null, { reservation_id: reservationId });
  });

  // Desde el detalle de una reserva se llega con ?folio=: se abre sola.
  useEffect(() => {
    const folio = new URLSearchParams(window.location.search).get('folio');
    if (folio) {
      setTerm(folio);
      buscar(null, folio);
    }
  }, []);

  async function buscar(event, valor) {
    event?.preventDefault();
    // El escaneo desde el celular manda la búsqueda ya armada; el mostrador
    // manda lo que se tecleó y aquí se adivina si es folio o pase.
    const consulta =
      typeof valor === 'object' && valor !== null
        ? valor
        : (() => {
            const term = (valor ?? termino).trim();
            if (!term) return null;
            // Un token de QR es largo y sin espacios; un folio no.
            const esQr = term.length > 20 && !term.includes(' ');
            return esQr ? { qr_token: term } : { folio: term };
          })();
    if (!consulta) return;

    setLoading(true);
    setError(null);

    try {
      const summary = await checkinApi.lookup(consulta);
      const full = await bookingApi.getByFolio(summary.folio);

      setAccount(summary);
      setReservation(full);
      // Lo normal es que llegue la partida completa, así que todos entran
      // marcados y el mostrador solo desmarca al que faltó. Pero si la partida
      // ya pasó por el mostrador, manda lo que quedó registrado: volver a
      // marcar al ausente reviviría su green fee y pediría un cobro que ya no
      // existe, con riesgo de cobrarle dos veces al huésped.
      const yaAtendida = Boolean(full.checked_in_at);
      setArrivals(
        Object.fromEntries(full.players.map((p) => [p.id, yaAtendida ? p.arrived : true])),
      );
      setLlegadasAcomp(
        Object.fromEntries(full.companions.map((c) => [c.id, yaAtendida ? c.arrived : true])),
      );
      setAddedServices([]);
      setModalidad('unico');
      setMoneda('MXN');
      setMetodo('EFECTIVO');
      setMontos(MONTOS_VACIOS);
      setReferencia('');
      setReplay(false);

      // La credencial se revisa a mano, fuera del sistema. Aquí solo se
      // guarda si el mostrador la aceptó o no; no se consulta ningún padrón.
      setPga(
        Object.fromEntries(
          full.players.map((p) => [p.id, { decision: p.pga_validated ? 'valida' : null }]),
        ),
      );
    } catch (err) {
      setError(err.message);
      setReservation(null);
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }

  async function cobrar() {
    if (enReplay) {
      await cobrarReplay();
      return;
    }
    // Pagada en línea y sin nada extra: solo se registra la llegada.
    const soloLlegada = esperaLlegada;
    if (soloLlegada && !Object.values(arrivals).some(Boolean)) {
      await avisoError('Marque quién llegó', 'Toque el recuadro de al menos una persona.');
      return;
    }
    // El servidor lo vuelve a validar, pero conviene atajarlo aquí con un
    // mensaje claro en vez de un 409.
    if (!soloLlegada && !(await cobroEnRegla('el saldo'))) return;

    const ok = await confirmar(
      soloLlegada
        ? {
            titulo: 'Registrar llegada',
            texto:
              `La reserva <b>#${reservation.folio}</b> ya está pagada (${mxn(yaPagado)}).` +
              `<br>Se registrará su llegada y ${
                esPractica ? 'pasarán a la zona de práctica' : 'la partida quedará en juego'
              }.`,
            confirmar: 'Sí, registrar llegada',
            icono: 'question',
          }
        : {
            titulo: 'Confirmar llegada y cobro',
            texto:
              `Se registrará la llegada de la partida <b>#${reservation.folio}</b> y un cobro de ` +
              `<b>${mxn(porCobrar)}</b>.` +
              (cambio > 0
                ? `<br>Recibido: <b>${mxn(totalCapturado)}</b> · <b>Cambio a entregar: ${mxn(cambio)}</b>`
                : '') +
              '<br><span style="font-size:0.9em;opacity:.75">' +
              'Los cobros quedan en el turno de caja y no se pueden borrar.</span>',
            confirmar: 'Sí, registrar cobro',
            icono: 'question',
          },
    );
    if (!ok) return;

    setSaving(true);
    setError(null);
    try {
      try {
        localStorage.setItem('ultimo_atendio', atiende.trim());
      } catch {
        /* Modo privado o almacenamiento bloqueado: no es grave. */
      }
      const response = await checkinApi.perform(reservation.id, {
        attended_by_name: atiende.trim(),
        arrivals: Object.entries(arrivals).map(([id, arrived]) => ({
          player_id: Number(id),
          arrived,
        })),
        companion_arrivals: Object.entries(llegadasAcomp).map(([id, arrived]) => ({
          companion_id: Number(id),
          arrived,
        })),
        // Solo se mandan los jugadores que traen credencial y sobre los que el
        // mostrador ya tomó una decisión. apply_benefit es esa decisión.
        pga_validations: reservation.players
          .filter((p) => p.pga_code && pga[p.id]?.decision)
          .map((p) => ({
            player_id: p.id,
            pga_code: p.pga_code,
            credential_number: p.credential_number || null,
            apply_benefit: pga[p.id].decision === 'valida',
          })),
        services: addedServices,
        payments: (soloLlegada ? [] : lineasDePago).map((p) => ({
          currency: p.currency,
          amount: p.amount,
          method: p.method,
          reference: p.reference || null,
        })),
        allow_partial_payment: false,
      });
      refrescarEncabezado();

      // La partida se queda en pantalla. Antes el cobro la sacaba y había que
      // volver a teclear el folio solo para imprimir el recibo, que es
      // justamente lo que sigue.
      const actualizada = await bookingApi.getByFolio(reservation.folio).catch(() => null);
      if (actualizada) setReservation(actualizada);
      const cuenta = await checkinApi
        .lookup({ folio: reservation.folio })
        .catch(() => null);
      if (cuenta) setAccount(cuenta);

      // Los montos capturados se limpian: ya se cobraron y dejarlos ahí
      // invita a cobrar dos veces.
      setMontos(MONTOS_VACIOS);
      setReferencia('');

      await exito(
        soloLlegada
          ? 'Llegada registrada'
          : response.status === 'EN_JUEGO'
            ? esPractica
              ? 'Pagado · en práctica'
              : 'Pagado · partida en juego'
            : 'Cobro registrado',
        soloLlegada
          ? response.message
          : `Partida <b>#${reservation.folio}</b> · total <b>${mxn(response.total)}</b>.<br>` +
              (Number(response.change_mxn) > 0
                ? `<b>Entregue de cambio ${mxn(response.change_mxn)}</b>.<br>`
                : '') +
              'Ya puede imprimir el recibo. La cuenta quedó cerrada.',
      );
    } catch (err) {
      setError(err.message);
      await avisoError('No se registró el cobro', err.message);
    } finally {
      setSaving(false);
    }
  }

  async function recargar() {
    const actualizada = await bookingApi.getByFolio(reservation.folio).catch(() => null);
    if (actualizada) setReservation(actualizada);
    const cuenta = await checkinApi.lookup({ folio: reservation.folio }).catch(() => null);
    if (cuenta) setAccount(cuenta);
    refrescarEncabezado();
  }

  /** Salida del campo, camino 1: la partida terminó y se cierra. */
  async function finalizar() {
    const ok = await confirmar({
      titulo: 'Finalizar la partida',
      texto:
        `La partida <b>#${reservation.folio}</b> quedará como <b>finalizada</b>.<br>` +
        '<span style="font-size:0.9em;opacity:.75">Después ya no se le puede cobrar un replay.</span>',
      confirmar: 'Sí, finalizar',
      icono: 'question',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await bookingApi.complete(reservation.id);
      await recargar();
      setReplay(false);
      await exito('Partida finalizada', `<b>#${reservation.folio}</b> salió del campo.`);
    } catch (err) {
      await avisoError('No se pudo finalizar', err.message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Reglas del cobro: nunca puede faltar dinero; con tarjeta o transferencia
   * se cobra exacto; en efectivo se puede entregar de más y se da cambio.
   */
  async function cobroEnRegla(concepto) {
    // Sin el nombre de quien atiende no se cobra: con cuentas compartidas es
    // el único dato que dice quién lo hizo, y después ya no se puede saber.
    if (atiende.trim().length < 3) {
      await avisoError(
        'Falta quién atiende',
        'Escriba arriba su nombre completo. Queda registrado en el cobro.',
      );
      return false;
    }
    if (faltante > 0) {
      await avisoError(
        'Cobro incompleto',
        `Faltan <b>${mxn(faltante)}</b> para cubrir ${concepto} de <b>${mxn(porCobrar)}</b>.`,
      );
      return false;
    }
    if (excedeSinEfectivo) {
      await avisoError(
        'Tarjeta y transferencia se cobran exacto',
        `Con tarjeta o transferencia no se puede cobrar de más: ${concepto} es de ` +
          `<b>${mxn(porCobrar)}</b>. Solo en efectivo se da cambio.`,
      );
      return false;
    }
    return true;
  }

  /** Salida del campo, camino 2: repiten y se cobra solo lo extra. */
  async function abrirReplay() {
    setMontos(MONTOS_VACIOS);
    setReferencia('');
    setModalidad('unico');
    setMoneda('MXN');
    setMetodo('EFECTIVO');
    setSalidaReplay(null);
    setSalidasReplay(null);
    setReplay(true);
    // Solo se ofrecen horarios libres de hoy, después de la partida. Si ya
    // no queda ninguno, el replay no se puede jugar.
    try {
      const libres = await checkinApi.replaySlots(reservation.id);
      setSalidasReplay(libres);
      if (libres.length > 0) setSalidaReplay(libres[0].id);
    } catch (err) {
      setSalidasReplay([]);
      await avisoError('No se pudieron leer los horarios', err.message);
    }
  }

  async function cobrarReplay() {
    if (!salidaReplay) {
      await avisoError('Elija el horario', 'El replay necesita un horario libre para jugarse.');
      return;
    }
    if (!(await cobroEnRegla('el replay'))) return;
    const horaReplay = salidasReplay?.find((s) => s.id === salidaReplay)?.slot_time;
    const ok = await confirmar({
      titulo: 'Cobrar replay',
      texto:
        `Se abrirá un segundo ticket del folio <b>#${reservation.folio}</b> por el replay ` +
        `de la partida · <b>${mxn(porCobrar)}</b>, saliendo a las <b>${horaReplay}</b>.` +
        (cambio > 0
          ? `<br>Recibido: <b>${mxn(totalCapturado)}</b> · <b>Cambio a entregar: ${mxn(cambio)}</b>`
          : '') +
        '<br><span style="font-size:0.9em;opacity:.75">El ticket original no cambia.</span>',
      confirmar: 'Sí, cobrar replay',
      icono: 'question',
    });
    if (!ok) return;
    setSaving(true);
    try {
      const ticket = await checkinApi.replay(reservation.id, {
        tee_slot_id: salidaReplay,
        attended_by_name: atiende.trim(),
        payments: (soloLlegada ? [] : lineasDePago).map((p) => ({
          currency: p.currency,
          amount: p.amount,
          method: p.method,
          reference: p.reference || null,
        })),
      });
      await recargar();
      setReplay(false);
      setMontos(MONTOS_VACIOS);
      setReferencia('');
      const cambioReplay = (ticket.payments || []).reduce((t, p) => t + Number(p.change_mxn || 0), 0);
      await exito(
        'Replay cobrado',
        `Segundo ticket del folio <b>#${reservation.folio}</b> · <b>${mxn(ticket.total)}</b> · ` +
          `salida ${String(ticket.slot_time || '').slice(0, 5)}.<br>` +
          (cambioReplay > 0 ? `<b>Entregue de cambio ${mxn(cambioReplay)}</b>.<br>` : '') +
          'Ya puede imprimirlo. Cuando terminen, finalice la partida.',
      );
    } catch (err) {
      await avisoError('No se cobró el replay', err.message);
    } finally {
      setSaving(false);
    }
  }

  const tasa = Number(rate?.rate || 0);

  /** Lo capturado en las cajas, aplanado a líneas de cobro. */
  const lineasDePago = METODOS.flatMap(({ valor }) =>
    ['MXN', 'USD']
      .filter((divisa) => Number(montos[valor][divisa]) > 0)
      .map((divisa) => ({
        method: valor,
        currency: divisa,
        amount: montos[valor][divisa],
        reference: valor === 'TRANSFERENCIA' ? referencia : '',
      })),
  );

  const totalCapturado = lineasDePago.reduce(
    (suma, p) => suma + Number(p.amount) * (p.currency === 'USD' ? tasa : 1),
    0,
  );

  const serviciosExtra = addedServices.reduce((suma, item) => {
    const servicio = services.find((s) => s.id === item.service_id);
    return suma + (servicio ? precioDeHoy(servicio) * item.quantity : 0);
  }, 0);

  /**
   * La cuenta se arma aquí con la misma fórmula que usa el servidor, en vez de
   * corregir el saldo que llegó. Así el ticket responde en vivo a lo que el
   * mostrador va marcando: quien no llegó no se cobra, y el beneficio PGA
   * entra o sale en cuanto se toca el sí o el no.
   */
  const jugadores = reservation?.players || [];
  const presentes = jugadores.filter((p) => arrivals[p.id]);
  const ausentes = jugadores.filter((p) => !arrivals[p.id]);

  const lineasPga = presentes
    .filter((p) => p.pga_code)
    .map((p) => {
      const estado = pga[p.id] || {};
      const descuento =
        estado.decision === 'valida' ? descuentoPga(pgaConfig, p.rate_applied) : 0;
      return { player: p, estado, descuento };
    });

  const greenFeesBruto = Number(
    presentes.reduce((suma, p) => suma + Number(p.rate_applied || 0), 0).toFixed(2),
  );
  const descuentoPgaVigente = Number(
    lineasPga.reduce((suma, l) => suma + l.descuento, 0).toFixed(2),
  );
  const serviciosReserva = Number(reservation?.subtotal_services || 0);
  // Los acompañantes vienen cobrados desde el hotel ($800 cada uno). Van con
  // los jugadores en el ticket, no como servicio.
  const lineasAcompanante = (reservation?.services || []).filter(
    (s) => s.service_code === 'ACOMPANANTE',
  );
  const acompanantes = reservation?.companions || [];
  const acompPresentes = acompanantes.filter((c) => llegadasAcomp[c.id]);
  const acompAusentes = acompanantes.filter((c) => !llegadasAcomp[c.id]);
  const precioAcompanante = Number(lineasAcompanante[0]?.unit_price_applied || 0);
  // Lo que el servidor tiene cargado hoy por acompañantes, y lo que se cobra
  // con las llegadas que va marcando el mostrador.
  const acompGuardado = lineasAcompanante.reduce((suma, s) => suma + Number(s.total), 0);
  const totalAcompanantes = Number((precioAcompanante * acompPresentes.length).toFixed(2));
  const serviciosDelHotel = (reservation?.services || []).filter(
    (s) => s.service_code !== 'ACOMPANANTE',
  );
  const convenio = Number(reservation?.discount_amount || 0);

  const totalPrevisto = Number(
    (
      greenFeesBruto +
      (serviciosReserva - acompGuardado) +
      totalAcompanantes +
      serviciosExtra -
      convenio -
      descuentoPgaVigente
    ).toFixed(2),
  );
  const yaPagado = Number(reservation?.total_paid || 0);

  /** Ya pagada: en juego o finalizada. Desde aquí nada se puede modificar. */
  const bloqueada = ['EN_JUEGO', 'COMPLETADA'].includes(reservation?.status);
  const servicioReplay = services.find((s) => s.code === 'REPLAY');
  const precioReplay = Number(servicioReplay?.price || 0);
  const enReplay = replay && reservation?.status === 'EN_JUEGO';
  const replays = reservation?.replays || [];

  const porCobrar = enReplay
    ? Number(precioReplay.toFixed(2))
    : Number(Math.max(totalPrevisto - yaPagado, 0).toFixed(2));

  const diferencia = Number((totalCapturado - porCobrar).toFixed(2));
  // Lo que no es efectivo tiene que caber en el saldo; el efectivo puede
  // pasarse y la diferencia es el cambio.
  const capturadoSinEfectivo = lineasDePago
    .filter((p) => p.method !== 'EFECTIVO')
    .reduce((suma, p) => suma + Number(p.amount) * (p.currency === 'USD' ? tasa : 1), 0);
  const excedeSinEfectivo = Number(capturadoSinEfectivo.toFixed(2)) > porCobrar;
  const faltante = diferencia < 0 ? Math.abs(diferencia) : 0;
  const cambio = diferencia > 0 && !excedeSinEfectivo ? diferencia : 0;
  const cobroExacto = diferencia === 0;
  const cobroValido = porCobrar > 0 && faltante === 0 && !excedeSinEfectivo;
  /** Ya no hay nada que cobrar: la partida quedó saldada. */
  const saldada = bloqueada || (porCobrar === 0 && yaPagado > 0);
  const mostrarCobro = enReplay || !saldada;
  /** Zona de práctica: no hay hoyos, ni replay, ni PGA. */
  const esPractica = reservation?.modality === 'PRACTICA';
  /**
   * Pagada antes de llegar (en línea): ya no se cobra nada, pero falta que el
   * huésped se presente. El mostrador solo registra su llegada y entonces sí
   * queda en juego.
   */
  const esperaLlegada =
    saldada && ['PENDIENTE', 'CONFIRMADA', 'CHECK_IN'].includes(reservation?.status);

  function marcarLlegada(playerId) {
    if (bloqueada) return;
    setArrivals((actual) => ({ ...actual, [playerId]: !actual[playerId] }));
  }

  function marcarAcompanante(id) {
    if (bloqueada) return;
    setLlegadasAcomp((actual) => ({ ...actual, [id]: !actual[id] }));
  }

  function decidirPga(playerId, decision) {
    if (bloqueada) return;
    setPga((actual) => ({
      ...actual,
      [playerId]: {
        ...actual[playerId],
        decision: actual[playerId]?.decision === decision ? null : decision,
      },
    }));
  }

  return (
    <div className="space-y-6">
      {/* ----------------------------------------- 1. Caja viva y salidas del día */}
      <section className="grid gap-gutter xl:grid-cols-12">
        <div className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card xl:col-span-7">
          <p className="mb-3 flex items-center gap-2 text-label-md uppercase tracking-wider text-primary">
            <span className="h-2 w-2 rounded-full bg-estado-ok-text" /> Caja en vivo
          </p>
          <div className="flex flex-wrap gap-2">
            <Pastilla t="Efectivo MXN" v={mxn(cash?.cash_mxn ?? 0)} />
            <Pastilla t="Efectivo USD" v={usd(cash?.usd_cash_original ?? 0)} />
            <Pastilla t="Tarjeta MXN" v={mxn(cash?.card_mxn ?? 0)} />
            <Pastilla t="Transferencias" v={mxn(cash?.transfer_mxn ?? 0)} />
            <Pastilla t="Tipo de cambio" v={`1 USD = $${tasa.toFixed(2)} MXN`} />
            <Pastilla t="Total cobrado" v={mxn(cash?.total_mxn ?? 0)} acento />
          </div>
          {!cash?.session_id && (
            <p className="mt-3 text-body-md text-outline">
              No hay turno de caja abierto. Ábralo desde Liquidaciones antes de cobrar.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card xl:col-span-5">
          <p className="mb-3 flex items-center gap-2 text-label-md uppercase tracking-wider text-primary">
            <Icono nombre="golf" size={16} className="text-secondary" />
            Salidas del día ({panel?.slots_total ?? 0} horarios)
          </p>
          <div className="flex flex-wrap gap-2">
            <Pastilla t="Reservados" v={`${panel?.slots_occupied ?? 0}/${panel?.slots_total ?? 0}`} />
            <Pastilla t="Por llegar" v={`${(panel?.pending ?? 0) + (panel?.confirmed ?? 0)}`} />
            <Pastilla t="En mostrador" v={`${panel?.checked_in ?? 0}`} />
            <Pastilla t="Finalizadas" v={`${panel?.completed ?? 0}`} />
            <Pastilla t="Disponibles" v={`${panel?.slots_available ?? 0}/${panel?.slots_total ?? 0}`} />
            <Pastilla t="En juego" v={`${panel?.in_progress ?? 0} partidas`} acento />
          </div>
        </div>
      </section>

      {/* Quién está en el mostrador. Va antes de buscar el folio: su nombre se
          graba en el check-in y en el replay, y la cuenta de recepción la usan
          los tres turnos, así que es lo único que dice quién atendió. */}
      <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-4 shadow-card">
        <label className="flex flex-wrap items-center gap-3">
          <span className="shrink-0 text-title-md text-primary">¿Quién atiende?</span>
          <input
            value={atiende}
            onChange={(e) => setAtiende(e.target.value)}
            placeholder="Nombre de quien está en el mostrador"
            className="min-w-[260px] flex-1 rounded border border-outline-variant bg-surface-container-low px-3 py-2.5 text-body-lg text-on-surface placeholder:text-outline focus:border-primary-container focus:bg-surface-container-lowest focus:outline-none"
          />
          <span className="text-body-md text-outline">
            {atiende.trim().length >= 3
              ? 'Queda registrado en cada cobro de este turno.'
              : 'Hace falta para poder cobrar.'}
          </span>
        </label>
      </section>

      {/* -------------------------------------------------------- 2. Búsqueda */}
      <form
        onSubmit={buscar}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-4 shadow-card"
      >
        <label className="relative flex min-w-[320px] flex-1 items-center">
          <Icono nombre="buscar" size={18} className="pointer-events-none absolute left-3.5 text-outline" />
          <input
            value={termino}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Folio (LP-8921) o token del pase QR"
            autoFocus
            className="w-full rounded border border-outline-variant bg-surface-container-low py-2.5 pl-10 pr-10 text-body-lg text-on-surface placeholder:text-outline focus:border-primary-container focus:bg-surface-container-lowest focus:outline-none"
          />
          {termino && (
            <button
              type="button"
              onClick={() => setTerm('')}
              className="absolute right-3 text-outline transition hover:text-on-surface"
              aria-label="Limpiar"
            >
              <Icono nombre="cancelar" size={17} />
            </button>
          )}
        </label>

        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-title-md text-on-surface transition hover:bg-surface-container-low disabled:opacity-60"
        >
          <Icono nombre="qr_code_2" size={17} className="text-secondary" />
          {loading ? 'Buscando…' : 'Escanear pase QR'}
        </button>

        {/* No todo el que llega viene de un hotel: el que se aparece por su
            cuenta se registra aquí mismo, sin salir del mostrador. */}
        {can('screen:new_reservation') && (
          <Link
            to="/reservas/nueva?directo=1"
            className="flex items-center gap-2 rounded bg-primary-container px-4 py-2.5 text-title-md text-on-primary shadow-card transition hover:bg-primary"
          >
            <Icono nombre="add" size={17} className="text-secondary-fixed" />
            Reservar en mostrador
          </Link>
        )}
      </form>

      {error && (
        <Alert tone="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && <Spinner />}

      {reservation && (
        <>
          {/* ------------------------------------------ 3. Flujo de atención */}
          <section className="flex flex-wrap items-center gap-4 rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-5 py-4 shadow-card">
            <p className="text-label-md uppercase tracking-wider text-secondary">
              Flujo de atención de salida
            </p>
            <span className="text-body-md text-outline">
              {esPractica
                ? `Zona de práctica · llegada ${hora(reservation.slot_time)}`
                : `${reservation.tee} · partida ${hora(reservation.slot_time)} · ${reservation.holes} hoyos`}
              {/* Quién la levantó del otro lado: si algo no cuadra, es a esa
                  persona a la que hay que hablarle, no al hotel en abstracto. */}
              {reservation.booked_by_name && (
                <> · la levantó {reservation.booked_by_name}</>
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
              {PASOS.map((texto, i) => {
                const n = i + 1;
                const actual = pasoActual(reservation.status);
                const hecho = n < actual;
                const activo = n === actual;
                return (
                  <span
                    key={texto}
                    className={`flex items-center gap-2 whitespace-nowrap rounded px-3 py-1.5 text-title-md ${
                      activo
                        ? 'bg-primary-container text-on-primary'
                        : hecho
                          ? 'text-estado-ok-text'
                          : 'text-outline'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-label-sm ${
                        activo
                          ? 'bg-secondary-fixed text-primary'
                          : hecho
                            ? 'bg-estado-ok-bg text-estado-ok-text'
                            : 'bg-surface-container-high text-outline'
                      }`}
                    >
                      {hecho ? '✓' : n}
                    </span>
                    {n === 4 && reservation.status === 'COMPLETADA'
                      ? 'Finalizado'
                      : n === 1 && esperaLlegada
                        ? 'Pagado · en espera de llegada'
                        : n === 3 && esPractica
                          ? 'En práctica'
                          : texto}
                  </span>
                );
              })}
            </div>
          </section>

          <div className="grid gap-gutter xl:grid-cols-12">
            {/* ------------------------------------------ columna izquierda */}
            <div className="space-y-gutter xl:col-span-7">
              {/* Documentos que se entregan en mano. El recibo solo tiene
                  sentido una vez que hay cobro registrado. */}
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => setDocumento('responsiva')}
                  className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-4 py-2 text-title-md text-on-surface shadow-card transition hover:bg-surface-container-low"
                >
                  <Icono nombre="historial" size={17} className="text-secondary" /> Responsiva
                </button>
                <button
                  type="button"
                  onClick={() => setDocumento('recibo')}
                  disabled={Number(reservation.total_paid || 0) <= 0}
                  title={
                    Number(reservation.total_paid || 0) > 0
                      ? 'Imprimir el recibo del cobro'
                      : 'Disponible en cuanto se registre el cobro'
                  }
                  className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-4 py-2 text-title-md text-on-surface shadow-card transition hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icono nombre="pago" size={17} className="text-secondary" /> Recibo
                </button>
                {/* El recibo por correo no lleva botón: sale solo en cuanto
                    la cuenta queda pagada. */}

                {/* Cada replay es otro ticket del mismo folio. */}
                {replays.map((t, i) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setDocumento({ replay: t, numero: i + 1 })}
                    className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-4 py-2 text-title-md text-on-surface shadow-card transition hover:bg-surface-container-low"
                  >
                    <Icono nombre="refrescar" size={17} className="text-secondary" />
                    Ticket replay{replays.length > 1 ? ` ${i + 1}` : ''}
                  </button>
                ))}
                {reservation.status === 'COMPLETADA' && (
                  <span className="ml-auto flex items-center gap-2 rounded border border-outline-variant bg-surface-container-high px-4 py-2 text-title-md text-on-surface-variant">
                    <Icono nombre="check" size={17} />
                    Finalizado
                  </span>
                )}
              </div>

              {/* ------------------------------------- salida del campo */}
              {reservation.status === 'EN_JUEGO' && (
                <section className="rounded-lg border border-primary-container/40 bg-surface-container-lowest p-5 shadow-card">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-label-md uppercase tracking-wider text-primary">
                        <Icono nombre="golf" size={17} className="text-secondary" />
                        Salida del campo
                      </p>
                      <p className="text-body-md text-outline">
                        {esPractica
                          ? 'En la zona de práctica. Al terminar, finalice la visita.'
                          : 'Partida en juego. Al volver: se finaliza, o repiten y se cobra el replay.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2.5">
                      {!esPractica && (
                      <button
                        type="button"
                        onClick={enReplay ? () => setReplay(false) : abrirReplay}
                        disabled={saving || !servicioReplay}
                        className={`flex items-center gap-2 rounded border px-4 py-2.5 text-title-md shadow-card transition disabled:opacity-60 ${
                          enReplay
                            ? 'border-primary-container bg-primary-fixed/30 text-primary'
                            : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low'
                        }`}
                      >
                        <Icono nombre="refrescar" size={17} className="text-secondary" />
                        {enReplay ? 'Cancelar replay' : `Replay de la partida · ${mxn(precioReplay)}`}
                      </button>
                      )}
                      <button
                        type="button"
                        onClick={finalizar}
                        disabled={saving || enReplay}
                        className="flex items-center gap-2 rounded bg-primary-container px-4 py-2.5 text-title-md text-on-primary shadow-card transition hover:bg-primary disabled:opacity-60"
                      >
                        <Icono nombre="check" size={17} className="text-secondary-fixed" />
                        {esPractica ? 'Finalizar práctica' : 'Finalizar partida'}
                      </button>
                    </div>
                  </div>

                  {enReplay && (
                    <div className="mt-4 space-y-3 border-t border-outline-variant/40 pt-4">
                      <p className="flex flex-wrap items-center justify-between gap-3 text-body-lg text-on-surface">
                        <span>Replay de la partida · precio fijo, sin descuentos</span>
                        <span className="font-mono text-title-lg text-primary">{mxn(precioReplay)}</span>
                      </p>
                      {/* Solo horarios libres de hoy, después de la partida. */}
                      <div>
                        <p className="mb-1.5 text-label-sm uppercase tracking-wider text-on-surface-variant">
                          ¿A qué hora salen al replay?
                        </p>
                        {salidasReplay === null ? (
                          <p className="text-body-md text-outline">Buscando horarios libres…</p>
                        ) : salidasReplay.length === 0 ? (
                          <p className="rounded border border-estado-pend-border bg-estado-pend-bg px-3.5 py-2.5 text-body-md text-estado-pend-text">
                            Ya no quedan horarios libres hoy después de esta partida: no se puede
                            jugar el replay.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {salidasReplay.map((salida) => (
                              <button
                                key={salida.id}
                                type="button"
                                onClick={() => setSalidaReplay(salida.id)}
                                className={`rounded border px-3.5 py-1.5 font-mono text-title-md transition ${
                                  salidaReplay === salida.id
                                    ? 'border-primary-container bg-primary-container text-on-primary'
                                    : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low'
                                }`}
                              >
                                {salida.slot_time}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* ----------------------------------- detalle de la partida */}
              <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/40 px-5 py-4">
                  <h2 className="flex items-center gap-2.5 text-label-md uppercase tracking-wider text-primary">
                    <Icono nombre="grupo" size={18} className="text-secondary" />
                    {esPractica ? 'Personas en práctica' : 'Detalle de la partida'}
                  </h2>
                  <span className="text-body-md text-outline">
                    {bloqueada
                      ? 'Partida pagada · ya no se modifica'
                      : 'Toque el recuadro para marcar quién llegó'}
                  </span>
                </div>

                <div className="space-y-3 p-5">
                  {bloquesDeJugadores(reservation.players).map((bloque, i) =>
                    bloque.tipo === 'pga' ? (
                      <TarjetaPga
                        key={bloque.players[0].id}
                        player={bloque.players[0]}
                        indice={reservation.players.indexOf(bloque.players[0]) + 1}
                        llego={arrivals[bloque.players[0].id] || false}
                        estado={pga[bloque.players[0].id] || {}}
                        config={pgaConfig}
                        bloqueada={bloqueada}
                        onLlegada={() => marcarLlegada(bloque.players[0].id)}
                        onDecidir={(d) => decidirPga(bloque.players[0].id, d)}
                      />
                    ) : (
                      <div key={`simple-${i}`} className="grid gap-3 sm:grid-cols-2">
                        {bloque.players.map((player) => (
                          <TarjetaSimple
                            key={player.id}
                            player={player}
                            practica={esPractica}
                            indice={reservation.players.indexOf(player) + 1}
                            llego={arrivals[player.id] || false}
                            bloqueada={bloqueada}
                            onLlegada={() => marcarLlegada(player.id)}
                          />
                        ))}
                      </div>
                    ),
                  )}

                  {/* Los acompañantes van con los jugadores: no juegan, pero el
                      hotel ya los cobró en la reserva. */}
                  {reservation.companions.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {reservation.companions.map((c) => (
                        <Recuadro
                          key={c.id}
                          llego={llegadasAcomp[c.id] || false}
                          bloqueada={bloqueada}
                          onLlegada={() => marcarAcompanante(c.id)}
                        >
                          <p className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-2">
                              <Icono nombre="persona" size={17} className="shrink-0 text-secondary" />
                              <span className="truncate text-title-md text-primary">{c.full_name}</span>
                            </span>
                            <span className="shrink-0 text-label-sm uppercase tracking-wider text-outline">
                              No juega
                            </span>
                          </p>
                          <p className="mt-1.5 flex items-center justify-between gap-3 text-body-md text-outline">
                            <span>Acompañante</span>
                            <span className="font-mono text-title-md text-primary">
                              {mxn(precioAcompanante)}
                            </span>
                          </p>
                        </Recuadro>
                      ))}
                    </div>
                  )}

                  {!esPractica && (
                  <p className="flex items-start gap-2 rounded bg-surface-container-low px-3.5 py-2.5 text-body-md text-outline">
                    <Icono nombre="escudo" size={16} className="mt-0.5 shrink-0 text-secondary" />
                    Regla de aplicación: el beneficio PGA es estrictamente individual. Solo se
                    descuenta sobre la tarifa del portador de la credencial validada.
                  </p>
                  )}
                </div>
              </section>

              {/* -------------------------------------- servicios adicionales */}
              <section className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card">
                <div className="border-b border-outline-variant/40 px-5 py-4">
                  <h2 className="flex items-center gap-2.5 text-label-md uppercase tracking-wider text-primary">
                    <Icono nombre="golf" size={18} className="text-secondary" />
                    Servicios adicionales
                  </h2>
                  <p className="text-body-md text-outline">
                    Lo que el huésped pida en el mostrador.
                  </p>
                </div>

                {/* Lo que el hotel ya apartó en la solicitud. Se muestra antes
                    de la lista para que el mostrador no lo vuelva a agregar. */}
                {serviciosDelHotel.length > 0 && (
                  <div className="mx-5 mt-5 rounded border border-estado-ok-border bg-estado-ok-bg px-4 py-3">
                    <p className="flex items-center gap-2 text-title-md text-estado-ok-text">
                      <Icono nombre="check" size={16} />
                      Ya solicitado por el hotel · no volver a agregar
                    </p>
                    <ul className="mt-1.5 space-y-0.5 text-body-md text-on-surface-variant">
                      {serviciosDelHotel.map((s) => (
                        <li key={s.id} className="flex justify-between gap-3">
                          <span>
                            {s.quantity} × {s.service_name}
                          </span>
                          <span className="font-mono">{mxn(s.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {bloqueada && (
                  <p className="mx-5 mt-5 flex items-center gap-2 rounded bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">
                    <Icono nombre="escudo" size={16} className="text-secondary" />
                    La partida ya está pagada: no se agregan más servicios.
                  </p>
                )}
                <div
                  className={`grid gap-3 p-5 sm:grid-cols-2 ${
                    bloqueada ? 'pointer-events-none select-none opacity-50' : ''
                  }`}
                  aria-disabled={bloqueada}
                >
                  {services
                    .filter((s) => !NO_SON_SERVICIOS.includes(s.code))
                    // En práctica no hay caddie ni se vende otra vez la zona de práctica.
                    .filter((s) => !esPractica || !['CADDIE', 'PRACTICA'].includes(s.code))
                    .map((servicio) => {
                    const agregado = addedServices.find((i) => i.service_id === servicio.id);
                    return (
                      <div
                        key={servicio.id}
                        className={`rounded border p-4 transition ${
                          agregado
                            ? 'border-primary-container bg-primary-fixed/30'
                            : 'border-outline-variant/50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <label className="flex min-w-0 items-start gap-2.5">
                            <input
                              type="checkbox"
                              disabled={bloqueada}
                              checked={Boolean(agregado)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setAddedServices([
                                    ...addedServices,
                                    { service_id: servicio.id, quantity: 1 },
                                  ]);
                                } else {
                                  setAddedServices(
                                    addedServices.filter((i) => i.service_id !== servicio.id),
                                  );
                                }
                              }}
                              className="mt-1 h-4 w-4 accent-[#16382C]"
                            />
                            <span className="min-w-0">
                              <span className="block text-title-md text-primary">{servicio.name}</span>
                              <span className="block font-mono text-label-sm text-outline">
                                {mxn(precioDeHoy(servicio))}
                                {tasa ? ` (${usd(precioDeHoy(servicio) / tasa)})` : ''}
                              </span>
                            </span>
                          </label>

                          {agregado && (
                            <input
                              type="number"
                              min="1"
                              value={agregado.quantity}
                              onChange={(e) =>
                                setAddedServices(
                                  addedServices.map((i) =>
                                    i.service_id === servicio.id
                                      ? { ...i, quantity: Number(e.target.value) }
                                      : i,
                                  ),
                                )
                              }
                              className="w-16 shrink-0 rounded border border-outline-variant bg-surface-container-lowest px-2 py-1 text-center font-mono text-body-lg"
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {services.length === 0 && (
                    <p className="py-6 text-center text-body-lg text-outline sm:col-span-2">
                      Sin servicios dados de alta.
                    </p>
                  )}
                </div>
              </section>
            </div>

            {/* ---------------------------------------- columna de liquidación */}
            <div className="xl:col-span-5">
              <section className="sticky top-20 space-y-gutter">
                {/* ------------------------------------------------ el ticket */}
                <div className="overflow-hidden rounded-lg bg-primary-container text-on-primary shadow-card">
                  <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
                    <div>
                      <p className="text-label-sm uppercase tracking-widest text-secondary-fixed">
                        Liquidación
                      </p>
                      <p className="font-serif text-headline-lg">{esPractica ? 'Cuenta de la práctica' : 'Cuenta de la partida'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-title-md">#{reservation.folio}</p>
                      <p className="text-label-sm uppercase tracking-wider text-secondary-fixed">
                        {reservation.status === 'COMPLETADA'
                          ? 'Finalizado'
                          : reservation.status === 'EN_JUEGO'
                            ? 'En juego'
                            : saldada
                              ? 'Liquidada'
                              : 'Abierta'}
                      </p>
                    </div>
                  </div>

                  <dl className="space-y-2 px-5 py-4 text-body-lg">
                    <Linea
                      t={`${presentes.length}× ${esPractica ? 'Zona de práctica' : 'Green fees base'}`}
                      nota={
                        presentes.length
                          ? `${presentes.length} @ ${mxn(greenFeesBruto / presentes.length)}`
                          : 'nadie se ha presentado'
                      }
                      v={mxn(greenFeesBruto)}
                    />

                    {/* Quien no llegó no se cobra, pero sí se deja ver: el
                        ticket tiene que explicar por qué bajó el total. */}
                    {ausentes.map((p) => (
                      <Linea
                        key={`falta-${p.id}`}
                        t={`No se presentó · ${p.full_name}`}
                        nota={`no se cobra ${mxn(p.rate_applied)}`}
                        v="—"
                        tono="text-primary-fixed/70"
                      />
                    ))}

                    {acompPresentes.length > 0 && (
                      <Linea
                        t={`${acompPresentes.length}× Acompañante (no juega)`}
                        nota={acompPresentes.map((c) => c.full_name).join(', ')}
                        v={mxn(totalAcompanantes)}
                      />
                    )}
                    {acompAusentes.map((c) => (
                      <Linea
                        key={`falta-a-${c.id}`}
                        t={`No se presentó · ${c.full_name}`}
                        nota={`no se cobra ${mxn(precioAcompanante)}`}
                        v="—"
                        tono="text-primary-fixed/70"
                      />
                    ))}

                    {/* Cada credencial aceptada sale con nombre y código: así se
                        ve de dónde viene el descuento sin abrir otra pantalla. */}
                    {lineasPga
                      .filter((linea) => linea.descuento > 0)
                      .map((linea) => (
                        <Linea
                          key={linea.player.id}
                          banda
                          icono="verificado"
                          t={`Descuento PGA · ${linea.player.full_name}`}
                          nota={linea.player.pga_code}
                          v={`−${mxn(linea.descuento)}`}
                          tono="text-secondary-fixed"
                        />
                      ))}

                    {convenio > 0 && (
                      <Linea
                        banda
                        t={`Convenio ${reservation.discount_code_applied || ''}`}
                        v={`−${mxn(convenio)}`}
                        tono="text-secondary-fixed"
                      />
                    )}


                    <div className="border-t border-white/10 pt-2">
                      <Linea
                        t={`Subtotal ${esPractica ? 'práctica' : 'green fees'} (${presentes.length} ${
                          esPractica
                            ? presentes.length === 1 ? 'persona' : 'personas'
                            : presentes.length === 1 ? 'cupo' : 'cupos'
                        })`}
                        v={mxn(greenFeesBruto - descuentoPgaVigente)}
                      />
                    </div>

                    {!esPractica && (
                    <Linea
                      t={`${reservation.carts_used || 0}× Carrito de golf`}
                      nota="incluido"
                      v="—"
                    />
                    )}
                    {/* El caddie no se cobra en la caja: el huésped le paga
                        directo. Se enseña para que el mostrador no lo busque
                        en la cuenta ni lo intente cobrar. */}
                    {reservation.caddies_used > 0 && (
                      <Linea
                        t={`${reservation.caddies_used}× Caddie`}
                        nota="el huésped le paga directo al caddie"
                        v="—"
                      />
                    )}
                    <Linea t="Servicios de la reserva" v={mxn(serviciosReserva - acompGuardado)} />
                    <Linea
                      t="Servicios adicionales"
                      nota={serviciosExtra > 0 ? 'agregados en mostrador' : 'sin cargo'}
                      v={mxn(serviciosExtra)}
                      tono={serviciosExtra > 0 ? 'text-secondary-fixed' : undefined}
                    />

                    {/* El IVA ya viene en el precio: solo se desglosa. */}
                    <div className="space-y-2 border-t border-white/10 pt-2">
                      <Linea t="Subtotal sin IVA" v={mxn(desgloseIva(totalPrevisto).base)} />
                      <Linea
                        t={`IVA ${TASA_IVA}%`}
                        nota="incluido en el precio"
                        v={mxn(desgloseIva(totalPrevisto).iva)}
                      />
                    </div>
                  </dl>

                  {(reservation.payments || []).length > 0 && (
                    <dl className="space-y-2 border-t border-white/10 px-5 py-3 text-body-lg">
                      <PagosDelTicket pagos={reservation.payments} />
                    </dl>
                  )}

                  <div className="mx-5 mb-4 rounded bg-white/5 px-4 py-3">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-label-sm uppercase tracking-wider text-secondary-fixed">
                          Total de la reserva
                        </p>
                        <p className="font-mono text-label-sm text-primary-fixed">
                          {tasa
                            ? `Equivale a ${usd(totalPrevisto / tasa)} @ TC $${tasa.toFixed(2)}`
                            : ''}
                        </p>
                      </div>
                      <p className="font-serif text-display-lg leading-none">{mxn(totalPrevisto)}</p>
                    </div>
                    {/* El equivalente en dólares va aquí y no escondido en la
                        caja de pago: si el huésped paga en USD, es la cifra
                        que hay que teclear. */}
                    {!saldada && porCobrar > 0 ? (
                      <p className="mt-2 flex flex-wrap items-baseline justify-between gap-2 border-t border-white/10 pt-2 font-mono text-body-lg text-secondary-fixed">
                        <span>Por cobrar ahora: {mxn(porCobrar)}</span>
                        {tasa > 0 && <span className="text-primary-fixed">≈ {usd(porCobrar / tasa)}</span>}
                      </p>
                    ) : (
                      yaPagado > 0 && (
                        <p className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2 text-body-lg text-secondary-fixed">
                          <Icono nombre="verificado" size={16} />
                          Pagado · no queda saldo
                        </p>
                      )
                    )}
                  </div>
                </div>

                {/* Segundos tickets del folio, debajo del original y con su
                    detalle: los dos a la vista, cada uno con su propia cuenta. */}
                {/* Mientras se captura, el replay ya se ve como ticket: así se
                    revisa el detalle antes de cobrarlo, igual que el general. */}
                {enReplay && (
                  <div className="overflow-hidden rounded-lg border-2 border-dashed border-primary-container/50 bg-surface-container-lowest shadow-card">
                    <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 px-5 py-4">
                      <div>
                        <p className="text-label-sm uppercase tracking-widest text-secondary">
                          Segundo ticket · por cobrar
                        </p>
                        <p className="font-serif text-headline-lg text-primary">Replay de la partida</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-title-md text-primary">#{reservation.folio}</p>
                        <p className="text-label-sm uppercase tracking-wider text-estado-pend-text">
                          Abierto
                        </p>
                      </div>
                    </div>
                    <dl className="space-y-2 px-5 py-4 text-body-lg">
                      <LineaClara t="Replay · ronda extra" nota="precio fijo por partida" v={mxn(precioReplay)} />
                      <LineaClara
                        t="Salida del replay"
                        v={
                          salidaReplay
                            ? `${salidasReplay?.find((x) => x.id === salidaReplay)?.slot_time} hrs`
                            : 'sin horario'
                        }
                      />
                      <LineaClara t="Jugadores" v={`${presentes.length}`} />
                      {totalCapturado > 0 && (
                        <LineaClara t="Recibido" v={mxn(totalCapturado)} />
                      )}
                      {cambio > 0 && <LineaClara t="Cambio a entregar" v={`−${mxn(cambio)}`} />}
                    </dl>
                    <div className="mx-5 mb-4 flex items-end justify-between gap-3 rounded bg-surface-container-low px-4 py-3">
                      <p className="text-label-sm uppercase tracking-wider text-secondary">
                        Total del replay
                      </p>
                      <p className="font-serif text-headline-lg leading-none text-primary">
                        {mxn(precioReplay)}
                      </p>
                    </div>
                  </div>
                )}

                {replays.map((t, i) => (
                  <div
                    key={t.id}
                    className="overflow-hidden rounded-lg bg-primary-container text-on-primary shadow-card"
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
                      <div>
                        <p className="text-label-sm uppercase tracking-widest text-secondary-fixed">
                          Segundo ticket{replays.length > 1 ? ` · ${i + 1}` : ''}
                        </p>
                        <p className="font-serif text-headline-lg">Replay de la partida</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-title-md">#{reservation.folio}</p>
                        <p className="text-label-sm uppercase tracking-wider text-secondary-fixed">
                          Pagado
                        </p>
                      </div>
                    </div>
                    <dl className="space-y-2 px-5 py-4 text-body-lg">
                      <Linea t="Replay · ronda extra" nota="precio fijo por partida" v={mxn(t.total)} />
                      {t.slot_time && <Linea t="Salida del replay" v={`${hora(t.slot_time)} hrs`} />}
                      <PagosDelTicket pagos={t.payments || []} />
                    </dl>
                    <div className="mx-5 mb-4 flex items-end justify-between gap-3 rounded bg-white/5 px-4 py-3">
                      <div>
                        <p className="text-label-sm uppercase tracking-wider text-secondary-fixed">
                          Total del replay
                        </p>
                        <p className="font-mono text-label-sm text-primary-fixed">
                          {t.created_by_name ? `Cobró ${t.created_by_name}` : ''}
                        </p>
                      </div>
                      <p className="font-serif text-headline-lg leading-none">{mxn(t.total)}</p>
                    </div>
                  </div>
                ))}

                {/* ---------------------------------- tipo de cambio del día */}
                <div className="rounded-lg border border-outline-variant/50 bg-surface-container-low px-5 py-4 shadow-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-label-md uppercase tracking-wider text-primary">
                      <Icono nombre="refrescar" size={16} className="text-secondary" />
                      Tipo de cambio operativo del día
                    </p>
                    <span className="rounded border border-estado-ok-border bg-estado-ok-bg px-2.5 py-1 font-mono text-label-sm text-estado-ok-text">
                      1 USD = ${tasa.toFixed(2)} MXN
                    </span>
                  </div>
                  <p className="mt-1.5 font-mono text-body-md text-outline">
                    Moneda base MXN · equivalente total{' '}
                    {tasa ? usd(totalPrevisto / tasa) : '—'}
                    {rate?.effective_date ? ` · vigente ${rate.effective_date}` : ''}
                  </p>
                </div>

                {/* Sin saldo no hay nada que cobrar: se dice, y el bloque de
                    captura desaparece para que nadie cobre dos veces. */}
                {!mostrarCobro && esperaLlegada ? (
                  // Pagada en línea, todavía no llega: se registra su llegada.
                  <div className="rounded-lg border border-estado-pend-border bg-estado-pend-bg p-5 text-center shadow-card">
                    <Icono nombre="historial" size={26} className="mx-auto text-estado-pend-text" />
                    <p className="mt-1.5 font-serif text-headline-lg text-estado-pend-text">
                      Pagado · en espera de llegada
                    </p>
                    <p className="text-body-lg text-on-surface-variant">
                      Ya se pagaron {mxn(yaPagado)}. Marque quién llegó y registre la llegada
                      {esPractica ? ' para pasar a la zona de práctica.' : ' para que la partida quede en juego.'}{' '}
                      Si piden algo más (bastones, etc.), agréguelo en servicios y se cobra aquí.
                    </p>
                    <button
                      type="button"
                      onClick={cobrar}
                      disabled={saving || atiende.trim().length < 3}
                      title={atiende.trim().length < 3 ? 'Escriba quién atiende' : undefined}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-primary-container px-5 py-3.5 text-title-lg text-on-primary shadow-card transition hover:bg-primary disabled:cursor-not-allowed disabled:bg-surface-container-highest disabled:text-outline disabled:shadow-none"
                    >
                      <Icono nombre="verificado" size={19} className="text-secondary-fixed" />
                      {saving ? 'Registrando…' : 'Registrar llegada'}
                    </button>
                  </div>
                ) : !mostrarCobro ? (
                  <div className="rounded-lg border border-estado-ok-border bg-estado-ok-bg p-5 text-center shadow-card">
                    <Icono nombre="verificado" size={26} className="mx-auto text-estado-ok-text" />
                    <p className="mt-1.5 font-serif text-headline-lg text-estado-ok-text">
                      {reservation.status === 'COMPLETADA'
                        ? esPractica ? 'Práctica finalizada' : 'Partida finalizada'
                        : esPractica ? 'Pagado · en práctica' : 'Partida pagada · en juego'}
                    </p>
                    <p className="text-body-lg text-on-surface-variant">
                      Se cobraron {mxn(yaPagado)}.{' '}
                      {reservation.status === 'COMPLETADA'
                        ? 'La cuenta está cerrada.'
                        : esPractica
                          ? 'La cuenta quedó cerrada; al terminar, finalícela.'
                          : 'La cuenta quedó cerrada; al volver del campo, finalícela o cobre un replay.'}
                    </p>
                  </div>
                ) : (
                  // -------------------------------------- cobro multimoneda
                  <div className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-card">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-label-md uppercase tracking-wider text-primary">
                      {enReplay ? 'Cobro del replay' : 'Modalidad de cobro'}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <Selector
                        opciones={[
                          ['unico', 'Pago único'],
                          ['mixto', 'Pago mixto'],
                        ]}
                        valor={modalidad}
                        onCambio={(valor) => {
                          setModalidad(valor);
                          // Volver a pago único deja solo el método elegido: si
                          // no, quedarían montos escondidos sumando al total.
                          if (valor === 'unico') {
                            setMontos((actual) => ({
                              ...MONTOS_VACIOS,
                              [metodo]: actual[metodo],
                            }));
                          }
                        }}
                      />
                      <Selector
                        opciones={[
                          ['MXN', 'MXN'],
                          ['USD', 'USD'],
                        ]}
                        valor={moneda}
                        onCambio={setMoneda}
                        mono
                      />
                    </div>
                  </div>

                  {/* Al cobrar en dólares hay que decir cuánto es en dólares:
                      el saldo vive en pesos y el mostrador no tiene por qué
                      sacar la división. */}
                  {moneda === 'USD' && porCobrar > 0 && tasa > 0 && (
                    <p className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded bg-surface-container-low px-3.5 py-2 text-body-md text-on-surface-variant">
                      <span>
                        Hay que cobrar{' '}
                        <strong className="font-mono text-primary">{usd(porCobrar / tasa)}</strong>
                      </span>
                      <span className="font-mono text-label-sm text-outline">
                        {mxn(porCobrar)} al TC de ${tasa.toFixed(2)}
                      </span>
                    </p>
                  )}

                  {/* Tres recuadros, uno por método: se toca el que se va a
                      usar y se teclea el monto. Más rápido que desplegar una
                      lista con un huésped enfrente. */}
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {METODOS.map(({ valor, icono, destino }) => {
                      const activo = modalidad === 'mixto' || metodo === valor;
                      const otra = moneda === 'MXN' ? 'USD' : 'MXN';
                      return (
                        <CajaDeMetodo
                          key={valor}
                          nombre={METODO_PAGO[valor]}
                          icono={icono}
                          destino={destino}
                          activo={activo}
                          moneda={moneda}
                          tasa={tasa}
                          monto={montos[valor][moneda]}
                          montoOtra={montos[valor][otra]}
                          onElegir={() => {
                            // En pago único elegir método limpia los demás.
                            setMetodo(valor);
                            if (modalidad === 'unico') {
                              setMontos((actual) => ({
                                ...MONTOS_VACIOS,
                                [valor]: actual[valor],
                              }));
                            }
                          }}
                          onMonto={(v) =>
                            setMontos((actual) => ({
                              ...actual,
                              [valor]: { ...actual[valor], [moneda]: v },
                            }))
                          }
                          onLimpiarOtra={() =>
                            setMontos((actual) => ({
                              ...actual,
                              [valor]: { ...actual[valor], [otra]: '' },
                            }))
                          }
                        />
                      );
                    })}
                  </div>

                  {montos.TRANSFERENCIA[moneda] || montos.TRANSFERENCIA[moneda === 'MXN' ? 'USD' : 'MXN'] ? (
                    <input
                      value={referencia}
                      placeholder="Referencia o autorización de la transferencia"
                      onChange={(e) => setReferencia(e.target.value)}
                      className={`mt-2.5 ${CAMPO}`}
                    />
                  ) : null}

                  {/* Atajo del mostrador: deja el saldo exacto en el método
                      elegido. En dólares el saldo casi nunca cae en centavos
                      redondos, así que se ponen los dólares que sí caben y el
                      sobrante de unos pesos se deja en efectivo; si no, el
                      cobro quedaría corto por un centavo y no dejaría cerrar. */}
                  {porCobrar > 0 && tasa > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const destino = modalidad === 'unico' ? metodo : 'EFECTIVO';
                        if (moneda === 'MXN') {
                          setMontos((actual) => ({
                            ...actual,
                            [destino]: { ...actual[destino], MXN: porCobrar.toFixed(2) },
                          }));
                          return;
                        }
                        // Dólares enteros de centavo que no se pasan del saldo.
                        const dolares = Math.floor((porCobrar / tasa) * 100) / 100;
                        const resto = Number((porCobrar - dolares * tasa).toFixed(2));
                        setMontos((actual) => ({
                          ...actual,
                          [destino]: {
                            ...actual[destino],
                            USD: dolares.toFixed(2),
                            MXN: resto > 0 ? resto.toFixed(2) : actual[destino].MXN,
                          },
                        }));
                      }}
                      className="mt-2.5 w-full rounded border border-dashed border-outline-variant py-2 text-label-sm uppercase tracking-wider text-on-surface-variant transition hover:bg-surface-container-low"
                    >
                      {moneda === 'MXN'
                        ? `Poner el saldo exacto (${mxn(porCobrar)})`
                        : `Poner el saldo exacto (${usd(porCobrar / tasa)} + cambio en pesos)`}
                    </button>
                  )}

                  {/* El cobro tiene que cuadrar al centavo: se dice si falta,
                      si sobra o si ya está exacto. */}
                  <div
                    className={`mt-4 rounded px-4 py-3 ${
                      cobroValido ? 'bg-estado-ok-bg' : 'bg-estado-pend-bg'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-body-lg text-on-surface">
                        Total pagado <strong className="font-mono">{mxn(totalCapturado)}</strong>
                        {tasa > 0 && (
                          <span className="text-outline"> ({usd(totalCapturado / tasa)} eq.)</span>
                        )}
                      </p>
                      <span
                        className={`rounded px-2.5 py-1 font-mono text-label-sm text-white ${
                          cobroValido ? 'bg-estado-ok-text' : 'bg-estado-pend-text'
                        }`}
                      >
                        {cobroExacto
                          ? 'Monto exacto'
                          : faltante > 0
                            ? `Faltan ${mxn(faltante)}`
                            : excedeSinEfectivo
                              ? 'Tarjeta/transferencia: exacto'
                              : `Cambio ${mxn(cambio)}`}
                      </span>
                    </div>
                    {/* En efectivo se puede pagar con un billete mayor: aquí
                        se dice cuánto hay que regresar. */}
                    {cambio > 0 && (
                      <p className="mt-2 flex items-center justify-between gap-3 rounded bg-white/70 px-3 py-2 text-body-lg text-on-surface">
                        <span className="flex items-center gap-2">
                          <Icono nombre="cajaFuerte" size={16} className="text-secondary" />
                          Cambio a entregar en efectivo
                        </span>
                        <strong className="font-mono text-title-lg text-primary">{mxn(cambio)}</strong>
                      </p>
                    )}
                    {excedeSinEfectivo && (
                      <p className="mt-2 text-body-md text-estado-pend-text">
                        Con tarjeta o transferencia se cobra exacto. Solo en efectivo se da cambio.
                      </p>
                    )}
                    {lineasDePago.length > 1 && (
                      <p className="mt-1.5 font-mono text-label-sm text-on-surface-variant">
                        Conciliación:{' '}
                        {lineasDePago
                          .map((p) =>
                            p.currency === 'USD'
                              ? `${usd(p.amount)} (${mxn(Number(p.amount) * tasa)})`
                              : mxn(p.amount),
                          )
                          .join('  +  ')}
                      </p>
                    )}
                  </div>

                  <p className="mt-4 flex items-start gap-2 rounded bg-surface-container-low px-3 py-2 text-body-md text-outline">
                    <Icono nombre="escudo" size={15} className="mt-0.5 shrink-0 text-secondary" />
                    Nunca se cobra de menos. Con tarjeta o transferencia el cobro es exacto; en
                    efectivo se puede recibir de más y el sistema calcula el cambio.
                  </p>

                  <button
                    type="button"
                    onClick={cobrar}
                    disabled={saving || !cobroValido || (enReplay && !salidaReplay)}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded bg-primary-container px-5 py-3.5 text-title-lg text-on-primary shadow-card transition hover:bg-primary disabled:cursor-not-allowed disabled:bg-surface-container-highest disabled:text-outline disabled:shadow-none"
                  >
                    <Icono nombre="verificado" size={19} className="text-secondary-fixed" />
                    {saving
                      ? 'Registrando…'
                      : enReplay
                        ? `Cobrar replay · ${mxn(porCobrar)}`
                        : 'Confirmar llegada y registrar pago'}
                  </button>

                  {enReplay ? (
                    <p className="mt-3 flex items-start gap-2 text-body-md text-outline">
                      <Icono nombre="refrescar" size={15} className="mt-0.5 shrink-0 text-secondary" />
                      Es un segundo ticket del mismo folio: el ticket original no cambia y el
                      replay no genera comisión para el hotel.
                    </p>
                  ) : esPractica ? null : (
                    <p className="mt-3 flex items-start gap-2 text-body-md text-outline">
                      <Icono nombre="martillo" size={15} className="mt-0.5 shrink-0 text-secondary" />
                      Nota administrativa: el PGA es un beneficio individual. Solo descuenta sobre la
                      tarifa del portador de la credencial validada.
                    </p>
                  )}
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}

      {documento === 'responsiva' && reservation && (
        <Responsiva reservation={reservation} onCerrar={() => setDocumento(null)} />
      )}
      {documento === 'recibo' && reservation && (
        <Recibo reservation={reservation} cuenta={account} onCerrar={() => setDocumento(null)} />
      )}
      {documento?.replay && reservation && (
        <ReciboReplay
          reservation={reservation}
          replay={documento.replay}
          numero={documento.numero}
          onCerrar={() => setDocumento(null)}
        />
      )}

      {!reservation && !loading && (
        <section className="rounded-lg border border-dashed border-outline-variant bg-surface-container-lowest px-6 py-16 text-center">
          <Icono nombre="qr_code_2" size={40} className="mx-auto text-outline-variant" />
          <p className="mt-3 font-serif text-headline-lg text-primary">
            Escanee el pase de la partida
          </p>
          <p className="text-body-lg text-outline">
            Un solo pase QR por reserva: al leerlo aparecen todos los jugadores del grupo.
          </p>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- piezas */

/**
 * Jugador con credencial profesional. Ocupa el ancho completo porque trae el
 * desglose de la tarifa y los dos botones con los que el mostrador decide.
 */
function TarjetaPga({ player, indice, llego, estado, config, bloqueada, onLlegada, onDecidir }) {
  const valida = estado.decision === 'valida';
  const rechazada = estado.decision === 'invalida';
  const descuento = valida ? descuentoPga(config, player.rate_applied) : 0;
  const total = Number(player.rate_applied) - descuento;
  const porcentaje =
    config?.discount_type === 'PORCENTAJE' ? Number(config.value).toFixed(0) : null;

  return (
    <Recuadro llego={llego} resaltado={valida} bloqueada={bloqueada} onLlegada={onLlegada}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <Numero valor={indice} llego={llego} />
            <span className="text-title-lg text-primary">{player.full_name}</span>
            {player.is_holder && (
              <span className="rounded bg-secondary-container px-2 py-0.5 text-label-sm uppercase tracking-wider text-on-secondary-container">
                Titular
              </span>
            )}
          </p>
          <p className="mt-0.5 font-mono text-body-md text-outline">
            PGA: {player.pga_code}
            {player.credential_number ? ` · Credencial: ${player.credential_number}` : ''}
          </p>
        </div>

        {valida && (
          <span className="flex shrink-0 items-center gap-1.5 rounded border border-estado-ok-border bg-estado-ok-bg px-3 py-1.5 text-label-sm uppercase tracking-wider text-estado-ok-text">
            <Icono nombre="verificado" size={15} />
            Beneficio PGA aplicado
          </span>
        )}
        {rechazada && (
          <span className="flex shrink-0 items-center gap-1.5 rounded border border-outline-variant bg-surface-container-high px-3 py-1.5 text-label-sm uppercase tracking-wider text-on-surface-variant">
            <Icono nombre="cancelar" size={15} />
            Sin beneficio
          </span>
        )}
      </div>

      {/* La credencial se revisa a mano: el sistema no consulta ningún padrón,
          solo guarda la decisión del mostrador y quién la tomó. */}
      <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-outline-variant/40 pt-3">
        <span className="text-body-lg text-on-surface">
          ¿Trae su credencial vigente?
          {porcentaje && (
            <span className="ml-1.5 text-body-md text-outline">
              (descuenta {porcentaje}% de su tarifa)
            </span>
          )}
        </span>
        <Opcion activo={valida} tono="ok" disabled={bloqueada} onClick={() => onDecidir('valida')}>
          Sí
        </Opcion>
        <Opcion activo={rechazada} tono="neutro" disabled={bloqueada} onClick={() => onDecidir('invalida')}>
          No
        </Opcion>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 border-t border-outline-variant/40 pt-3 text-body-md">
        <span className="text-on-surface-variant">
          Tarifa base: <span className="font-mono text-primary">{mxn(player.rate_applied)}</span>
        </span>
        {descuento > 0 && (
          <span className="rounded bg-estado-ok-bg px-2.5 py-1 text-estado-ok-text">
            Descuento PGA: <span className="font-mono">−{mxn(descuento)}</span>
          </span>
        )}
        <span className="text-on-surface-variant">
          Total: <span className="font-mono text-title-lg text-primary">{mxn(total)}</span>
        </span>
      </div>
    </Recuadro>
  );
}

/** Jugador sin credencial: solo hay que marcar si llegó. */
function TarjetaSimple({ player, indice, llego, bloqueada, onLlegada, practica = false }) {
  return (
    <Recuadro llego={llego} bloqueada={bloqueada} onLlegada={onLlegada}>
      <div className="flex items-start justify-between gap-3">
        <p className="flex min-w-0 flex-wrap items-center gap-2">
          <Numero valor={indice} llego={llego} />
          <span className="truncate text-title-md text-primary">{player.full_name}</span>
          {player.is_holder && (
            <span className="rounded bg-secondary-container px-2 py-0.5 text-label-sm uppercase tracking-wider text-on-secondary-container">
              Titular
            </span>
          )}
        </p>
        <span className="shrink-0 text-label-sm uppercase tracking-wider text-outline">
          {practica ? 'Práctica' : 'Sin PGA'}
        </span>
      </div>
      <p className="mt-1.5 flex items-center justify-between gap-3 text-body-md text-outline">
        <span>
          {player.category === 'LOCAL' ? (
            <strong className="text-secondary">Local · pedir credencial</strong>
          ) : (
            categoria(player.category)
          )}
          {player.club_hand
            ? ` · palos ${
                player.club_hand === 'ZURDO'
                  ? 'zurdo'
                  : player.club_hand === 'DIESTRO'
                    ? 'diestro'
                    : 'propios'
              }`
            : ''}
        </span>
        <span className="font-mono text-title-md text-primary">{mxn(player.rate_applied)}</span>
      </p>
    </Recuadro>
  );
}

/**
 * El recuadro del jugador. Todo él es el control de llegada: en un mostrador
 * con gente esperando, apuntarle a una casilla de 16px es perder tiempo.
 */
function Recuadro({ llego, resaltado, bloqueada, onLlegada, children }) {
  return (
    <div
      role="button"
      tabIndex={bloqueada ? -1 : 0}
      aria-pressed={llego}
      aria-disabled={bloqueada}
      onClick={bloqueada ? undefined : onLlegada}
      onKeyDown={(e) => {
        if (bloqueada) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onLlegada();
        }
      }}
      className={`rounded border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container ${
        bloqueada ? 'cursor-default' : 'cursor-pointer'
      } ${
        llego
          ? 'border-estado-ok-text bg-estado-ok-bg/60 shadow-card'
          : resaltado
            ? 'border-estado-ok-border bg-estado-ok-bg/25 hover:bg-estado-ok-bg/40'
            : 'border-outline-variant/50 bg-surface-container-lowest hover:bg-surface-container-low'
      }`}
    >
      {children}
      <p
        className={`mt-2.5 flex items-center gap-1.5 text-label-sm uppercase tracking-wider ${
          llego ? 'text-estado-ok-text' : 'text-outline'
        }`}
      >
        <Icono nombre={llego ? 'check' : 'persona'} size={14} />
        {llego ? 'Llegó al mostrador' : bloqueada ? 'No se presentó' : 'Toque para marcar su llegada'}
      </p>
    </div>
  );
}

function Numero({ valor, llego }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-label-sm ${
        llego ? 'bg-estado-ok-text text-white' : 'bg-primary-container text-secondary-fixed'
      }`}
    >
      {valor}
    </span>
  );
}

/** Botón de decisión: válida o no. Se puede desmarcar volviéndolo a tocar. */
function Opcion({ activo, tono, disabled, onClick, children }) {
  const estilos = activo
    ? tono === 'ok'
      ? 'border-estado-ok-text bg-estado-ok-text text-white'
      : 'border-on-surface-variant bg-on-surface-variant text-white'
    : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low';
  return (
    <button
      type="button"
      // El recuadro entero marca la llegada; estos botones no deben dispararla.
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded border px-3.5 py-1.5 text-title-md transition disabled:cursor-not-allowed disabled:opacity-60 ${estilos}`}
    >
      {children}
    </button>
  );
}

/** Conmutador de dos o más opciones, en pastillas. */
function Selector({ opciones, valor, onCambio, mono }) {
  return (
    <div className="flex rounded border border-outline-variant p-0.5">
      {opciones.map(([v, texto]) => (
        <button
          key={v}
          type="button"
          onClick={() => onCambio(v)}
          className={`rounded px-3 py-1.5 text-label-sm uppercase tracking-wider transition ${
            mono ? 'font-mono' : ''
          } ${
            valor === v
              ? 'bg-primary-container text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-container-low'
          }`}
        >
          {texto}
        </button>
      ))}
    </div>
  );
}

/**
 * Un método de cobro. En pago único los tres recuadros funcionan como botones
 * y solo el elegido acepta monto; en pago mixto los tres aceptan a la vez.
 */
function CajaDeMetodo({
  nombre,
  icono,
  destino,
  activo,
  moneda,
  tasa,
  monto,
  montoOtra,
  onElegir,
  onMonto,
  onLimpiarOtra,
}) {
  const valor = Number(monto) || 0;
  const otra = moneda === 'MXN' ? 'USD' : 'MXN';

  return (
    <div
      onClick={activo ? undefined : onElegir}
      className={`rounded border p-3 transition ${
        activo
          ? 'border-primary-container bg-surface-container-lowest shadow-card'
          : 'cursor-pointer border-outline-variant/60 bg-surface-container-low hover:bg-surface-container'
      }`}
    >
      <p
        className={`flex items-center gap-1.5 text-title-md ${
          activo ? 'text-primary' : 'text-on-surface-variant'
        }`}
      >
        <Icono nombre={icono} size={16} className={activo ? 'text-secondary' : 'text-outline'} />
        {nombre}
      </p>
      <p className="mt-0.5 text-label-sm uppercase tracking-wider text-outline">
        {destino}
        {moneda === 'USD' && valor > 0 && tasa > 0 ? ` · ${mxn(valor * tasa)}` : ''}
      </p>

      {activo ? (
        <>
          <div className="mt-2 flex items-center rounded border border-outline-variant bg-surface-container-lowest focus-within:border-primary-container">
            <span className="pl-2 font-mono text-label-sm text-outline">{moneda}</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={monto}
              placeholder="0.00"
              onChange={(e) => onMonto(e.target.value)}
              className="w-full bg-transparent px-2 py-1.5 text-right font-mono text-title-lg text-primary focus:outline-none"
            />
          </div>

          {/* El mismo método puede haber recibido la otra moneda: se deja ver
              para que nadie cobre dos veces sin darse cuenta. */}
          {Number(montoOtra) > 0 && (
            <p className="mt-1.5 flex items-center justify-between gap-2 rounded bg-surface-container-low px-2 py-1 font-mono text-label-sm text-on-surface-variant">
              <span>
                + {otra === 'USD' ? usd(montoOtra) : mxn(montoOtra)}
                {otra === 'USD' && tasa > 0 ? ` (${mxn(Number(montoOtra) * tasa)})` : ''}
              </span>
              <button
                type="button"
                onClick={onLimpiarOtra}
                className="text-outline transition hover:text-error"
                aria-label={`Quitar el monto en ${otra}`}
              >
                <Icono nombre="cancelar" size={14} />
              </button>
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 rounded border border-dashed border-outline-variant py-1.5 text-center text-label-sm uppercase tracking-wider text-outline">
          {Number(montoOtra) > 0 || valor > 0 ? 'Con monto' : 'Elegir'}
        </p>
      )}
    </div>
  );
}

function Pastilla({ t, v, acento }) {
  return (
    <span
      className={`rounded border px-3 py-1.5 text-label-sm ${
        acento
          ? 'border-estado-ok-text/40 bg-estado-ok-bg text-estado-ok-text'
          : 'border-outline-variant/50 bg-surface-container-low text-on-surface-variant'
      }`}
    >
      <span className="uppercase tracking-wider">{t}:</span>{' '}
      <span className="font-mono text-primary">{v}</span>
    </span>
  );
}

/**
 * Una línea del ticket. `banda` la resalta con un fondo tenue: el verde de
 * "correcto" que se usa en el resto del sitio es oscuro y sobre este panel,
 * que también es verde oscuro, no se leería.
 */
function Linea({ t, nota, v, tono, icono, banda }) {
  return (
    <div
      className={`flex items-start justify-between gap-4 ${
        banda ? '-mx-2 rounded bg-white/10 px-2 py-1' : ''
      }`}
    >
      <dt className="flex min-w-0 items-center gap-1.5 text-primary-fixed">
        {icono && <Icono nombre={icono} size={14} className="shrink-0 text-secondary-fixed" />}
        <span className="min-w-0">
          {t}
          {nota && (
            <span className="ml-1.5 font-mono text-label-sm text-primary-fixed/70">({nota})</span>
          )}
        </span>
      </dt>
      <dd className={`shrink-0 font-mono ${tono || 'text-on-primary'}`}>{v}</dd>
    </div>
  );
}

/** Cómo se pagó un ticket: cada método, lo recibido y el cambio entregado. */
function PagosDelTicket({ pagos }) {
  return pagos.map((p) => {
    const cambio = Number(p.change_mxn || 0);
    return (
      <div key={p.id} className="space-y-1">
        <Linea
          t={`Pagado · ${METODO_PAGO[p.method] || p.method}`}
          nota={
            p.currency === 'USD'
              ? `${usd(p.amount)} @ ${Number(p.exchange_rate_applied).toFixed(2)}`
              : cambio > 0
                ? 'recibido'
                : null
          }
          v={mxn(p.amount_mxn)}
          tono="text-primary-fixed"
        />
        {cambio > 0 && (
          <Linea t="Cambio entregado" v={`−${mxn(cambio)}`} tono="text-secondary-fixed" />
        )}
      </div>
    );
  });
}

/** Línea de ticket sobre fondo claro (el replay mientras se captura). */
function LineaClara({ t, nota, v }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="min-w-0 text-on-surface-variant">
        {t}
        {nota && <span className="ml-1.5 font-mono text-label-sm text-outline">({nota})</span>}
      </dt>
      <dd className="shrink-0 font-mono text-on-surface">{v}</dd>
    </div>
  );
}

const CAMPO =
  'w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-lg text-on-surface focus:border-primary-container focus:outline-none';

const ETIQUETA = 'mb-1 block text-label-sm uppercase tracking-wider text-on-surface-variant';
