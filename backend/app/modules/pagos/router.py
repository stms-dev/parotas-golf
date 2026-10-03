"""Las rutas que el sitio del club puede llamar sin cuenta.

Todo lo demás del sistema pide sesión. Estas cinco no, porque del otro lado
hay un turista que nunca va a tener usuario. Eso obliga a dos cuidados que no
hacen falta puertas adentro:

- **No se devuelve nada de nadie.** De una salida ocupada solo se sabe que
  está ocupada, nunca quién la tomó ni de qué hotel.
- **Se cuentan los intentos.** Sin un tope, un script aparta todas las salidas
  del mes en diez minutos y deja el campo vacío y vendido. El tope es simple y
  vive en memoria; para producción lo que corresponde es un captcha (Cloudflare
  Turnstile, que es gratis y el club ya está en Cloudflare).
"""
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.exceptions import BusinessRuleError
from app.modules.pagos import stripe_gateway
from app.modules.pagos.service import ReservaPublicaService

router = APIRouter(prefix="/public", tags=["Sitio público"])


# ------------------------------------------------------------------ contratos
class ExtraOut(BaseModel):
    code: str
    nombre: str
    descripcion: Optional[str] = None
    precio: Decimal
    pago_directo: bool = False


class TarifaOut(BaseModel):
    modalidad: str
    hoyos: int
    categoria: str
    dia: str
    franja: str
    precio: Decimal


class PaqueteOut(BaseModel):
    """Cuánta gente admite cada paquete. El sitio no lo trae escrito: lo pide,
    para que el día que el club mueva el mínimo no haya que tocar el sitio."""

    modalidad: str
    minimo: int
    maximo: int


class CampoOut(BaseModel):
    primera_salida: Optional[time] = None
    ultima_salida: Optional[time] = None
    intervalo_minutos: Optional[int] = None
    cupo_por_salida: int = 4
    cierre_de_campo: Optional[time] = None
    twilight_desde: Optional[time] = None
    tipo_de_cambio: Decimal
    tarifas: List[TarifaOut] = []
    extras: List[ExtraOut] = []
    paquetes: List[PaqueteOut] = []
    minimo_grupo: int = 4
    cupo_partida_abierta: int = 4
    apartado_minutos: int = 15
    # Si el cobro en línea está prendido. Con esto el sitio sabe si mandar al
    # huésped a pagar o decirle que el club le va a llamar.
    cobro_disponible: bool = False
    # Cómo se cobra: "stripe" manda a la página de Stripe; "simulado" pide la
    # tarjeta en el sitio y no cobra nada. El sitio pinta distinto cada caso
    # para que nadie crea que pagó cuando no.
    pasarela: Optional[str] = None


class SalidaOut(BaseModel):
    id: int
    hora: time
    libres: int
    twilight: bool = False


class DisponibilidadOut(BaseModel):
    fecha: date
    dia_cerrado: bool = False
    admite_partida_abierta: bool = True
    cierre_de_campo: Optional[time] = None
    twilight_desde: Optional[time] = None
    salidas: List[SalidaOut] = []


class JugadorIn(BaseModel):
    """Un jugador, con lo mismo que pide el mostrador menos lo del hotel.

    El primero de la lista es el titular: el correo y el teléfono de la reserva
    son los suyos, y a él le llega el pase.
    """

    nombre: str = Field(min_length=3, max_length=180)
    edad: Optional[int] = Field(default=None, ge=1, le=120)
    pga: Optional[str] = Field(default=None, max_length=40)
    # Un solo campo para los dos: el jugador da su hándicap o su credencial
    # GHIN, y lo que el club necesita es tenerlo anotado.
    handicap: Optional[str] = Field(default=None, max_length=24)
    # Vacío si trae sus bastones; DIESTRO o ZURDO si los renta.
    bastones: Optional[str] = Field(default=None, pattern="^(DIESTRO|ZURDO)$")


class CotizarIn(BaseModel):
    tee_slot_id: int
    modalidad: str
    hoyos: int = Field(default=18)
    jugadores: List[JugadorIn] = Field(min_length=1, max_length=8)


