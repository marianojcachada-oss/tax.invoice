import { db } from '../db.js';
import { leerConfig, asegurarPlan } from './config.js';
import { natural, esResultados, sumarDias } from './tipos.js';

export class ErrorContable extends Error {
  constructor(mensaje, estado = 400) {
    super(mensaje);
    this.estado = estado;
  }
}

const dia = (f) => String(f).slice(0, 10);
const enRango = (f, desde, hasta) => dia(f) >= desde && dia(f) <= hasta;

/** Cuenta contable donde entra/sale el dinero según el método de pago. */
function cuentaPorMetodo(cfg, metodo, cuentaContableDeCuenta) {
  if (cuentaContableDeCuenta) return cuentaContableDeCuenta;
  const m = String(metodo ?? '').toLowerCase();
  if (m.includes('zelle')) return cfg.zelle;
  if (m.includes('kota')) return cfg.kotapay;
  if (m.includes('efectivo') || m.includes('cash')) return cfg.efectivo;
  return cfg.banco;
}

/**
 * Movimientos (debe/haber) que generan las operaciones de la app entre dos
 * fechas (inclusive). El plan de cuentas viene de la tabla plan_cuentas.
 */
export async function movimientosApp(desde, hasta, cfg, conn = db) {
  const mov = [];
  const avisos = new Set();
  const plan = new Set((await conn.prepare('SELECT numero FROM plan_cuentas').all()).map((c) => c.numero));
  const add = (fecha, cuenta, debe, haber, origen) => {
    if (!debe && !haber) return;
    let c = cuenta;
    if (!plan.has(c)) {
      avisos.add(`La cuenta ${c} no existe en el plan de cuentas (${origen}); se usó 80000 Ask My Accountant.`);
      c = '80000';
    }
    mov.push({ fecha: dia(fecha), cuenta: c, debe, haber, origen });
  };
  const par = (fecha, cuentaDebe, cuentaHaber, monto, origen) => {
    add(fecha, cuentaDebe, monto, 0, origen);
    add(fecha, cuentaHaber, 0, monto, origen);
  };

  const ctas = new Map((await conn.prepare('SELECT id, cuenta_contable FROM cuentas').all()).map((c) => [c.id, c.cuenta_contable]));

  // Facturas: A/R contra el ingreso que corresponde al código de fee.
  const facturas = await conn
    .prepare(
      `SELECT f.fecha, f.monto, f.codigo,
              (SELECT cf.cuenta_ingreso FROM catalogo_fees cf WHERE cf.codigo = f.codigo AND cf.cuenta_ingreso IS NOT NULL LIMIT 1) AS cuenta_ingreso
       FROM facturas f WHERE f.estado <> 'anulada' AND substr(f.fecha, 1, 10) BETWEEN ? AND ?`
    )
    .all(desde, hasta);
  for (const f of facturas) par(f.fecha, cfg.ar, f.cuenta_ingreso || cfg.ingresoDefault, f.monto, 'factura');

  // Pagos recibidos: banco contra A/R.
  const pagos = await conn.prepare('SELECT numero, fecha, monto, metodo, cuenta_id FROM pagos WHERE substr(fecha, 1, 10) BETWEEN ? AND ?').all(desde, hasta);
  const metodoPorNumero = new Map((await conn.prepare('SELECT numero, metodo, cuenta_id FROM pagos').all()).map((p) => [Number(p.numero), p]));
  for (const p of pagos) par(p.fecha, cuentaPorMetodo(cfg, p.metodo, ctas.get(p.cuenta_id)), cfg.ar, p.monto, 'pago');

  // Notas de crédito: las de "Excedente" son plata que entró de más (banco/A-R);
  // el resto es un descuento o crédito (cuenta de ingresos configurable).
  const ncs = await conn.prepare('SELECT fecha, monto, motivo FROM notas_credito WHERE substr(fecha, 1, 10) BETWEEN ? AND ?').all(desde, hasta);
  for (const n of ncs) {
    if (/^excedente/i.test(n.motivo ?? '')) {
      const num = /pago #(\d+)/i.exec(n.motivo ?? '')?.[1];
      const p = num ? metodoPorNumero.get(Number(num)) : null;
      const metodo = p?.metodo ?? (/kotapay/i.test(n.motivo ?? '') ? 'kotapay' : 'zelle');
      par(n.fecha, cuentaPorMetodo(cfg, metodo, p ? ctas.get(p.cuenta_id) : null), cfg.ar, n.monto, 'excedente');
    } else {
      par(n.fecha, cfg.notaCredito, cfg.ar, n.monto, 'nota de crédito');
    }
  }

  // Reembolsos: salen de una cuenta/método contra Refunds.
  const reem = await conn.prepare('SELECT fecha, monto, metodo, cuenta_id FROM reembolsos WHERE substr(fecha, 1, 10) BETWEEN ? AND ?').all(desde, hasta);
  for (const r of reem) par(r.fecha, cfg.reembolso, cuentaPorMetodo(cfg, r.metodo, ctas.get(r.cuenta_id)), r.monto, 'reembolso');

  // Gastos directos.
  const gastos = await conn.prepare('SELECT fecha, monto, categoria, metodo, cuenta_id, cuenta_contable FROM gastos WHERE substr(fecha, 1, 10) BETWEEN ? AND ?').all(desde, hasta);
  for (const g of gastos) {
    par(g.fecha, g.cuenta_contable || cfg.gastoPorCategoria[g.categoria] || cfg.billDefault, cuentaPorMetodo(cfg, g.metodo, ctas.get(g.cuenta_id)), g.monto, 'gasto');
  }

  // Bills (devengan al emitirse) y su pago.
  const bills = await conn.prepare('SELECT fecha, monto, cuenta_contable FROM bills WHERE substr(fecha, 1, 10) BETWEEN ? AND ?').all(desde, hasta);
  for (const b of bills) par(b.fecha, b.cuenta_contable || cfg.billDefault, cfg.ap, b.monto, 'bill');
  const billPagos = await conn.prepare('SELECT fecha, monto, metodo, cuenta_id FROM bill_pagos WHERE substr(fecha, 1, 10) BETWEEN ? AND ?').all(desde, hasta);
  for (const b of billPagos) par(b.fecha, cfg.ap, cuentaPorMetodo(cfg, b.metodo, ctas.get(b.cuenta_id)), b.monto, 'pago de bill');

  // Transferencias entre cuentas propias.
  const trans = await conn.prepare('SELECT fecha, monto, cuenta_origen_id, cuenta_destino_id FROM transferencias WHERE substr(fecha, 1, 10) BETWEEN ? AND ?').all(desde, hasta);
  for (const t of trans) {
    const o = ctas.get(t.cuenta_origen_id);
    const d = ctas.get(t.cuenta_destino_id);
    if (!o || !d) {
      avisos.add('Hay transferencias entre cuentas sin cuenta contable asignada: no se reflejan en los informes.');
      continue;
    }
    par(t.fecha, d, o, t.monto, 'transferencia');
  }

  // Asientos manuales.
  const lineas = await conn
    .prepare(
      `SELECT a.fecha, l.cuenta, l.debe, l.haber FROM asiento_lineas l JOIN asientos a ON a.id = l.asiento_id
       WHERE substr(a.fecha, 1, 10) BETWEEN ? AND ?`
    )
    .all(desde, hasta);
  for (const l of lineas) add(l.fecha, l.cuenta, l.debe, l.haber, 'asiento manual');

  return { mov, avisos: [...avisos] };
}

