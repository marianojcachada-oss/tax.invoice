import type {
  Cliente,
  Factura,
  Pago,
  Gasto,
  NotaCredito,
  Reembolso,
  ConfiguracionCobro,
  EstadoCliente,
  Cuenta,
  Transferencia,
  Proveedor,
  Bill,
  BillPago,
  DocumentoCliente,
  Usuario,
} from '../types';

// PRNG determinístico (mismos datos en cada carga, útil para testing)
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

// Nombres de ejemplo genéricos (no corresponden a datos reales)
const NOMBRES = [
  'Andrés Romero', 'Kevin Silva', 'Nathaly Villa', 'Margarita Jovel', 'Carmen Morel',
  'Williams Salazar', 'Liseth Terencio', 'Elvis Viana', 'Juan Payares', 'Pablo Espinosa',
  'Hernán Araya', 'Pablo González', 'Alberto Sierra', 'Yeisson Bedoya', 'Johandry Nieves',
  'Lina Mahmoud', 'Jhonder Soteldo', 'Doris Carrillo', 'Erica Valdez', 'William Segura',
  'Moisés Olaves', 'Rubén Pirela', 'Gregory Vargas', 'Dervin Negrette', 'Antony Vera',
  'Víctor Torrealba', 'Jorge Jiménez', 'Jonathan Gómez', 'Jeferson Duarte', 'Jimmy Escobar',
  'José Reina', 'Gustavo Valera', 'Anny Almanzar', 'Yonairo Rincón', 'Gabriel Gallo',
];
const APELLIDOS_EXTRA = ['Fernández', 'Gómez', 'Herrera', 'Aguilar', 'Molina', 'Vargas', 'Cabrera', 'Delgado'];

function nombreAleatorio(i: number): string {
  if (i < NOMBRES.length) return NOMBRES[i];
  const base = pick(NOMBRES).split(' ')[0];
  return `${base} ${pick(APELLIDOS_EXTRA)}`;
}

function emailDe(nombre: string): string {
  const slug = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('.');
  return `${slug}${Math.floor(rand() * 900)}@gmail.com`;
}

// Plantillas de "licencia" con el mismo estilo que se ve en el sistema real
const LICENCIAS = [
  (m: string) => `LIC GA ${m}`,
  (m: string) => `LIC FL ${m}`,
  (m: string) => `LIC NJ ${m}`,
  (m: string) => `LIC MD${1000000 + Math.floor(rand() * 9999999)} ${m}`,
  (m: string) => `LIC INT ${m}`,
  (m: string) => `LIC NEW MEX ${m}`,
  (m: string) => `LIC GA ${m} (VENCIDA) PLAZO HASTA ${mesAleatorio()}`,
  (_m: string) => `LIC GA MED 1 MES PARA COMP ${mesAleatorio()}`,
];
function mesAleatorio(): string {
  const mm = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
  const dd = String(1 + Math.floor(rand() * 28)).padStart(2, '0');
  const yy = 2025 + Math.floor(rand() * 8);
  return `${mm}/${dd}/${yy}`;
}
function licenciaAleatoria(): string {
  return pick(LICENCIAS)(mesAleatorio());
}

function telefonoAleatorio(): string {
  const gen = () => `${pick(['305', '404', '470', '678', '689', '770', '954'])}${String(1000000 + Math.floor(rand() * 8999999))}`;
  return rand() < 0.35 ? `${gen()} / ${gen()}` : `(${gen().slice(0, 3)}) ${gen().slice(3, 6)}-${gen().slice(6, 10)}`;
}

const CALLES = ['Ardsley Place', 'Peachtree Rd', 'Buford Hwy', 'Roswell Rd', 'Windy Hill Rd', 'Jimmy Carter Blvd'];
const CIUDADES = [
  ['Norcross', 'GA', '30093'],
  ['Doraville', 'GA', '30340'],
  ['Duluth', 'GA', '30096'],
  ['Chamblee', 'GA', '30341'],
  ['Marietta', 'GA', '30060'],
];
function direccionAleatoria(): string {
  const numero = 100 + Math.floor(rand() * 900);
  const calle = pick(CALLES);
  const [ciudad, estado, zip] = pick(CIUDADES);
  const apto = rand() < 0.4 ? ` Apto ${100 + Math.floor(rand() * 300)}` : '';
  return `${numero} ${calle}${apto}, ${ciudad} ${estado} ${zip}`;
}

const TOTAL_CLIENTES = 400;
const CUOTA_BASE = 145;