class RenglonOut(BaseModel):
    nombre: str
    categoria: str
    green_fee: Decimal


class CotizacionOut(BaseModel):
    modalidad: str
    hoyos: int
    fecha: date
    hora: time
    twilight: bool = False
    jugadores: List[RenglonOut] = []
    green_fees: Decimal
    sets_bastones: int = 0
    precio_bastones: Decimal
    subtotal_bastones: Decimal
    total: Decimal
    caddie_por_persona: Optional[Decimal] = None


class ApartarIn(BaseModel):
    tee_slot_id: int
    fecha: date
    modalidad: str
    hoyos: int = Field(default=18)
    jugadores: List[JugadorIn] = Field(min_length=1, max_length=8)
    correo: EmailStr
    telefono: Optional[str] = Field(default=None, max_length=40)


class ApartadoOut(BaseModel):
    folio: str
    total: Decimal
    vence: Optional[datetime] = None
    modalidad: str
    fecha: date
    hora: time
    jugadores: int


class TarjetaIn(BaseModel):
    """Los datos de la tarjeta. No se guardan: de aquí solo sobreviven la
    marca y los últimos cuatro dígitos, igual que en un recibo."""

    numero: str = Field(min_length=12, max_length=32)
    mes: int = Field(ge=1, le=12)
    anio: int = Field(ge=24, le=2100)
    cvv: str = Field(min_length=3, max_length=4)
    nombre: str = Field(min_length=3, max_length=120)


class CheckoutOut(BaseModel):
    """A dónde mandar al huésped para que pague."""

    url: str
    folio: str


class CobroOut(BaseModel):
    """El resultado del cobro simulado, que solo corre en desarrollo."""

    aprobado: bool
    motivo: Optional[str] = None
    folio: Optional[str] = None
    referencia: Optional[str] = None
    marca: Optional[str] = None
    ultimos4: Optional[str] = None
    total: Optional[Decimal] = None
    vence: Optional[datetime] = None


class EstadoOut(BaseModel):
    folio: str
    estado: str
    fecha: Optional[date] = None
    hora: Optional[time] = None
    jugadores: int = 0
    titular: str
    total: Decimal
    vence: Optional[datetime] = None


# -------------------------------------------------------- tope de intentos
# En memoria a propósito: es una contención, no una cerradura. Si el servidor
# se reinicia se olvida, y eso está bien — lo que de verdad frena a un robot
# es el captcha, que se pone cuando esto salga a producción.
_INTENTOS: dict = defaultdict(list)


def _frenar(request: Request, cuantos: int) -> None:
    quien = request.client.host if request.client else "desconocido"
    ahora = datetime.utcnow()
    hace_una_hora = ahora - timedelta(hours=1)
    _INTENTOS[quien] = [t for t in _INTENTOS[quien] if t > hace_una_hora]
    if len(_INTENTOS[quien]) >= cuantos:
        raise BusinessRuleError(
            "Demasiados intentos desde esta conexión. Espere un momento o "
            "llame al club para reservar."
        )
    _INTENTOS[quien].append(ahora)


# ---------------------------------------------------------------- endpoints
@router.get("/campo", response_model=CampoOut)
def campo(db: Session = Depends(get_db)):
    """Horario, tarifas, servicios y reglas: lo que el sitio pinta al abrir."""
    return ReservaPublicaService(db).campo()


@router.get("/disponibilidad", response_model=DisponibilidadOut)
def disponibilidad(
    fecha: date = Query(..., description="Día que se quiere jugar"),
    db: Session = Depends(get_db),
):
    """Las salidas de un día. De las ocupadas solo se dice que lo están."""
    return ReservaPublicaService(db).salidas(fecha)


@router.post("/cotizacion", response_model=CotizacionOut)
def cotizacion(payload: CotizarIn, db: Session = Depends(get_db)):
    """Lo que va a costar, según el servidor.

    No aparta nada ni cobra nada: solo resuelve la tarifa. Existe para que el
    número que ve el huésped sea exactamente el que va a pasar por Stripe, en
    lugar de uno que el navegador calculó por su cuenta.
    """
    return ReservaPublicaService(db).cotizar(payload)


