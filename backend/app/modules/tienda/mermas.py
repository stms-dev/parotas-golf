"""Merma de la tienda: se solicita, la Administración la autoriza.

Quien atiende **solicita** la baja de piezas (con motivo, justificación y, si
tiene, una foto o PDF de evidencia). Nada se mueve hasta que la Administración
la **autoriza**: ahí baja la existencia, queda el movimiento MERMA en el kardex y
el producto suma esas piezas a su `merma_total`. Si la **rechaza**, no pasa
nada con el inventario. Una merma ya autorizada solo la puede **cancelar** la
Administración (devuelve las piezas) y queda constancia.
"""
import base64
import binascii
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, NotFoundError, ValidationError
from app.modules.audit.service import AuditService
from app.modules.identity.models import User
from app.modules.tienda.models import TiendaMerma, TiendaMovimiento, TiendaProducto
from app.shared.enums import AuditAction
from app.shared.money import ZERO, money
from app.shared.tiempo import zona

MODULO = "tienda"

MOTIVOS = {
    "DANADO": "Dañado",
    "CADUCADO": "Caducado",
    "ROBO": "Robo o extravío",
    "MUESTRA": "Muestra o uso interno",
    "OTRO": "Otro",
}
TOPE_EVIDENCIA = 3 * 1024 * 1024  # 3 MB