// ── Cuentas ──
export const cuentas: Cuenta[] = [
  { id: 'cta-cash', nombre: 'Cash', tipo: 'efectivo', saldoInicial: 1200 },
  { id: 'cta-chase', nombre: 'Chase', tipo: 'banco', saldoInicial: 18500 },
  { id: 'cta-boa', nombre: 'Bank of America', tipo: 'banco', saldoInicial: 6200 },
  { id: 'cta-zelle', nombre: 'Zelle', tipo: 'zelle', saldoInicial: 0 },
  { id: 'cta-stripe', nombre: 'Stripe', tipo: 'stripe', saldoInicial: 0 },
  { id: 'cta-petty', nombre: 'Petty Cash', tipo: 'efectivo', saldoInicial: 300 },
];
function cuentaSegunMetodo(metodo: string): string {
  if (metodo === 'zelle') return 'cta-zelle';
  if (metodo === 'efectivo') return rand() < 0.7 ? 'cta-cash' : 'cta-petty';
  if (metodo === 'kotapay' || metodo === 'tarjeta') return 'cta-boa';
  if (metodo === 'stripe') return 'cta-stripe';
  if (metodo === 'ach') return 'cta-chase';
  return 'cta-chase';
}

// ── Clientes ──
export const clientes: Cliente[] = Array.from({ length: TOTAL_CLIENTES }, (_, i) => {
  const yaNoTrabaja = i > 0 && rand() < 0.04;
  const nombre = nombreAleatorio(i);
  return {
    id: `cli-${i + 1}`,
    codigo: `D${String(300 + i).padStart(4, '0')}`,
    numero: String(100000 + Math.floor(rand() * 4000)),
    nombre,
    email: rand() < 0.7 ? emailDe(nombre) : undefined,
    tipo: pick(['Conductor con auto propio', 'Conductor con auto de la empresa']),
    licenciaInfo: licenciaAleatoria(),
    telefonos: telefonoAleatorio(),
    direccion: direccionAleatoria(),
    notas: undefined,
    cuotaSemanal: rand() < 0.1 ? CUOTA_BASE + 15 : CUOTA_BASE,
    fechaAlta: `202${3 + Math.floor(rand() * 2)}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`,
    estado: (yaNoTrabaja ? 'inactivo' : 'activo') as EstadoCliente,
  };
});

// Fuerza los primeros clientes a calzar con ejemplos de mora conocidos, para
// que el dashboard y los reportes muestren siempre casos representativos.
const ejemplosMora: { idx: number; saldo: number; dias: number }[] = [
  { idx: 0, saldo: 580, dias: 28 },
  { idx: 1, saldo: 435, dias: 21 },
  { idx: 2, saldo: 290, dias: 14 },
  { idx: 3, saldo: 290, dias: 12 },
  { idx: 4, saldo: 145, dias: 5 },
];

const SEMANA_ACTUAL = 37;
const HOY = new Date('2026-09-14');
let contadorFactura = 39678;
let contadorPago = 8801;
let contadorNota = 5001;
let contadorReembolso = 6001;
let contadorBill = 3001;
let contadorBillPago = 7001;

