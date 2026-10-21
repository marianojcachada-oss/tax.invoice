import { db } from '../db.js';
import { PLAN_BASE } from './planBase.js';

// Valores de arranque. Todo se puede cambiar desde Contabilidad -> Ajustes
// (se guarda como JSON en configuracion.contab_config).
export const CONFIG_DEFECTO = {
  empresa: 'TAXI LASER LLC',
  corte: '2026-10-20', // fecha del Balance Sheet / P&L del sistema anterior cargados como saldos de arranque
  zelle: '10201', // Bank of America 9859*: en el historial del sistema anterior los pagos por Zelle de 2025-2026 entran ahí
  kotapay: '14500', // Undeposited Funds: en el historial, los pagos con tarjeta/Kotapay entran ahí (14510 no tiene movimientos)
  efectivo: '14500', // el efectivo también entra a Undeposited Funds; la administración lo deposita en el banco a mano
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

// Cuenta de ingreso de cada código de fee, según el estudio contable. Si el fee tiene una cuenta elegida a mano
// en "A qué cuenta contable va cada cosa", esa manda. 1090DR (deuda recuperada) NO es ingreso: no pasa por acá.
const INGRESO_POR_CODIGO = {
  '1090PB': '40000', // cuota semanal -> Taxis Income
  '1090RA': '40001', // reactivación -> Subscription Income
  '1090RI': '40001', // reinscripción -> Subscription Income
  '1090ACT': '40003', // asistencia -> Assistance Income
  '1090ADA': '40003',
  '1090RC': '42000', // reclamos -> Claims
};
export function cuentaIngresoDeFee(codigo, cuentaElegida, cfg = CONFIG_DEFECTO) {
  if (cuentaElegida) return cuentaElegida;
  if (!codigo) return cfg.ingresoDefault;
  if (INGRESO_POR_CODIGO[codigo]) return INGRESO_POR_CODIGO[codigo];
  if (String(codigo).startsWith('1090')) return '40002'; // multas y penalidades -> Fines Income
  return '41001'; // cualquier otro ingreso (venta de productos) -> Other Sales
}

/** Ajustes al plan de cuentas que indicó el estudio contable. Se aplican siempre (son idempotentes). */
async function ajustarPlan(conn) {
  await conn.prepare(`UPDATE plan_cuentas SET tipo = 'Other Current Liabilities', detalle = 'Other Current Liabilities' WHERE numero = '24500' AND tipo = 'Long Term Liabilities'`).run();
  await conn.prepare(`UPDATE plan_cuentas SET detalle = 'Checking' WHERE numero = '10300' AND detalle = 'Cash on hand'`).run();
  await conn.prepare(`UPDATE plan_cuentas SET detalle = 'Cost of Labor' WHERE numero = '60400' AND detalle = 'Advertising/Promotional'`).run();
  // Cuentas que nunca se usaron: se sacan del plan (solo si no tienen ningún saldo ni asiento).
  for (const n of ['12700', '50020']) {
    const usada = await conn
      .prepare(`SELECT (SELECT COUNT(*) FROM saldos_iniciales WHERE cuenta = ? AND monto <> 0) + (SELECT COUNT(*) FROM asiento_lineas WHERE cuenta = ?) AS n`)
      .get(n, n);
    if (Number(usada.n) === 0) await conn.prepare('DELETE FROM plan_cuentas WHERE numero = ?').run(n);
  }
}

/** Carga el plan de cuentas base la primera vez (no pisa lo que ya exista) y aplica los ajustes del estudio contable. */
export async function asegurarPlan(conn = db) {
  const { n } = await conn.prepare('SELECT COUNT(*)::int AS n FROM plan_cuentas').get();
  if (n > 0) {
    // Los ajustes del estudio contable se aplican UNA sola vez (después se puede cambiar el plan a mano).
    const cfg = await leerConfig(conn);
    if (!cfg.planAjustado) { await ajustarPlan(conn); await guardarConfig({ planAjustado: true }, conn); }
    return;
  }
  for (const [numero, nombre, tipo, detalle, padre] of PLAN_BASE) {
    await conn
      .prepare('INSERT INTO plan_cuentas (numero, nombre, tipo, detalle, padre, mostrar_en_cero, cero_con_signo) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (numero) DO NOTHING')
      .run(numero, nombre, tipo, detalle, padre, MOSTRAR_EN_CERO.includes(numero), CERO_CON_SIGNO.includes(numero));
  }
  await guardarConfig({ planAjustado: true }, conn);
}