@router.post(
    "/reservas", response_model=ApartadoOut, status_code=status.HTTP_201_CREATED
)
def apartar(payload: ApartarIn, request: Request, db: Session = Depends(get_db)):
    """Aparta la salida mientras el huésped paga.

    La reserva nace pendiente, con hora de vencimiento. Si no se completa el
    pago, se cancela sola y el horario vuelve a la venta.
    """
    _frenar(request, settings.PUBLICO_INTENTOS_POR_HORA)

    ip = request.client.host if request.client else None
    reserva = ReservaPublicaService(db).apartar(payload, ip=ip)
    slot = reserva.tee_slot
    return ApartadoOut(
        folio=reserva.folio,
        total=reserva.total,
        vence=reserva.hold_expires_at,
        modalidad=reserva.modality,
        fecha=slot.slot_date,
        hora=slot.slot_time,
        jugadores=len(reserva.players),
    )


@router.post("/reservas/{folio}/checkout", response_model=CheckoutOut)
def checkout(folio: str, request: Request, db: Session = Depends(get_db)):
    """Abre la página de pago de Stripe y devuelve a dónde mandar al huésped.

    El monto lo calcula el servidor a partir de la reserva. Nada de lo que
    mande el navegador toca el precio.
    """
    _frenar(request, settings.PUBLICO_INTENTOS_POR_HORA * 3)
    return ReservaPublicaService(db).iniciar_cobro(folio)


@router.post("/stripe/webhook", include_in_schema=False)
async def webhook_de_stripe(request: Request, db: Session = Depends(get_db)):
    """Stripe avisa que un pago se completó. **Esto es lo que confirma.**

    Que el huésped vuelva a la página de "listo" no prueba nada: esa dirección
    se puede teclear. Lo único que confirma una reserva es este aviso, y solo
    después de comprobar que la firma es de Stripe.
    """
    cuerpo = await request.body()
    firma = request.headers.get("stripe-signature", "")
    evento = stripe_gateway.leer_evento(cuerpo, firma)

    if evento["type"] != "checkout.session.completed":
        # Stripe manda muchos tipos de aviso; de los demás no hay nada que
        # hacer, pero se contesta 200 para que no los reintente en vano.
        return {"recibido": True}

    sesion = evento["data"]["object"]
    folio = (sesion.get("metadata") or {}).get("folio")
    if not folio:
        return {"recibido": True, "nota": "aviso sin folio"}

    # `payment_status` puede quedar pendiente con algunos métodos de pago: la
    # reserva solo se confirma cuando el dinero ya está.
    if sesion.get("payment_status") != "paid":
        return {"recibido": True, "nota": "todavía sin pagar"}

    tarjeta = {}
    intento = sesion.get("payment_intent")
    resultado = ReservaPublicaService(db).confirmar_pago(
        folio=folio,
        referencia=str(intento or sesion.get("id")),
        monto_centavos=int(sesion.get("amount_total") or 0),
        marca=tarjeta.get("marca"),
        ultimos4=tarjeta.get("ultimos4"),
        payment_intent=str(intento) if intento else None,
    )
    return {"recibido": True, **resultado}


@router.post("/reservas/{folio}/pago", response_model=CobroOut)
def pagar_simulado(folio: str, tarjeta: TarjetaIn, request: Request, db: Session = Depends(get_db)):
    """El cobro de mentiras, para desarrollar sin tocar Stripe.

    Con Stripe configurado esta ruta se niega: el camino bueno es /checkout.
    """
    _frenar(request, settings.PUBLICO_INTENTOS_POR_HORA * 3)
    return ReservaPublicaService(db).cobrar_simulado(folio, tarjeta)


@router.get("/reservas/{folio}", response_model=EstadoOut)
def estado(folio: str, db: Session = Depends(get_db)):
    """Cómo va una reserva. Sin el QR ni los datos de los demás jugadores."""
    return ReservaPublicaService(db).estado(folio)
