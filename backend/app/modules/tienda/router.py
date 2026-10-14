"""API de la tienda. Todo bajo /api/tienda; los hoteles no tienen acceso."""
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import RequirePermission
from app.core.exceptions import NotFoundError
from app.core.permissions import Permission
from app.modules.identity.models import User
from app.modules.tienda.schemas import (
    AbrirCorteIn,
    ArqueoIn,
    CancelarVentaIn,
    CerrarCorteIn,
    ConteoIn,
    CorteOut,
    MovimientoIn,
    MovimientoOut,
    PrecioMasivoIn,
    ProductoIn,
    ProductoOut,
    ProductoUpdate,
    ResumenInventario,
    VentaIn,
    VentaOut,
)
from app.modules.tienda.service import CajaTienda, CatalogoTienda, VentasTienda
from app.shared.tiempo import hoy

router = APIRouter(prefix="/tienda", tags=["Tienda"])

VENDER = RequirePermission(Permission.TIENDA_VENDER)
ADMINISTRAR = RequirePermission(Permission.TIENDA_ADMINISTRAR)


# ------------------------------------------------------------------ productos
@router.get("/productos", response_model=List[ProductoOut])
def productos(
    q: Optional[str] = Query(None),
    categoria: Optional[str] = Query(None),
    por_surtir: bool = Query(False),
    sin_precio: bool = Query(False),
    inactivos: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(VENDER),
):
    return CatalogoTienda(db).listar(
        termino=q, categoria=categoria, por_surtir=por_surtir, inactivos=inactivos, sin_precio=sin_precio
    )


@router.get("/productos/codigo/{codigo}", response_model=ProductoOut)
def por_codigo(codigo: str, db: Session = Depends(get_db), _: User = Depends(VENDER)):
    producto = CatalogoTienda(db).por_codigo(codigo)
    if not producto:
        raise NotFoundError(f"No hay ningún producto con el código {codigo}")
    return producto


@router.get("/resumen", response_model=ResumenInventario)
def resumen(db: Session = Depends(get_db), _: User = Depends(VENDER)):
    return CatalogoTienda(db).resumen()


@router.post("/productos", response_model=ProductoOut, status_code=status.HTTP_201_CREATED)
def crear(
    data: ProductoIn,
    atendio: str = Query(..., min_length=3),
    db: Session = Depends(get_db),
    user: User = Depends(ADMINISTRAR),
):
    return CatalogoTienda(db).crear(data, user, atendio.strip())


@router.patch("/productos/{producto_id}", response_model=ProductoOut)
def actualizar(producto_id: int, data: ProductoUpdate, db: Session = Depends(get_db),
               user: User = Depends(ADMINISTRAR)):
    return CatalogoTienda(db).actualizar(producto_id, data.model_dump(exclude_unset=True), user)


@router.post("/productos/precio-por-margen")
def precio_por_margen(data: PrecioMasivoIn, db: Session = Depends(get_db),
                      user: User = Depends(ADMINISTRAR)):
    return {"actualizados": CatalogoTienda(db).precio_masivo(data, user)}


@router.post("/productos/conteo")
def conteo(data: ConteoIn, db: Session = Depends(get_db), user: User = Depends(ADMINISTRAR)):
    return CatalogoTienda(db).conteo(data, user)


@router.post("/productos/{producto_id}/movimientos", response_model=ProductoOut)
def mover(producto_id: int, data: MovimientoIn, db: Session = Depends(get_db),
          user: User = Depends(ADMINISTRAR)):
    return CatalogoTienda(db).mover(producto_id, data, user)


@router.get("/movimientos", response_model=List[MovimientoOut])
def movimientos(
    producto_id: Optional[int] = Query(None),
    tipo: Optional[str] = Query(None),
    limite: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(ADMINISTRAR),
):
    from app.modules.tienda.models import TiendaVenta

    lista = CatalogoTienda(db).movimientos(producto_id=producto_id, tipo=tipo, limite=limite)
    folios = {}
    ids = {m.venta_id for m in lista if m.venta_id}
    if ids:
        for v in db.query(TiendaVenta).filter(TiendaVenta.id.in_(ids)).all():
            folios[v.id] = v.folio
    salida = []
    for m in lista:
        out = MovimientoOut.model_validate(m)
        out.producto_codigo = m.producto.codigo if m.producto else None
        out.producto_descripcion = m.producto.descripcion if m.producto else None
        out.usuario_nombre = m.usuario.full_name if m.usuario else None
        out.venta_folio = folios.get(m.venta_id)
        salida.append(out)
    return salida


