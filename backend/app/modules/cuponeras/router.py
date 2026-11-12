"""Endpoints de cuponeras."""
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import RequirePermission
from app.core.permissions import Permission
from app.modules.cuponeras.schemas import (
    CanjeIn, CuponeraIn, CuponeraMostrador, CuponeraOut, CuponeraUpdate, NotaIn, PagoIn, UsoOut,
)
from app.modules.cuponeras.service import Cuponeras, bloqueos_de, estado_de, motivo_bloqueo
from app.modules.identity.models import User
from app.shared.money import money

router = APIRouter(prefix="/cuponeras", tags=["Cuponeras"])

CANJEAR = RequirePermission(Permission.CUPONERA_CANJEAR)
GESTIONAR = RequirePermission(Permission.CUPONERA_GESTIONAR)
ADMINISTRAR = RequirePermission(Permission.CUPONERA_ADMINISTRAR)


def _usos(c) -> List[UsoOut]:
    return [UsoOut.model_validate(u) for u in c.usos]


def _completa(c, con_usos: bool = True) -> CuponeraOut:
    lista = Decimal(c.precio_lista) if c.precio_lista else None
    descuento = None
    if lista and lista > 0:
        descuento = money((lista - Decimal(c.precio_total)) / lista * 100)
    return CuponeraOut(
        id=c.id, folio=c.folio, titular_nombre=c.titular_nombre, empresa=c.empresa, telefono=c.telefono,
        correo=c.correo, pases_total=c.pases_total, pases_usados=c.pases_usados, saldo=c.saldo,
        hoyos_18=c.hoyos_18, hoyos_9=c.hoyos_9, precio_total=c.precio_total, precio_lista=c.precio_lista,
        descuento_pct=descuento, precio_por_pase=money(Decimal(c.precio_total) / c.pases_total),
        vence_el=c.vence_el, fechas_bloqueadas=bloqueos_de(c), pago_estado=c.pago_estado,
        pago_referencia=c.pago_referencia, pagada_en=c.pagada_en, pago_confirmo_nombre=c.pago_confirmo_nombre,
        cancelada=c.cancelada, cancelada_en=c.cancelada_en, cancelada_por=c.cancelada_por,
        cancelada_nota=c.cancelada_nota, notas=c.notas, creada_por_nombre=c.creada_por_nombre,
        created_at=c.created_at, estado=estado_de(c), usos=_usos(c) if con_usos else [],
    )


def _mostrador(c) -> CuponeraMostrador:
    return CuponeraMostrador(
        id=c.id, folio=c.folio, titular_nombre=c.titular_nombre, empresa=c.empresa,
        pases_total=c.pases_total, pases_usados=c.pases_usados, saldo=c.saldo,
        hoyos_18=c.hoyos_18, hoyos_9=c.hoyos_9, vence_el=c.vence_el,
        fechas_bloqueadas=bloqueos_de(c), estado=estado_de(c), motivo_bloqueo=motivo_bloqueo(c),
        usos=_usos(c)[:15],
    )


@router.get("", response_model=List[CuponeraOut])
def listar(
    estado: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(GESTIONAR),
):
    return [_completa(c, con_usos=False) for c in Cuponeras(db).listar(estado=estado, q=q)]


@router.post("", response_model=CuponeraOut, status_code=status.HTTP_201_CREATED)
def crear(data: CuponeraIn, db: Session = Depends(get_db), actor: User = Depends(GESTIONAR)):
    return _completa(Cuponeras(db).crear(data, actor))


@router.get("/codigo/{folio}", response_model=CuponeraMostrador)
def por_codigo(folio: str, db: Session = Depends(get_db), _: User = Depends(CANJEAR)):
    """Lo que lee el mostrador al escanear el código de barras."""
    return _mostrador(Cuponeras(db).por_folio(folio))


@router.get("/{cuponera_id}", response_model=CuponeraOut)
def detalle(cuponera_id: int, db: Session = Depends(get_db), _: User = Depends(GESTIONAR)):
    return _completa(Cuponeras(db).obtener(cuponera_id))


@router.post("/{cuponera_id}/pago", response_model=CuponeraOut)
def confirmar_pago(cuponera_id: int, data: PagoIn, db: Session = Depends(get_db), actor: User = Depends(GESTIONAR)):
    return _completa(Cuponeras(db).confirmar_pago(cuponera_id, data.referencia, actor))


@router.post("/{cuponera_id}/reenviar", response_model=CuponeraOut)
def reenviar(cuponera_id: int, db: Session = Depends(get_db), _: User = Depends(GESTIONAR)):
    """Vuelve a mandar la cuponera por correo (por si no le llegó o la perdió)."""
    return _completa(Cuponeras(db).reenviar_tarjeta(cuponera_id))


@router.patch("/{cuponera_id}", response_model=CuponeraOut)
def actualizar(cuponera_id: int, data: CuponeraUpdate, db: Session = Depends(get_db), actor: User = Depends(ADMINISTRAR)):
    return _completa(Cuponeras(db).actualizar(cuponera_id, data, actor))


@router.post("/{cuponera_id}/cancelar", response_model=CuponeraOut)
def cancelar(cuponera_id: int, data: NotaIn, db: Session = Depends(get_db), actor: User = Depends(ADMINISTRAR)):
    return _completa(Cuponeras(db).cancelar(cuponera_id, data.nota, actor))


@router.post("/{cuponera_id}/canjear", response_model=CuponeraMostrador)
def canjear(cuponera_id: int, data: CanjeIn, db: Session = Depends(get_db), actor: User = Depends(CANJEAR)):
    return _mostrador(Cuponeras(db).canjear(cuponera_id, data, actor))


@router.post("/usos/{uso_id}/anular", response_model=CuponeraOut)
def anular_uso(uso_id: int, data: NotaIn, db: Session = Depends(get_db), actor: User = Depends(ADMINISTRAR)):
    return _completa(Cuponeras(db).anular_uso(uso_id, data.nota, actor))