function fechaMenosDias(dias: number): string {
  const d = new Date(HOY);
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

// ── Facturas (cada cuota semanal es una factura) ──
export const facturas: Factura[] = [];
clientes.forEach((c, idx) => {
  if (c.estado === 'inactivo' && rand() < 0.6) return;

  const ejemplo = ejemplosMora.find((e) => e.idx === idx);
  const semanasAdeudadas = ejemplo
    ? Math.round(ejemplo.saldo / c.cuotaSemanal)
    : rand() < 0.29
      ? 1 + Math.floor(rand() * 3)
      : 0;

  for (let s = 0; s < Math.max(semanasAdeudadas, 1); s++) {
    const semanaOffset = semanasAdeudadas > 0 ? semanasAdeudadas - s : 1;
    const diasAtras = semanaOffset * 7 - (semanasAdeudadas === 0 ? 7 : 0);
    const vencida = semanaOffset > 0;
    const pagadaDeAntemano = !vencida && rand() < 0.71;
    facturas.push({
      id: `fac-${c.id}-${SEMANA_ACTUAL - semanaOffset}`,
      numero: contadorFactura++,
      clienteId: c.id,
      semana: SEMANA_ACTUAL - semanaOffset,
      fecha: fechaMenosDias(diasAtras + 7),
      fechaVencimiento: fechaMenosDias(diasAtras),
      concepto: `Cuota semana ${SEMANA_ACTUAL - semanaOffset}`,
      monto: c.cuotaSemanal,
      montoPagado: pagadaDeAntemano ? c.cuotaSemanal : 0,
      estado: vencida ? 'vencida' : pagadaDeAntemano ? 'pagada' : 'pendiente',
    });
  }
});

// ── Pagos (derivados de facturas pagadas) ──
export const pagos: Pago[] = facturas
  .filter((f) => f.estado === 'pagada')
  .map((f) => {
    const metodo = pick<Pago['metodo']>(['zelle', 'efectivo', 'kotapay']);
    return {
      id: `pago-${f.id}`,
      numero: contadorPago++,
      clienteId: f.clienteId,
      fecha: f.fechaVencimiento,
      monto: f.montoPagado,
      metodo,
      referencia: rand() < 0.6 ? String(8000 + Math.floor(rand() * 999)) : undefined,
      cuentaId: cuentaSegunMetodo(metodo),
      aplicaciones: [{ facturaId: f.id, monto: f.montoPagado }],
    };
  });

// ── Notas de crédito (ajustes a favor del cliente) ──
export const notasCredito: NotaCredito[] = clientes.slice(5, 13).map((c, i) => ({
  id: `nc-${i + 1}`,
  numero: contadorNota++,
  clienteId: c.id,
  fecha: fechaMenosDias(3 + i * 4),
  monto: [5, 10, 15, 20][i % 4],
  montoAplicado: 0,
  motivo: pick([
    'Ajuste por auto en taller',
    'Cortesía por reclamo',
    'Corrección de cobro duplicado',
    'Descuento acordado',
  ]),
  aplicada: i % 3 === 0,
  facturasAplicadas: [],
}));

// ── Reembolsos ──
export const reembolsos: Reembolso[] = clientes.slice(13, 18).map((c, i) => {
  const metodo = pick<Reembolso['metodo']>(['zelle', 'efectivo', 'kotapay']);
  return {
    id: `re-${i + 1}`,
    numero: contadorReembolso++,
    clienteId: c.id,
    fecha: fechaMenosDias(2 + i * 5),
    monto: [10, 25, 15, 50, 20][i % 5],
    metodo,
    cuentaId: cuentaSegunMetodo(metodo),
    motivo: pick(['Pago duplicado', 'Cliente dado de baja con saldo a favor', 'Error de carga']),
  };
});

// ── Gastos ──
export const gastos: Gasto[] = [
  { id: 'gasto-1', fecha: '2026-09-11', proveedor: 'Taller Ríos', categoria: 'mantenimiento', cuentaId: 'cta-chase', metodo: 'ach', nota: 'TL-118', monto: 420 },
  { id: 'gasto-2', fecha: '2026-09-08', proveedor: 'Seguros Miami', categoria: 'seguro', cuentaId: 'cta-chase', metodo: 'ach', nota: 'flota', monto: 9800 },
  { id: 'gasto-3', fecha: '2026-09-05', proveedor: 'Goodyear', categoria: 'neumaticos', cuentaId: 'cta-boa', metodo: 'tarjeta', nota: 'TL-042', monto: 640 },
  { id: 'gasto-4', fecha: '2026-09-02', proveedor: 'Taller Ríos', categoria: 'mantenimiento', cuentaId: 'cta-chase', metodo: 'ach', nota: 'TL-207', monto: 275 },
  { id: 'gasto-5', fecha: '2026-08-29', proveedor: 'Google Workspace', categoria: 'software', cuentaId: 'cta-boa', metodo: 'tarjeta', nota: 'suscripción mensual', monto: 42 },
  { id: 'gasto-6', fecha: '2026-08-27', proveedor: 'Georgia Power', categoria: 'servicios', cuentaId: 'cta-chase', metodo: 'ach', nota: 'oficina', monto: 210 },
  { id: 'gasto-7', fecha: '2026-08-20', proveedor: 'Office Depot', categoria: 'oficina', cuentaId: 'cta-petty', metodo: 'efectivo', nota: 'insumos', monto: 65 },
];

// ── Transferencias entre cuentas ──
export const transferencias: Transferencia[] = [
  { id: 'tr-1', fecha: '2026-09-08', cuentaOrigenId: 'cta-chase', cuentaDestinoId: 'cta-petty', monto: 500, nota: 'Reposición de caja chica' },
  { id: 'tr-2', fecha: '2026-08-25', cuentaOrigenId: 'cta-boa', cuentaDestinoId: 'cta-chase', monto: 2000, nota: 'Consolidación de fondos' },
];

// ── Proveedores ──
export const proveedores: Proveedor[] = [
  { id: 'prov-1', nombre: 'Taller Ríos', empresa: 'Taller Ríos LLC', telefono: '(404) 555-0142', email: 'contacto@tallerrios.com', direccion: '88 Buford Hwy, Doraville GA 30340', condicionesPago: 'Net 15', estado: 'activo' },
  { id: 'prov-2', nombre: 'Seguros Miami', empresa: 'Seguros Miami Inc.', telefono: '(305) 555-0199', email: 'polizas@segurosmiami.com', direccion: '400 Brickell Ave, Miami FL 33131', condicionesPago: 'Net 30', estado: 'activo' },
  { id: 'prov-3', nombre: 'Goodyear', empresa: 'Goodyear Tire Center', telefono: '(770) 555-0110', email: 'ventas@goodyear-atlanta.com', direccion: '210 Roswell Rd, Marietta GA 30060', condicionesPago: 'Al contado', estado: 'activo' },
  { id: 'prov-4', nombre: 'Google Workspace', empresa: 'Google LLC', telefono: undefined, email: 'billing@google.com', direccion: undefined, condicionesPago: 'Al contado', estado: 'activo' },
  { id: 'prov-5', nombre: 'Georgia Power', empresa: 'Georgia Power Co.', telefono: '(888) 555-0100', email: undefined, direccion: undefined, condicionesPago: 'Net 15', estado: 'activo' },
];

// ── Bills (cuentas por pagar) ──
export const bills: Bill[] = [
  { id: 'bill-1', numero: contadorBill++, proveedorId: 'prov-1', fecha: '2026-09-11', fechaVencimiento: '2026-09-26', concepto: 'Mantenimiento TL-118', categoria: 'mantenimiento', monto: 420, montoPagado: 420, estado: 'pagada' },
  { id: 'bill-2', numero: contadorBill++, proveedorId: 'prov-2', fecha: '2026-08-08', fechaVencimiento: '2026-09-07', concepto: 'Póliza flota — septiembre', categoria: 'seguro', monto: 9800, montoPagado: 9800, estado: 'pagada' },
  { id: 'bill-3', numero: contadorBill++, proveedorId: 'prov-3', fecha: '2026-09-05', fechaVencimiento: '2026-09-05', concepto: 'Neumáticos TL-042', categoria: 'neumaticos', monto: 640, montoPagado: 640, estado: 'pagada' },
  { id: 'bill-4', numero: contadorBill++, proveedorId: 'prov-1', fecha: '2026-09-01', fechaVencimiento: '2026-09-16', concepto: 'Revisión de frenos TL-207', categoria: 'mantenimiento', monto: 310, montoPagado: 0, estado: 'abierta' },
  { id: 'bill-5', numero: contadorBill++, proveedorId: 'prov-5', fecha: '2026-08-20', fechaVencimiento: '2026-09-04', concepto: 'Electricidad — oficina agosto', categoria: 'servicios', monto: 210, montoPagado: 100, estado: 'parcial' },
  { id: 'bill-6', numero: contadorBill++, proveedorId: 'prov-4', fecha: '2026-08-01', fechaVencimiento: '2026-08-15', concepto: 'Suscripción Workspace — agosto', categoria: 'software', monto: 42, montoPagado: 0, estado: 'vencida' },
];

export const billPagos: BillPago[] = bills
  .filter((b) => b.montoPagado > 0)
  .map((b) => ({
    id: `billpago-${b.id}`,
    numero: contadorBillPago++,
    proveedorId: b.proveedorId,
    fecha: b.fecha,
    monto: b.montoPagado,
    metodo: 'ach' as const,
    cuentaId: 'cta-chase',
    billsAplicados: [b.id],
  }));

// ── Configuración ──
export const configuracion: ConfiguracionCobro = {
  cuotaSemanalPorDefecto: CUOTA_BASE,
  diaEmision: 'lun',
  metodosHabilitados: ['zelle', 'efectivo', 'kotapay', 'ach', 'tarjeta'],
  precioPorDia: {},
  recordatorios: {
    activo: true,
    semanasActividadReciente: 4,
    soloConSaldoVencido: true,
    plantillaMensaje: 'Hola {nombre}, tenés un saldo pendiente de {monto} ({dias} días de atraso). Por favor ponete al día cuando puedas. ¡Gracias!',
    ringcentral: {},
  },
  mail: { envioAutomatico: false, metodo: 'graph', buzonEnvio: '', remitenteNombre: '', remitenteDireccion: '', responderA: '', asunto: '', mensaje: '', smtp: { host: '', puerto: 587, usuario: '', clave: '' } },
  empresa: {
    nombre: '',
    direccion: '',
    email: '',
  },
};

export const documentos: DocumentoCliente[] = [];

// ── Usuarios ──
// PINs de ejemplo para probar: admin = 1234, operador = 5678.
export const usuarios: Usuario[] = [
  { id: 'user-luis', nombre: 'Luis', email: 'luis@taxi.com', rol: 'admin', pin: '1234', activo: true },
  { id: 'user-ana', nombre: 'Ana', email: 'ana@taxi.com', rol: 'operador', pin: '5678', activo: true },
];

export const HOY_ISO = HOY.toISOString().slice(0, 10);
export const SEMANA_ACTUAL_EXPORT = SEMANA_ACTUAL;
