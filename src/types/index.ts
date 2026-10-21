// ── Tipos de dominio ──
// Estos tipos son el "contrato" entre la UI y los datos. Hoy los llena
// src/data/mockData.ts en memoria; el día que se conecte una base real,
// solo hay que reemplazar la capa src/data/*, sin tocar los componentes.

export type EstadoCliente = 'activo' | 'inactivo';

export interface Cliente {
  id: string;
  codigo: string; // ej. "D0387" (código corto interno)
  numero: string; // ej. "101650" (número de cliente tipo QuickBooks)
  nombre: string;
  email?: string;
  tipo?: string; // ej. "Conductor propio", "Conductor con auto de la empresa"
  licenciaInfo: string; // texto libre: "LIC GA 08/19/2029", "LIC GA 07/30/2025 (VENCIDA)..."
  telefonos: string; // uno o varios, ej. "4705959089 / 4482320660"
  direccion?: string; // ej. "233 Ardsley Place Apto 233, Norcross GA 30093"
  notas?: string;
  nombreQb?: string; // nombre completo exacto en QuickBooks (clave para la migración)
  cuotaSemanal: number;
  fechaAlta: string; // ISO date
  estado: EstadoCliente;
}

export type EstadoFactura = 'pendiente' | 'vencida' | 'pagada' | 'parcial' | 'exenta';

export interface Factura {
  id: string;
  numero: number; // número de factura, ej. 39812
  clienteId: string;
  semana: number; // número de semana ISO, para agrupar la corrida semanal
  fecha: string; // ISO date de emisión
  fechaVencimiento: string; // ISO date
  concepto: string; // ej. "1090PB Semana 37", "Penaltie Fee", "Ajuste manual"
  monto: number;
  montoPagado: number;
  estado: EstadoFactura;
  codigo?: string; // código del catálogo de fees usado (1060NL, 1090PB, etc.), si vino de ahí
  creadoPor?: string; // nombre del usuario que la creó
  beneficiarioId?: string; // 1060DR: unidad que recibirá el saldo a favor (1060SAF) cuando se pague
  recuperoNcId?: string; // nota de crédito 1060SAF ya generada a partir de esta factura
}

export interface ItemCatalogoFee {
  id: string;
  codigo: string;
  etiqueta: string;
  monto: number;
  orden: number;
  /** true: se vuelve a facturar cada semana mientras esté tildado; false: multa, se cobra una sola vez. */
  seArrastra: boolean;
  /** true: se muestra en la ficha del cliente para tildarlo. */
  visibleEnFicha: boolean;
}

export type MetodoPago = 'zelle' | 'efectivo' | 'kotapay' | 'ach' | 'tarjeta' | 'stripe';

export interface AplicacionPago {
  facturaId: string;
  monto: number;
}

export interface Pago {
  id: string;
  numero: number;
  clienteId: string;
  fecha: string; // ISO date
  monto: number;
  metodo: MetodoPago;
  referencia?: string;
  cuentaId?: string; // a qué cuenta entró el dinero
  aplicaciones: AplicacionPago[]; // a qué factura(s) se aplicó, y cuánto a cada una
  editado?: boolean; // true si un administrador lo corrigió después de creado
}

export interface NotaCredito {
  id: string;
  numero: number;
  clienteId: string;
  fecha: string; // ISO date
  monto: number;
  montoAplicado: number; // cuánto de la nota ya se usó contra facturas
  motivo: string;
  aplicada: boolean;
  facturasAplicadas: string[]; // ids de Factura a las que se aplicó
  origenFacturaId?: string; // si nació de una factura 1060DR pagada
  origenFacturaNumero?: number;
  origenClienteId?: string; // unidad que recuperó el dinero
}

export interface Reembolso {
  id: string;
  numero: number;
  clienteId: string;
  fecha: string; // ISO date
  monto: number;
  metodo: MetodoPago;
  cuentaId?: string;
  motivo: string;
  pagoId?: string; // pago sobre el que se devolvió dinero
  pagoNumero?: number;
  facturas?: { id: string; numero: number }[]; // facturas que cubría ese pago
}

export type CategoriaGasto =
  | 'mantenimiento'
  | 'seguro'
  | 'combustible'
  | 'neumaticos'
  | 'oficina'
  | 'software'
  | 'nomina'
  | 'publicidad'
  | 'servicios'
  | 'otro';

export interface Gasto {
  id: string;
  fecha: string; // ISO date
  proveedor: string;
  categoria: CategoriaGasto;
  cuentaId?: string;
  metodo?: MetodoPago;
  referencia?: string;
  nota?: string;
  monto: number;
}

export interface ConfiguracionRecordatorios {
  activo: boolean;
  // Evita contactar a "fantasmas" del historial: solo se le manda
  // recordatorio a quien facturó en las últimas N semanas.
  semanasActividadReciente: number;
  soloConSaldoVencido: boolean;
  // Variables disponibles en la plantilla: {nombre}, {monto}, {dias}
  plantillaMensaje: string;
  ringcentral: {
    clientId?: string;
    clientSecret?: string;
    numeroDesde?: string;
  };
}

export interface DatosEmpresa {
  nombre?: string;
  direccion?: string;
  email?: string;
}

export interface ConfiguracionMail {
  envioAutomatico: boolean; // manda la factura por mail apenas queda paga
  metodo: 'graph' | 'smtp';
  buzonEnvio: string; // buzón real desde el que se envía por Microsoft Graph
  remitenteNombre: string;
  remitenteDireccion: string;
  responderA: string;
  asunto: string; // variables: {nombre} {numero} {concepto} {monto} {empresa}
  mensaje: string;
  smtp: { host: string; puerto: number; usuario: string; clave: string };
}

