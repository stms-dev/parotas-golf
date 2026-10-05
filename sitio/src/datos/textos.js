/**
 * Todo lo que el sitio dice, en los dos idiomas.
 *
 * Un solo archivo a propósito: con dos idiomas y cinco pantallas, repartir las
 * frases por componente obliga a abrir cinco archivos para revisar que una
 * traducción cuadre con otra. Aquí se leen una debajo de la otra.
 *
 * La clave nombra la pantalla y lo que es —`tarifas.incluye`, no `k_42`— para
 * que al leer el componente se entienda qué va a salir sin venir a buscarlo.
 *
 * El inglés no es la traducción literal del español. «Le apartamos la salida
 * treinta minutos mientras paga» en inglés literal suena a aviso de banco; lo
 * que dice es lo mismo con las palabras que usaría un club de golf
 * angloparlante. Donde el español trata de usted, el inglés simplemente no
 * tiene esa distinción y se queda en su registro cortés normal.
 */
export const TEXTOS = {
  es: {
    // ------------------------------------------------------------ el marco
    'nav.inicio': 'Inicio',
    'nav.campo': 'El campo',
    'nav.tarifas': 'Tarifas',
    'nav.reservar': 'Reservar',
    'nav.evento': 'Evento privado',
    'nav.acceder': 'Acceder',
    'nav.irAlInicio': 'Ir al inicio',
    'pie.lugar': 'Club de Golf Huatulco · Bahías de Huatulco, Oaxaca',
    // La conjunción con la que se cierra una enumeración escrita.
    'lista.union': 'y',
    /*
     * La terminación de plural de «jugador», para las frases que llevan el
     * número al lado: «2 jugadores», «2 players». No es una regla de plurales
     * de verdad —no la necesita: el único plural del sitio es este, y ninguno
     * de los dos idiomas cambia la palabra, solo le agrega una letra—. Si
     * algún día hace falta pluralizar otra cosa, esto no se estira: ahí sí
     * toca `Intl.PluralRules`.
     */
    'plural.jugador': 'es',
    'mapa.hoyo': 'Hoyo {n} · par {par}',
    'mapa.alt': 'Trazo del campo: dieciocho hoyos',
    'mapa.unHoyo': 'Hoyo {n}, par {par}',

    // ------------------------------------------------------------- inicio
    'salida.lugar': 'Bahías de Huatulco, Oaxaca',
    'salida.titulo1': 'Dieciocho hoyos',
    'salida.titulo2': 'bajo las parotas',
    'salida.cuerpo':
      'Las parotas ya estaban aquí cuando se trazó el campo: árboles de copa ' +
      'ancha que dan sombra a media hectárea cada uno. En lugar de tumbarlas, ' +
      'Agustín Pizá acomodó el recorrido entre ellas. Por eso ningún hoyo se ' +
      'parece al anterior, y por eso el campo se llama como se llama.',
    'salida.par': 'Par',
    'salida.hoyos': 'Hoyos',
    'salida.salidas': 'Salidas',
    'salida.diseno': 'Diseño',
    'salida.reservar': 'Reservar una salida',
    'salida.verTarifas': 'Ver tarifas',

    // ---------------------------------------------------------- el campo
    'campo.par': 'Par {par} · {mitad}',
    'campo.ida': 'la ida',
    'campo.vuelta': 'la vuelta',
    'campo.foto': 'El campo en el hoyo {n}',
    'campo.anterior': 'Hoyo anterior',
    'campo.siguiente': 'Hoyo siguiente',
    'campo.cuenta': '{n} de 18',

    // ------------------------------------------------------------ tarifas
    'tarifas.titulo': 'Tarifas',
    'tarifas.incluye':
      'El green fee incluye {incluido}. Precios por jugador, en pesos.',
    'tarifas.ronda': 'Ronda',
    'tarifas.semana': 'Lun a jue',
    'tarifas.fin': 'Vie a dom',
    'tarifas.hoyos': '{n} hoyos',
    'tarifas.adulto': 'Adulto',
    'tarifas.menores': 'Menores de 16',
    'tarifas.aparte': 'Aparte del green fee',
    'tarifas.pagoDirecto': 'se le paga directo',
    'tarifas.reservar': 'Reservar una salida',
    'tarifas.carrito': 'carrito compartido',
    'tarifas.agua': 'agua',
    'tarifas.cerveza': 'cerveza',
    'tarifas.refresco': 'refresco',
    'extra.CADDIE': 'Caddie',
    'extra.CADDIE.nota':
      'Se le paga directo al caddie. Hay dos por día y se asignan por orden de salida.',
    'extra.BASTONES': 'Renta de bastones',
    'extra.BASTONES.nota': 'Set básico: putter, madera, driver y hierros. Uno por jugador.',
    'extra.ACOMPANANTE': 'Acompañante',
    'extra.ACOMPANANTE.nota': 'Para quien va en el carrito sin jugar.',

    // ----------------------------------------------------- evento privado
    'evento.titulo': 'Evento privado',
    'evento.cuerpo':
      'El campo abre su primera salida a las {primera} y la última sale a las ' +
      '{ultima}. Cierra a las {cierre}, así que una salida tardía puede no ' +
      'alcanzar los 18 hoyos.',
    'evento.invitacion':
      '¿Un torneo, una despedida, un día de empresa? Llámenos o escríbanos y lo ' +
      'armamos con usted.',
    'evento.telefono': 'Teléfono',
    'evento.correo': 'Correo',
    'evento.donde': 'Dónde',
    'evento.acceso':
      '¿Trabaja en el club o en un hotel con convenio? Entre por {enlace} — el botón «Acceder» de arriba.',
    'evento.acceso.enlace': 'el sistema de reservas',

    // ----------------------------------------------------------- reservar
    'reservar.titulo': 'Reservar',
    'reservar.apartado': 'Le apartamos la salida durante {minutos} minutos mientras paga',
    'reservar.apartadoSinMinutos': 'Le apartamos la salida mientras paga',
    'reservar.paso1': 'Paquete',
    'reservar.paso2': 'Día y hora',
    'reservar.paso3': 'Jugadores',
    'reservar.paso4': 'Revisión',
    'reservar.atras': 'Atrás',
    'reservar.siguiente': 'Siguiente',
    'reservar.recorrido': 'Recorrido del campo',
    'reservar.nueve': '9 hoyos',
    'reservar.dieciocho': '18 hoyos',
    'reservar.media': 'Media vuelta. Por internet solo con jugadores adultos.',
    'reservar.completa': 'La vuelta completa, par 72.',
    'reservar.pax': '{min}–{max} PAX',
    'reservar.paxFijo': '{max} PAX',
    'reservar.queDia': '¿Qué día?',
    'reservar.finDeSemana': ' · fin de semana, la tarifa es más alta',
    'reservar.queHora': '¿A qué hora?',
    'reservar.consultando': 'Consultando las salidas…',
    'reservar.sinSistema': 'No podemos consultar las salidas en este momento.',
    'reservar.diaCerrado': 'Las reservas para ese día ya cerraron. Elija una fecha posterior.',
    'reservar.twilight':
      'Las de color turquesa son twilight, desde las {desde} · el campo cierra a las {cierre}',
    'reservar.sinLugares': 'No quedan lugares a esa hora',
    'reservar.quienes': 'Quiénes juegan',
    'reservar.unoMenos': 'Uno menos',
    'reservar.unoMas': 'Uno más',
    'reservar.titular': 'Titular',
    'reservar.nombreTitular': 'Nombre completo del titular',
    'reservar.nombre': 'Nombre completo',
    'reservar.edad': 'Edad',
    'reservar.handicap': 'Handicap/GHIN',
    'reservar.pga': 'PGA (opcional)',
    'reservar.traeBastones': 'Trae bastones',
    'reservar.diestro': 'Diestro',
    'reservar.zurdo': 'Zurdo',
    'reservar.renta': 'renta {precio}',
    'reservar.notaEdad':
      'La edad decide la tarifa: menor de 16 paga como infantil. El código PGA lo ' +
      'valida recepción al llegar; no descuenta nada todavía.',
    'reservar.pase': '¿A dónde le mandamos su pase?',
    'reservar.correo': 'Correo del titular',
    'reservar.telefono': 'Teléfono (opcional)',
    'reservar.calculando': 'Calculando su cuenta…',
    'reservar.paquete': 'Paquete',
    'reservar.salida': 'Salida',
    'reservar.paseA': 'Pase a',
    'reservar.aLas': '{dia} a las {hora}',
    'reservar.hoyosDe': '{n} hoyos',
    'reservar.infantil': 'Infantil',
    'reservar.adulto': 'Adulto',
    'reservar.greenFees': 'Green fees',
    'reservar.sets': 'Renta de bastones · {n} {palabra}',
    'reservar.set': 'set',
    'reservar.setPlural': 'sets',
    'reservar.caddie': 'Caddie · {precio}',
    'reservar.caddieNota':
      'se le paga directo a él, no va en esta cuenta · hay dos y se asignan por orden de salida',
    'reservar.incluye':
      'Incluye carrito compartido, agua, cerveza y refresco. Preséntese en la casa ' +
      'club veinte minutos antes de su salida.',
    'reservar.pagoSeguro': 'Pago seguro con Stripe',
    'reservar.pagoNota':
      'Al confirmar lo mandamos a la página de pago de Stripe y vuelve aquí con su ' +
      'folio. Su tarjeta nunca pasa por el servidor del club. Aceptamos Visa, ' +
      'Mastercard y American Express.',
    'reservar.total.usd': '≈ {usd} USD · {n} jugador{es}{stripe}',
    'reservar.total.stripe': ' · paga en Stripe',
    'reservar.sinCuenta': 'Su cuenta se calcula cuando estén los jugadores.',
    'reservar.pagar': 'Pagar con tarjeta',
    'reservar.apartar': 'Apartar esta salida',
    'reservar.unMomento': 'Un momento…',
    'reservar.noDisponible': 'Reservas no disponibles',

    // avisos de lo que falta
    'falta.hora': 'Elija una hora de salida.',
    'falta.nombre': 'Falta el nombre completo del jugador {n}.',
    'falta.edad': 'Falta la edad del jugador {n}: de ella depende su tarifa.',
    'falta.correo': 'Hace falta el correo del titular: ahí le llega su pase.',
    'falta.cuenta': 'Estamos calculando su cuenta.',
    'reservar.sinAbiertas':
      'Ese día el campo no está armando partidas abiertas. Reserve con cuatro ' +
      'jugadores o elija otra fecha.',
    'reservar.cambioPaquete':
      'El {dia} el campo no está armando partidas abiertas. Se cambió el paquete a En Grupo.',
    'reservar.sinConexion':
      'No pudimos conectar con el sistema de reservas. Llámenos y con gusto le ' +
      'apartamos su salida.',

    // el final
    'listo.sinReserva': 'Sin reserva',
    'listo.pagado': 'Pago recibido',
    'listo.confirmando': 'Confirmando su pago',
    'listo.cancelado':
      'No se completó el pago, así que la salida volvió a estar disponible. No se ' +
      'le cobró nada. Puede elegir otro horario cuando quiera.',
    'listo.detalle':
      '{dia} a las {hora}, {n} jugador{es}. Preséntese en la casa club veinte ' +
      'minutos antes con este folio.',
    'listo.entrando':
      'Su pago está entrando. En cuanto nos lo confirmen —normalmente son segundos— ' +
      'le llega su pase por correo. No hace falta que vuelva a pagar.',
    'listo.otroHorario': 'Elegir otro horario',
    'listo.otraSalida': 'Reservar otra salida',
    'listo.noEncontrada': 'No encontramos esa reserva.',

    // el diálogo de cancelación
    'cancelado.titulo': 'No se hizo la reserva',
    'cancelado.cuerpo':
      'Se canceló el pago, así que la salida volvió a estar disponible. No se le ' +
      'cobró nada y no hay nada que cancelar. Puede elegir otro horario cuando quiera.',
    'dialogo.entendido': 'Entendido',

    // paquetes
    'paquete.GRUPO': 'En Grupo',
    'paquete.GRUPO.detalle':
      'La salida es suya: arma su propio grupo y nadie más se les junta.',
    'paquete.PARTIDA_ABIERTA': 'Partida Abierta',
    'paquete.PARTIDA_ABIERTA.detalle':
      'Sale con los que se junten, hasta llegar a cuatro. Para cuando van menos.',
    'paquete.noAbiertas': 'Ese día el campo no está armando partidas abiertas.',
  },

  en: {
    // ------------------------------------------------------------ el marco
    'nav.inicio': 'Home',
    'nav.campo': 'The course',
    'nav.tarifas': 'Rates',
    'nav.reservar': 'Book',
    'nav.evento': 'Private events',
    'nav.acceder': 'Sign in',
    'nav.irAlInicio': 'Back to home',
    'pie.lugar': 'Club de Golf Huatulco · Bahías de Huatulco, Oaxaca',
    'lista.union': 'and',
    'plural.jugador': 's',
    'mapa.hoyo': 'Hole {n} · par {par}',
    'mapa.alt': 'Course routing: eighteen holes',
    'mapa.unHoyo': 'Hole {n}, par {par}',

    // ------------------------------------------------------------- inicio
    'salida.lugar': 'Bahías de Huatulco, Oaxaca',
    'salida.titulo1': 'Eighteen holes',
    'salida.titulo2': 'under the parotas',
    'salida.cuerpo':
      'The parota trees were here before the course was: broad-crowned giants, ' +
      'each one shading half an acre. Rather than cut them down, Agustín Pizá ' +
      'routed the holes around them. That is why no two holes play alike, and ' +
      'why the course is named after the trees.',
    'salida.par': 'Par',
    'salida.hoyos': 'Holes',
    'salida.salidas': 'Tee times',
    'salida.diseno': 'Design',
    'salida.reservar': 'Book a tee time',
    'salida.verTarifas': 'See rates',

    // ---------------------------------------------------------- el campo
    'campo.par': 'Par {par} · {mitad}',
    'campo.ida': 'front nine',
    'campo.vuelta': 'back nine',
    'campo.foto': 'The course at hole {n}',
    'campo.anterior': 'Previous hole',
    'campo.siguiente': 'Next hole',
    'campo.cuenta': '{n} of 18',

    // ------------------------------------------------------------ tarifas
    'tarifas.titulo': 'Rates',
    'tarifas.incluye':
      'The green fee includes {incluido}. Per player, in Mexican pesos.',
    'tarifas.ronda': 'Round',
    'tarifas.semana': 'Mon–Thu',
    'tarifas.fin': 'Fri–Sun',
    'tarifas.hoyos': '{n} holes',
    'tarifas.adulto': 'Adult',
    'tarifas.menores': 'Under 16',
    'tarifas.aparte': 'Not included in the green fee',
    'tarifas.pagoDirecto': 'paid directly',
    'tarifas.reservar': 'Book a tee time',
    'tarifas.carrito': 'a shared cart',
    'tarifas.agua': 'water',
    'tarifas.cerveza': 'beer',
    'tarifas.refresco': 'soft drinks',
    'extra.CADDIE': 'Caddie',
    'extra.CADDIE.nota':
      'Paid directly to the caddie. Two are available each day, assigned by tee time.',
    'extra.BASTONES': 'Club rental',
    'extra.BASTONES.nota': 'Basic set: putter, wood, driver and irons. One per player.',
    'extra.ACOMPANANTE': 'Non-playing guest',
    'extra.ACOMPANANTE.nota': 'For anyone riding along without playing.',

    // ----------------------------------------------------- evento privado
    'evento.titulo': 'Private events',
    'evento.cuerpo':
      'First tee time is {primera} and the last one goes out at {ultima}. The ' +
      'course closes at {cierre}, so a late start may not reach all 18 holes.',
    'evento.invitacion':
      'A tournament, a bachelor party, a company day? Call or write and we will ' +
      'put it together with you.',
    'evento.telefono': 'Phone',
    'evento.correo': 'Email',
    'evento.donde': 'Where',
    'evento.acceso':
      'Club staff or a partner hotel? Sign in through {enlace} — the "Sign in" button above.',
    'evento.acceso.enlace': 'the booking system',

    // ----------------------------------------------------------- reservar
    'reservar.titulo': 'Book',
    'reservar.apartado': 'We hold your tee time for {minutos} minutes while you pay',
    'reservar.apartadoSinMinutos': 'We hold your tee time while you pay',
    'reservar.paso1': 'Package',
    'reservar.paso2': 'Date & time',
    'reservar.paso3': 'Players',
    'reservar.paso4': 'Review',
    'reservar.atras': 'Back',
    'reservar.siguiente': 'Next',
    'reservar.recorrido': 'Round',
    'reservar.nueve': '9 holes',
    'reservar.dieciocho': '18 holes',
    'reservar.media': 'Half a round. Online, adults only.',
    'reservar.completa': 'The full round, par 72.',
    'reservar.pax': '{min}–{max} players',
    'reservar.paxFijo': '{max} players',
    'reservar.queDia': 'Which day?',
    'reservar.finDeSemana': ' · weekend rate applies',
    'reservar.queHora': 'What time?',
    'reservar.consultando': 'Checking tee times…',
    'reservar.sinSistema': 'We cannot check tee times right now.',
    'reservar.diaCerrado': 'Bookings for that day are closed. Please pick a later date.',
    'reservar.twilight':
      'The turquoise ones are twilight, from {desde} · the course closes at {cierre}',
    'reservar.sinLugares': 'No spots left at that time',
    'reservar.quienes': "Who's playing",
    'reservar.unoMenos': 'One fewer',
    'reservar.unoMas': 'One more',
    'reservar.titular': 'Lead player',
    'reservar.nombreTitular': 'Lead player, full name',
    'reservar.nombre': 'Full name',
    'reservar.edad': 'Age',
    'reservar.handicap': 'Handicap/GHIN',
    'reservar.pga': 'PGA (optional)',
    'reservar.traeBastones': 'Own clubs',
    'reservar.diestro': 'Right-handed',
    'reservar.zurdo': 'Left-handed',
    'reservar.renta': 'rental {precio}',
    'reservar.notaEdad':
      'Age sets the rate: under 16 pays the junior rate. The PGA number is checked ' +
      'at the clubhouse on arrival; it does not discount anything yet.',
    'reservar.pase': 'Where should we send your pass?',
    'reservar.correo': 'Lead player email',
    'reservar.telefono': 'Phone (optional)',
    'reservar.calculando': 'Working out your total…',
    'reservar.paquete': 'Package',
    'reservar.salida': 'Tee time',
    'reservar.paseA': 'Pass to',
    'reservar.aLas': '{dia} at {hora}',
    'reservar.hoyosDe': '{n} holes',
    'reservar.infantil': 'Junior',
    'reservar.adulto': 'Adult',
    'reservar.greenFees': 'Green fees',
    'reservar.sets': 'Club rental · {n} {palabra}',
    'reservar.set': 'set',
    'reservar.setPlural': 'sets',
    'reservar.caddie': 'Caddie · {precio}',
    'reservar.caddieNota':
      'paid directly to the caddie, not part of this total · two available, assigned by tee time',
    'reservar.incluye':
      'Includes a shared cart, water, beer and soft drinks. Please come to the ' +
      'clubhouse twenty minutes before your tee time.',
    'reservar.pagoSeguro': 'Secure payment with Stripe',
    'reservar.pagoNota':
      'When you confirm we send you to Stripe to pay, and you come back here with ' +
      'your booking number. Your card never touches the club server. We accept ' +
      'Visa, Mastercard and American Express.',
    'reservar.total.usd': '≈ {usd} USD · {n} player{es}{stripe}',
    'reservar.total.stripe': ' · pay with Stripe',
    'reservar.sinCuenta': 'Your total appears once the players are in.',
    'reservar.pagar': 'Pay by card',
    'reservar.apartar': 'Hold this tee time',
    'reservar.unMomento': 'One moment…',
    'reservar.noDisponible': 'Booking unavailable',

    'falta.hora': 'Please pick a tee time.',
    'falta.nombre': "Player {n}'s full name is missing.",
    'falta.edad': "Player {n}'s age is missing — the rate depends on it.",
    'falta.correo': 'We need the lead player email: that is where the pass goes.',
    'falta.cuenta': 'We are working out your total.',
    'reservar.sinAbiertas':
      'The course is not making up open groups that day. Book with four players or ' +
      'pick another date.',
    'reservar.cambioPaquete':
      'The course is not making up open groups on {dia}. The package was changed to Group.',
    'reservar.sinConexion':
      'We could not reach the booking system. Give us a call and we will gladly hold ' +
      'your tee time.',

    'listo.sinReserva': 'No booking',
    'listo.pagado': 'Payment received',
    'listo.confirmando': 'Confirming your payment',
    'listo.cancelado':
      'The payment was not completed, so the tee time is available again. You were ' +
      'not charged. Pick another time whenever you like.',
    'listo.detalle':
      '{dia} at {hora}, {n} player{es}. Please come to the clubhouse twenty minutes ' +
      'before, with this number.',
    'listo.entrando':
      'Your payment is coming through. As soon as it clears — usually seconds — your ' +
      'pass arrives by email. No need to pay again.',
    'listo.otroHorario': 'Pick another time',
    'listo.otraSalida': 'Book another tee time',
    'listo.noEncontrada': 'We could not find that booking.',

    'cancelado.titulo': 'No booking was made',
    'cancelado.cuerpo':
      'The payment was cancelled, so the tee time is available again. You were not ' +
      'charged and there is nothing to cancel. Pick another time whenever you like.',
    'dialogo.entendido': 'Got it',

    'paquete.GRUPO': 'Group',
    'paquete.GRUPO.detalle':
      'The tee time is yours: bring your own group and nobody joins you.',
    'paquete.PARTIDA_ABIERTA': 'Open group',
    'paquete.PARTIDA_ABIERTA.detalle':
      'You go out with whoever makes up the four. For parties of fewer than four.',
    'paquete.noAbiertas': 'The course is not making up open groups that day.',
  },
};
