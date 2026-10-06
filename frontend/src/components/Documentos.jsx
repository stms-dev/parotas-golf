/**
 * Documentos que el mostrador entrega al huésped: la responsiva que firma
 * antes de salir al campo y el recibo del cobro.
 *
 * Se imprimen desde la misma pantalla. La regla `@media print` de styles.css
 * oculta la aplicación y deja solo el documento, así que no hace falta abrir
 * otra ventana ni generar un PDF en el servidor.
 *
 * El recibo se arma con lo que ya está en la reserva —jugadores, tarifas,
 * descuentos y pagos registrados—, no con cifras recalculadas aquí: un ticket
 * que no cuadre con la caja es peor que no tener ticket.
 */
import Logo from './Logo';
import { useEffect, useState } from 'react';

import { correosApi } from '../api/client';
import { categoria, fecha, fechaHora, hora, mxn, TASA_IVA, desgloseIva } from '../utils/format';

/** Marco común: encabezado del club, cuerpo y botones que no se imprimen. */
function Marco({ titulo, subtitulo, onCerrar, ancho = 'max-w-3xl', children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className={`w-full ${ancho} my-4`}>
        <div className="no-imprimir mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-title-lg text-white">{titulo}</p>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="rounded bg-primary-container px-4 py-2 text-title-md text-on-primary shadow-card transition hover:bg-primary"
            >
              Imprimir
            </button>
            <button
              onClick={onCerrar}
              className="rounded border border-white/40 px-4 py-2 text-title-md text-white transition hover:bg-white/10"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="documento-imprimible rounded-lg bg-white p-8 shadow-modal">
          <header className="mb-6 flex items-start justify-between gap-4 border-b border-outline-variant pb-4">
            <Logo alto={62} />
            <div className="text-right">
              <p className="text-label-md uppercase tracking-wider text-on-surface-variant">
                {subtitulo}
              </p>
              <p className="font-mono text-label-sm text-outline">
                Emitido {fechaHora(new Date().toISOString())}
              </p>
            </div>
          </header>

          {children}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- responsiva */

export function Responsiva({ reservation, onCerrar }) {
  const jugadores = reservation.players || [];
  const qr = usePaseQr(reservation.id);

  return (
    <Marco
      titulo="Responsiva de salida"
      subtitulo="Responsiva y reglamento"
      onCerrar={onCerrar}
    >
      {/* El pase de la partida, para que el huésped lo lleve en papel si no
          trae el correo a la mano. */}
      {qr && (
        <div className="mb-5 flex items-center gap-4 rounded border border-outline-variant/50 bg-surface-container-low px-4 py-3">
          <img src={qr} alt="Pase de la partida" className="h-28 w-28" />
          <div>
            <p className="text-title-md text-primary">Pase de la partida</p>
            <p className="text-body-md text-outline">
              Uno solo para todo el grupo. Se lee en recepción el día de la salida.
            </p>
          </div>
        </div>
      )}

      <dl className="mb-5 grid gap-x-8 gap-y-2 text-body-lg sm:grid-cols-2">
        <Dato t="Folio" v={`#${reservation.folio}`} />
        <Dato t="Hotel" v={reservation.hotel_name || '—'} />
        <Dato t="Titular" v={reservation.holder_name} />
        <Dato t="Habitación" v={reservation.holder_room || '—'} />
        <Dato t="Fecha de juego" v={fecha(reservation.slot_date)} />
        <Dato
          t="Salida"
          v={`${hora(reservation.slot_time)} hrs · ${reservation.holes} hoyos`}
        />
        <Dato t="Reserva levantada por" v={reservation.booked_by_name || '—'} />
        <Dato t="Atendió en el mostrador" v={reservation.attended_by_name || '—'} />
      </dl>

      <section className="mb-5">
        <p className="mb-2 text-label-md uppercase tracking-wider text-primary">
          Jugadores que salen al campo
        </p>
        <table className="w-full text-left text-body-lg">
          <thead>
            <tr className="border-b border-outline-variant text-label-sm uppercase tracking-wider text-on-surface-variant">
              <th className="py-1.5">#</th>
              <th className="py-1.5">Nombre</th>
              <th className="py-1.5">Categoría</th>
              <th className="py-1.5">Bastones</th>
              <th className="py-1.5 text-right">Firma</th>
            </tr>
          </thead>
          <tbody>
            {jugadores.map((p, i) => (
              <tr key={p.id} className="border-b border-outline-variant/40">
                <td className="py-3 font-mono">{i + 1}</td>
                <td className="py-3 text-primary">{p.full_name}</td>
                <td className="py-3 text-on-surface-variant">
                  {categoria(p.category)}
                </td>
                <td className="py-3 text-on-surface-variant">
                  {p.club_hand === 'ZURDO'
                    ? 'Zurdo'
                    : p.club_hand === 'DIESTRO'
                      ? 'Diestro'
                      : 'Propios'}
                </td>
                <td className="w-40 py-3">
                  <span className="mt-4 block border-b border-outline" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-6 rounded border border-outline-variant bg-surface-container-low p-4 text-body-md leading-relaxed text-on-surface-variant">
        <p className="mb-2 text-label-md uppercase tracking-wider text-primary">
          Condiciones que acepta el huésped
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            El golf es una actividad con riesgo inherente. El jugador reconoce que participa por
            voluntad propia y libera al club de responsabilidad por lesiones derivadas del juego
            normal, salvo negligencia comprobada del club.
          </li>
          <li>
            El jugador se compromete a respetar el ritmo de juego señalado por el Caddie Master y a
            ceder el paso cuando se le indique.
          </li>
          <li>
            Código de etiqueta obligatorio: playera con cuello y calzado de golf con spikes suaves.
            No se permite el acceso al campo sin este equipamiento.
          </li>
          <li>
            El carrito se conduce únicamente por los senderos señalados y solo por mayores de edad
            con licencia vigente. Los daños causados se cargan a la cuenta del titular.
          </li>
          <li>
            Los menores de 16 años deben permanecer acompañados por un adulto responsable durante
            todo el recorrido.
          </li>
          <li>
            El equipo rentado se devuelve en la Casa Club al terminar la ronda. La pérdida o daño se
            cobra a valor de reposición.
          </li>
        </ol>
      </section>

      <section className="grid gap-8 pt-6 sm:grid-cols-2">
        <Firma etiqueta="Titular de la reserva" nombre={reservation.holder_name} />
        <Firma etiqueta="Recepción · Casa Club" nombre="" />
      </section>

      <p className="mt-6 text-center text-label-sm text-outline">
        Las Parotas · Club de Golf Huatulco · Documento interno, no es comprobante fiscal.
      </p>
    </Marco>
  );
}

/* ----------------------------------------------------------------- recibo */

export function Recibo({ reservation, cuenta, onCerrar }) {
  const jugadores = reservation.players || [];
  // El acompañante no es un servicio: viene con la partida y se imprime junto
  // a los jugadores, aunque no juegue.
  const acompanantes = (reservation.services || []).filter(
    (s) => s.service_code === 'ACOMPANANTE' && s.quantity > 0,
  );
  // Si ya pasó por el mostrador, solo se imprime a quien llegó.
  const nombresAcomp = (reservation.companions || [])
    .filter((c) => !reservation.checked_in_at || c.arrived)
    .map((c) => c.full_name)
    .join(', ');
  const servicios = (reservation.services || []).filter((s) => s.service_code !== 'ACOMPANANTE');
  const totalAcompanantes = acompanantes.reduce((suma, s) => suma + Number(s.total), 0);
  const totalServicios = Number(reservation.subtotal_services || 0) - totalAcompanantes;
  const pagos = reservation.payments || [];

  const pagado = Number(cuenta?.total_paid ?? reservation.total_paid ?? 0);
  const saldo = Number(cuenta?.balance ?? reservation.balance ?? 0);

  return (
    <Marco
      titulo="Recibo de cobro"
      subtitulo={`Recibo · Folio #${reservation.folio}`}
      onCerrar={onCerrar}
      ancho="max-w-xl"
    >
      <dl className="mb-4 grid gap-x-6 gap-y-1.5 text-body-md sm:grid-cols-2">
        <Dato t="Titular" v={reservation.holder_name} />
        <Dato t="Hotel" v={reservation.hotel_name || '—'} />
        <Dato t="Fecha de juego" v={fecha(reservation.slot_date)} />
        <Dato t="Salida" v={`${hora(reservation.slot_time)} hrs`} />
        <Dato t="Atendió" v={reservation.attended_by_name || '—'} />
      </dl>

      <table className="mb-4 w-full text-left text-body-md">
        <thead>
          <tr className="border-y border-outline-variant text-label-sm uppercase tracking-wider text-on-surface-variant">
            <th className="py-1.5">Concepto</th>
            <th className="py-1.5 text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {jugadores.map((p) => (
            <tr key={p.id} className="border-b border-outline-variant/30">
              <td className="py-2">
                <span className="block text-on-surface">{p.full_name}</span>
                <span className="block text-label-sm text-outline">
                  Green fee {categoria(p.category).toLowerCase()} ·{' '}
                  {reservation.holes} hoyos
                </span>
              </td>
              {/* Va la tarifa base, no la ya descontada: el beneficio PGA baja
                  después, en su propia línea, para que las filas sumen el
                  subtotal y el descuento se vea de dónde salió. */}
              <td className="py-2 text-right font-mono text-on-surface">{mxn(p.rate_applied)}</td>
            </tr>
          ))}

          {acompanantes.map((s) => (
            <tr key={`a-${s.id}`} className="border-b border-outline-variant/30">
              <td className="py-2">
                <span className="block text-on-surface">
                  {nombresAcomp || 'Acompañante'}
                </span>
                <span className="block text-label-sm text-outline">
                  Acompañante · no juega · {s.quantity} × {mxn(s.unit_price_applied)}
                </span>
              </td>
              <td className="py-2 text-right font-mono text-on-surface">{mxn(s.total)}</td>
            </tr>
          ))}

          {reservation.carts_used > 0 && (
            <tr className="border-b border-outline-variant/30">
              <td className="py-2">
                <span className="block text-on-surface">
                  {reservation.carts_used} carrito{reservation.carts_used === 1 ? '' : 's'} de golf
                </span>
                <span className="block text-label-sm text-outline">
                  Incluido con la partida · dos personas por carrito
                </span>
              </td>
              <td className="py-2 text-right font-mono text-outline">Incluido</td>
            </tr>
          )}

          {/* El caddie va en la responsiva a propósito: el club no lo cobra,
              pero el huésped tiene que saber que le paga directo y cuánto. */}
          {reservation.caddies_used > 0 && (
            <tr className="border-b border-outline-variant/30">
              <td className="py-2">
                <span className="block text-on-surface">
                  {reservation.caddies_used} caddie{reservation.caddies_used === 1 ? '' : 's'}
                </span>
                <span className="block text-label-sm text-outline">
                  Uno por carrito · se le paga directo al caddie en el campo
                </span>
              </td>
              <td className="py-2 text-right font-mono text-outline">Pago directo</td>
            </tr>
          )}

          {servicios.map((s) => (
            <tr key={`s-${s.id}`} className="border-b border-outline-variant/30">
              <td className="py-2">
                <span className="block text-on-surface">{s.service_name}</span>
                <span className="block text-label-sm text-outline">
                  {s.quantity} × {mxn(s.unit_price_applied)}
                </span>
              </td>
              <td className="py-2 text-right font-mono text-on-surface">{mxn(s.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mb-4 space-y-1 border-t border-outline-variant pt-3 text-body-md">
        <Linea
          t={`Green fees base (${jugadores.length} cupos)`}
          v={mxn(reservation.subtotal_green_fees)}
        />
        {/* Una línea por credencial, con nombre y código: así el huésped ve a
            quién se le aplicó y no parece un descuento de grupo. */}
        {jugadores
          .filter((p) => Number(p.pga_discount_applied) > 0)
          .map((p) => (
            <Linea
              key={`pga-${p.id}`}
              t={`Descuento PGA · ${p.full_name}${p.pga_code ? ` (${p.pga_code})` : ''}`}
              v={`−${mxn(p.pga_discount_applied)}`}
            />
          ))}
        {totalAcompanantes > 0 && (
          <Linea t={`Acompañantes (${acompanantes.reduce((n, s) => n + s.quantity, 0)})`} v={mxn(totalAcompanantes)} />
        )}
        {totalServicios > 0 && <Linea t="Servicios" v={mxn(totalServicios)} />}
        {Number(reservation.discount_amount) > 0 && (
          <Linea t="Descuento convenio" v={`−${mxn(reservation.discount_amount)}`} />
        )}
        <div className="border-t border-outline-variant/50 pt-1">
          <Linea t="Subtotal sin IVA" v={mxn(desgloseIva(reservation.total).base)} />
          <Linea t={`IVA ${TASA_IVA}% (incluido)`} v={mxn(desgloseIva(reservation.total).iva)} />
        </div>
        <div className="flex items-baseline justify-between border-t border-outline-variant pt-2">
          <dt className="text-title-md text-primary">Total</dt>
          <dd className="font-serif text-headline-md text-primary">{mxn(reservation.total)}</dd>
        </div>
      </dl>

      {pagos.length > 0 && (
        <section className="mb-4">
          <p className="mb-1.5 text-label-md uppercase tracking-wider text-primary">
            Formas de pago
          </p>
          <ul className="space-y-1 text-body-md">
            {pagos.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <span className="text-on-surface-variant">
                  {p.method === 'EFECTIVO' ? 'Efectivo' : p.method === 'TARJETA' ? 'Tarjeta' : 'Transferencia'}
                  {p.currency === 'USD'
                    ? ` · ${Number(p.amount).toFixed(2)} USD @ ${Number(p.exchange_rate_applied).toFixed(2)}`
                    : ''}
                </span>
                <span className="font-mono text-on-surface">{mxn(p.amount_mxn)}</span>
              </li>
            ))}
            {/* En efectivo se pudo recibir de más: el cambio va impreso. */}
            {pagos
              .filter((p) => Number(p.change_mxn) > 0)
              .map((p) => (
                <li key={`c-${p.id}`} className="flex justify-between gap-3">
                  <span className="text-on-surface-variant">Cambio entregado en efectivo</span>
                  <span className="font-mono text-on-surface">−{mxn(p.change_mxn)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <dl className="space-y-1 border-t border-outline-variant pt-3 text-body-md">
        <Linea t="Pagado" v={mxn(pagado)} />
        <Linea t="Saldo" v={mxn(saldo)} />
      </dl>

      <p className="mt-6 border-t border-outline-variant pt-4 text-center text-label-sm leading-relaxed text-outline">
        Las Parotas · Club de Golf Huatulco
        <br />
        Comprobante interno de cobro. No es un comprobante fiscal.
        <br />
        Si requiere factura, solicítela en recepción.
      </p>
    </Marco>
  );
}

/**
 * Trae la imagen del pase ya autenticada. El <img> no puede pedirla directo:
 * el navegador no manda el token de la sesión en esa petición.
 */
function usePaseQr(reservationId) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!reservationId) return undefined;
    let vigente = true;
    let direccion = null;
    correosApi
      .qr(reservationId)
      .then((generada) => {
        direccion = generada;
        if (vigente) setUrl(generada);
        else URL.revokeObjectURL(generada);
      })
      .catch(() => setUrl(null));
    return () => {
      vigente = false;
      if (direccion) URL.revokeObjectURL(direccion);
    };
  }, [reservationId]);

  return url;
}

/* ---------------------------------------------------------- ticket replay */

/**
 * Segundo ticket del mismo folio. Solo lleva la ronda extra: el ticket
 * original ya se entregó y no se vuelve a imprimir con otro total.
 */
export function ReciboReplay({ reservation, replay, numero = 1, onCerrar }) {
  const pagos = replay.payments || [];
  return (
    <Marco
      titulo="Ticket de replay"
      subtitulo={`Replay ${numero} · Folio #${reservation.folio}`}
      onCerrar={onCerrar}
      ancho="max-w-xl"
    >
      <dl className="mb-4 grid gap-x-6 gap-y-1.5 text-body-md sm:grid-cols-2">
        <Dato t="Titular" v={reservation.holder_name} />
        <Dato t="Fecha de juego" v={fecha(reservation.slot_date)} />
        <Dato t="Salida original" v={`${hora(reservation.slot_time)} hrs`} />
        {replay.slot_time && <Dato t="Salida del replay" v={`${hora(replay.slot_time)} hrs`} />}
        {/* El nombre de la persona manda sobre el de la cuenta: la del
            mostrador la comparten los turnos. */}
        <Dato t="Cobrado por" v={replay.attended_by_name || replay.created_by_name || '—'} />
      </dl>

      <table className="mb-4 w-full text-left text-body-md">
        <thead>
          <tr className="border-y border-outline-variant text-label-sm uppercase tracking-wider text-on-surface-variant">
            <th className="py-1.5">Concepto</th>
            <th className="py-1.5 text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-outline-variant/30">
            <td className="py-2">
              <span className="block text-on-surface">Replay · ronda extra de la partida</span>
              <span className="block text-label-sm text-outline">Precio fijo por partida</span>
            </td>
            <td className="py-2 text-right font-mono text-on-surface">{mxn(replay.total)}</td>
          </tr>
        </tbody>
      </table>

      <dl className="mb-4 space-y-1 border-t border-outline-variant pt-3 text-body-md">
        <div className="flex items-baseline justify-between pt-1">
          <dt className="text-title-md text-primary">Total del replay</dt>
          <dd className="font-serif text-headline-md text-primary">{mxn(replay.total)}</dd>
        </div>
      </dl>

      {pagos.length > 0 && (
        <section className="mb-4">
          <p className="mb-1.5 text-label-md uppercase tracking-wider text-primary">Formas de pago</p>
          <ul className="space-y-1 text-body-md">
            {pagos.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <span className="text-on-surface-variant">
                  {p.method === 'EFECTIVO' ? 'Efectivo' : p.method === 'TARJETA' ? 'Tarjeta' : 'Transferencia'}
                  {p.currency === 'USD'
                    ? ` · ${Number(p.amount).toFixed(2)} USD @ ${Number(p.exchange_rate_applied).toFixed(2)}`
                    : ''}
                </span>
                <span className="font-mono text-on-surface">{mxn(p.amount_mxn)}</span>
              </li>
            ))}
            {/* En efectivo se pudo recibir de más: el cambio va impreso. */}
            {pagos
              .filter((p) => Number(p.change_mxn) > 0)
              .map((p) => (
                <li key={`c-${p.id}`} className="flex justify-between gap-3">
                  <span className="text-on-surface-variant">Cambio entregado en efectivo</span>
                  <span className="font-mono text-on-surface">−{mxn(p.change_mxn)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <p className="mt-6 border-t border-outline-variant pt-4 text-center text-label-sm leading-relaxed text-outline">
        Las Parotas · Club de Golf Huatulco
        <br />
        Comprobante interno de cobro. No es un comprobante fiscal.
      </p>
    </Marco>
  );
}

/* ----------------------------------------------------------------- piezas */

function Dato({ t, v }) {
  return (
    <div className="flex justify-between gap-3 border-b border-outline-variant/30 py-1">
      <dt className="text-on-surface-variant">{t}</dt>
      <dd className="text-right text-title-md text-primary">{v}</dd>
    </div>
  );
}

function Linea({ t, v }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-on-surface-variant">{t}</dt>
      <dd className="font-mono text-on-surface">{v}</dd>
    </div>
  );
}

function Firma({ etiqueta, nombre }) {
  return (
    <div>
      <span className="block h-12" />
      <span className="block border-b border-outline" />
      <p className="mt-1 text-body-md text-on-surface">{nombre || ' '}</p>
      <p className="text-label-sm uppercase tracking-wider text-outline">{etiqueta}</p>
    </div>
  );
}
