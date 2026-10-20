import { db } from '../db.js';
import { saldosBalance, saldosResultados } from './libro.js';
import { leerConfig } from './config.js';
import { esResultados, hoyAtlanta, sumarDias } from './tipos.js';

// ─── Fechas con el formato de QuickBooks ────────────────────────────
const MESES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const partes = (iso) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) - 1, d: Number(iso.slice(8, 10)) });
const largo = (iso) => { const p = partes(iso); return `${MESES[p.m]} ${p.d}, ${p.y}`; };
const corto = (iso) => { const p = partes(iso); return `${MESES[p.m].slice(0, 3)} ${p.d}, ${p.y}`; };

/** "January 1-October 20, 2026" (mismo año) o "January 1, 2026-March 3, 2027". */
export function rangoLargo(desde, hasta) {
  const a = partes(desde);
  const b = partes(hasta);
  if (a.y === b.y) return `${MESES[a.m]} ${a.d}-${MESES[b.m]} ${b.d}, ${b.y}`;
  return `${largo(desde)}-${largo(hasta)}`;
}

/** "Tuesday, October 20, 2026 08:09 PM GMT-04:00" en hora de Atlanta. */
export function selloDeTiempo(ahora = new Date()) {
  const zona = 'America/New_York';
  const f = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: zona, ...opts }).format(ahora);
  const offset = (new Intl.DateTimeFormat('en-US', { timeZone: zona, timeZoneName: 'longOffset' }).formatToParts(ahora).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT').replace(/^GMT$/, 'GMT+00:00');
  const hora = f({ hour: '2-digit', minute: '2-digit', hour12: true });
  return `${f({ weekday: 'long' })}, ${f({ month: 'long' })} ${f({ day: 'numeric' })}, ${f({ year: 'numeric' })} ${hora} ${offset}`;
}

// ─── Armado de filas ─────────────────────────────────────────────────
// Una fila: { etiqueta, nivel, negrita, valores:[centavos|null], formulas?:[...], total? }
//  - formulas[col] = { filas:[{fila, signo}], cero? }  (suma de otras filas de la misma columna)
//  - formulas[col] = { columnas:[0..n] }               (suma de columnas de la misma fila)
class Constructor {
  constructor(nCols = 1) {
    this.filas = [];
    this.nCols = nCols;
  }
  push(f) {
    this.filas.push({ nivel: 0, negrita: false, valores: Array(this.nCols).fill(null), ...f });
    return this.filas.length - 1;
  }
  valor(i, col = 0) { return this.filas[i].valores[col] ?? 0; }
  /** Grupo: encabezado, hijos y "Total X". Si no hay hijos visibles no deja nada. */
  grupo(etiqueta, nivel, construirHijos, { total, forzar } = {}) {
    const marca = this.filas.length;
    const h = this.push({ etiqueta, nivel });
    const hijos = construirHijos().filter((x) => x != null);
    if (hijos.length === 0 && !forzar) {
      this.filas.length = marca;
      return null;
    }
    return this.pushTotal(total ?? `Total ${etiqueta}`, nivel, [h, ...hijos]);
  }
  pushTotal(etiqueta, nivel, indices, signos = null) {
    const refs = indices.map((fila, k) => ({ fila, signo: signos?.[k] ?? 1 }));
    const valor = refs.reduce((a, r) => a + r.signo * this.valor(r.fila), 0);
    return this.push({ etiqueta, nivel, negrita: true, total: true, valores: [valor], formulas: [{ filas: refs }] });
  }
}

/** Cuentas "de arriba" (sin madre) de ciertos tipos, con sus hijas, filtradas por visibilidad. */
function cuentasDeTipos(plan, tipos, saldos, { ocultarEnCero }) {
  const visible = (c) => {
    const v = saldos.get(c.numero) ?? 0;
    if (v !== 0) return true;
    if (!ocultarEnCero && c.mostrar_en_cero) return true;
    return plan.some((h) => h.padre === c.numero && visible(h));
  };
  return plan
    .filter((c) => tipos.includes(c.tipo) && !c.padre && c.activa !== false && visible(c))
    .sort((a, b) => Number(a.numero) - Number(b.numero))
    .map((c) => ({ c, visible }));
}

function filasDeCuenta(b, plan, c, nivel, saldos, visible) {
  const etiqueta = `${c.numero} ${c.nombre}`;
  const hijas = plan.filter((h) => h.padre === c.numero && visible(h)).sort((x, y) => Number(x.numero) - Number(y.numero));
  const propio = saldos.get(c.numero) ?? 0;
  if (hijas.length === 0) return b.push({ etiqueta, nivel, valores: [propio], ...(propio === 0 && c.cero_con_signo ? { moneda: [true] } : {}) });
  const h = b.push({ etiqueta, nivel });
  const hijos = [];
  if (propio !== 0) hijos.push(b.push({ etiqueta, nivel: nivel + 1, valores: [propio] }));
  for (const hija of hijas) hijos.push(filasDeCuenta(b, plan, hija, nivel + 1, saldos, visible));
  return b.pushTotal(`Total for ${etiqueta}`, nivel, [h, ...hijos]);
}

