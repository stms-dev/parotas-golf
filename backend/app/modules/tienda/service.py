"""Reglas de la tienda: catálogo, existencias, caja y ventas."""
import math
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import List, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError, ValidationError
from app.modules.audit.service import AuditService
from app.modules.catalog.service import ExchangeRateService
from app.modules.identity.models import User
from app.modules.tienda.models import (
    TiendaCorte,
    TiendaMovimiento,
    TiendaPago,
    TiendaProducto,
    TiendaVenta,
    TiendaVentaLinea,
)
from app.shared.enums import AuditAction
from app.shared.money import ZERO, money
from app.shared.tiempo import ahora, hoy

MODULO = "tienda"
CATEGORIAS_BASE = ["Pelotas", "Guantes", "Gorras", "Playeras", "Bermudas", "Toallas", "Accesorios"]


def _texto(valor: Optional[str]) -> Optional[str]:
    limpio = " ".join((valor or "").split())
    return limpio or None


# ======================================================================= catálogo
class CatalogoTienda:
    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def listar(self, *, termino=None, categoria=None, por_surtir=False, inactivos=False,
               sin_precio=False) -> List[TiendaProducto]:
        stmt = select(TiendaProducto)
        if not inactivos:
            stmt = stmt.where(TiendaProducto.activo.is_(True))
        if categoria:
            stmt = stmt.where(TiendaProducto.categoria == categoria)
        if sin_precio:
            stmt = stmt.where(TiendaProducto.precio.is_(None))
        if termino and termino.strip():
            patron = f"%{termino.strip()}%"
            stmt = stmt.where(or_(
                TiendaProducto.codigo.ilike(patron),
                TiendaProducto.descripcion.ilike(patron),
                TiendaProducto.marca.ilike(patron),
                TiendaProducto.talla.ilike(patron),
            ))
        productos = list(self.db.execute(
            stmt.order_by(TiendaProducto.categoria, TiendaProducto.descripcion)
        ).scalars().all())
        if por_surtir:
            productos = [p for p in productos if p.por_surtir]
        return productos

    def obtener(self, producto_id: int) -> TiendaProducto:
        producto = self.db.get(TiendaProducto, producto_id)
        if not producto:
            raise NotFoundError("Ese producto no existe")
        return producto

    def por_codigo(self, codigo: str) -> Optional[TiendaProducto]:
        return self.db.execute(
            select(TiendaProducto).where(TiendaProducto.codigo == codigo.strip())
        ).scalar_one_or_none()

    def categorias(self) -> List[str]:
        usadas = self.db.execute(select(TiendaProducto.categoria).distinct()).scalars().all()
        return sorted(set(CATEGORIAS_BASE) | {c for c in usadas if c})

    def resumen(self) -> dict:
        productos = self.listar()
        return {
            "productos": len(productos),
            "piezas": sum(p.existencia_total for p in productos),
            "piezas_tienda": sum(p.existencia for p in productos),
            "piezas_bodega": sum(p.existencia_bodega for p in productos),
            "pasar_a_tienda": sum(1 for p in productos if p.pasar_a_tienda),
            "sobre_maximo": sum(1 for p in productos if p.sobre_maximo),
            "valor_costo": money(sum((money(p.costo) * p.existencia_total for p in productos), start=ZERO)),
            "valor_venta": money(sum((money(p.precio or 0) * p.existencia_total for p in productos), start=ZERO)),
            "por_surtir": sum(1 for p in productos if p.por_surtir),
            "sin_existencia": sum(1 for p in productos if p.existencia_total <= 0),
            "sin_precio": sum(1 for p in productos if p.precio is None),
            "sin_codigo": sum(1 for p in productos if not p.tiene_codigo_barras),
            "categorias": self.categorias(),
        }

    def _codigo_interno(self) -> str:
        """INT-001, INT-002… para lo que no trae código de barras."""
        codigos = self.db.execute(
            select(TiendaProducto.codigo).where(TiendaProducto.codigo.ilike("INT-%"))
        ).scalars().all()
        numeros = [int(c[4:]) for c in codigos if c[4:].isdigit()]
        return f"INT-{(max(numeros) + 1) if numeros else 1:03d}"

    def crear(self, datos, actor: User, atendio: str) -> TiendaProducto:
        codigo = (datos.codigo or "").strip() or self._codigo_interno()
        if self.por_codigo(codigo):
            raise ConflictError(f"Ya hay un producto con el código {codigo}")
        producto = TiendaProducto(
            codigo=codigo,
            tiene_codigo_barras=not codigo.upper().startswith("INT-"),
            descripcion=_texto(datos.descripcion),
            categoria=_texto(datos.categoria),
            marca=_texto(datos.marca),
            talla=_texto(datos.talla),
            costo=money(datos.costo),
            precio=money(datos.precio) if datos.precio is not None else None,
            minimo=datos.minimo,
            maximo=datos.maximo,
            existencia=0,
            existencia_bodega=0,
        )
        self.db.add(producto)
        self.db.flush()
        for lugar, piezas in (("TIENDA", datos.existencia_inicial), ("BODEGA", datos.bodega_inicial)):
            if not piezas:
                continue
            if lugar == "TIENDA":
                producto.existencia = piezas
            else:
                producto.existencia_bodega = piezas
            self.db.add(TiendaMovimiento(
                producto_id=producto.id, tipo="ENTRADA", ubicacion=lugar, cantidad=piezas,
                existencia_despues=piezas, motivo="Existencia inicial",
                costo_unitario=producto.costo, usuario_id=actor.id, atendio=atendio,
            ))
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module=MODULO,
            entity="TiendaProducto", entity_id=producto.id,
            description=f"Alta de {producto.codigo} · {producto.descripcion} · registró {atendio}",
        )
        self.db.commit()
        self.db.refresh(producto)
        return producto

    def actualizar(self, producto_id: int, datos: dict, actor: User) -> TiendaProducto:
        producto = self.obtener(producto_id)
        if "codigo" in datos and datos["codigo"] is not None:
            nuevo = datos["codigo"].strip()
            if nuevo != producto.codigo:
                if not nuevo:
                    raise ValidationError("El código no puede quedar vacío")
                if self.por_codigo(nuevo):
                    raise ConflictError(f"Ya hay un producto con el código {nuevo}")
                datos["codigo"] = nuevo
                producto.tiene_codigo_barras = not nuevo.upper().startswith("INT-")
        for campo, valor in datos.items():
            if campo in ("costo", "precio") and valor is not None:
                valor = money(valor)
            if campo in ("descripcion", "categoria", "marca", "talla"):
                valor = _texto(valor)
                if campo in ("descripcion", "categoria") and not valor:
                    continue
            anterior = getattr(producto, campo)
            if anterior == valor:
                continue
            setattr(producto, campo, valor)
            self.audit.log(
                user=actor, action=AuditAction.MODIFICAR, module=MODULO,
                entity="TiendaProducto", entity_id=producto.id, field=campo,
                old_value=None if anterior is None else str(anterior),
                new_value=None if valor is None else str(valor),
                description=f"{producto.codigo} · {campo}",
            )
        self.db.commit()
        self.db.refresh(producto)
        return producto

    def precio_masivo(self, datos, actor: User) -> int:
        """Precio = costo × (1 + margen), redondeado hacia arriba al múltiplo pedido."""
        productos = self.listar(categoria=datos.categoria)
        cambiados = 0
        for p in productos:
            if datos.solo_sin_precio and p.precio is not None:
                continue
            bruto = Decimal(p.costo) * (1 + Decimal(datos.margen_pct) / 100)
            paso = datos.redondear_a
            nuevo = money(Decimal(math.ceil(bruto / paso) * paso))
            if p.precio == nuevo:
                continue
            p.precio = nuevo
            cambiados += 1
        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=MODULO,
            entity="TiendaProducto", field="precio",
            description=(
                f"Precio por margen {datos.margen_pct}% a {cambiados} productos"
                + (f" de {datos.categoria}" if datos.categoria else "")
            ),
        )
        self.db.commit()
        return cambiados

    # ------------------------------------------------------------- movimientos
    @staticmethod
    def _en(producto: TiendaProducto, lugar: str) -> int:
        return producto.existencia if lugar == "TIENDA" else producto.existencia_bodega

    @staticmethod
    def _poner(producto: TiendaProducto, lugar: str, piezas: int) -> None:
        if lugar == "TIENDA":
            producto.existencia = piezas
        else:
            producto.existencia_bodega = piezas

    def mover(self, producto_id: int, datos, actor: User) -> TiendaProducto:
        producto = self.obtener(producto_id)
        lugar = datos.ubicacion
        nombre = "tienda" if lugar == "TIENDA" else "bodega"
        motivo = (datos.motivo or "").strip() or None
        atendio = datos.atendio.strip()
        renglones = []  # (lugar, delta, despues)

        if datos.tipo == "ENTRADA":
            if datos.cantidad <= 0:
                raise BusinessRuleError("Indique cuántas piezas entraron")
            despues = self._en(producto, lugar) + datos.cantidad
            renglones.append((lugar, datos.cantidad, despues))
            # Si el lote llegó a otro costo, ese pasa a ser el costo vigente.
            if datos.costo_unitario is not None and money(datos.costo_unitario) != money(producto.costo):
                self.audit.log(
                    user=actor, action=AuditAction.MODIFICAR, module=MODULO,
                    entity="TiendaProducto", entity_id=producto.id, field="costo",
                    old_value=str(producto.costo), new_value=str(money(datos.costo_unitario)),
                    description=f"{producto.codigo} · costo actualizado por entrada",
                )
                producto.costo = money(datos.costo_unitario)
        elif datos.tipo == "AJUSTE":
            antes = self._en(producto, lugar)
            delta = datos.cantidad - antes
            if delta == 0:
                raise BusinessRuleError(f"El conteo de {nombre} coincide con lo registrado; no hay nada que ajustar")
            if not motivo:
                raise BusinessRuleError("Un ajuste por conteo necesita el motivo")
            renglones.append((lugar, delta, datos.cantidad))
        else:  # TRASPASO hacia `lugar`
            origen = "BODEGA" if lugar == "TIENDA" else "TIENDA"
            hay = self._en(producto, origen)
            if datos.cantidad <= 0:
                raise BusinessRuleError("Indique cuántas piezas se pasan")
            if datos.cantidad > hay:
                raise BusinessRuleError(
                    f"En {'bodega' if origen == 'BODEGA' else 'tienda'} solo hay {hay} pieza{'s' if hay != 1 else ''}"
                )
            renglones.append((origen, -datos.cantidad, hay - datos.cantidad))
            renglones.append((lugar, datos.cantidad, self._en(producto, lugar) + datos.cantidad))
            motivo = motivo or f"De {'bodega a tienda' if lugar == 'TIENDA' else 'tienda a bodega'}"

        for donde, delta, despues in renglones:
            self._poner(producto, donde, despues)
            self.db.add(TiendaMovimiento(
                producto_id=producto.id, tipo=datos.tipo, ubicacion=donde, cantidad=delta,
                existencia_despues=despues, motivo=motivo,
                costo_unitario=money(datos.costo_unitario)
                if datos.tipo == "ENTRADA" and datos.costo_unitario is not None else None,
                usuario_id=actor.id, atendio=atendio,
            ))
        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=MODULO,
            entity="TiendaProducto", entity_id=producto.id, field="existencia",
            new_value=f"tienda {producto.existencia} · bodega {producto.existencia_bodega}",
            description=f"{datos.tipo.title()} {datos.cantidad} ({nombre}) · {producto.codigo} · {atendio}"
                        + (f" · {motivo}" if motivo else ""),
        )
        self.db.commit()
        self.db.refresh(producto)
        return producto

    def conteo(self, datos, actor: User) -> dict:
        """Conteo físico de varios productos de un jalón (p. ej. el inventario
        inicial). Solo deja AJUSTE donde lo contado difiere de lo registrado;
        todo entra en una sola transacción."""
        motivo = (datos.motivo or "").strip() or "Conteo físico"
        atendio = datos.atendio.strip()
        cambiados = 0
        for fila in datos.filas:
            producto = self.obtener(fila.producto_id)
            antes = self._en(producto, fila.ubicacion)
            delta = fila.contado - antes
            if delta == 0:
                continue
            self._poner(producto, fila.ubicacion, fila.contado)
            self.db.add(TiendaMovimiento(
                producto_id=producto.id, tipo="AJUSTE", ubicacion=fila.ubicacion,
                cantidad=delta, existencia_despues=fila.contado,
                motivo=motivo, usuario_id=actor.id, atendio=atendio,
            ))
            cambiados += 1
        if cambiados:
            self.audit.log(
                user=actor, action=AuditAction.MODIFICAR, module=MODULO, entity="TiendaProducto",
                description=f"{motivo} · {cambiados} productos ajustados · {atendio}",
            )
        self.db.commit()
        return {"ajustados": cambiados, "revisados": len(datos.filas)}

    def movimientos(self, *, producto_id=None, tipo=None, limite=200) -> List[TiendaMovimiento]:
        stmt = select(TiendaMovimiento)
        if producto_id:
            stmt = stmt.where(TiendaMovimiento.producto_id == producto_id)
        if tipo:
            stmt = stmt.where(TiendaMovimiento.tipo == tipo)
        stmt = stmt.order_by(TiendaMovimiento.id.desc()).limit(limite)
        return list(self.db.execute(stmt).scalars().all())


