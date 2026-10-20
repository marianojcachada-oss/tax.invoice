import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import { app } from '../src/app.js';
import { db, pool } from '../src/db.js';
import { hashPin } from '../src/auth.js';
import { asegurarPlan } from '../src/contabilidad/config.js';
import { cargarArranque } from '../src/contabilidad/importarQB.js';
import { balanceSheet, profitAndLoss, arAgingSummary, rangoLargo } from '../src/contabilidad/informes.js';
import { aXlsx, aCsv, aPdf } from '../src/contabilidad/exportar.js';
import { aDebeHaber, sumarDias } from '../src/contabilidad/tipos.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(join(aqui, 'fixtures', n));
const b64 = (n) => fixture(n).toString('base64');

let server;
let baseUrl;

before(async () => {
  await pool.query(`
    TRUNCATE TABLE
      asiento_lineas, asientos, saldos_iniciales, plan_cuentas,
      pagos_email, auditoria, documentos, bill_pago_aplicaciones, bill_pagos, bills,
      proveedores, transferencias, cuentas, gastos, reembolsos,
      nota_credito_facturas, notas_credito, pago_aplicaciones, pagos,
      facturas, clientes, configuracion, usuarios,
      cliente_fees_pendientes, catalogo_fees
    RESTART IDENTITY CASCADE
  `);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://localhost:${server.address().port}/api`;
  await db.prepare("INSERT INTO usuarios (id, nombre, rol, pin_hash, activo) VALUES ('u-admin', 'Admin', 'admin', ?, true)").run(hashPin('1234'));
  await db.prepare("INSERT INTO usuarios (id, nombre, rol, pin_hash, activo) VALUES ('u-op', 'Operador', 'operador', ?, true)").run(hashPin('5678'));
  await db
    .prepare(`INSERT INTO configuracion (id, cuota_semanal_por_defecto, dia_emision, metodos_habilitados, recordatorios_plantilla) VALUES (1, 14500, 'lun', '["zelle"]', 'hola')`)
    .run();
  await asegurarPlan();
  await cargarArranque({ balance: b64('Balance_Sheet.xlsx'), resultados: b64('Profit_and_Loss.xlsx') });
});

after(async () => {
  server.close();
  await pool.end();
});

// ─── comparación celda por celda contra el archivo de QuickBooks ──────
async function cargarXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets[0];
}
const formulaDe = (c) => (c.value && typeof c.value === 'object' && 'formula' in c.value ? c.value.formula : null);
const numeroDe = (c) => (c.value && typeof c.value === 'object' && 'result' in c.value ? c.value.result : c.value);

async function compararConQuickBooks(modelo, archivo) {
  const esperado = await cargarXlsx(fixture(archivo));
  const obtenido = await cargarXlsx(await aXlsx(modelo));
  assert.equal(obtenido.rowCount >= esperado.rowCount, true);
  const ultima = esperado.rowCount;
  for (let r = 1; r <= ultima; r++) {
    const e = esperado.getRow(r);
    const o = obtenido.getRow(r);
    const aE = e.getCell(1);
    const aO = o.getCell(1);
    const donde = `fila ${r} (${aE.value})`;
    if (r === ultima) {
      assert.match(String(aO.value), /\d{4} \d{2}:\d{2} (AM|PM) GMT[+-]\d{2}:\d{2}$/, donde);
      continue;
    }
    assert.equal(String(aO.value ?? ''), String(aE.value ?? ''), `texto ${donde}`);
    assert.equal(aO.alignment?.indent ?? 0, aE.alignment?.indent ?? 0, `sangría ${donde}`);
    assert.equal(!!aO.font?.bold, !!aE.font?.bold, `negrita ${donde}`);
    for (let c = 2; c <= esperado.columnCount; c++) {
      const ce = e.getCell(c);
      const co = o.getCell(c);
      const d = `${donde} col ${c}`;
      assert.equal(formulaDe(co), formulaDe(ce), `fórmula ${d}`);
      const ve = numeroDe(ce);
      const vo = numeroDe(co);
      if (typeof ve === 'number') {
        assert.ok(typeof vo === 'number' && Math.abs(vo - ve) < 0.006, `valor ${d}: esperado ${ve}, obtenido ${vo}`);
        assert.equal(co.numFmt, ce.numFmt, `formato ${d}`);
      } else {
        assert.equal(vo ?? null, ve ?? null, `valor ${d}`);
      }
    }
  }
}