function cuentasEn(b, plan, tipos, nivel, saldos, ocultarEnCero) {
  return cuentasDeTipos(plan, tipos, saldos, { ocultarEnCero }).map(({ c, visible }) => filasDeCuenta(b, plan, c, nivel, saldos, visible));
}

function marco(cfg, titulo, rango, columnas, filas, pie) {
  return { empresa: cfg.empresa, titulo, rango, columnas, filas, pie };
}

// ─── Profit and Loss ─────────────────────────────────────────────────
export async function profitAndLoss({ desde, hasta, conn = db }) {
  const { saldos, plan, cfg, avisos } = await saldosResultados(desde, hasta, conn);
  const b = new Constructor(1);
  const seccion = (etiqueta, tipos, forzar = false) => b.grupo(etiqueta, 0, () => cuentasEn(b, plan, tipos, 1, saldos, true), { forzar });

  const ingresos = seccion('Income', ['Income'], true);
  const costo = seccion('Cost of Goods Sold', ['Cost of Goods Sold']);
  // Gross Profit = Income - COGS (aparece siempre, como en QuickBooks)
  const bruto = b.pushTotal('Gross Profit', 0, [ingresos, ...(costo != null ? [costo] : [])], [1, -1]);
  const gastos = seccion('Expenses', ['Expenses']);
  const operativo = b.pushTotal('Net Operating Income', 0, [bruto, ...(gastos != null ? [gastos] : [])], [1, -1]);
  const otrosIng = seccion('Other Income', ['Other Income']);
  const otrosGas = seccion('Other Expenses', ['Other Expense']);
  const netoOtros = b.push({
    etiqueta: 'Net Other Income',
    nivel: 0,
    negrita: true,
    total: true,
    valores: [(otrosIng != null ? b.valor(otrosIng) : 0) - (otrosGas != null ? b.valor(otrosGas) : 0)],
    formulas: [{ cero: otrosIng == null, filas: [...(otrosIng != null ? [{ fila: otrosIng, signo: 1 }] : []), ...(otrosGas != null ? [{ fila: otrosGas, signo: -1 }] : [])] }],
  });
  b.pushTotal('Net Income', 0, [operativo, netoOtros]);

  return {
    modelo: marco(cfg, 'Profit and Loss', rangoLargo(desde, hasta), ['Total'], b.filas, `Accrual Basis ${selloDeTiempo()}`),
    avisos,
    netIncome: b.valor(b.filas.length - 1),
  };
}

// ─── Balance Sheet ───────────────────────────────────────────────────
export async function balanceSheet({ hasta, conn = db }) {
  const { saldos, plan, cfg, netIncome, avisos } = await saldosBalance(hasta, conn);
  const b = new Constructor(1);
  const sub = (etiqueta, tipos, nivel, nivelCtas) => b.grupo(etiqueta, nivel, () => cuentasEn(b, plan, tipos, nivelCtas, saldos, false));

  const activos = b.grupo('Assets', 0, () => [
    b.grupo('Current Assets', 1, () => [
      sub('Bank Accounts', ['Bank'], 2, 3),
      sub('Accounts Receivable', ['Accounts receivable (A/R)'], 2, 3),
      sub('Other Current Assets', ['Other Current Assets'], 2, 3),
    ]),
    sub('Fixed Assets', ['Fixed Assets'], 1, 2),
    sub('Other Assets', ['Other Assets'], 1, 2),
  ]);

  let totalPyP = 0;
  const pyp = b.grupo('Liabilities and Equity', 0, () => [
    b.grupo('Liabilities', 1, () => [
      b.grupo('Current Liabilities', 2, () => [
        sub('Accounts Payable', ['Accounts payable (A/P)'], 3, 4),
        sub('Credit Cards', ['Credit Card'], 3, 4),
        sub('Other Current Liabilities', ['Other Current Liabilities'], 3, 4),
      ]),
      sub('Long-term Liabilities', ['Long Term Liabilities'], 2, 3),
    ]),
    b.grupo('Equity', 1, () => {
      const filas = cuentasEn(b, plan, ['Equity'], 2, saldos, false);
      filas.push(b.push({ etiqueta: 'Net Income', nivel: 2, valores: [netIncome] }));
      return filas;
    }),
  ], { forzar: true });
  totalPyP = b.valor(pyp);

  const totalActivos = activos != null ? b.valor(activos) : 0;
  return {
    modelo: marco(cfg, 'Balance Sheet', `As of ${corto(hasta)}`, ['Total'], b.filas, `Accrual Basis ${selloDeTiempo()}`),
    avisos,
    totalActivos,
    totalPasivoYPatrimonio: totalPyP,
    cuadra: totalActivos === totalPyP,
    netIncome,
  };
}

