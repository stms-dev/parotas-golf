"""Cuponeras: vender, confirmar el pago, canjear pases y llevar el historial."""
import json
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, NotFoundError, ValidationError
from app.modules.audit.service import AuditService
from app.modules.cuponeras.models import Cuponera, CuponeraUso
from app.modules.identity.models import User
from app.shared.enums import AuditAction
from app.shared.money import money
from app.shared.tiempo import ahora, hoy

MODULO = "cuponeras"

ESTADOS = {
    "PENDIENTE_PAGO": "Pendiente de pago",
    "ACTIVA": "Activa",
    "AGOTADA": "Agotada",
    "VENCIDA": "Vencida",
    "CANCELADA": "Cancelada",
}


def bloqueos_de(c: Cuponera) -> list:
    if not c.fechas_bloqueadas:
        return []
    try:
        return json.loads(c.fechas_bloqueadas)
    except ValueError:
        return []


def estado_de(c: Cuponera, dia: Optional[date] = None) -> str:
    dia = dia or hoy()
    if c.cancelada:
        return "CANCELADA"
    if c.pago_estado != "PAGADA":
        return "PENDIENTE_PAGO"
    if dia > c.vence_el:
        return "VENCIDA"
    if c.saldo <= 0:
        return "AGOTADA"
    return "ACTIVA"


def _fecha_bloqueada(c: Cuponera, dia: date) -> Optional[str]:
    for b in bloqueos_de(c):
        if b["desde"] <= dia.isoformat() <= b["hasta"]:
            return b.get("motivo") or "fecha bloqueada"
    return None


def motivo_bloqueo(c: Cuponera, dia: Optional[date] = None) -> Optional[str]:
    """Por qué hoy no se puede canjear; None si sí."""
    dia = dia or hoy()
    est = estado_de(c, dia)
    if est == "CANCELADA":
        return "La cuponera está cancelada"
    if est == "PENDIENTE_PAGO":
        return "La transferencia todavía no está confirmada"
    if est == "VENCIDA":
        return f"Venció el {c.vence_el.strftime('%d/%m/%Y')}"
    if est == "AGOTADA":
        return "Ya no quedan pases"
    razon = _fecha_bloqueada(c, dia)
    if razon:
        return f"Hoy no aplica la cuponera ({razon})"
    return None


def _json_bloqueos(lista) -> Optional[str]:
    if not lista:
        return None
    salida = []
    for b in lista:
        d, h = (b.desde, b.hasta) if hasattr(b, "desde") else (b["desde"], b["hasta"])
        if h < d:
            raise ValidationError("En un bloqueo, «hasta» no puede ser antes que «desde»")
        motivo = b.motivo if hasattr(b, "motivo") else b.get("motivo")
        salida.append({"desde": d.isoformat(), "hasta": h.isoformat(), "motivo": motivo})
    return json.dumps(salida, ensure_ascii=False)


