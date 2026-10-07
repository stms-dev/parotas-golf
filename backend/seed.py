"""Datos iniciales.

Crea los 9 hoteles con convenio, tarifas, servicios, credenciales PGA,
horarios, tipo de cambio, inventario del Pro-Shop y las cuentas de acceso.

    python seed.py                 # desarrollo: cuentas de prueba
    python seed.py --produccion    # solo catálogos y un administrador real

En producción no se crean cuentas de prueba ni contraseñas conocidas: el
administrador sale de las variables SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD, y
desde su pantalla de control se dan de alta las demás cuentas.
"""
import secrets
import os
import sys
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import select

from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
from app.models import (  # noqa: F401  (registra todos los modelos)
    AdditionalService,
    CourseScheduleConfig,
    DiscountCode,
    ExchangeRate,
    Hotel,
    PGABenefitConfig,
    PGACredential,
    RatePlan,
    SystemSetting,
    User,
)
from app.shared.enums import (
    BookingModality,
    DayType,
    DiscountType,
    PlayerCategory,
    ServiceUnit,
    TimeBand,
    UserRole,
)

HOY = date.today()


def crear_tablas():
    Base.metadata.create_all(engine)
    print("✓ Esquema creado")


def sembrar(produccion: bool = False):
    db = SessionLocal()
    try:
        # La venta directa la crea la migración, así que no cuenta como
        # "ya sembrado": lo que manda es si hay hoteles con convenio.
        if db.execute(select(Hotel).where(Hotel.is_direct.is_(False))).scalars().first():
            print("⚠ La base ya tiene datos. Borra las_parotas.db para volver a sembrar.")
            return

        # ------------------------------------------------------------ hoteles
        # Los nueve convenios de la hoja "Costeo" del tarifario del club. A
        # cuatro se les paga comisión del 5%; los otros cinco van sin comisión.
        hoteles_data = [
            ("CELESTE", "Celeste", "5.00"),
            ("DREAMS", "Dreams", "5.00"),
            ("SECRETS", "Secrets", "5.00"),
            ("BRISAS", "Brisas", "5.00"),
            ("BARCELO", "Barceló", "0.00"),
            ("QUINTAREAL", "Quinta Real", "0.00"),
            ("CAMINOREAL", "Camino Real Zaashila", "0.00"),
            ("AMHMH", "AMHMH (Binniguenda, Marina, Park Royal)", "0.00"),
            ("COSMO", "Cosmo Residences", "0.00"),
            # Quien llega al campo por su cuenta, sin venir de un hotel. El
            # mostrador lo registra aquí; no hay comisión que pagar.
            ("DIRECTO", "Público general (sin hotel)", "0.00"),
        ]
        hoteles = {}
        for code, name, commission in hoteles_data:
            # La venta directa puede venir ya creada por la migración.
            hotel = db.execute(select(Hotel).where(Hotel.code == code)).scalars().first()
            if not hotel:
                hotel = Hotel(
                    code=code, name=name,
                    commission_rate=Decimal(commission),
                    is_direct=code == "DIRECTO",
                    contact_email=None if code == "DIRECTO" else f"concierge@{code.lower()}.mx",
                )
                db.add(hotel)
            hoteles[code] = hotel
        db.flush()
        print(f"✓ {len(hoteles) - 1} hoteles con convenio + venta directa en mostrador")

        # ------------------------------------------------------------ tarifas
        # Green fee POR JUGADOR, de la hoja "Costeo". El precio cambia de lunes
        # a jueves contra viernes a domingo, y es el mismo en los tres
        # paquetes: lo que cambia entre ellos es cómo se ocupa la salida.
        #
        # Precios 2026. Todas las rondas incluyen carrito compartido, tarjeta
        # de score, 10 tees y 50 pelotas de práctica; las bebidas ya no.
        #
        # La hoja no trae precio de menor a 9 hoyos: no se inventa. Si un
        # hotel lo intenta, el sistema avisa que falta darlo de alta.
        precios = [
            # hoyos, categoría,            día,                    precio,    franja
            (9,  PlayerCategory.ADULTO,   DayType.ENTRE_SEMANA,   "2200.00", TimeBand.TODAS),
            (9,  PlayerCategory.ADULTO,   DayType.FIN_DE_SEMANA,  "2500.00", TimeBand.TODAS),
            (18, PlayerCategory.ADULTO,   DayType.ENTRE_SEMANA,   "3600.00", TimeBand.TODAS),
            (18, PlayerCategory.ADULTO,   DayType.FIN_DE_SEMANA,  "4000.00", TimeBand.TODAS),
            (18, PlayerCategory.INFANTIL, DayType.ENTRE_SEMANA,   "1800.00", TimeBand.TODAS),
            (18, PlayerCategory.INFANTIL, DayType.FIN_DE_SEMANA,  "2000.00", TimeBand.TODAS),
            # Twilight: salidas de 2:00 a 3:00 pm.
            (18, PlayerCategory.ADULTO,   DayType.ENTRE_SEMANA,   "2700.00", TimeBand.TWILIGHT),
            (18, PlayerCategory.ADULTO,   DayType.FIN_DE_SEMANA,  "3000.00", TimeBand.TWILIGHT),
            # Local: vive en Huatulco, enseña credencial. Solo entre semana;
            # en fin de semana paga como adulto.
            (18, PlayerCategory.LOCAL,    DayType.ENTRE_SEMANA,   "2500.00", TimeBand.TODAS),
        ]
        DIA = {DayType.ENTRE_SEMANA: "lun a jue", DayType.FIN_DE_SEMANA: "vie a dom"}
        tarifas = []
        # Individual ya no se vende: quien llega solo entra a una partida
        # abierta. Por eso no se le dan de alta tarifas — una tarifa de una
        # modalidad que nadie puede elegir solo confunde a quien ve la lista.
        for modalidad, etiqueta in (
            (BookingModality.GRUPO, "Grupo"),
            (BookingModality.PARTIDA_ABIERTA, "Partida abierta"),
        ):
            for hoyos, categoria, dia, precio, franja in precios:
                quien = {PlayerCategory.INFANTIL: " (JR)", PlayerCategory.LOCAL: " (local)"}.get(categoria, "")
                tw = " · twilight" if franja == TimeBand.TWILIGHT else ""
                tarifas.append((
                    f"{etiqueta} · {hoyos} hoyos{quien}{tw} · {DIA[dia]}",
                    modalidad, hoyos, categoria, dia, precio, franja,
                ))
        for name, modality, holes, category, day_type, price, franja in tarifas:
            db.add(
                RatePlan(
                    name=name, modality=modality.value, holes=holes, category=category,
                    day_type=day_type.value, time_band=franja.value,
                    price=Decimal(price), currency="MXN",
                    valid_from=date(HOY.year, 1, 1),
                )
            )
        print(f"✓ {len(tarifas)} tarifas vigentes (entre semana y fin de semana)")

        # ---------------------------------------------------------- servicios
        # De la hoja "Costeo". Los códigos CADDIE y BASTONES no se cambian:
        # Nueva Reserva los busca por código para ofrecerlos al hotel.
        servicios = [
            # El caddie cobra 600: 500 son suyos y 100 de comisión al club.
            ("CADDIE", "Caddie", "600.00", ServiceUnit.POR_RONDA),
            # Set básico: putter, madera, driver y hierros (10 bastones). No se
            # comparten: cada jugador renta el suyo.
            ("BASTONES", "Renta de bastones (set básico)", "850.00", ServiceUnit.POR_RONDA),
            ("REPLAY", "Replay · ronda extra de la partida", "1200.00", ServiceUnit.POR_RONDA),
            # Quien acompaña sin jugar paga su lugar. Se carga solo desde la
            # reserva del hotel, uno por cada acompañante anotado.
            ("ACOMPANANTE", "Acompañante (no juega)", "800.00", ServiceUnit.POR_PERSONA),
            # 180 pelotas. Cuesta más de viernes a domingo.
            ("PRACTICA", "Zona de práctica", "250.00", ServiceUnit.POR_PERSONA),
        ]
        FIN_DE_SEMANA = {"PRACTICA": "400.00"}
        from sqlalchemy import select as _select
        existentes = set(db.execute(_select(AdditionalService.code)).scalars().all())
        for code, name, price, unit in servicios:
            # La migración de tarifas 2026 ya da de alta la zona de práctica:
            # no se vuelve a insertar.
            if code in existentes:
                continue
            fin = FIN_DE_SEMANA.get(code)
            db.add(
                AdditionalService(
                    code=code, name=name, price=Decimal(price), currency="MXN", unit=unit,
                    weekend_price=Decimal(fin) if fin else None,
                )
            )
        print(f"✓ {len(servicios)} servicios adicionales")

        # --------------------------------------------------------- descuentos
        # PGA NO va aquí: es acreditación del jugador, no código de reserva.
        db.flush()
        descuentos = [
            ("CONVENIO_EMPRESA", "Convenio corporativo", DiscountType.PORCENTAJE, "10.00", None, None),
            ("HOTELVIP", "Huéspedes en suite", DiscountType.PORCENTAJE, "15.00", None, None),
            ("CORPORATIVO2026", "Grupos mayores a 3 jugadores", DiscountType.PORCENTAJE, "20.00", None, 3),
        ]
        for code, description, dtype, value, hotel_code, min_players in descuentos:
            db.add(
                DiscountCode(
                    code=code, description=description, discount_type=dtype,
                    value=Decimal(value), valid_from=date(HOY.year, 1, 1),
                    valid_to=date(HOY.year + 1, 12, 31),
                    hotel_id=hoteles[hotel_code].id if hotel_code else None,
                    min_players=min_players,
                )
            )
        print(f"✓ {len(descuentos)} convenios comerciales")

        # ---------------------------------------------------------------- PGA
        # Monto fijo por jugador con credencial, no porcentaje: el club decidió
        # que el beneficio valga lo mismo cualquier día, y un 75% pagaba muy
        # distinto entre semana que en fin de semana. Se puede cambiar a
        # porcentaje desde Control del sistema sin tocar esto.
        db.add(
            PGABenefitConfig(
                discount_type=DiscountType.MONTO,
                value=Decimal("1000.00"),
                description="Beneficio PGA: $1,000 por jugador con credencial",
                valid_from=date(HOY.year, 1, 1),
            )
        )
        credenciales = [
            ("PGA-7841", "45872", "Alejandro Larrazábal", "PGA México / FMG"),
            ("PGA-9022", "39410", "Santiago Luna", "PGA Tour LA"),
            ("PGA-5510", "51203", "Gonzalo Fernández-Castaño", "PGA Tour / Master"),
            ("PGA-00123", "45872", "Juan Pérez", "PGA México"),
            ("PGA-00119", "39410", "Carlos Mendoza", "PGA México"),
        ]
        for pga_code, credential, name, accreditation in credenciales:
            db.add(
                PGACredential(
                    pga_code=pga_code, credential_number=credential,
                    professional_name=name, accreditation=accreditation,
                    valid_until=date(HOY.year + 1, 12, 31),
                )
            )
        print(f"✓ Beneficio PGA configurado ($1,000 por credencial) y {len(credenciales)} credenciales")

        # ----------------------------------------------------------- horarios
        # Un solo campo. El recorrido (9 o 18 hoyos) lo elige cada reserva; no
        # son salidas distintas.
        db.add(
            CourseScheduleConfig(
                tee="CAMPO", label="Horarios de salida",
                start_time=time(7, 0), end_time=time(15, 0),
                interval_minutes=30, slot_capacity=4, holes=18,
            )
        )
        print("✓ Horarios de salida: 07:00–15:00 cada 30 min (17 salidas)")

        # ----------------------------------------------------- tipo de cambio
        db.add(
            ExchangeRate(
                from_currency="USD", to_currency="MXN",
                rate=Decimal("17.2000"), effective_from=datetime.utcnow(),
            )
        )
        print("✓ Tipo de cambio operativo: 1 USD = 17.20 MXN")

        # -------------------------------------------------------- parámetros
        parametros = [
            ("cash_cutoff_hour", "22", "Hora a partir de la cual la caja no admite cobros"),
            ("same_day_cutoff", "15:00", "Hora límite para reservar el mismo día (HH:MM)"),
            ("course_name", "Las Parotas Club de Golf", "Nombre del campo"),
            ("course_par", "72", "Par del campo"),
            ("max_handicap_men", "26.4", "Hándicap máximo caballeros"),
            ("max_handicap_women", "34.0", "Hándicap máximo damas"),
            ("carritos_totales", "20", "Carritos de golf del club"),
            ("personas_por_carrito", "2", "Personas que caben en cada carrito"),
            ("caddies_totales", "2", "Caddies disponibles en el campo"),
            ("cierre_de_campo", "18:00", "Hora en que el campo cierra y ya no hay juego"),
            ("twilight_desde", "14:00", "Desde esta hora la salida toma tarifa twilight"),
        ]
        # Algunos parámetros los inserta una migración (los que el club
        # necesitó después del primer despliegue), así que aquí se salta lo que
        # ya exista en vez de chocar contra el UNIQUE de la clave.
        ya_estan = {
            fila[0] for fila in db.execute(select(SystemSetting.key)).all()
        }
        nuevos = 0
        for key, value, description in parametros:
            if key in ya_estan:
                continue
            db.add(SystemSetting(key=key, value=value, description=description))
            nuevos += 1
        print(f"✓ {nuevos} parámetros del sistema")

        # --------------------------------------------------------- inventario
        # La lista del Pro-Shop tal como la pasó el club (data/inventario_inicial.tsv).
        # Entra con existencia en cero: todavía no hay conteo físico. Lo que
        # sí trae es el costo, así que el valor del inventario empieza a
        # cuadrar en cuanto se registren las primeras entradas.
        from pathlib import Path
        from app.modules.inventory.importar import leer
        from app.modules.inventory.models import InventoryItem

        productos = leer(Path(__file__).parent / "data" / "inventario_inicial.tsv")
        for pr in productos:
            db.add(
                InventoryItem(
                    code=pr.codigo, has_barcode=pr.tiene_codigo,
                    description=pr.descripcion, category=pr.categoria,
                    brand=pr.marca, size=pr.talla,
                    purchase_price=pr.precio_compra, stock=0, min_stock=0,
                )
            )
        sin_codigo = sum(1 for pr in productos if not pr.tiene_codigo)
        print(f"✓ {len(productos)} productos del Pro-Shop ({sin_codigo} sin código de barras)")

        # ----------------------------------------------------------- usuarios
        db.flush()
        if produccion:
            # Una sola cuenta, con la contraseña que puso quien despliega. El
            # resto se da de alta desde Control del sistema.
            correo = os.getenv("SEED_ADMIN_EMAIL", "admin@parotasgolf.com")
            clave = os.getenv("SEED_ADMIN_PASSWORD")
            if not clave or len(clave) < 10:
                raise SystemExit(
                    "Falta SEED_ADMIN_PASSWORD (mínimo 10 caracteres) para sembrar en producción."
                )
            usuarios = [(correo, "Administrador General", UserRole.SUPER_ADMIN, None)]
        else:
            usuarios = [
                ("admin@lasparotas.mx", "Administrador General", UserRole.SUPER_ADMIN, None),
                ("operaciones@lasparotas.mx", "Dirección de Operaciones", UserRole.ADMIN_OPERACIONES, None),
                ("recepcion@lasparotas.mx", "Recepción Casa Club", UserRole.RECEPCION, None),
                # Uno con comisión y otro sin ella, para probar los dos casos.
                ("concierge@celeste.mx", "Concierge Celeste", UserRole.HOTEL, hoteles["CELESTE"].id),
                ("concierge@barcelo.mx", "Concierge Barceló", UserRole.HOTEL, hoteles["BARCELO"].id),
            ]
            clave = "Reserva2026*"

        for email, name, role, hotel_id in usuarios:
            db.add(
                User(
                    email=email, full_name=name,
                    hashed_password=hash_password(clave),
                    role=role, hotel_id=hotel_id,
                )
            )
        print(f"✓ {len(usuarios)} cuenta(s) de acceso")

        # La cuenta a cuyo nombre quedan las reservas del sitio. No es de una
        # persona: existe para que una reserva hecha por internet tenga autor
        # en la bitácora, y para que caiga en público general con cero
        # comisión, igual que las que levanta recepción.
        #
        # Va desactivada y con una contraseña que nadie conoce ni necesita: el
        # login la rechaza por inactiva, así que no es una puerta de entrada.
        from app.modules.pagos.service import CUENTA_DEL_SITIO

        db.add(
            User(
                email=CUENTA_DEL_SITIO,
                full_name="Reservas en línea",
                hashed_password=hash_password(secrets.token_urlsafe(32)),
                role=UserRole.RECEPCION,
                is_active=False,
            )
        )
        print("✓ Cuenta de reservas en línea (sin acceso)")

        db.commit()

        print("\n" + "=" * 62)
        print("  Base de datos lista")
        print("=" * 62)
        for email, name, role, _ in usuarios:
            print(f"  {email:<34} {role}")
        print("=" * 62)
        if produccion:
            print("  La contraseña es la que se puso en SEED_ADMIN_PASSWORD")
        else:
            print("  Contraseña para todos: Reserva2026*")
        print("=" * 62)

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    produccion = "--produccion" in sys.argv
    # En producción el esquema lo crean las migraciones, no create_all: así
    # la base queda con la misma historia que el repositorio.
    if not produccion:
        crear_tablas()
    sembrar(produccion=produccion)