test('el Balance Sheet reproduce el de QuickBooks celda por celda (valores, fórmulas, sangrías)', async () => {
  const r = await balanceSheet({ hasta: '2026-10-20' });
  assert.equal(r.cuadra, true);
  assert.equal(r.totalActivos, 69935253);
  assert.equal(r.netIncome, 131369191);
  await compararConQuickBooks(r.modelo, 'Balance_Sheet.xlsx');
});

test('el Profit and Loss reproduce el de QuickBooks celda por celda', async () => {
  const r = await profitAndLoss({ desde: '2026-01-01', hasta: '2026-10-20' });
  assert.equal(r.netIncome, 131369191);
  assert.equal(r.modelo.rango, 'January 1-October 20, 2026');
  await compararConQuickBooks(r.modelo, 'Profit_and_Loss.xlsx');
});

test('rangos de fechas con el formato de QuickBooks', () => {
  assert.equal(rangoLargo('2026-01-01', '2026-12-31'), 'January 1-December 31, 2026');
  assert.equal(rangoLargo('2026-01-01', '2027-03-03'), 'January 1, 2026-March 3, 2027');
});

test('no se emiten informes anteriores al corte ni rangos que lo parten', async () => {
  await assert.rejects(() => balanceSheet({ hasta: '2026-06-30' }), /fecha de corte/);
  await assert.rejects(() => profitAndLoss({ desde: '2026-03-01', hasta: '2026-10-20' }), /bloque anual/);
});

test('debe/haber según el lado de la cuenta', () => {
  assert.deepEqual(aDebeHaber('Bank', 500), { debe: 500, haber: 0 });
  assert.deepEqual(aDebeHaber('Income', 500), { debe: 0, haber: 500 });
  assert.deepEqual(aDebeHaber('Fixed Assets', -500), { debe: 0, haber: 500 });
  assert.equal(sumarDias('2026-10-20', 1), '2026-10-21');
});

// ─── actividad posterior al corte ────────────────────────────────────
test('la actividad nueva entra al libro: el balance sigue cuadrando, A/R = aging y el P&L suma lo nuevo', async () => {
  await db.prepare(`INSERT INTO clientes (id, codigo, numero, nombre, cuota_semanal, fecha_alta, estado) VALUES ('c1', 'D0001', '1001', 'Ana Prueba', 14500, '2025-01-01', 'activo')`).run();
  await db.prepare(`INSERT INTO clientes (id, codigo, numero, nombre, cuota_semanal, fecha_alta, estado) VALUES ('c2', 'D0002', '1002', 'Beto Prueba', 14500, '2025-01-01', 'activo')`).run();
  // saldo de arranque de A/R de QuickBooks (38,900.27) como factura migrada anterior al corte
  await db.prepare(`INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado) VALUES ('f0', 1, 'c1', 0, '2026-09-01', '2026-09-01', 'Saldo inicial', 3890027, 0, 'pendiente')`).run();
  // nueva factura de $145 (vence en 5 días pasados del corte) y pago de $60
  await db.prepare(`INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado) VALUES ('f1', 2, 'c2', 1, '2026-10-26', '2026-10-26', 'Cuota', 14500, 6000, 'parcial')`).run();
  await db.prepare(`INSERT INTO pagos (id, numero, cliente_id, fecha, monto, metodo, editado) VALUES ('p1', 1, 'c2', '2026-10-27', 6000, 'zelle', false)`).run();
  await db.prepare(`INSERT INTO pago_aplicaciones (pago_id, factura_id, monto) VALUES ('p1', 'f1', 6000)`).run();
  await db.prepare(`INSERT INTO gastos (id, fecha, proveedor, categoria, metodo, monto) VALUES ('g1', '2026-10-28', 'Taller', 'mantenimiento', 'zelle', 2500)`).run();

  const antes = await balanceSheet({ hasta: '2026-10-20' });
  const bs = await balanceSheet({ hasta: '2026-10-31' });
  assert.equal(bs.cuadra, true);
  // ingresos +145, gasto -25 => net income +120
  assert.equal(bs.netIncome - antes.netIncome, 12000);
  // A/R del libro = aging (incluye la factura migrada)
  const aging = await arAgingSummary({ al: '2026-10-31' });
  const filaAR = bs.modelo.filas.find((f) => f.etiqueta === '11000 Accounts Receivable');
  assert.equal(filaAR.valores[0], aging.total);
  // banco 1611: +60 - 25
  const banco = (m) => m.filas.find((f) => f.etiqueta === '10200 Bank of America 1611*').valores[0];
  assert.equal(banco(bs.modelo) - banco(antes.modelo), 3500);
  const pl = await profitAndLoss({ desde: '2026-01-01', hasta: '2026-10-31' });
  assert.equal(pl.netIncome, 131369191 + 12000);
  assert.ok(pl.modelo.filas.some((f) => f.etiqueta === '67200 Repairs and Maintenance' && f.valores[0] === 401340 + 2500));
});