class Cuponeras:
    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    # ------------------------------------------------------------ lectura
    def obtener(self, cuponera_id: int, *, bloquear: bool = False) -> Cuponera:
        stmt = select(Cuponera).where(Cuponera.id == cuponera_id)
        if bloquear:
            stmt = stmt.with_for_update()
        c = self.db.execute(stmt).scalar_one_or_none()
        if not c:
            raise NotFoundError("Esa cuponera no existe")
        return c

    def por_folio(self, folio: str) -> Cuponera:
        # El lector de códigos suele mandar el folio con espacios o en minúsculas.
        limpio = (folio or "").strip().upper()
        c = self.db.execute(select(Cuponera).where(Cuponera.folio == limpio)).scalar_one_or_none()
        if not c:
            raise NotFoundError(f"No hay una cuponera con el folio {limpio or '—'}")
        return c

    def listar(self, *, estado: Optional[str] = None, q: Optional[str] = None) -> List[Cuponera]:
        stmt = select(Cuponera).order_by(Cuponera.id.desc()).limit(500)
        if q:
            t = f"%{q.strip().lower()}%"
            from sqlalchemy import func, or_

            stmt = stmt.where(or_(
                func.lower(Cuponera.folio).like(t),
                func.lower(Cuponera.titular_nombre).like(t),
                func.lower(Cuponera.empresa).like(t),
            ))
        filas = list(self.db.execute(stmt).scalars().all())
        if estado:
            filas = [c for c in filas if estado_de(c) == estado]
        return filas

    # ------------------------------------------------------------- venta
    def crear(self, datos, actor: User) -> Cuponera:
        if not datos.hoyos_18 and not datos.hoyos_9:
            raise ValidationError("Elija al menos una modalidad: 18 o 9 hoyos")
        if datos.vence_el < hoy():
            raise ValidationError("La vigencia no puede ser una fecha pasada")
        if datos.precio_lista is not None and datos.precio_total > datos.precio_lista:
            raise ValidationError("El precio de la cuponera no puede ser mayor al de tarifa normal")
        if datos.pagada and not (datos.pago_referencia or "").strip():
            raise ValidationError("Para marcarla como pagada escriba la referencia de la transferencia")

        c = Cuponera(
            folio="TMP",
            titular_nombre=datos.titular_nombre.strip(),
            empresa=(datos.empresa or "").strip() or None,
            telefono=(datos.telefono or "").strip() or None,
            correo=(datos.correo or "").strip() or None,
            pases_total=datos.pases_total,
            hoyos_18=datos.hoyos_18,
            hoyos_9=datos.hoyos_9,
            precio_total=money(datos.precio_total),
            precio_lista=money(datos.precio_lista) if datos.precio_lista is not None else None,
            vence_el=datos.vence_el,
            fechas_bloqueadas=_json_bloqueos(datos.fechas_bloqueadas),
            notas=(datos.notas or "").strip() or None,
            creada_por_nombre=actor.full_name,
            creada_por_id=actor.id,
        )
        if datos.pagada:
            c.pago_estado = "PAGADA"
            c.pago_referencia = datos.pago_referencia.strip()
            c.pagada_en = ahora()
            c.pago_confirmo_nombre = actor.full_name
            c.pago_confirmo_usuario_id = actor.id
        self.db.add(c)
        self.db.flush()
        c.folio = f"CUP-{c.id:04d}"
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module=MODULO, entity="Cuponera", entity_id=c.id,
            description=f"Cuponera {c.folio} · {c.pases_total} pases · {c.titular_nombre} · "
                        f"${c.precio_total} · {'pagada' if datos.pagada else 'pendiente de pago'}",
        )
        self.db.commit()
        self.db.refresh(c)
        return c

    def confirmar_pago(self, cuponera_id: int, referencia: str, actor: User) -> Cuponera:
        c = self.obtener(cuponera_id)
        if c.cancelada:
            raise BusinessRuleError("La cuponera está cancelada")
        if c.pago_estado == "PAGADA":
            raise BusinessRuleError("Esa cuponera ya está pagada")
        c.pago_estado = "PAGADA"
        c.pago_referencia = referencia.strip()
        c.pagada_en = ahora()
        c.pago_confirmo_nombre = actor.full_name
        c.pago_confirmo_usuario_id = actor.id
        self.audit.log(
            user=actor, action=AuditAction.PAGO, module=MODULO, entity="Cuponera", entity_id=c.id,
            description=f"Pago confirmado de {c.folio} · ${c.precio_total} · ref. {c.pago_referencia}",
        )
        self.db.commit()
        self.db.refresh(c)
        return c

    # --------------------------------------------------- cambios (Administración)
    def actualizar(self, cuponera_id: int, datos, actor: User) -> Cuponera:
        c = self.obtener(cuponera_id)
        if c.cancelada:
            raise BusinessRuleError("La cuponera está cancelada")
        cambios = datos.model_dump(exclude_unset=True, exclude={"nota_cambio"})
        if "pases_total" in cambios and cambios["pases_total"] < c.pases_usados:
            raise BusinessRuleError(f"Ya se usaron {c.pases_usados} pases; no puede quedar con menos")
        hoyos18 = cambios.get("hoyos_18", c.hoyos_18)
        hoyos9 = cambios.get("hoyos_9", c.hoyos_9)
        if not hoyos18 and not hoyos9:
            raise ValidationError("Debe quedar al menos una modalidad: 18 o 9 hoyos")
        precio = cambios.get("precio_total", c.precio_total)
        lista = cambios.get("precio_lista", c.precio_lista)
        if lista is not None and precio is not None and Decimal(precio) > Decimal(lista):
            raise ValidationError("El precio de la cuponera no puede ser mayor al de tarifa normal")
        if "vence_el" in cambios and cambios["vence_el"] < c.created_at.date():
            raise ValidationError("La vigencia no puede ser anterior a la fecha de venta")

        antes = []
        for campo, valor in cambios.items():
            if campo == "fechas_bloqueadas":
                nuevo = _json_bloqueos(datos.fechas_bloqueadas)
                if nuevo != c.fechas_bloqueadas:
                    antes.append("fechas bloqueadas")
                c.fechas_bloqueadas = nuevo
                continue
            if campo in ("precio_total", "precio_lista") and valor is not None:
                valor = money(valor)
            actual = getattr(c, campo)
            if actual != valor:
                antes.append(f"{campo}: {actual} → {valor}")
                setattr(c, campo, valor)
        if not antes:
            return c
        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=MODULO, entity="Cuponera", entity_id=c.id,
            description=f"Cambio en {c.folio} ({'; '.join(antes)}) · {datos.nota_cambio}",
        )
        self.db.commit()
        self.db.refresh(c)
        return c

    def cancelar(self, cuponera_id: int, nota: str, actor: User) -> Cuponera:
        c = self.obtener(cuponera_id)
        if c.cancelada:
            raise BusinessRuleError("Esa cuponera ya está cancelada")
        c.cancelada = True
        c.cancelada_en = ahora()
        c.cancelada_por = actor.full_name
        c.cancelada_nota = nota.strip()
        self.audit.log(
            user=actor, action=AuditAction.CANCELAR, module=MODULO, entity="Cuponera", entity_id=c.id,
            description=f"Cuponera {c.folio} cancelada con {c.saldo} pases sin usar · {c.cancelada_nota}",
        )
        self.db.commit()
        self.db.refresh(c)
        return c

    # ------------------------------------------------------------- canje
    def aplicar(self, c: Cuponera, jugadores: int, hoyos: int, reserva_folio: Optional[str],
                atendio: str, actor: User, nota: Optional[str] = None) -> CuponeraUso:
        """Descuenta los pases y deja el canje en el historial (sin confirmar la transacción)."""
        uso = CuponeraUso(
            cuponera_id=c.id, fecha=hoy(), jugadores=jugadores, hoyos=hoyos,
            reserva_folio=(reserva_folio or "").strip().upper() or None,
            nota=(nota or "").strip() or None,
            validado_por_nombre=atendio.strip(), validado_por_id=actor.id,
        )
        c.pases_usados += jugadores
        self.db.add(uso)
        self.db.flush()
        return uso

    def validar_para(self, c: Cuponera, hoyos: int, dia: Optional[date] = None) -> None:
        """Revisa que la cuponera sirva ese día y para esa modalidad."""
        razon = motivo_bloqueo(c, dia)
        if razon:
            raise BusinessRuleError(razon)
        if hoyos == 18 and not c.hoyos_18:
            raise BusinessRuleError("Esta cuponera no incluye 18 hoyos")
        if hoyos == 9 and not c.hoyos_9:
            raise BusinessRuleError("Esta cuponera no incluye 9 hoyos")

    def canjear(self, cuponera_id: int, datos, actor: User) -> Cuponera:
        c = self.obtener(cuponera_id, bloquear=True)
        dia = hoy()
        razon = motivo_bloqueo(c, dia)
        if razon:
            raise BusinessRuleError(razon)
        if datos.hoyos == 18 and not c.hoyos_18:
            raise BusinessRuleError("Esta cuponera no incluye 18 hoyos")
        if datos.hoyos == 9 and not c.hoyos_9:
            raise BusinessRuleError("Esta cuponera no incluye 9 hoyos")
        if datos.jugadores > c.saldo:
            raise BusinessRuleError(
                f"Solo quedan {c.saldo} pases y llegaron {datos.jugadores} jugadores"
            )
        uso = self.aplicar(
            c, datos.jugadores, datos.hoyos, datos.reserva_folio, datos.atendio, actor, nota=datos.nota,
        )
        self.audit.log(
            user=actor, action=AuditAction.CHECK_IN, module=MODULO, entity="Cuponera", entity_id=c.id,
            description=f"Canje en {c.folio}: {datos.jugadores} jugador(es), {datos.hoyos} hoyos · "
                        f"quedan {c.saldo} · {uso.validado_por_nombre}",
        )
        self.db.commit()
        self.db.refresh(c)
        return c

    def anular_uso(self, uso_id: int, nota: str, actor: User) -> Cuponera:
        uso = self.db.get(CuponeraUso, uso_id)
        if not uso:
            raise NotFoundError("Ese canje no existe")
        if uso.anulado:
            raise BusinessRuleError("Ese canje ya está anulado")
        c = self.obtener(uso.cuponera_id, bloquear=True)
        self._anular(uso, c, actor.full_name, nota.strip())
        self.audit.log(
            user=actor, action=AuditAction.CANCELAR, module=MODULO, entity="CuponeraUso", entity_id=uso.id,
            description=f"Canje anulado en {c.folio}: regresan {uso.jugadores} pases · {uso.anulado_nota}",
        )
        self.db.commit()
        self.db.refresh(c)
        return c

    # -------------------------------------------------- anulación (interna)
    def _anular(self, uso: CuponeraUso, c: Cuponera, quien: str, nota: str) -> None:
        """Regresa los pases; si el canje cubrió una reserva, le quita ese cobro."""
        uso.anulado = True
        uso.anulado_en = ahora()
        uso.anulado_por = quien
        uso.anulado_nota = nota
        c.pases_usados = max(0, c.pases_usados - uso.jugadores)
        if uso.payment_id:
            from app.modules.billing.models import Payment
            from app.modules.booking.models import ReservationPlayer

            pago = self.db.get(Payment, uso.payment_id)
            if pago and not pago.is_voided:
                pago.is_voided = True
                pago.voided_at = ahora()
                pago.voided_reason = f"Canje de cuponera anulado: {nota}"
            for jugador in self.db.execute(
                select(ReservationPlayer).where(ReservationPlayer.cuponera_uso_id == uso.id)
            ).scalars():
                jugador.cuponera_uso_id = None

    def devolver_de_reserva(self, reserva_folio: str, actor: User, nota: str) -> int:
        """Una reserva con pases canjeados se canceló: los pases regresan solos."""
        usos = self.db.execute(
            select(CuponeraUso).where(
                CuponeraUso.reserva_folio == reserva_folio, CuponeraUso.anulado.is_(False)
            )
        ).scalars().all()
        devueltos = 0
        for uso in usos:
            c = self.obtener(uso.cuponera_id, bloquear=True)
            self._anular(uso, c, actor.full_name, nota)
            devueltos += uso.jugadores
            self.audit.log(
                user=actor, action=AuditAction.CANCELAR, module=MODULO, entity="CuponeraUso", entity_id=uso.id,
                description=f"Regresan {uso.jugadores} pases a {c.folio}: {nota}",
            )
        return devueltos
