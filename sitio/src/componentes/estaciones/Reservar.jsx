/**
 * Reservar: el mismo expediente que levanta el mostrador, por internet.
 *
 * Lo que pide es lo que pide el sistema —paquete y recorrido, fecha y horario,
 * titular y jugadores, revisión— menos lo del hotel, que aquí no aplica: quien
 * reserva por el sitio llega por su cuenta y cae en venta directa.
 *
 * Va por pasos, uno a la vez, y no porque esté de moda: los cuatro bloques
 * juntos no caben en el panel, y el sitio entero está hecho de una idea a la
 * vez. Cada paso revisa lo suyo antes de dejar pasar al siguiente, así que
 * nadie llega al botón de pagar con un campo a medias.
 *
 * **El total lo calcula el servidor.** Esta pantalla no multiplica nada: manda
 * la lista de jugadores a /cotizacion y pinta lo que le contesten. La tarifa
 * que aplica sale de una cascada de cuatro niveles (franja de twilight, día de
 * la semana, modalidad, edad) y una copia de esa cascada aquí se
 * desincronizaría el día que el club mueva un precio — el huésped vería un
 * número y Stripe le cobraría otro.
 *
 * El caddie no es un renglón de la cuenta porque el club no lo cobra: se le
 * paga directo a él. Va aparte, con su propio trato visual, para que nadie
 * crea que lo está comprando aquí.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../datos/api';
import { problema } from '../../datos/avisos';
import {
  EXTRAS,
  HORARIO,
  PAQUETES,
  enDolares,
  esFinDeSemana,
  pesos,
} from '../../datos/campo';

/** El día de mañana: lo mínimo razonable para reservar en línea. */
function manana() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const FECHA_LARGA = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const diaEnPalabras = (iso) => FECHA_LARGA.format(new Date(`${iso}T12:00:00`));
const hhmm = (h) => String(h || '').slice(0, 5);

const PASOS = ['Paquete', 'Día y hora', 'Jugadores', 'Revisión'];

const entrada =
  'rounded-sm border border-arena/25 bg-arena/[0.07] px-3 py-2 font-texto ' +
  'text-[0.95rem] text-arena outline-none transition placeholder:text-arena/75 ' +
  'focus:border-hoja focus:bg-arena/10';

const jugadorNuevo = () => ({
  nombre: '',
  edad: '',
  handicap: '',
  pga: '',
  bastones: '', // '' = trae los suyos · DIESTRO · ZURDO
});

const CORREO = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