test('un asiento manual cuadrado entra al libro; uno descuadrado se rechaza', async () => {
  const token = (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuarioId: 'u-admin', pin: '1234' }) })).json()).token;
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const mal = await fetch(`${baseUrl}/contabilidad/asientos`, { method: 'POST', headers: h, body: JSON.stringify({ fecha: '2026-10-30', descripcion: 'x', lineas: [{ cuenta: '81100', debe: 10 }, { cuenta: '16000', haber: 9 }] }) });
  assert.equal(mal.status, 400);
  const bien = await fetch(`${baseUrl}/contabilidad/asientos`, { method: 'POST', headers: h, body: JSON.stringify({ fecha: '2026-10-30', descripcion: 'Depreciación', lineas: [{ cuenta: '81100', debe: 100 }, { cuenta: '16000', haber: 100 }] }) });
  assert.equal(bien.status, 201);
  const bs = await balanceSheet({ hasta: '2026-10-31' });
  assert.equal(bs.cuadra, true);
  const dep = bs.modelo.filas.find((f) => f.etiqueta === '16000 Accumulated Depreciation');
  assert.equal(dep.valores[0], -16287109 - 10000); // más negativa
});

test('el A/R Aging reparte por días de vencida y el total coincide', async () => {
  await db.prepare(`INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado) VALUES ('a1', 10, 'c2', 1, '2026-11-01', '2026-11-01', 'x', 1000, 0, 'pendiente')`).run();
  await db.prepare(`INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado) VALUES ('a2', 11, 'c2', 1, '2026-11-01', '2026-12-20', 'x', 2000, 0, 'pendiente')`).run();
  const r = await arAgingSummary({ al: '2026-12-31' });
  const beto = r.modelo.filas.find((f) => f.etiqueta === 'D0002 1002 Beto Prueba');
  // a2 vence hace 11 días (1-30); a1 hace 60 (31-60); f1 (saldo 85) hace 66 (61-90)
  assert.deepEqual(beto.valores, [0, 2000, 1000, 8500, 0, 11500]);
  assert.equal(r.modelo.filas.at(-1).etiqueta, 'TOTAL');
  assert.equal(r.modelo.columnas.join('|'), 'CURRENT|1 - 30|31 - 60|61 - 90|91 AND OVER|Total');
});

test('exportaciones: CSV, Excel y PDF', async () => {
  const r = await balanceSheet({ hasta: '2026-10-31' });
  const csv = aCsv(r.modelo);
  assert.match(csv, /^﻿TAXI LASER LLC/);
  assert.match(csv, /10200 Bank of America 1611\*/);
  const pdf = await aPdf(r.modelo);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const ws = await cargarXlsx(await aXlsx(r.modelo));
  assert.equal(ws.getCell('A2').value, 'Balance Sheet');
});

test('API: solo admin; descarga en los tres formatos y falla claro antes del corte', async () => {
  const login = async (id, pin) => (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuarioId: id, pin }) })).json()).token;
  const admin = await login('u-admin', '1234');
  const op = await login('u-op', '5678');
  const get = (tipo, q, token) => fetch(`${baseUrl}/contabilidad/informes/${tipo}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await get('balance-sheet', 'al=2026-10-31', op)).status, 403);
  for (const [ext, tipoMime] of [['xlsx', 'spreadsheetml'], ['csv', 'text/csv'], ['pdf', 'application/pdf']]) {
    const res = await get('profit-and-loss', `desde=2026-01-01&hasta=2026-10-31&formato=${ext}`, admin);
    assert.equal(res.status, 200, ext);
    assert.ok(res.headers.get('content-type').includes(tipoMime), ext);
    assert.match(res.headers.get('content-disposition'), new RegExp(`TAXI_LASER_LLC_Profit_and_Loss\\.${ext}`));
  }
  const antes = await get('balance-sheet', 'al=2026-01-31', admin);
  assert.equal(antes.status, 400);
  const j = await (await get('ar-aging-summary', 'al=2026-10-31', admin)).json();
  assert.equal(j.titulo, 'A/R Aging Summary Report');
  const c = await (await fetch(`${baseUrl}/contabilidad/conciliacion?al=2026-10-31`, { headers: { Authorization: `Bearer ${admin}` } })).json();
  assert.equal(c.balanceCuadra, true);
});