# ========================================================================== caja
class CajaTienda:
    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)

    def abierto(self) -> Optional[TiendaCorte]:
        return self.db.execute(
            select(TiendaCorte).where(TiendaCorte.estado == "ABIERTO").order_by(TiendaCorte.id.desc())
        ).scalars().first()

    def obtener(self, corte_id: int) -> TiendaCorte:
        corte = self.db.get(TiendaCorte, corte_id)
        if not corte:
            raise NotFoundError("Ese corte no existe")
        return corte

    def totales(self, corte: TiendaCorte) -> dict:
        pagadas = [v for v in corte.ventas if v.estado == "PAGADA"]
        canceladas = [v for v in corte.ventas if v.estado == "CANCELADA"]
        por_metodo = defaultdict(lambda: ZERO)
        for v in pagadas:
            for p in v.pagos:
                por_metodo[p.metodo] += money(p.monto_mxn)
            por_metodo["EFECTIVO"] -= money(v.cambio_mxn)
        ventas_total = money(sum((money(v.total) for v in pagadas), start=ZERO))
        utilidad = money(sum((money(v.total) - money(v.costo_total) for v in pagadas), start=ZERO))
        efectivo = money(por_metodo["EFECTIVO"])
        return {
            "ventas_total": ventas_total,
            "ventas_cuenta": len(pagadas),
            "canceladas": len(canceladas),
            "efectivo_ventas": efectivo,
            "efectivo_esperado": money(money(corte.fondo_inicial) + efectivo),
            "tarjeta_total": money(por_metodo["TARJETA"]),
            "transferencia_total": money(por_metodo["TRANSFERENCIA"]),
            "utilidad": utilidad,
        }

    def salida(self, corte: TiendaCorte) -> dict:
        base = {c: getattr(corte, c) for c in (
            "id", "fecha", "estado", "abierto_en", "abierto_por_nombre", "fondo_inicial",
            "cerrado_en", "cerrado_por_nombre", "efectivo_contado", "diferencia", "notas",
        )}
        base["pendiente_arqueo"] = corte.estado == "CERRADO" and corte.efectivo_contado is None
        if corte.estado == "ABIERTO":
            base.update(self.totales(corte))
        else:
            vivos = self.totales(corte)
            base.update({
                "ventas_total": corte.ventas_total, "ventas_cuenta": corte.ventas_cuenta,
                "efectivo_esperado": corte.efectivo_esperado, "tarjeta_total": corte.tarjeta_total,
                "transferencia_total": corte.transferencia_total,
                "canceladas": vivos["canceladas"], "efectivo_ventas": vivos["efectivo_ventas"],
                "utilidad": vivos["utilidad"],
            })
        return base

    def abierto_o_abrir(self, actor: User, atendio: Optional[str] = None) -> TiendaCorte:
        """La caja de la tienda abre sola con el primer movimiento del día.

        Se abre a nombre de quien atiende (o de la cuenta, si no se dijo) y con
        fondo en cero; el fondo de cambio se ajusta después desde Caja. Pasada
        la hora de cierre no se abre: eso levantaría una caja que se quedaría
        abierta hasta el día siguiente.
        """
        corte = self.abierto()
        if corte:
            return corte
        nombre = (atendio or "").strip()
        if len(nombre) < 3:
            nombre = (actor.full_name or "").strip() or actor.email
        return self.abrir(ZERO, nombre, actor, automatica=True)

    def abrir(self, fondo: Decimal, atendio: str, actor: User, automatica: bool = False) -> TiendaCorte:
        if self.abierto():
            raise BusinessRuleError("Ya hay una caja de tienda abierta. Ciérrela antes de abrir otra.")
        from app.core.cierre_cajas import exigir_horario_de_caja

        exigir_horario_de_caja(self.db)
        corte = TiendaCorte(
            fecha=hoy(), estado="ABIERTO", abierto_en=datetime.utcnow(),
            abierto_por_id=actor.id, abierto_por_nombre=atendio.strip(), fondo_inicial=money(fondo),
        )
        self.db.add(corte)
        self.db.flush()
        self.audit.log(
            user=actor, action=AuditAction.CREAR, module=MODULO, entity="TiendaCorte", entity_id=corte.id,
            new_value=str(corte.fondo_inicial),
            description=(
                f"Apertura {'automática ' if automatica else ''}de caja de tienda · "
                f"fondo ${corte.fondo_inicial} · {atendio.strip()}"
            ),
        )
        self.db.commit()
        self.db.refresh(corte)
        return corte

    def cambiar_fondo(self, fondo: Decimal, actor: User) -> TiendaCorte:
        """Ajusta el fondo de cambio de la caja abierta (la abrió sola, en cero)."""
        corte = self.abierto()
        if not corte:
            raise BusinessRuleError("No hay caja de tienda abierta")
        anterior = money(corte.fondo_inicial)
        corte.fondo_inicial = money(fondo)
        self.audit.log(
            user=actor, action=AuditAction.MODIFICAR, module=MODULO, entity="TiendaCorte",
            entity_id=corte.id, old_value=str(anterior), new_value=str(corte.fondo_inicial),
            description=f"Fondo de caja de tienda #{corte.id}: ${anterior} → ${corte.fondo_inicial}",
        )
        self.db.commit()
        self.db.refresh(corte)
        return corte

    def cerrar(self, datos, actor: User) -> TiendaCorte:
        corte = self.abierto()
        if not corte:
            raise BusinessRuleError("No hay caja de tienda abierta")
        t = self.totales(corte)
        corte.ventas_total = t["ventas_total"]
        corte.ventas_cuenta = t["ventas_cuenta"]
        corte.efectivo_esperado = t["efectivo_esperado"]
        corte.tarjeta_total = t["tarjeta_total"]
        corte.transferencia_total = t["transferencia_total"]
        corte.efectivo_contado = money(datos.efectivo_contado)
        corte.diferencia = money(money(datos.efectivo_contado) - t["efectivo_esperado"])
        corte.notas = (datos.notas or "").strip() or None
        corte.estado = "CERRADO"
        corte.cerrado_en = datetime.utcnow()
        corte.cerrado_por_id = actor.id
        corte.cerrado_por_nombre = datos.atendio.strip()
        self.audit.log(
            user=actor, action=AuditAction.CIERRE_CAJA, module=MODULO, entity="TiendaCorte",
            entity_id=corte.id, new_value=str(corte.efectivo_contado),
            description=(
                f"Cierre de caja de tienda · esperado ${corte.efectivo_esperado} · "
                f"contado ${corte.efectivo_contado} · diferencia ${corte.diferencia} · {datos.atendio.strip()}"
            ),
        )
        self.db.commit()
        self.db.refresh(corte)
        return corte

    def cerrar_automatico(self, corte: TiendaCorte, hora: str) -> TiendaCorte:
        """Cierre a la hora configurada, sin nadie que cuente el cajón.

        Se congelan los totales igual que en un cierre normal, pero el efectivo
        contado queda vacío: el arqueo se registra después, desde Caja.
        """
        t = self.totales(corte)
        corte.ventas_total = t["ventas_total"]
        corte.ventas_cuenta = t["ventas_cuenta"]
        corte.efectivo_esperado = t["efectivo_esperado"]
        corte.tarjeta_total = t["tarjeta_total"]
        corte.transferencia_total = t["transferencia_total"]
        corte.efectivo_contado = None
        corte.diferencia = None
        corte.estado = "CERRADO"
        corte.cerrado_en = datetime.utcnow()
        corte.cerrado_por_id = None
        corte.cerrado_por_nombre = "Cierre automático"
        corte.notas = f"Cerrada automáticamente a las {hora}. Falta contar el efectivo."
        self.audit.log(
            user=None, action=AuditAction.CIERRE_CAJA, module=MODULO, entity="TiendaCorte",
            entity_id=corte.id, new_value=str(corte.efectivo_esperado),
            description=f"Cierre automático de caja de tienda ({hora}) · esperado ${corte.efectivo_esperado}",
        )
        self.db.commit()
        return corte

    def arqueo(self, corte_id: int, datos, actor: User) -> TiendaCorte:
        """Contar el efectivo de un corte que se cerró solo."""
        corte = self.obtener(corte_id)
        if corte.estado != "CERRADO" or corte.efectivo_contado is not None:
            raise BusinessRuleError("Ese corte ya tiene su efectivo contado")
        corte.efectivo_contado = money(datos.efectivo_contado)
        corte.diferencia = money(corte.efectivo_contado - money(corte.efectivo_esperado))
        nota = (datos.notas or "").strip()
        corte.notas = " · ".join(x for x in (corte.notas, f"Arqueo de {datos.atendio.strip()}", nota) if x)
        self.audit.log(
            user=actor, action=AuditAction.CIERRE_CAJA, module=MODULO, entity="TiendaCorte",
            entity_id=corte.id, new_value=str(corte.efectivo_contado),
            description=(
                f"Arqueo posterior de caja de tienda #{corte.id} · esperado ${corte.efectivo_esperado} · "
                f"contado ${corte.efectivo_contado} · diferencia ${corte.diferencia} · {datos.atendio.strip()}"
            ),
        )
        self.db.commit()
        self.db.refresh(corte)
        return corte

    def historial(self, limite: int = 60) -> List[TiendaCorte]:
        return list(self.db.execute(
            select(TiendaCorte).order_by(TiendaCorte.id.desc()).limit(limite)
        ).scalars().all())


