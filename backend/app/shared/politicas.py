"""Políticas y Reglamento del club, en español y en inglés.

Un solo lugar a propósito: el sitio las muestra antes de reservar (llegan en
`/public/campo`) y el correo del pase las repite completas. Si el club cambia
una regla, cambia aquí y las dos pantallas dicen lo mismo.

Cada apartado es un diccionario con `titulo` (la palabra en negritas con la que
abre), `texto` y, si trae viñetas, `items`.
"""
from typing import Dict, List, Optional


def _p(titulo: str, texto: str = "", items: Optional[List[str]] = None) -> Dict:
    return {"titulo": titulo, "texto": texto, "items": items or []}


POLITICAS: Dict[str, Dict] = {
    "es": {
        "titulo": "Políticas y Reglamento — Club de Golf Las Parotas",
        "intro": "Gracias por su reservación. Le pedimos leer las siguientes políticas y reglas antes de su visita.",
        "politicas_titulo": "Políticas",
        "politicas": [
            _p("Aceptación.", "El ingreso a las instalaciones, la reservación de una salida o el pago de cualquier cuota implica la aceptación expresa e incondicional del presente Reglamento."),
            _p("Identificación.", "Todo Usuario deberá registrarse en recepción (Pro Shop) antes de iniciar su juego y presentar identificación y código de reserva."),
            _p("Menores de edad.", "Los menores de 12 años deberán estar acompañados en todo momento por un adulto responsable. Los menores podrán jugar en el campo cuando acrediten conocimiento suficiente del juego y la etiqueta, a juicio del caddie master."),
            _p("Derecho de admisión.", "El Club se reserva el derecho de admisión, sin discriminación alguna por origen étnico, género, edad, discapacidad, religión, orientación sexual o cualquier otra condición."),
            _p("Puntualidad.", "El Usuario deberá presentarse en recepción al menos 15 minutos antes de su horario de reserva. La impuntualidad podrá ocasionar la pérdida de la salida sin derecho a reembolso."),
            _p("Cancelaciones.", "Las cancelaciones deberán realizarse con al menos 24 horas de anticipación a la salida reservada. En tal caso, el Club no realizará reembolsos y, en su lugar, ofrecerá la reprogramación a una nueva fecha y horario, sujeta a disponibilidad. Las cancelaciones con menos de 24 horas de anticipación o la inasistencia causarán el cobro total de la cuota reservada, sin derecho a reprogramación."),
            _p("Clima.", "Cuando el campo se cierre por condiciones climáticas o de seguridad, el Club ofrecerá la reprogramación a una nueva fecha y horario, sujeta a disponibilidad, por la cantidad de hoyos no jugados."),
            _p("Asunción de riesgo.", "El golf implica riesgos inherentes, como el impacto de bolas o palos, terreno irregular, fauna silvestre y condiciones climáticas. El Usuario reconoce y asume dichos riesgos. El Club no será responsable por lesiones o daños derivados de la conducta del propio Usuario o de terceros."),
            _p("Daños.", "El Usuario responderá por los daños que cause a carritos, equipo rentado, instalaciones o terceros por uso indebido, negligencia o incumplimiento de este Reglamento."),
        ],
        "reglamento_titulo": "Reglamento",
        "reglamento": [
            _p("Código de vestimenta.", "Es obligatorio el uso de camisa tipo polo; pantalón, falda o bermuda de vestir; y zapatos de golf o calzado deportivo. No se permiten prendas de mezclilla, trajes de baño, shorts de playa ni sandalias."),
            _p("Ritmo de juego.", "Los grupos que pierdan posición respecto al grupo de adelante deberán ceder el paso. El personal de campo (marshals o caddie master) podrá instruir medidas para mantener el ritmo."),
            _p("Retiro del campo.", "El caddie master o marshal podrá solicitar el retiro de cualquier persona o jugador que viole el presente Reglamento o las reglas de juego, sin derecho a reembolso ni reprogramación."),
            _p("Reglas de juego.", "", [
                "Las prácticas en el campo de práctica están limitadas a 120 pelotas o 90 minutos, lo que ocurra primero.",
                "Queda prohibido recoger pelotas del campo de práctica, ya sea para reutilizarlas o para jugar con ellas en el campo.",
                "Queda prohibido compartir equipo; cada jugador deberá contar con su propio set o rentarlo para poder jugar.",
                "Todas las rondas se juegan con caddie obligatorio.",
                "Queda estrictamente prohibido que los clientes instalen carpas de cualquier tipo en las instalaciones del Club.",
                "Queda prohibido ingresar con carritos a los greens y a las mesas de salida.",
            ]),
            _p("Carritos de golf.", "Solo podrán conducir carritos las personas mayores de 18 años, o de 16 años acompañadas por un adulto. Máximo dos personas por carrito."),
            _p("Objetos personales.", "El Club no se hace responsable por la pérdida, robo o daño de objetos personales, equipo o vehículos dejados en sus instalaciones."),
            _p("Bebidas y alimentos.", "Se prohíbe ingresar alimentos y bebidas adquiridos fuera del Club. El consumo de bebidas alcohólicas está prohibido para menores de 18 años. Queda prohibido fumar en las instalaciones del Club."),
        ],
        "cierre": "¡Le esperamos en el campo!",
    },
    "en": {
        "titulo": "Policies and Rules — Las Parotas Golf Club",
        "intro": "Thank you for your reservation. Please read the following policies and rules before your visit.",
        "politicas_titulo": "Policies",
        "politicas": [
            _p("Acceptance.", "Entering the premises, booking a tee time or paying any fee constitutes express and unconditional acceptance of these Rules."),
            _p("Identification.", "All Users must check in at the front desk (Pro Shop) before starting play and present a valid ID and their booking code."),
            _p("Minors.", "Children under 12 must be accompanied by a responsible adult at all times. Minors may play on the course when they demonstrate sufficient knowledge of the game and its etiquette, at the discretion of the caddie master."),
            _p("Right of admission.", "The Club reserves the right of admission, without discrimination of any kind based on ethnic origin, gender, age, disability, religion, sexual orientation or any other condition."),
            _p("Punctuality.", "Users must arrive at the front desk at least 15 minutes before their scheduled tee time. Late arrival may result in the loss of the tee time without a refund."),
            _p("Cancellations.", "Cancellations must be made at least 24 hours before the scheduled tee time. In that case, the Club will not issue refunds; instead, it will offer to reschedule to a new date and time, subject to availability. Cancellations made less than 24 hours in advance, or no-shows, will be charged the full booking fee, with no option to reschedule."),
            _p("Weather.", "If the course is closed due to weather or safety conditions, the Club will offer to reschedule to a new date and time, subject to availability, for the number of holes not played."),
            _p("Assumption of risk.", "Golf involves inherent risks, such as being struck by balls or clubs, uneven terrain, wildlife and weather conditions. The User acknowledges and assumes these risks. The Club shall not be liable for injuries or damages arising from the conduct of the User or of third parties."),
            _p("Damages.", "Users shall be liable for any damage they cause to golf carts, rental equipment, facilities or third parties through misuse, negligence or failure to comply with these Rules."),
        ],
        "reglamento_titulo": "Rules",
        "reglamento": [
            _p("Dress code.", "A collared polo shirt; dress trousers, skirt or dress shorts; and golf shoes or athletic footwear are required. Denim, swimwear, beach shorts and sandals are not permitted."),
            _p("Pace of play.", "Groups that fall behind the group ahead must let the following group play through. Course staff (marshals or caddie master) may direct measures to maintain the pace of play."),
            _p("Removal from the course.", "The caddie master or a marshal may ask any person or player who violates these Rules or the rules of play to leave the course, with no refund or rescheduling."),
            _p("Rules of play.", "", [
                "Practice on the driving range is limited to 120 balls or 90 minutes, whichever comes first.",
                "Picking up balls from the driving range, whether to reuse them or to play with them on the course, is prohibited.",
                "Sharing equipment is prohibited; each player must have their own set or rent one in order to play.",
                "All rounds require a caddie.",
                "Guests are strictly prohibited from setting up tents of any kind on Club premises.",
                "Golf carts are not permitted on greens or tee boxes.",
            ]),
            _p("Golf carts.", "Only persons 18 or older, or 16-year-olds accompanied by an adult, may drive golf carts. Maximum two people per cart."),
            _p("Personal belongings.", "The Club is not responsible for the loss, theft or damage of personal belongings, equipment or vehicles left on its premises."),
            _p("Food and beverages.", "Outside food and beverages are not permitted. Alcoholic beverages may not be consumed by anyone under 18. Smoking is prohibited on Club premises."),
        ],
        "cierre": "We look forward to seeing you on the course!",
    },
}


def politicas_de(idioma: str) -> Dict:
    """Las políticas en el idioma pedido; español si no hay de ese."""
    return POLITICAS.get(idioma) or POLITICAS["es"]