async function cargarPlan(conn) {
  await asegurarPlan(conn);
  return conn.prepare('SELECT * FROM plan_cuentas ORDER BY numero').all();
}

/** Suma de movimientos por cuenta, en saldo natural, sin saldos de arranque. */
function actividad(mov, tipos) {
  const m = new Map();
  for (const x of mov) {
    const tipo = tipos.get(x.cuenta);
    m.set(x.cuenta, (m.get(x.cuenta) ?? 0) + natural(tipo, x.debe, x.haber));
  }
  return m;
}

export const resultadoNeto = (saldos, plan) => {
  let ni = 0;
  for (const c of plan) {
    if (!esResultados(c.tipo)) continue;
    const v = saldos.get(c.numero) ?? 0;
    ni += c.tipo === 'Income' || c.tipo === 'Other Income' ? v : -v;
  }
  return ni;
};

/**
 * Saldos de las cuentas de resultados (ingresos y gastos) entre `desde` y
 * `hasta`. El histórico anterior al corte solo existe en bloque (el P&L de
 * QuickBooks del año), por eso el rango tiene que incluir todo ese año.
 */
export async function saldosResultados(desde, hasta, conn = db) {
  const cfg = await leerConfig(conn);
  const plan = await cargarPlan(conn);
  const tipos = new Map(plan.map((c) => [c.numero, c.tipo]));
  const anioCorte = cfg.corte.slice(0, 4);
  const inicioAnioCorte = `${anioCorte}-01-01`;
  if (hasta < cfg.corte) {
    throw new ErrorContable(`Este informe solo se puede emitir a partir de la fecha de corte contable (${cfg.corte}): antes de esa fecha los datos están en el sistema anterior.`);
  }
  const incluyeArranque = desde <= inicioAnioCorte;
  if (!incluyeArranque && desde <= cfg.corte) {
    throw new ErrorContable(`El histórico hasta el corte (${cfg.corte}) se cargó como un bloque anual. Pedí el informe desde el 1 de enero de ${anioCorte} o desde ${sumarDias(cfg.corte, 1)}.`);
  }
  const saldos = new Map();
  if (incluyeArranque) {
    const ini = await conn.prepare('SELECT cuenta, monto FROM saldos_iniciales').all();
    for (const s of ini) if (esResultados(tipos.get(s.cuenta))) saldos.set(s.cuenta, s.monto);
  }
  const desdeAct = desde > cfg.corte ? desde : sumarDias(cfg.corte, 1);
  const { mov, avisos } = await movimientosApp(desdeAct, hasta, cfg, conn);
  for (const [c, v] of actividad(mov.filter((x) => esResultados(tipos.get(x.cuenta))), tipos)) saldos.set(c, (saldos.get(c) ?? 0) + v);
  return { saldos, plan, cfg, avisos };
}