# ======================================================================== ventas
class VentasTienda:
    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)
        self.caja = CajaTienda(db)
        self.catalogo = CatalogoTienda(db)

    def _folio(self) -> str:
        ultimo = self.db.execute(select(func.max(TiendaVenta.id))).scalar() or 0
        return f"PS-{ultimo + 1:06d}"

    def obtener(self, venta_id: int) -> TiendaVenta:
        venta = self.db.get(TiendaVenta, venta_id)
        if not venta:
            raise NotFoundError("Esa venta no existe")
        return venta

    def por_folio(self, folio: str) -> TiendaVenta:
        venta = self.db.execute(
            select(TiendaVenta).where(TiendaVenta.folio == folio.strip().upper())
        ).scalar_one_or_none()
        if not venta:
            raise NotFoundError("No encontramos ese ticket")
        return venta

    def listar(self, *, desde=None, hasta=None, estado=None, termino=None, corte_id=None,
               limite=300) -> List[TiendaVenta]:
        stmt = select(TiendaVenta)
        if corte_id:
            stmt = stmt.where(TiendaVenta.corte_id == corte_id)
        if desde:
            stmt = stmt.where(TiendaVenta.fecha >= desde)
        if hasta:
            stmt = stmt.where(TiendaVenta.fecha <= hasta)
        if estado:
            stmt = stmt.where(TiendaVenta.estado == estado)
        if termino and termino.strip():
            patron = f"%{termino.strip()}%"
            stmt = stmt.where(or_(TiendaVenta.folio.ilike(patron), TiendaVenta.cliente.ilike(patron),
                                  TiendaVenta.atendio.ilike(patron)))
        return list(self.db.execute(stmt.order_by(TiendaVenta.id.desc()).limit(limite)).scalars().all())

    # ------------------------------------------------------------------ vender
    def vender(self, datos, actor: User) -> TiendaVenta:
        corte = self.caja.abierto_o_abrir(actor, datos.atendio)

        # Juntar renglones repetidos: el mismo producto escaneado dos veces.
        cantidades = defaultdict(int)
        for l in datos.lineas:
            cantidades[l.producto_id] += l.cantidad

        lineas, subtotal, costo_total, piezas = [], ZERO, ZERO, 0
        productos = {}
        for producto_id, cantidad in cantidades.items():
            p = self.db.execute(
                select(TiendaProducto).where(TiendaProducto.id == producto_id).with_for_update()
                if self.db.bind and self.db.bind.dialect.name != "sqlite"
                else select(TiendaProducto).where(TiendaProducto.id == producto_id)
            ).scalar_one_or_none()
            if not p:
                raise NotFoundError("Uno de los productos ya no existe")
            if not p.activo:
                raise BusinessRuleError(f"{p.descripcion} está dado de baja")
            if p.precio is None:
                raise BusinessRuleError(f"{p.descripcion} no tiene precio de venta. Póngale precio primero.")
            if cantidad > p.existencia:
                extra = (
                    f" En bodega hay {p.existencia_bodega}: páselas a tienda primero."
                    if p.existencia_bodega else " Registre la entrada o ajuste el conteo."
                )
                raise BusinessRuleError(
                    f"En tienda solo hay {p.existencia} de {p.descripcion} y se quieren vender {cantidad}." + extra
                )
            precio = money(p.precio)
            total_linea = money(precio * cantidad)
            lineas.append((p, cantidad, precio, total_linea))
            productos[p.id] = p
            subtotal += total_linea
            costo_total += money(p.costo) * cantidad
            piezas += cantidad

        descuento = money(datos.descuento or 0)
        if descuento > subtotal:
            raise BusinessRuleError("El descuento no puede ser mayor que la venta")
        if descuento > 0 and not (datos.descuento_motivo or "").strip():
            raise BusinessRuleError("Indique el motivo del descuento")
        total = money(subtotal - descuento)

        tc = ExchangeRateService(self.db).current_rate()
        cambio = self._validar_pagos(datos.pagos, total, tc)

        venta = TiendaVenta(
            folio=self._folio(), corte_id=corte.id, fecha=hoy(), estado="PAGADA",
            subtotal=money(subtotal), descuento=descuento,
            descuento_motivo=(datos.descuento_motivo or "").strip() or None,
            total=total, costo_total=money(costo_total), piezas=piezas, cambio_mxn=cambio,
            tipo_cambio=tc, cliente=_texto(datos.cliente), notas=(datos.notas or "").strip() or None,
            atendio=datos.atendio.strip(), usuario_id=actor.id, created_at=datetime.utcnow(),
        )
        self.db.add(venta)
        self.db.flush()

        for p, cantidad, precio, total_linea in lineas:
            self.db.add(TiendaVentaLinea(
                venta_id=venta.id, producto_id=p.id, codigo=p.codigo, descripcion=p.descripcion,
                categoria=p.categoria, cantidad=cantidad, precio_unitario=precio,
                costo_unitario=money(p.costo), total=total_linea,
            ))
            p.existencia -= cantidad
            self.db.add(TiendaMovimiento(
                producto_id=p.id, tipo="VENTA", cantidad=-cantidad, existencia_despues=p.existencia,
                motivo=f"Venta {venta.folio}", venta_id=venta.id, usuario_id=actor.id,
                atendio=venta.atendio,
            ))
        for pago in datos.pagos:
            tasa = tc if pago.moneda == "USD" else Decimal("1.0000")
            self.db.add(TiendaPago(
                venta_id=venta.id, metodo=pago.metodo, moneda=pago.moneda, monto=money(pago.monto),
                tipo_cambio=tasa, monto_mxn=money(money(pago.monto) * tasa),
                referencia=(pago.referencia or "").strip() or None,
            ))
        self.audit.log(
            user=actor, action=AuditAction.PAGO, module=MODULO, entity="TiendaVenta", entity_id=venta.id,
            new_value=str(total),
            description=f"Venta {venta.folio} · {piezas} pzas · ${total} · {venta.atendio}"
                        + (f" · descuento ${descuento}" if descuento else ""),
        )
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ConflictError("Se cruzaron dos ventas al mismo tiempo. Intente de nuevo.") from exc
        self.db.refresh(venta)
        return venta

    @staticmethod
    def _validar_pagos(pagos, total: Decimal, tc: Decimal) -> Decimal:
        """Nunca de menos. Tarjeta y transferencia exactas; el efectivo da cambio."""
        entrante, no_efectivo = ZERO, ZERO
        for p in pagos:
            mxn = money(money(p.monto) * (tc if p.moneda == "USD" else 1))
            entrante += mxn
            if p.metodo != "EFECTIVO":
                no_efectivo += mxn
        entrante, no_efectivo = money(entrante), money(no_efectivo)
        if entrante < total:
            raise BusinessRuleError(f"Faltan ${money(total - entrante)} para cubrir la venta de ${total}")
        if no_efectivo > total:
            raise BusinessRuleError(
                "Con tarjeta o transferencia se cobra exacto; solo en efectivo se puede dar cambio"
            )
        return money(entrante - total)

    # --------------------------------------------------------------- cancelar
    def cancelar(self, venta_id: int, datos, actor: User) -> TiendaVenta:
        venta = self.obtener(venta_id)
        if venta.estado != "PAGADA":
            raise BusinessRuleError("Esa venta ya estaba cancelada")
        if venta.corte.estado != "ABIERTO":
            raise BusinessRuleError(
                "Esa venta es de una caja ya cerrada. Las devoluciones de días anteriores se "
                "registran como entrada de mercancía con su motivo."
            )
        for linea in venta.lineas:
            p = self.catalogo.obtener(linea.producto_id)
            p.existencia += linea.cantidad
            self.db.add(TiendaMovimiento(
                producto_id=p.id, tipo="CANCELACION", cantidad=linea.cantidad,
                existencia_despues=p.existencia, motivo=f"Cancelación {venta.folio} · {datos.motivo.strip()}",
                venta_id=venta.id, usuario_id=actor.id, atendio=datos.atendio.strip(),
            ))
        venta.estado = "CANCELADA"
        venta.cancelada_en = datetime.utcnow()
        venta.cancelada_por = datos.atendio.strip()
        venta.motivo_cancelacion = datos.motivo.strip()
        self.audit.log(
            user=actor, action=AuditAction.CANCELAR, module=MODULO, entity="TiendaVenta",
            entity_id=venta.id, old_value=str(venta.total),
            description=f"Cancelación de {venta.folio} · ${venta.total} · {datos.atendio.strip()} · {datos.motivo.strip()}",
        )
        self.db.commit()
        self.db.refresh(venta)
        return venta

    # --------------------------------------------------------------- reportes
    def reporte(self, desde: date, hasta: date) -> dict:
        if hasta < desde:
            desde, hasta = hasta, desde
        if (hasta - desde).days > 366:
            raise ValidationError("El reporte abarca como máximo un año")
        ventas = self.listar(desde=desde, hasta=hasta, limite=100000)
        pagadas = [v for v in ventas if v.estado == "PAGADA"]
        canceladas = [v for v in ventas if v.estado == "CANCELADA"]

        total = money(sum((money(v.total) for v in pagadas), start=ZERO))
        costo = money(sum((money(v.costo_total) for v in pagadas), start=ZERO))
        piezas = sum(v.piezas for v in pagadas)

        por_dia = {}
        d = desde
        while d <= hasta:
            por_dia[d] = {"fecha": d, "total": ZERO, "ventas": 0, "utilidad": ZERO}
            d += timedelta(days=1)
        por_metodo = defaultdict(lambda: ZERO)
        por_hora = defaultdict(lambda: {"total": ZERO, "ventas": 0})
        por_vendedor = defaultdict(lambda: {"total": ZERO, "ventas": 0})
        productos = {}
        categorias = defaultdict(lambda: {"total": ZERO, "piezas": 0, "utilidad": ZERO})

        from app.shared.tiempo import zona
        from datetime import timezone as _tz
        tz = zona()
        for v in pagadas:
            fila = por_dia[v.fecha]
            fila["total"] += money(v.total)
            fila["ventas"] += 1
            fila["utilidad"] += money(v.total) - money(v.costo_total)
            for p in v.pagos:
                por_metodo[p.metodo] += money(p.monto_mxn)
            por_metodo["EFECTIVO"] -= money(v.cambio_mxn)
            local = v.created_at.replace(tzinfo=_tz.utc).astimezone(tz) if tz else v.created_at
            h = por_hora[local.hour]
            h["total"] += money(v.total)
            h["ventas"] += 1
            pv = por_vendedor[v.atendio]
            pv["total"] += money(v.total)
            pv["ventas"] += 1
            for l in v.lineas:
                fila_p = productos.setdefault(l.producto_id, {
                    "producto_id": l.producto_id, "codigo": l.codigo, "descripcion": l.descripcion,
                    "categoria": l.categoria, "piezas": 0, "importe": ZERO, "utilidad": ZERO,
                })
                fila_p["piezas"] += l.cantidad
                fila_p["importe"] += money(l.total)
                fila_p["utilidad"] += money(l.total) - money(l.costo_unitario) * l.cantidad
                c = categorias[l.categoria]
                c["piezas"] += l.cantidad
                c["total"] += money(l.total)
                c["utilidad"] += money(l.total) - money(l.costo_unitario) * l.cantidad

        top = sorted(productos.values(), key=lambda x: (x["importe"], x["piezas"]), reverse=True)
        return {
            "desde": desde,
            "hasta": hasta,
            "ventas": len(pagadas),
            "total": total,
            "costo": costo,
            "utilidad": money(total - costo),
            "margen_pct": (
                Decimal((total - costo) / total * 100).quantize(Decimal("0.1"), ROUND_HALF_UP)
                if total > 0 else Decimal("0")
            ),
            "piezas": piezas,
            "ticket_promedio": money(total / len(pagadas)) if pagadas else ZERO,
            "descuentos": money(sum((money(v.descuento) for v in pagadas), start=ZERO)),
            "canceladas": len(canceladas),
            "canceladas_total": money(sum((money(v.total) for v in canceladas), start=ZERO)),
            "por_dia": [
                {**f, "total": money(f["total"]), "utilidad": money(f["utilidad"])} for f in por_dia.values()
            ],
            "por_metodo": [
                {"metodo": m, "total": money(por_metodo[m])}
                for m in ("EFECTIVO", "TARJETA", "TRANSFERENCIA")
            ],
            "por_hora": [
                {"hora": hh, "total": money(por_hora[hh]["total"]), "ventas": por_hora[hh]["ventas"]}
                for hh in sorted(por_hora)
            ],
            "por_vendedor": sorted(
                [{"atendio": k, "total": money(x["total"]), "ventas": x["ventas"]} for k, x in por_vendedor.items()],
                key=lambda x: x["total"], reverse=True,
            ),
            "por_categoria": sorted(
                [{"categoria": k, "total": money(x["total"]), "piezas": x["piezas"], "utilidad": money(x["utilidad"])}
                 for k, x in categorias.items()],
                key=lambda x: x["total"], reverse=True,
            ),
            "top_productos": [
                {**x, "importe": money(x["importe"]), "utilidad": money(x["utilidad"])} for x in top[:15]
            ],
        }
