// Lectura de nombres y contactos tal como los exporta QuickBooks.

export interface NombreQB {
  codigo: string; // "D0018" (vacío si la persona no tiene código)
  numero: string; // "101001" (número de cliente de QuickBooks, puede faltar)
  nombre: string;
  ex: boolean; // ex-driver: el nombre empieza con "EX"
}

// [EX] [D]código [número] nombre — se probó contra los 3.388 nombres reales del Customer Contact List.
//   "D0018 101001 Ninoska Chirinos"   "EX 455 101666 Gabriel Gonzalez"   "EX104 101552 Francisco Manchado"
//   "D035 ANYURI RANGEL" (sin número)  "D1215 1030 Yender…" (número de 4 dígitos)  "EX D238 101601 Luis…"
const PATRON_NOMBRE = /^(EX)?\s*(D?\s?\d{1,5})\s+(?:(\d{4,7})\s+)?(\S.*)$/i;

// Formas de pago y cuentas del banco que QuickBooks guarda como si fueran clientes.
const PATRON_NO_CLIENTE = /^(cash|cash app|cash reward|counter credit|zelle transfer|merchant services|square|error)$/i;

export const normalizarEspacios = (s: string) => s.replace(/\s+/g, ' ').trim();
export const esNoCliente = (nombreQb: string) => PATRON_NO_CLIENTE.test(normalizarEspacios(nombreQb));

export function parsearNombreQB(crudo: string): NombreQB {
  const s = normalizarEspacios(crudo);
  const m = s.match(PATRON_NOMBRE);
  if (!m) return { codigo: '', numero: '', nombre: s, ex: false };
  const [, ex, cod, numero, nombre] = m;
  const limpio = cod.replace(/\s/g, '');
  const codigo = /^D/i.test(limpio) ? limpio.toUpperCase() : `D${limpio.padStart(4, '0')}`;
  return { codigo, numero: numero ?? '', nombre: nombre.trim(), ex: Boolean(ex) };
}

/** "Phone:4707961789 / 7708203509 " -> "4707961789 / 7708203509" */
export function limpiarTelefonos(crudo: string): string {
  return crudo
    .split('/')
    .map((p) => p.replace(/^\s*(phone|mobile|fax|work|home|other)s?\s*:\s*/i, '').trim())
    .filter(Boolean)
    .join(' / ');
}

export interface ContactoQB {
  nombreQb: string;
  codigo: string;
  numero: string;
  nombre: string;
  telefonos: string;
  email: string;
  direccion: string;
  notas: string;
  estado: 'activo' | 'inactivo';
  motivoEstado?: string;
  esNoCliente: boolean;
}

/** Una fila del "Customer Contact List" (columnas: Customer full name, Phone numbers, Email, Full name, Bill address, Ship address). */
export function mapearContacto(fila: Record<string, unknown>): ContactoQB {
  const txt = (k: string) => String(fila[k] ?? '').trim();
  const nombreQb = txt('Customer full name');
  const p = parsearNombreQB(nombreQb);
  const bill = txt('Bill address');
  const ship = txt('Ship address');
  const facturacion = txt('Full name');
  const notas: string[] = [];
  if (ship && normalizarEspacios(ship) !== normalizarEspacios(bill)) notas.push(`Dirección de envío (QuickBooks): ${ship}`);
  if (facturacion && normalizarEspacios(facturacion) !== normalizarEspacios(nombreQb)) notas.push(`Nombre de facturación (QuickBooks): ${facturacion}`);
  const sinCodigo = !p.codigo;
  return {
    nombreQb,
    codigo: p.codigo,
    numero: p.numero,
    nombre: p.nombre,
    telefonos: limpiarTelefonos(txt('Phone numbers')),
    email: txt('Email'),
    direccion: bill,
    notas: notas.join('\n'),
    estado: p.ex || sinCodigo ? 'inactivo' : 'activo',
    motivoEstado: p.ex ? 'Ex-driver (nombre empieza con "EX")' : sinCodigo ? 'Sin código' : undefined,
    esNoCliente: esNoCliente(nombreQb),
  };
}
