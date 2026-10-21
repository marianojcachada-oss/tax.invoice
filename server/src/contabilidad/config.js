import { db } from '../db.js';
import { PLAN_BASE } from './planBase.js';

// Valores de arranque. Todo se puede cambiar desde Contabilidad -> Ajustes
// (se guarda como JSON en configuracion.contab_config).
export const CONFIG_DEFECTO = {
  empresa: 'TAXI LASER LLC',
  corte: '2026-10-20', // fecha del Balance Sheet / P&L del sistema anterior cargados como saldos de arranque
  zelle: '10201', // Bank of America 9859*: en el historial del sistema anterior los pagos por Zelle de 2025-2026 entran ahí
  kotapay: '14500', // Undeposited Funds: en el historial, los pagos con tarjeta/Kotapay entran ahí (14510 no tiene movimientos)
  efectivo: '10000', // Cash on Hand
  banco: '10200', // cuenta por defecto cuando un gasto/pago no indica de dónde salió
  ar: '11000',
  ap: '20000',
  ingresoDefault: '40000', // Taxis Income
  notaCredito: '40005', // Discounts
  reembolso: '41000', // Refunds
  billDefault: '80000', // Ask My Accountant
  gastoPorCategoria: {
    mantenimiento: '67200',
    seguro: '63300',
    combustible: '61100',
    neumaticos: '61100',
    oficina: '64900',
    software: '61700',
    nomina: '60100',
    publicidad: '61000',
    servicios: '68600',
    otro: '80000',
  },
  retained: '32000',
};

// Cuentas que el Balance Sheet de QuickBooks muestra aunque estén en 0.
const MOSTRAR_EN_CERO = ['10000', '10300', '13200', '14300', '21000', '23200', '24500'];
// De esas, las que QuickBooks muestra como "$0.00" (cuentas sin movimientos).
const CERO_CON_SIGNO = ['13200', '14300', '21000', '23200', '24500'];

export async function leerConfig(conn = db) {
  const fila = await conn.prepare('SELECT contab_config FROM configuracion WHERE id = 1').get();
  let guardada = {};
  try { guardada = fila?.contab_config ? JSON.parse(fila.contab_config) : {}; } catch { guardada = {}; }
  return {
    ...CONFIG_DEFECTO,
    ...guardada,
    gastoPorCategoria: { ...CONFIG_DEFECTO.gastoPorCategoria, ...(guardada.gastoPorCategoria ?? {}) },
  };
}

export async function guardarConfig(parcial, conn = db) {
  const actual = await leerConfig(conn);
  const nueva = { ...actual, ...parcial, gastoPorCategoria: { ...actual.gastoPorCategoria, ...(parcial.gastoPorCategoria ?? {}) } };
  await conn.prepare('UPDATE configuracion SET contab_config = ? WHERE id = 1').run(JSON.stringify(nueva));
  return nueva;
}

/** Carga el plan de cuentas base la primera vez (no pisa lo que ya exista). */
export async function asegurarPlan(conn = db) {
  const { n } = await conn.prepare('SELECT COUNT(*)::int AS n FROM plan_cuentas').get();
  if (n > 0) return;
  for (const [numero, nombre, tipo, detalle, padre] of PLAN_BASE) {
    await conn
      .prepare('INSERT INTO plan_cuentas (numero, nombre, tipo, detalle, padre, mostrar_en_cero, cero_con_signo) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (numero) DO NOTHING')
      .run(numero, nombre, tipo, detalle, padre, MOSTRAR_EN_CERO.includes(numero), CERO_CON_SIGNO.includes(numero));
  }
}