# ---------------------------------------------------------------------- caja
@router.get("/caja/actual")
def caja_actual(db: Session = Depends(get_db), _: User = Depends(VENDER)):
    caja = CajaTienda(db)
    corte = caja.abierto()
    return {"abierta": bool(corte), "corte": CorteOut(**caja.salida(corte)) if corte else None}


@router.post("/caja/abrir", response_model=CorteOut)
def caja_abrir(data: AbrirCorteIn, db: Session = Depends(get_db), user: User = Depends(VENDER)):
    caja = CajaTienda(db)
    return CorteOut(**caja.salida(caja.abrir(data.fondo_inicial, data.atendio, user)))


@router.post("/caja/cerrar", response_model=CorteOut)
def caja_cerrar(data: CerrarCorteIn, db: Session = Depends(get_db), user: User = Depends(VENDER)):
    caja = CajaTienda(db)
    return CorteOut(**caja.salida(caja.cerrar(data, user)))


@router.get("/caja/cortes", response_model=List[CorteOut])
def caja_cortes(db: Session = Depends(get_db), _: User = Depends(ADMINISTRAR)):
    caja = CajaTienda(db)
    return [CorteOut(**caja.salida(c)) for c in caja.historial()]


@router.get("/caja/cortes/{corte_id}", response_model=CorteOut)
def caja_corte(corte_id: int, db: Session = Depends(get_db), _: User = Depends(VENDER)):
    caja = CajaTienda(db)
    return CorteOut(**caja.salida(caja.obtener(corte_id)))


@router.post("/caja/cortes/{corte_id}/arqueo", response_model=CorteOut)
def caja_arqueo(corte_id: int, data: ArqueoIn, db: Session = Depends(get_db), user: User = Depends(VENDER)):
    caja = CajaTienda(db)
    return CorteOut(**caja.salida(caja.arqueo(corte_id, data, user)))


# -------------------------------------------------------------------- ventas
@router.post("/ventas", response_model=VentaOut, status_code=status.HTTP_201_CREATED)
def vender(data: VentaIn, db: Session = Depends(get_db), user: User = Depends(VENDER)):
    return VentasTienda(db).vender(data, user)


@router.get("/ventas", response_model=List[VentaOut])
def ventas(
    desde: Optional[date] = Query(None),
    hasta: Optional[date] = Query(None),
    estado: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    corte_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(VENDER),
):
    return VentasTienda(db).listar(desde=desde, hasta=hasta, estado=estado, termino=q, corte_id=corte_id)


@router.get("/ventas/folio/{folio}", response_model=VentaOut)
def venta_por_folio(folio: str, db: Session = Depends(get_db), _: User = Depends(VENDER)):
    return VentasTienda(db).por_folio(folio)


@router.get("/ventas/{venta_id}", response_model=VentaOut)
def venta(venta_id: int, db: Session = Depends(get_db), _: User = Depends(VENDER)):
    return VentasTienda(db).obtener(venta_id)


@router.post("/ventas/{venta_id}/cancelar", response_model=VentaOut)
def cancelar(venta_id: int, data: CancelarVentaIn, db: Session = Depends(get_db),
             user: User = Depends(ADMINISTRAR)):
    return VentasTienda(db).cancelar(venta_id, data, user)


# ------------------------------------------------------------------ reportes
@router.get("/reportes")
def reportes(
    desde: Optional[date] = Query(None),
    hasta: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(ADMINISTRAR),
):
    fin = hasta or hoy()
    inicio = desde or fin.replace(day=1)
    return VentasTienda(db).reporte(inicio, fin)