// ─── A/R Aging Summary ───────────────────────────────────────────────
export const COLUMNAS_AGING = ['CURRENT', '1 - 30', '31 - 60', '61 - 90', '91 AND OVER', 'Total'];

function diasEntre(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
const casillero = (diasVencido) => (diasVencido <= 0 ? 0 : diasVencido <= 30 ? 1 : diasVencido <= 60 ? 2 : diasVencido <= 90 ? 3 : 4);

/**
 * Antigüedad de saldos al día `al`. Cada factura abierta cae en una columna
 * según los días de vencida; el saldo a favor (nota de crédito sin aplicar)
 * resta en la columna que corresponde a su fecha.
 * Si `al` es hoy (o futuro) se usa el saldo actual; para fechas pasadas se
 * restan solo los pagos hasta esa fecha.
 */
export async function arAgingSummary({ al, conn = db }) {
  const cfg = await leerConfig(conn);
  const hoy = hoyAtlanta();
  const pasado = al < hoy;

  const facturas = await conn
    .prepare(
      `SELECT f.id, f.cliente_id, f.fecha, f.fecha_vencimiento, f.monto, f.monto_pagado,
              COALESCE((SELECT SUM(pa.monto) FROM pago_aplicaciones pa JOIN pagos p ON p.id = pa.pago_id WHERE pa.factura_id = f.id AND substr(p.fecha,1,10) <= ?), 0)::bigint AS pagado_hasta,
              COALESCE((SELECT SUM(pa.monto) FROM pago_aplicaciones pa WHERE pa.factura_id = f.id), 0)::bigint AS pagado_por_pagos
       FROM facturas f WHERE f.estado <> 'anulada' AND substr(f.fecha,1,10) <= ?`
    )
    .all(al, al);
  const ncs = await conn
    .prepare(`SELECT cliente_id, fecha, monto, monto_aplicado FROM notas_credito WHERE substr(fecha,1,10) <= ?`)
    .all(al);
  const clientes = await conn.prepare('SELECT id, codigo, numero, nombre FROM clientes').all();
  const nombre = new Map(clientes.map((c) => [c.id, [c.codigo, c.numero, c.nombre].filter(Boolean).join(' ')]));

  const porCliente = new Map();
  const tocar = (id) => {
    if (!porCliente.has(id)) porCliente.set(id, Array(5).fill(0));
    return porCliente.get(id);
  };
  for (const f of facturas) {
    const creditos = Math.max(0, Number(f.monto_pagado) - Number(f.pagado_por_pagos)); // aplicado con notas de crédito
    const pagado = pasado ? Number(f.pagado_hasta) + creditos : Number(f.monto_pagado);
    const saldo = f.monto - pagado;
    if (saldo === 0) continue;
    tocar(f.cliente_id)[casillero(diasEntre(String(f.fecha_vencimiento).slice(0, 10), al))] += saldo;
  }
  for (const n of ncs) {
    const libre = n.monto - n.monto_aplicado;
    if (libre === 0) continue;
    tocar(n.cliente_id)[casillero(diasEntre(String(n.fecha).slice(0, 10), al))] -= libre;
  }

  const lineas = [...porCliente.entries()]
    .map(([id, v]) => ({ etiqueta: nombre.get(id) ?? id, v }))
    .filter((x) => x.v.some((n) => n !== 0))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'en', { sensitivity: 'base' }));

  const b = new Constructor(6);
  const idx = [];
  for (const l of lineas) {
    const total = l.v.reduce((a, n) => a + n, 0);
    idx.push(
      b.push({
        etiqueta: l.etiqueta,
        valores: [...l.v, total],
        formulas: [null, null, null, null, null, { columnas: [0, 1, 2, 3, 4] }],
      })
    );
  }
  const tot = Array(6).fill(0);
  for (const i of idx) for (let c = 0; c < 6; c++) tot[c] += b.valor(i, c);
  b.push({
    etiqueta: 'TOTAL',
    negrita: true,
    total: true,
    valores: tot,
    formulas: [0, 1, 2, 3, 4].map(() => ({ filas: idx.map((fila) => ({ fila, signo: 1 })) })).concat([{ columnas: [0, 1, 2, 3, 4] }]),
    moneda: [true, false, false, false, false, true], // QuickBooks pone "$" solo en CURRENT y Total
  });

  return {
    modelo: { ...marco(cfg, 'A/R Aging Summary Report', `As of ${corto(al)}`, COLUMNAS_AGING, b.filas, ` ${selloDeTiempo()}`) },
    avisos: pasado ? ['Para fechas pasadas los saldos se reconstruyen con la fecha de cada pago; los créditos se consideran aplicados.'] : [],
    total: tot[5],
  };
}

export { esResultados, sumarDias };