export interface ConfiguracionCobro {
  cuotaSemanalPorDefecto: number;
  diaEmision: 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom';
  metodosHabilitados: MetodoPago[];
  precioPorDia: {
    lunes?: number;
    martes?: number;
    miercoles?: number;
    jueves?: number;
    viernes?: number;
  };
  recordatorios: ConfiguracionRecordatorios;
  mail: ConfiguracionMail;
  empresa: DatosEmpresa;
}

// Resumen de antigüedad de deuda por cliente (usado en Dashboard y Reportes)
export interface FilaAntiguedad {
  clienteId: string;
  nombre: string;
  alDia: number;
  d1a7: number;
  d8a14: number;
  d15a30: number;
  masDe30: number;
  total: number;
}

// ── Cuentas / movimientos de caja ──
export type TipoCuenta = 'efectivo' | 'banco' | 'zelle' | 'stripe' | 'otro';

export interface Cuenta {
  id: string;
  nombre: string; // ej. "Chase", "Bank of America", "Petty Cash", "Zelle"
  tipo: TipoCuenta;
  saldoInicial: number;
}

export interface Transferencia {
  id: string;
  fecha: string; // ISO date
  cuentaOrigenId: string;
  cuentaDestinoId: string;
  monto: number;
  nota?: string;
}

// ── Proveedores / cuentas por pagar ──
export type EstadoProveedor = 'activo' | 'inactivo';

export interface Proveedor {
  id: string;
  nombre: string;
  empresa?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  condicionesPago?: string; // ej. "Net 30", "Al contado"
  notas?: string;
  estado: EstadoProveedor;
}

export type EstadoBill = 'abierta' | 'parcial' | 'pagada' | 'vencida' | 'anulada';

export interface Bill {
  id: string;
  numero: number;
  proveedorId: string;
  fecha: string;
  fechaVencimiento: string;
  concepto: string;
  categoria: CategoriaGasto;
  monto: number;
  montoPagado: number;
  estado: EstadoBill;
}

export interface BillPago {
  id: string;
  numero: number;
  proveedorId: string;
  fecha: string;
  monto: number;
  metodo: MetodoPago;
  cuentaId?: string;
  billsAplicados: string[];
}

export interface DocumentoCliente {
  id: string;
  clienteId: string;
  nombre: string;
  tipo: string; // mime type
  tamano: number; // bytes
  fecha: string; // ISO date
  dataUrl: string; // el archivo codificado en base64
}

// ── Usuarios y roles ──
// IMPORTANTE: esto NO es seguridad real. Como la app corre entera en el
// navegador (sin backend), cualquiera con las herramientas de desarrollador
// podría saltarse este control. Sirve para dos cosas honestas: (1) que la
// Auditoría registre quién hizo qué de verdad, en vez de un nombre fijo, y
// (2) evitar errores por descuido (que un operador borre una cuenta sin
// querer). El día que haya backend, esto se reemplaza por autenticación de
// verdad del lado del servidor.
export type RolUsuario = 'admin' | 'supervisor' | 'operador';

export const ROL_ETIQUETA: Record<RolUsuario, string> = { admin: 'Administrador', supervisor: 'Supervisor', operador: 'Operador' };
export const ROL_DESCRIPCION: Record<RolUsuario, string> = {
  admin: 'Control total. Aprueba solicitudes y cierra períodos.',
  supervisor: 'Ve todo, incluidos los informes. No borra facturas.',
  operador: 'Crea facturas, recibe pagos y ve clientes. Los cambios sensibles pasan por autorización.',
};

export interface SolicitudCambio {
  id: string;
  tipo: string;
  entidad: string;
  entidadId: string;
  resumen: string;
  detalle: { campo: string; anterior: string; nuevo: string }[];
  motivo?: string;
  solicitanteId: string;
  solicitante: string;
  creada: string;
  estado: 'pendiente' | 'aprobada' | 'rechazada' | 'fallida';
  resueltaPor?: string;
  resuelta?: string;
  nota?: string;
}

export interface Usuario {
  id: string;
  nombre: string;
  email?: string;
  rol: RolUsuario;
  pin: string; // 4 dígitos
  activo: boolean;
}

// ── Auditoría ──
export interface CambioAuditoria {
  campo: string;
  anterior: string;
  nuevo: string;
}

export interface RegistroAuditoria {
  id: string;
  fecha: string; // ISO datetime
  usuario: string;
  accion: string; // ej. "Creó factura", "Registró pago", "Aplicó nota de crédito"
  entidad: string; // ej. "Factura", "Pago", "Cliente", "Cuenta"
  entidadId: string;
  resumen: string;
  cambios?: CambioAuditoria[];
}

export interface PagoEmail {
  id: string;
  fecha: string; // ISO date
  hora?: string; // HH:MM, hora de Atlanta
  remitente: string;
  descripcion?: string;
  origen?: 'zelle' | 'kotapay';
  resultado?: 'aprobado' | 'rechazado' | 'solicitud'; // rechazado = tarjeta declinada; solicitud = la unidad pidió dinero en vez de enviarlo. En ambos el dinero NO entró
  motivoRechazo?: string;
  monto: number;
  estado: 'pendiente' | 'aplicado' | 'descartado';
  clienteId?: string;
  pagoId?: string;
  pagoNumero?: number;
  aplicadoAFacturas?: number;
  facturasCubiertas?: number;
  comoCredito?: number;
}