export default function Reservar({ campo, llegada, onLimpiarLlegada }) {
  const [paso, setPaso] = useState(0);

  const [paquete, setPaquete] = useState('GRUPO');
  const [hoyos, setHoyos] = useState(18);
  const [fecha, setFecha] = useState(manana());
  const [slot, setSlot] = useState(null);
  const [jugadores, setJugadores] = useState([jugadorNuevo()]);
  const [contacto, setContacto] = useState({ correo: '', telefono: '' });

  const [dia, setDia] = useState(null);
  const [cotizacion, setCotizacion] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [listo, setListo] = useState(null);

  const paquetes = campo?.paquetes?.length ? campo.paquetes : PAQUETES;
  const topes =
    paquetes.find((p) => p.modalidad === paquete) ||
    PAQUETES.find((p) => p.modalidad === paquete);

  // --------------------------------------------------- volver de pagar
  //
  // Dos regresos distintos, y durante un rato los traté igual, que era el
  // error. Quien pagó vuelve con su reserva hecha. Quien le dio para atrás en
  // Stripe no reservó nada: su apartado se suelta aquí mismo, el horario
  // vuelve a la venta y se le dice con todas sus letras que no hay reserva.
  // Antes se le mostraba su folio y un «le llamamos para confirmarla» —una
  // promesa que nadie pidió, por una salida que él decidió no pagar.
  //
  // El estado se consulta en lugar de creerle a la liga: a la página de
  // "listo" se llega tecleándola.
  useEffect(() => {
    if (!llegada?.folio) return undefined;
    let vigente = true;

    if (llegada.cancelado) {
      api
        .soltar(llegada.folio)
        .catch(() => {})
        .finally(() => {
          if (!vigente) return;
          onLimpiarLlegada?.();
          problema(
            'No se hizo la reserva',
            'Se canceló el pago, así que la salida volvió a estar disponible. ' +
              'No se le cobró nada y no hay nada que cancelar. ' +
              'Puede elegir otro horario cuando quiera.',
          );
        });
      return () => {
        vigente = false;
      };
    }

    api
      .estado(llegada.folio)
      .then((r) => {
        if (!vigente) return;
        // Puede volver antes de que llegue el aviso de Stripe. Si está
        // pagada se enseña; si no, se le dice que estamos confirmando.
        setListo(r);
      })
      .catch(() => vigente && setAviso('No encontramos esa reserva.'));
    return () => {
      vigente = false;
    };
  }, [llegada]);

  // ------------------------------------------------------- disponibilidad
  useEffect(() => setSlot(null), [fecha]);

  useEffect(() => {
    if (listo) return undefined;
    let vigente = true;
    setCargando(true);
    api
      .disponibilidad(fecha)
      .then((d) => vigente && setDia(d))
      .catch((e) => {
        if (!vigente) return;
        setDia(null);
        setAviso(
          e.sinConexion
            ? 'No pudimos conectar con el sistema de reservas. Llámenos y con gusto le apartamos su salida.'
            : e.message,
        );
      })
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [fecha, listo]);

  // El campo puede cerrar la partida abierta por día completo. Si estaba
  // elegida y el día no la admite, se cambia a Grupo y se avisa, en vez de
  // dejar que el servidor rechace la reserva al final.
  useEffect(() => {
    if (dia && !dia.admite_partida_abierta && paquete === 'PARTIDA_ABIERTA') {
      setPaquete('GRUPO');
      setAviso(
        `El ${diaEnPalabras(fecha)} el campo no está armando partidas abiertas. ` +
          'Se cambió el paquete a En Grupo.',
      );
    }
  }, [dia, paquete, fecha]);

  // Si el paquete nuevo pide más gente de la que hay capturada, se completan
  // los renglones; si admite menos, se recortan los de atrás.
  useEffect(() => {
    if (!topes) return;
    setJugadores((actuales) => {
      if (actuales.length < topes.minimo) {
        return [
          ...actuales,
          ...Array.from({ length: topes.minimo - actuales.length }, jugadorNuevo),
        ];
      }
      if (actuales.length > topes.maximo) return actuales.slice(0, topes.maximo);
      return actuales;
    });
  }, [paquete, topes?.minimo, topes?.maximo]);

  // ---------------------------------------------------------- cotización
  // Se vuelve a pedir cada vez que cambia algo que mueve el precio. Con un
  // respiro de por medio: escribir una edad dispara tres cambios de estado y
  // no hay por qué hacer tres viajes.
  const nombresListos = jugadores.every((j) => j.nombre.trim().length >= 3);
  const firma = JSON.stringify([
    slot,
    paquete,
    hoyos,
    jugadores.map((j) => [j.nombre.trim(), j.edad, j.bastones]),
  ]);
  const ultimaFirma = useRef(null);

  useEffect(() => {
    if (!slot || !nombresListos || listo) {
      setCotizacion(null);
      return undefined;
    }
    if (ultimaFirma.current === firma) return undefined;

    let vigente = true;
    const t = setTimeout(() => {
      api
        .cotizar({
          tee_slot_id: slot,
          modalidad: paquete,
          hoyos: Number(hoyos),
          jugadores: aCuerpo(jugadores),
        })
        .then((q) => {
          if (!vigente) return;
          ultimaFirma.current = firma;
          setCotizacion(q);
          setAviso(null);
        })
        .catch((e) => {
          if (!vigente) return;
          setCotizacion(null);
          setAviso(e.message);
        });
    }, 350);

    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [firma, slot, nombresListos, listo]);

  // ------------------------------------------------------------- piezas
  const caddie =
    campo?.extras?.find((e) => e.code === 'CADDIE') ??
    EXTRAS.find((e) => e.code === 'CADDIE');
  const precioBastones = Number(
    cotizacion?.precio_bastones ??
      campo?.extras?.find((e) => e.code === 'BASTONES')?.precio ??
      EXTRAS.find((e) => e.code === 'BASTONES').precio,
  );

  const sinSistema = dia === null && !cargando && !listo;

  /** Qué falta para poder avanzar de cada paso. Null = puede pasar. */
  const falta = useMemo(() => {
    if (paso === 0) return null; // siempre hay un paquete elegido
    if (paso === 1) {
      if (!slot) return 'Elija una hora de salida.';
      return null;
    }
    if (paso === 2) {
      const sinNombre = jugadores.findIndex((j) => j.nombre.trim().length < 3);
      if (sinNombre >= 0) {
        return `Falta el nombre completo del jugador ${sinNombre + 1}.`;
      }
      const sinEdad = jugadores.findIndex((j) => !j.edad);
      if (sinEdad >= 0) {
        return `Falta la edad del jugador ${sinEdad + 1}: de ella depende su tarifa.`;
      }
      if (!CORREO.test(contacto.correo.trim())) {
        return 'Hace falta el correo del titular: ahí le llega su pase.';
      }
      return null;
    }
    if (!cotizacion) return 'Estamos calculando su cuenta.';
    return null;
  }, [paso, slot, jugadores, contacto.correo, cotizacion]);

  function cuantos(n) {
    setJugadores((actuales) => {
      if (n > actuales.length) {
        return [...actuales, ...Array.from({ length: n - actuales.length }, jugadorNuevo)];
      }
      return actuales.slice(0, n);
    });
  }

  function cambiar(i, clave, valor) {
    setJugadores((actuales) =>
      actuales.map((j, k) => (k === i ? { ...j, [clave]: valor } : j)),
    );
  }

  async function apartarYPagar() {
    setAviso(null);
    setCargando(true);
    try {
      const apartado = await api.apartar({
        tee_slot_id: slot,
        fecha,
        modalidad: paquete,
        hoyos: Number(hoyos),
        jugadores: aCuerpo(jugadores),
        correo: contacto.correo.trim(),
        telefono: contacto.telefono.trim() || null,
      });

      if (campo?.pasarela === 'stripe') {
        // A pagar a la página de Stripe. Ningún número de tarjeta pasa por
        // aquí, y de allá se vuelve con el folio en la dirección.
        const { url } = await api.checkout(apartado.folio);
        window.location.href = url;
        return;
      }

      // Sin pasarela configurada la salida queda apartada y el club llama.
      setListo(await api.estado(apartado.folio));
    } catch (e) {
      setAviso(e.message);
    } finally {
      setCargando(false);
    }
  }

  if (listo) {
    return (
      <Listo
        reserva={listo}
        onOtra={() => {
          setListo(null);
          setPaso(0);
          setSlot(null);
          setJugadores([jugadorNuevo()]);
          setContacto({ correo: '', telefono: '' });
          ultimaFirma.current = null;
          onLimpiarLlegada?.();
        }}
      />
    );
  }

  return (
    <div>
      {/* --------------------------------------------------------- cabeza */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 className="font-titulo text-rotulo-lg text-arena">Reservar</h2>
        {/* En celular se calla: la pantalla la necesitan los campos. */}
        <p className="hidden font-texto text-menudo text-arena/80 sm:block">
          Le apartamos la salida
          {campo?.apartado_minutos ? ` durante ${campo.apartado_minutos} minutos` : ''}{' '}
          mientras paga
        </p>
      </div>

      <Rail paso={paso} onIr={setPaso} />

      {aviso && <Aviso>{aviso}</Aviso>}

      {/* ---------------------------------------------------- los cuatro */}
      <div className="mt-4 pb-2">
        {paso === 0 && (
          <Paso>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {PAQUETES.map((p) => {
                const puesto = paquete === p.modalidad;
                const apagado =
                  p.modalidad === 'PARTIDA_ABIERTA' && dia && !dia.admite_partida_abierta;
                const limites =
                  paquetes.find((x) => x.modalidad === p.modalidad) || p;
                return (
                  <button
                    key={p.modalidad}
                    onClick={() => !apagado && setPaquete(p.modalidad)}
                    disabled={apagado}
                    aria-pressed={puesto}
                    title={
                      apagado
                        ? 'Ese día el campo no está armando partidas abiertas.'
                        : undefined
                    }
                    className={`flex flex-col rounded-sm border p-3.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote ${
                      apagado
                        ? 'cursor-not-allowed border-arena/10 opacity-45'
                        : puesto
                          ? 'border-hoja bg-hoja/[0.12]'
                          : 'border-arena/20 bg-arena/[0.045] hover:border-copa/60'
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span
                        className={`font-titulo text-rotulo-sm ${
                          puesto ? 'text-hoja' : 'text-arena'
                        }`}
                      >
                        {p.nombre}
                      </span>
                      <span className="shrink-0 font-texto text-cifra uppercase text-arena/75">
                        {limites.minimo === limites.maximo
                          ? `${limites.maximo} pax`
                          : `${limites.minimo}–${limites.maximo} pax`}
                      </span>
                    </span>
                    <span className="mt-1.5 font-texto text-menudo leading-relaxed text-arena/85">
                      {p.detalle}
                    </span>
                  </button>
                );
              })}
            </div>

            <Campo etiqueta="Recorrido del campo">
              <Alternador
                opciones={[
                  { valor: 9, texto: '9 hoyos' },
                  { valor: 18, texto: '18 hoyos' },
                ]}
                valor={Number(hoyos)}
                onElegir={setHoyos}
              />
              <p className="mt-1.5 font-texto text-menudo text-arena/80">
                {Number(hoyos) === 9
                  ? 'Media vuelta. Por internet solo con jugadores adultos.'
                  : 'La vuelta completa, par 72.'}
              </p>
            </Campo>
          </Paso>
        )}

        {paso === 1 && (
          <Paso>
            <Campo etiqueta="¿Qué día?">
              <input
                type="date"
                value={fecha}
                min={manana()}
                onChange={(e) => setFecha(e.target.value)}
                className={`${entrada} w-full [color-scheme:dark] sm:max-w-[16rem]`}
              />
              <p className="mt-1.5 font-texto text-menudo text-arena/80">
                {diaEnPalabras(fecha)}
                {esFinDeSemana(fecha) && ' · fin de semana, la tarifa es más alta'}
              </p>
            </Campo>

            <Campo etiqueta="¿A qué hora?">
              {cargando && !dia ? (
                <p className="font-texto text-menudo text-arena/80">Consultando las salidas…</p>
              ) : sinSistema ? (
                <p className="font-texto text-menudo text-arena/80">
                  No podemos consultar las salidas en este momento.
                </p>
              ) : dia?.dia_cerrado ? (
                <p className="font-texto text-menudo text-arena/80">
                  Las reservas para ese día ya cerraron. Elija una fecha posterior.
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                  {(dia?.salidas || []).map((s) => {
                    const elegida = slot === s.id;
                    const lleno = s.libres < jugadores.length;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSlot(s.id)}
                        disabled={lleno}
                        aria-pressed={elegida}
                        title={lleno ? 'No quedan lugares a esa hora' : undefined}
                        className={`rounded-sm border py-1.5 text-center font-texto text-menudo font-semibold tabular-nums transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote ${
                          elegida
                            ? 'border-hoja bg-hoja text-sombra-honda'
                            : lleno
                              ? 'cursor-not-allowed border-arena/10 text-arena/70 line-through'
                              : s.twilight
                                ? 'border-copa/40 bg-copa/10 text-copa hover:border-copa'
                                : 'border-arena/20 bg-arena/[0.055] text-arena hover:border-copa/60'
                        }`}
                      >
                        {hhmm(s.hora)}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="mt-1.5 font-texto text-menudo text-arena/80">
                Las de color turquesa son twilight, desde las{' '}
                {hhmm(dia?.twilight_desde) || HORARIO.twilight} · el campo cierra a
                las {hhmm(dia?.cierre_de_campo) || HORARIO.cierre}
              </p>
            </Campo>
          </Paso>
        )}

        {paso === 2 && (
          <Paso>
            <div className="flex items-end justify-between gap-4">
              <p className="font-texto text-[0.95rem] font-semibold text-arena">
                Quiénes juegan
              </p>
              <Contador
                valor={jugadores.length}
                min={topes?.minimo ?? 1}
                max={topes?.maximo ?? 8}
                onCambiar={cuantos}
              />
            </div>

            <ul className="space-y-2">
              {jugadores.map((j, i) => (
                <li
                  key={i}
                  className="rounded-sm border border-arena/20 bg-arena/[0.04] p-3"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-5 shrink-0 font-titulo text-[0.95rem] text-arena/75">
                      {i + 1}
                    </span>
                    <input
                      value={j.nombre}
                      onChange={(e) => cambiar(i, 'nombre', e.target.value)}
                      placeholder={i === 0 ? 'Nombre completo del titular' : 'Nombre completo'}
                      className={`${entrada} min-w-0 flex-1`}
                    />
                    {i === 0 && (
                      <span className="shrink-0 rounded-sm bg-hoja/15 px-2 py-1 font-texto text-cifra uppercase text-hoja">
                        Titular
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-0 sm:pl-[1.9rem]">
                    <input
                      type="number"
                      min="1"
                      max="120"
                      value={j.edad}
                      onChange={(e) => cambiar(i, 'edad', e.target.value)}
                      placeholder="Edad"
                      className={`${entrada} w-[5.5rem]`}
                    />
                    <input
                      value={j.handicap}
                      onChange={(e) => cambiar(i, 'handicap', e.target.value)}
                      placeholder="Handicap/GHIN"
                      className={`${entrada} w-[9.5rem]`}
                    />
                    <input
                      value={j.pga}
                      onChange={(e) => cambiar(i, 'pga', e.target.value)}
                      placeholder="PGA (opcional)"
                      className={`${entrada} w-[9.5rem]`}
                    />
                    <Alternador
                      opciones={[
                        { valor: '', texto: 'Trae bastones' },
                        { valor: 'DIESTRO', texto: 'Diestro' },
                        { valor: 'ZURDO', texto: 'Zurdo' },
                      ]}
                      valor={j.bastones}
                      onElegir={(v) => cambiar(i, 'bastones', v)}
                    />
                    {j.bastones && (
                      <span className="font-texto text-menudo tabular-nums text-arena/80">
                        renta {pesos(precioBastones)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <p className="font-texto text-menudo text-arena/80">
              La edad decide la tarifa: menor de 16 paga como infantil. El código
              PGA lo valida recepción al llegar; no descuenta nada todavía.
            </p>

            <Campo etiqueta="¿A dónde le mandamos su pase?">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <input
                  type="email"
                  value={contacto.correo}
                  onChange={(e) => setContacto({ ...contacto, correo: e.target.value })}
                  placeholder="Correo del titular"
                  className={`${entrada} w-full`}
                />
                <input
                  value={contacto.telefono}
                  onChange={(e) => setContacto({ ...contacto, telefono: e.target.value })}
                  placeholder="Teléfono (opcional)"
                  className={`${entrada} w-full`}
                />
              </div>
            </Campo>
          </Paso>
        )}

        {paso === 3 && (
          <Paso>
            {!cotizacion ? (
              <p className="font-texto text-menudo text-arena/80">
                Calculando su cuenta…
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 font-texto text-[0.95rem]">
                  <Renglon t="Paquete">
                    {PAQUETES.find((p) => p.modalidad === cotizacion.modalidad)?.nombre}
                    {' · '}
                    {cotizacion.hoyos} hoyos
                  </Renglon>
                  <Renglon t="Salida">
                    {diaEnPalabras(cotizacion.fecha)} a las {hhmm(cotizacion.hora)}
                    {cotizacion.twilight && ' · twilight'}
                  </Renglon>
                  <Renglon t="Pase a">{contacto.correo.trim()}</Renglon>
                </dl>

                {/* La cuenta, renglón por renglón, como la calculó el servidor. */}
                <ul className="overflow-hidden rounded-sm border border-arena/20">
                  {cotizacion.jugadores.map((j, i) => (
                    <li
                      key={i}
                      className="flex items-baseline gap-x-3 border-b border-arena/10 bg-arena/[0.04] px-3 py-2 last:border-b-0"
                    >
                      <span className="w-4 shrink-0 font-titulo text-menudo text-arena/75">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-texto text-[0.95rem] text-arena">
                        {j.nombre}
                      </span>
                      <span className="shrink-0 font-texto text-cifra uppercase text-arena/75">
                        {j.categoria === 'INFANTIL' ? 'Infantil' : 'Adulto'}
                      </span>
                      <span className="shrink-0 font-texto text-[0.95rem] tabular-nums text-arena/90">
                        {pesos(Number(j.green_fee))}
                      </span>
                    </li>
                  ))}
                </ul>

                <dl className="grid grid-cols-[1fr_auto] gap-y-1 font-texto text-[0.95rem] tabular-nums">
                  <dt className="text-arena/85">Green fees</dt>
                  <dd className="text-right text-arena/90">
                    {pesos(Number(cotizacion.green_fees))}
                  </dd>
                  {cotizacion.sets_bastones > 0 && (
                    <>
                      <dt className="text-arena/85">
                        Renta de bastones · {cotizacion.sets_bastones}{' '}
                        {cotizacion.sets_bastones === 1 ? 'set' : 'sets'}
                      </dt>
                      <dd className="text-right text-arena/90">
                        {pesos(Number(cotizacion.subtotal_bastones))}
                      </dd>
                    </>
                  )}
                </dl>
              </>
            )}

            {/* Fuera de la cuenta a propósito: no se compra aquí. */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm border border-copa/30 bg-copa/[0.07] px-3.5 py-2.5">
              <span className="font-texto text-[0.95rem] font-semibold text-copa">
                Caddie · {pesos(Number(cotizacion?.caddie_por_persona ?? caddie.precio))}
              </span>
              <span className="font-texto text-menudo text-arena/85">
                se le paga directo a él, no va en esta cuenta · hay dos y se
                asignan por orden de salida
              </span>
            </div>

            {/* ------------------------------------------------- el cobro */}
            {/* Qué va a pasar al darle a pagar.
                El brinco a otro dominio es el precio de no guardar tarjetas
                aquí, y es justo donde la gente abandona: aparece de pronto una
                página que no es la del club y se duda. Avisarlo antes cuesta
                tres renglones y quita esa duda. Las tarjetas van dibujadas en
                genérico a propósito —rectángulos, no logotipos de nadie. */}
            {campo?.pasarela === 'stripe' && (
              <div className="rounded-sm border border-arena/15 bg-arena/[0.045] px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Candado />
                  <span className="font-texto text-[0.95rem] font-semibold text-arena">
                    Pago seguro con Stripe
                  </span>
                  <span className="ml-auto flex items-center gap-1.5" aria-hidden="true">
                    <Tarjeta /> <Tarjeta /> <Tarjeta />
                  </span>
                </div>
                <p className="mt-2 font-texto text-menudo leading-relaxed text-arena/80">
                  Al confirmar lo mandamos a la página de pago de Stripe y
                  vuelve aquí con su folio. Su tarjeta nunca pasa por el
                  servidor del club. Aceptamos Visa, Mastercard y American
                  Express.
                </p>
              </div>
            )}

            <p className="font-texto text-menudo leading-relaxed text-arena/80">
              Incluye carrito compartido, agua, cerveza y refresco. Preséntese en
              la casa club veinte minutos antes de su salida.
            </p>
          </Paso>
        )}
      </div>

      {/* ------------------------------------------------- total y avance */}
      {/* Pegado abajo, y con hueco suficiente por debajo: el fondo opaco tiene
          que llegar hasta el borde del panel, o se alcanza a ver media ficha
          de jugador asomándose bajo los botones. */}
      <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-arena/20 bg-sombra pb-5 pt-3.5">
        <div className="min-w-0">
          {cotizacion && (
            <p className="font-titulo text-[1.9rem] leading-none text-hoja sm:text-dato-xl">
              {pesos(Number(cotizacion.total))}
            </p>
          )}
          {/* Lo que falta manda sobre el resumen. Un botón apagado sin decir
              por qué es el peor renglón de un formulario: con la cuenta ya
              calculada, el total tapaba el aviso y el visitante se quedaba
              picándole a "Siguiente" sin saber que le faltaba el correo. */}
          <p
            className={`${cotizacion ? 'mt-1' : ''} font-texto text-menudo ${
              falta ? 'text-estado-aviso' : 'text-arena/80'
            }`}
          >
            {falta ||
              (cotizacion
                ? `≈ ${enDolares(Number(cotizacion.total))} USD · ${jugadores.length} jugador${
                    jugadores.length > 1 ? 'es' : ''
                  }${campo?.pasarela === 'stripe' ? ' · paga en Stripe' : ''}`
                : 'Su cuenta se calcula cuando estén los jugadores.')}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {paso > 0 && (
            <button
              onClick={() => setPaso(paso - 1)}
              className="rounded-sm border border-arena/25 px-4 py-3 font-texto text-[0.95rem] font-semibold text-arena transition hover:border-hoja hover:text-hoja focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
            >
              Atrás
            </button>
          )}

          {paso < 3 ? (
            <button
              disabled={Boolean(falta) || sinSistema}
              onClick={() => (falta ? setAviso(falta) : setPaso(paso + 1))}
              title={falta || undefined}
              className="rounded-sm bg-hoja px-6 py-3 font-texto text-[0.95rem] font-bold text-sombra-honda transition hover:bg-brote disabled:cursor-not-allowed disabled:bg-arena/15 disabled:text-arena/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
            >
              {sinSistema ? 'Reservas no disponibles' : 'Siguiente'}
            </button>
          ) : (
            <button
              disabled={Boolean(falta) || cargando || sinSistema}
              onClick={apartarYPagar}
              className="rounded-sm bg-hoja px-6 py-3 font-texto text-[0.95rem] font-bold text-sombra-honda transition hover:bg-brote disabled:cursor-not-allowed disabled:bg-arena/15 disabled:text-arena/75 sm:px-7 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
            >
              {cargando
                ? 'Un momento…'
                : campo?.pasarela === 'stripe'
                  ? 'Pagar con tarjeta'
                  : 'Apartar esta salida'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Lo que el servidor espera de cada jugador. */
function aCuerpo(jugadores) {
  return jugadores.map((j) => ({
    nombre: j.nombre.trim(),
    edad: j.edad ? Number(j.edad) : null,
    handicap: j.handicap.trim() || null,
    pga: j.pga.trim() || null,
    bastones: j.bastones || null,
  }));
}

// ------------------------------------------------------------------- piezas
/** Los cuatro pasos, para saber dónde va y poder volver a uno ya llenado. */
function Rail({ paso, onIr }) {
  return (
    <ol className="mt-3.5 flex items-center gap-1.5 border-b border-arena/12 pb-3">
      {PASOS.map((nombre, i) => {
        const aqui = i === paso;
        const hecho = i < paso;
        return (
          <li key={nombre} className="flex min-w-0 items-center gap-1.5">
            <button
              onClick={() => hecho && onIr(i)}
              disabled={!hecho && !aqui}
              aria-current={aqui ? 'step' : undefined}
              className={`whitespace-nowrap rounded-sm px-2 py-1 font-texto text-menudo font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brote ${
                aqui
                  ? 'bg-arena/[0.12] text-hoja'
                  : hecho
                    ? 'text-arena/85 hover:text-arena'
                    : 'cursor-default text-arena/70'
              }`}
            >
              <span className="tabular-nums">{i + 1}</span>
              <span className="ml-1.5 hidden sm:inline">{nombre}</span>
            </button>
            {i < PASOS.length - 1 && (
              <span aria-hidden="true" className="text-arena/70">
                ·
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Paso({ children }) {
  return <div className="space-y-4">{children}</div>;
}

function Campo({ etiqueta, children }) {
  return (
    <div>
      <p className="mb-2 font-texto text-[0.95rem] font-semibold text-arena">{etiqueta}</p>
      {children}
    </div>
  );
}

function Renglon({ t, children }) {
  return (
    <>
      <dt className="font-texto text-cifra uppercase text-arena/75">{t}</dt>
      <dd className="min-w-0 truncate text-arena">{children}</dd>
    </>
  );
}

function Aviso({ children }) {
  return (
    <p className="mt-3 rounded-sm border border-estado-aviso bg-estado-aviso-fondo px-3 py-2 font-texto text-menudo text-estado-aviso">
      {children}
    </p>
  );
}

/** Menos y más, en lugar de ocho botones numerados. */
function Contador({ valor, min, max, onCambiar }) {
  const boton =
    'flex h-8 w-8 items-center justify-center rounded-sm border border-arena/25 font-texto ' +
    'text-[1.05rem] leading-none text-arena transition hover:border-hoja hover:text-hoja ' +
    'disabled:cursor-not-allowed disabled:border-arena/10 disabled:text-arena/70 ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brote';
  return (
    <div className="flex items-center gap-2.5">
      <button onClick={() => onCambiar(valor - 1)} disabled={valor <= min} className={boton} aria-label="Uno menos">
        −
      </button>
      <span className="w-5 text-center font-titulo text-rotulo-md leading-none text-arena">
        {valor}
      </span>
      <button onClick={() => onCambiar(valor + 1)} disabled={valor >= max} className={boton} aria-label="Uno más">
        +
      </button>
    </div>
  );
}

/** Opciones en fila: se lee de un vistazo cuál está puesta. */
function Alternador({ opciones, valor, onElegir }) {
  return (
    <div className="inline-flex overflow-hidden rounded-sm border border-arena/20">
      {opciones.map((o) => {
        const puesta = o.valor === valor;
        return (
          <button
            key={String(o.valor)}
            onClick={() => !puesta && onElegir(o.valor)}
            aria-pressed={puesta}
            className={`whitespace-nowrap px-2.5 py-1.5 font-texto text-menudo font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brote ${
              puesta ? 'bg-arena/15 text-arena' : 'text-arena/75 hover:text-arena/90'
            }`}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

/** Un candado, dibujado aquí: es un icono de concepto, no una marca. */
function Candado() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-hoja" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path
        d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Una tarjeta genérica. No lleva marca de nadie: enseñar los logotipos de
 *  Visa o Mastercard sin su permiso es usar algo que no es nuestro. */
function Tarjeta() {
  return (
    <svg viewBox="0 0 22 14" className="h-3.5 w-[1.4rem] text-arena/75" aria-hidden="true">
      <rect x="0.7" y="0.7" width="20.6" height="12.6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="0.7" y="3.6" width="20.6" height="2.4" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

function Listo({ reserva, onOtra }) {
  const pagada = reserva.estado === 'CONFIRMADA';
  const cancelada = reserva.estado === 'CANCELADA';

  return (
    <div>
      <p className="font-texto text-cifra uppercase text-copa">
        {cancelada ? 'Sin reserva' : pagada ? 'Pago recibido' : 'Confirmando su pago'}
      </p>
      <h2 className="mt-2.5 font-titulo text-rotulo-xl leading-none text-arena">
        {reserva.folio}
      </h2>

      {cancelada ? (
        <p className="mt-4 max-w-lectura font-texto text-parrafo text-arena">
          No se completó el pago, así que la salida volvió a estar disponible.
          No se le cobró nada. Puede elegir otro horario cuando quiera.
        </p>
      ) : (
        <p className="mt-4 max-w-lectura font-texto text-parrafo text-arena">
          {reserva.fecha && diaEnPalabras(reserva.fecha)} a las {hhmm(reserva.hora)},{' '}
          {reserva.jugadores} jugador{reserva.jugadores > 1 ? 'es' : ''}. Preséntese
          en la casa club veinte minutos antes con este folio.
        </p>
      )}

      {/* El huésped puede volver de Stripe un instante antes de que llegue el
          aviso del banco. No es que falte pagar —ya pagó—: es que todavía no
          nos lo confirman. Decirle «le llamamos para confirmarla», como decía
          antes, lo deja creyendo que algo salió mal. */}
      {!pagada && !cancelada && (
        <Aviso>
          Su pago está entrando. En cuanto nos lo confirmen —normalmente son
          segundos— le llega su pase por correo. No hace falta que vuelva a
          pagar.
        </Aviso>
      )}

      <button
        onClick={onOtra}
        className="mt-7 rounded-sm border border-arena/25 px-6 py-3 font-texto text-[0.95rem] font-semibold text-arena transition hover:border-hoja hover:text-hoja focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brote"
      >
        {cancelada ? 'Elegir otro horario' : 'Reservar otra salida'}
      </button>
    </div>
  );
}