/** Saldos de las cuentas de balance a una fecha (incluye Net Income y cierre de años anteriores en Retained Earnings). */
export async function saldosBalance(hasta, conn = db) {
  const cfg = await leerConfig(conn);
  const plan = await cargarPlan(conn);
  const tipos = new Map(plan.map((c) => [c.numero, c.tipo]));
  if (hasta < cfg.corte) {
    throw new ErrorContable(`El Balance Sheet solo se puede emitir desde la fecha de corte contable (${cfg.corte}) en adelante.`);
  }
  const saldos = new Map();
  const ini = await conn.prepare('SELECT cuenta, monto FROM saldos_iniciales').all();
  for (const s of ini) if (!esResultados(tipos.get(s.cuenta))) saldos.set(s.cuenta, s.monto);
  const { mov, avisos } = await movimientosApp(sumarDias(cfg.corte, 1), hasta, cfg, conn);
  for (const [c, v] of actividad(mov.filter((x) => !esResultados(tipos.get(x.cuenta))), tipos)) saldos.set(c, (saldos.get(c) ?? 0) + v);

  const anio = Number(hasta.slice(0, 4));
  const anioCorte = Number(cfg.corte.slice(0, 4));
  // Años ya cerrados pasan a Retained Earnings.
  if (anio > anioCorte) {
    const cerrado = await saldosResultados(`${anioCorte}-01-01`, `${anio - 1}-12-31`, conn);
    saldos.set(cfg.retained, (saldos.get(cfg.retained) ?? 0) + resultadoNeto(cerrado.saldos, plan));
  }
  const ejercicio = await saldosResultados(`${anio}-01-01`, hasta, conn);
  const netIncome = resultadoNeto(ejercicio.saldos, plan);
  return { saldos, plan, cfg, netIncome, avisos: [...new Set([...avisos, ...ejercicio.avisos])] };
}

/** Total de A/R según el libro, para compararlo con el A/R Aging. */
export async function saldoLibroAR(hasta, conn = db) {
  const { saldos, cfg } = await saldosBalance(hasta, conn);
  return saldos.get(cfg.ar) ?? 0;
}