def _tipo_de(datos: bytes) -> Optional[str]:
    """El tipo de archivo sale de los primeros bytes, no de lo que diga el cliente."""
    if datos[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if datos[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if datos[:4] == b"RIFF" and datos[8:12] == b"WEBP":
        return "image/webp"
    if datos[:5] == b"%PDF-":
        return "application/pdf"
    return None


def limites_del_dia(desde: date, hasta: date) -> Tuple[datetime, datetime]:
    """Rango [inicio, fin) en UTC sin zona, de los días locales desde..hasta."""
    tz = zona()

    def _utc(d: date) -> datetime:
        local = datetime.combine(d, time.min)
        if tz is not None:
            local = local.replace(tzinfo=tz).astimezone(timezone.utc).replace(tzinfo=None)
        return local

    return _utc(desde), _utc(hasta + timedelta(days=1))


class MermasTienda:
    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    # ------------------------------------------------------------ lectura
    def obtener(self, merma_id: int) -> TiendaMerma:
        merma = self.db.get(TiendaMerma, merma_id)
        if not merma:
            raise NotFoundError("Esa merma no existe")
        return merma

    def listar(self, *, estado=None, desde=None, hasta=None, producto_id=None, limite=300) -> List[TiendaMerma]:
        stmt = select(TiendaMerma)
        if estado:
            stmt = stmt.where(TiendaMerma.estado == estado)
        if producto_id:
            stmt = stmt.where(TiendaMerma.producto_id == producto_id)
        if desde or hasta:
            ini, fin = limites_del_dia(desde or hasta, hasta or desde)
            stmt = stmt.where(TiendaMerma.created_at >= ini, TiendaMerma.created_at < fin)
        stmt = stmt.order_by(TiendaMerma.id.desc()).limit(limite)
        return list(self.db.execute(stmt).scalars().all())

    def pendientes(self) -> int:
        return len(self.db.execute(select(TiendaMerma.id).where(TiendaMerma.estado == "PENDIENTE")).all())

    def evidencia(self, merma_id: int) -> Tuple[bytes, str, str]:
        merma = self.obtener(merma_id)
        if not merma.evidencia:
            raise NotFoundError("Esa merma no tiene evidencia")
        return bytes(merma.evidencia), merma.evidencia_tipo or "application/octet-stream", merma.evidencia_nombre or "evidencia"

    # ---------------------------------------------------------- solicitud
    def solicitar(self, datos, actor: User) -> TiendaMerma:
        producto = self.db.get(TiendaProducto, datos.producto_id)
        if not producto:
            raise NotFoundError("Ese producto no existe")
        if datos.cantidad < 1:
            raise ValidationError("Indique cuántas piezas son")
        hay = self._disponible(producto, datos.ubicacion)
        if datos.cantidad > hay:
            donde = {"TIENDA": "en tienda", "BODEGA": "en bodega"}.get(datos.ubicacion, "")
            raise BusinessRuleError(
                f"Solo hay {hay} pieza{'s' if hay != 1 else ''} {donde}".strip() + f" de {producto.codigo}"
            )
        justificacion = (datos.justificacion or "").strip()
        if len(justificacion) < 5:
            raise ValidationError("Escriba la justificación (mínimo 5 letras)")

        archivo, tipo, nombre = None, None, None
        if datos.evidencia_base64:
            archivo, tipo = self._leer_evidencia(datos.evidencia_base64)
            nombre = (datos.evidencia_nombre or "evidencia").strip()[:120] or "evidencia"
        if datos.motivo_tipo == "ROBO" and archivo is None:
            raise ValidationError("Para robo o extravío hay que subir una evidencia (foto o PDF)")

        merma = TiendaMerma(
            folio=f"T-{uuid.uuid4().hex[:12]}",
            producto_id=producto.id,
            cantidad=datos.cantidad,
            ubicacion=datos.ubicacion,
            motivo_tipo=datos.motivo_tipo,
            justificacion=justificacion,
            estado="PENDIENTE",
            solicito_nombre=datos.atendio.strip(),
            solicito_usuario_id=actor.id,
            evidencia=archivo,
            evidencia_tipo=tipo,
            evidencia_nombre=nombre,
        )
        self.db.add(merma)
        self.db.flush()
        merma.folio = f"MR-{merma.id:06d}"
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module=MODULO, entity="TiendaMerma", entity_id=merma.id,
            description=f"Solicitud de merma {merma.folio} · {datos.cantidad} × {producto.codigo} · "
                        f"{MOTIVOS[datos.motivo_tipo]} · {merma.solicito_nombre}",
        )
        self.db.commit()
        self.db.refresh(merma)
        return merma

    # --------------------------------------------------------- resolución
    def autorizar(self, merma_id: int, nota: Optional[str], actor: User) -> TiendaMerma:
        merma = self.obtener(merma_id)
        if merma.estado != "PENDIENTE":
            raise BusinessRuleError(f"Esa merma ya está {merma.estado.lower()}")
        producto = self.db.get(TiendaProducto, merma.producto_id)

        hay = self._disponible(producto, merma.ubicacion)
        if merma.cantidad > hay:
            raise BusinessRuleError(
                f"Ya no alcanzan las piezas: hoy hay {hay} y la merma pide {merma.cantidad}. "
                "Rechácela o pida que se corrija."
            )
        if merma.ubicacion == "TIENDA":
            de_tienda, de_bodega = merma.cantidad, 0
        elif merma.ubicacion == "BODEGA":
            de_tienda, de_bodega = 0, merma.cantidad
        else:  # sin lugar: primero de tienda, lo que falte de bodega
            de_tienda = min(merma.cantidad, producto.existencia)
            de_bodega = merma.cantidad - de_tienda

        for lugar, piezas in (("TIENDA", de_tienda), ("BODEGA", de_bodega)):
            if piezas <= 0:
                continue
            despues = (producto.existencia if lugar == "TIENDA" else producto.existencia_bodega) - piezas
            if lugar == "TIENDA":
                producto.existencia = despues
            else:
                producto.existencia_bodega = despues
            self.db.add(TiendaMovimiento(
                producto_id=producto.id, tipo="MERMA", ubicacion=lugar, cantidad=-piezas,
                existencia_despues=despues,
                motivo=f"{merma.folio} · {MOTIVOS[merma.motivo_tipo]} · {merma.justificacion}"[:300],
                usuario_id=actor.id, atendio=merma.solicito_nombre,
            ))
        producto.merma_total = (producto.merma_total or 0) + merma.cantidad

        merma.estado = "AUTORIZADA"
        merma.de_tienda, merma.de_bodega = de_tienda, de_bodega
        merma.costo_unitario = money(producto.costo)
        self._resolver(merma, nota, actor)
        self.audit.log(
            user=actor, action=AuditAction.CONFIRMAR, module=MODULO, entity="TiendaMerma", entity_id=merma.id,
            description=f"Merma {merma.folio} autorizada · {merma.cantidad} × {producto.codigo} · {actor.full_name}",
        )
        self.db.commit()
        self.db.refresh(merma)
        return merma

    def rechazar(self, merma_id: int, nota: str, actor: User) -> TiendaMerma:
        merma = self.obtener(merma_id)
        if merma.estado != "PENDIENTE":
            raise BusinessRuleError(f"Esa merma ya está {merma.estado.lower()}")
        merma.estado = "RECHAZADA"
        self._resolver(merma, nota, actor)
        self.audit.log(
            user=actor, action=AuditAction.CANCELAR, module=MODULO, entity="TiendaMerma", entity_id=merma.id,
            description=f"Merma {merma.folio} rechazada · {actor.full_name} · {merma.nota_resolucion}",
        )
        self.db.commit()
        self.db.refresh(merma)
        return merma

    def cancelar(self, merma_id: int, nota: str, actor: User) -> TiendaMerma:
        """Deshace una merma ya autorizada: las piezas vuelven a donde salieron."""
        merma = self.obtener(merma_id)
        if merma.estado != "AUTORIZADA":
            raise BusinessRuleError("Solo se puede cancelar una merma ya autorizada")
        producto = self.db.get(TiendaProducto, merma.producto_id)
        for lugar, piezas in (("TIENDA", merma.de_tienda), ("BODEGA", merma.de_bodega)):
            if piezas <= 0:
                continue
            despues = (producto.existencia if lugar == "TIENDA" else producto.existencia_bodega) + piezas
            if lugar == "TIENDA":
                producto.existencia = despues
            else:
                producto.existencia_bodega = despues
            self.db.add(TiendaMovimiento(
                producto_id=producto.id, tipo="MERMA", ubicacion=lugar, cantidad=piezas,
                existencia_despues=despues, motivo=f"Cancelación de {merma.folio} · {nota.strip()}"[:300],
                usuario_id=actor.id, atendio=actor.full_name,
            ))
        producto.merma_total = max((producto.merma_total or 0) - merma.cantidad, 0)
        merma.estado = "CANCELADA"
        self._resolver(merma, nota, actor)
        self.audit.log(
            user=actor, action=AuditAction.CANCELAR, module=MODULO, entity="TiendaMerma", entity_id=merma.id,
            description=f"Merma {merma.folio} cancelada y piezas devueltas · {actor.full_name} · {merma.nota_resolucion}",
        )
        self.db.commit()
        self.db.refresh(merma)
        return merma

    # ------------------------------------------------------------ reporte
    def resumen(self, desde: date, hasta: date) -> dict:
        ini, fin = limites_del_dia(desde, hasta)
        filas = self.db.execute(
            select(TiendaMerma).where(
                TiendaMerma.estado == "AUTORIZADA",
                TiendaMerma.resuelta_en >= ini, TiendaMerma.resuelta_en < fin,
            )
        ).scalars().all()
        por_motivo = {}
        for m in filas:
            f = por_motivo.setdefault(m.motivo_tipo, {"motivo": m.motivo_tipo, "nombre": MOTIVOS.get(m.motivo_tipo, m.motivo_tipo),
                                                     "piezas": 0, "costo": ZERO})
            f["piezas"] += m.cantidad
            f["costo"] += money(m.costo_unitario or 0) * m.cantidad
        return {
            "piezas": sum(m.cantidad for m in filas),
            "costo": money(sum((money(m.costo_unitario or 0) * m.cantidad for m in filas), start=ZERO)),
            "pendientes": self.pendientes(),
            "por_motivo": sorted(
                [{**f, "costo": money(f["costo"])} for f in por_motivo.values()], key=lambda x: x["costo"], reverse=True
            ),
        }

    # ------------------------------------------------------------- ayudas
    @staticmethod
    def _disponible(producto: TiendaProducto, ubicacion: Optional[str]) -> int:
        if ubicacion == "TIENDA":
            return producto.existencia
        if ubicacion == "BODEGA":
            return producto.existencia_bodega
        return producto.existencia_fisica

    @staticmethod
    def _resolver(merma: TiendaMerma, nota: Optional[str], actor: User) -> None:
        merma.resolvio_nombre = actor.full_name
        merma.resolvio_usuario_id = actor.id
        merma.resuelta_en = datetime.utcnow()
        merma.nota_resolucion = (nota or "").strip() or None

    @staticmethod
    def _leer_evidencia(texto: str) -> Tuple[bytes, str]:
        if "," in texto[:120]:  # data URL: «data:image/jpeg;base64,....»
            texto = texto.split(",", 1)[1]
        try:
            datos = base64.b64decode(texto, validate=True)
        except (binascii.Error, ValueError):
            raise ValidationError("No se pudo leer la evidencia: el archivo está dañado") from None
        if len(datos) > TOPE_EVIDENCIA:
            raise ValidationError("La evidencia pesa más de 3 MB. Suba una foto más ligera o un PDF más pequeño")
        tipo = _tipo_de(datos)
        if tipo is None:
            raise ValidationError("La evidencia debe ser una foto (JPG, PNG, WEBP) o un PDF")
        return datos, tipo
