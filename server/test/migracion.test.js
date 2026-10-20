import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { db, pool } from '../src/db.js';
import { hashPin } from '../src/auth.js';
import { planificarCliente, importarLote } from '../src/migracion/historialQB.js';

let server;
let baseUrl;
let token;

before(async () => {
  await pool.query(`
    TRUNCATE TABLE
      asiento_lineas, asientos, saldos_iniciales, plan_cuentas,
      pagos_email, auditoria, documentos, bill_pago_aplicaciones, bill_pagos, bills,
      proveedores, transferencias, cuentas, gastos, reembolsos,
      nota_credito_facturas, notas_credito, pago_aplicaciones, pagos,
      facturas, clientes, configuracion, usuarios, cliente_fees_pendientes, catalogo_fees
    RESTART IDENTITY CASCADE
  `);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://localhost:${server.address().port}/api`;
  await db.prepare("INSERT INTO usuarios (id, nombre, rol, pin_hash, activo) VALUES ('u-admin', 'Admin', 'admin', ?, true)").run(hashPin('1234'));
  await db.prepare(`INSERT INTO configuracion (id, cuota_semanal_por_defecto, dia_emision, metodos_habilitados, recordatorios_plantilla) VALUES (1, 14500, 'lun', '["zelle"]', 'hola')`).run();
  token = (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuarioId: 'u-admin', pin: '1234' }) })).json()).token;
});
after(async () => {
  server.close();
  await pool.end();
});
const post = (ruta, cuerpo) => fetch(`${baseUrl}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(cuerpo) });

const ev = (fecha, tipo, monto, extra = {}) => ({ fecha, tipo, monto, num: '', memo: '', cuenta: '11000 Accounts Receivable', ...extra });

test('FIFO: el pago cubre la factura más vieja; el excedente queda como nota de crédito', () => {
  const p = planificarCliente([
    ev('2026-01-05', 'Invoice', 100, { num: '16020' }),
    ev('2026-01-12', 'Invoice', 100, { num: '16021' }),
    ev('2026-01-13', 'Payment', 250, { num: 'D056', cuenta: '10201 Bank of America 9859*' }),
  ], { compensarAlFinal: false });
  assert.equal(p.facturas.length, 2);
  assert.deepEqual(p.facturas.map((f) => f.pagado), [10000, 10000]);
  assert.equal(p.pagos[0].monto, 20000);
  assert.equal(p.pagos[0].metodo, 'zelle');
  assert.equal(p.ncs[0].monto, 5000);
  assert.match(p.ncs[0].motivo, /^Excedente/);
});

test('crédito: se aplica a facturas abiertas, el depósito bancario y el monto 0 no cuentan, el reembolso no toca la deuda', () => {
  const p = planificarCliente([
    ev('2026-02-01', 'Invoice', 135, { num: '1' }),
    ev('2026-02-02', 'Credit Memo', -35, { num: '9', memo: 'ajuste' }),
    ev('2026-02-03', 'Deposit', 135, { cuenta: '10200 Bank of America 1611*' }),
    ev('2026-02-04', 'Invoice', 0),
    ev('2026-02-05', 'Refund', -20, { cuenta: '14500 Undeposited Funds', memo: 'Refund for Payment' }),
  ]);
  assert.equal(p.facturas[0].pagado, 3500); // el crédito entró a la factura
  assert.equal(p.ncs[0].aplicado, 3500);
  assert.equal(p.pagos.length, 0);
  assert.deepEqual(p.omitidos, { sinMonto: 1, raros: 0, resumidos: 0, depositos: 1 });
  assert.equal(p.reembolsos[0].monto, 2000);
  assert.equal(p.reembolsos[0].metodo, 'kotapay');
});

test('"desde" resume el historial anterior en un saldo inicial y conserva la deuda neta', () => {
  const eventos = [
    ev('2025-06-01', 'Invoice', 100), ev('2025-06-02', 'Payment', 40), ev('2026-03-01', 'Invoice', 50), ev('2026-03-02', 'Payment', 70),
  ];
  const p = planificarCliente(eventos, { desde: '2026-01-01' });
  assert.equal(p.omitidos.resumidos, 2);
  assert.match(p.facturas[0].concepto, /Saldo inicial QuickBooks/);
  assert.equal(p.facturas[0].monto, 6000);
  const deuda = p.facturas.reduce((a, f) => a + f.monto - f.pagado, 0) - p.ncs.reduce((a, n) => a + n.monto - n.aplicado, 0);
  assert.equal(deuda, 100 + 50 - 40 - 70 > 0 ? (100 + 50 - 40 - 70) * 100 : -(Math.abs(100 + 50 - 40 - 70) * 100));
});

test('importarLote: clientes con el mismo código de unidad no se mezclan; repetir el lote no duplica', async () => {
  const ins = (id, nombreQb) => db.prepare("INSERT INTO clientes (id, codigo, numero, nombre, cuota_semanal, fecha_alta, estado, nombre_qb) VALUES (?, 'D0101', '1', ?, 0, '2026-01-01', 'activo', ?)").run(id, nombreQb, nombreQb);
  await ins('k1', 'D0101 102024 Jose Tigrera Guanipa');
  await ins('k2', 'EX 101 101199 Luis Pereira');
  const bloques = [
    { nombreQb: 'D0101 102024 Jose Tigrera Guanipa', transacciones: [ev('2026-01-05', 'Invoice', 100, { num: '7' })] },
    { nombreQb: 'EX 101 101199 Luis Pereira', transacciones: [ev('2026-01-05', 'Invoice', 60), ev('2026-01-06', 'Payment', 60, { cuenta: '10000 Cash on Hand' })] },
    { nombreQb: 'Zelle Transfer', transacciones: [ev('2026-01-05', 'Deposit', 500)] },
  ];
  const r = await importarLote(db, { bloques, usuario: 'test' });
  assert.equal(r.clientes, 2);
  assert.deepEqual(r.sinCliente, ['Zelle Transfer']);
  const f1 = await db.prepare("SELECT * FROM facturas WHERE cliente_id = 'k1'").all();
  assert.equal(f1.length, 1);
  assert.equal(f1[0].numero_qb, '7');
  assert.match(f1[0].concepto, /Invoice #7/);
  const f2 = await db.prepare("SELECT * FROM facturas WHERE cliente_id = 'k2'").all();
  assert.equal(f2[0].estado, 'pagada');
  const otra = await importarLote(db, { bloques, usuario: 'test' });
  assert.equal(otra.clientes, 0);
  assert.equal(otra.yaImportados.length, 2);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM facturas').get()).n, 2);
});

test('API: importar-historial valida y exige admin; importar-lote omite clientes ya cargados por nombre de QuickBooks', async () => {
  const mal = await post('/facturas/importar-historial', { bloques: [{ nombreQb: 'X', transacciones: [{ fecha: 'ayer', tipo: 'Invoice', monto: 1 }] }] });
  assert.equal(mal.status, 400);
  const fila = { nombreQb: 'D0200 100200 Cliente Nuevo', codigo: 'D0200', numero: '100200', nombre: 'Cliente Nuevo', email: 'a@b.com', telefonos: '4045550000', direccion: 'Calle 1', notas: 'Envío: Calle 2', estado: 'activo' };
  const a = await (await post('/clientes/importar-lote', { clientes: [fila, fila] })).json();
  assert.equal(a.importados, 1);
  const b = await (await post('/clientes/importar-lote', { clientes: [fila] })).json();
  assert.equal(b.importados, 0);
  assert.equal(b.omitidos, 1);
  const c = (await (await fetch(`${baseUrl}/clientes`, { headers: { Authorization: `Bearer ${token}` } })).json()).find((x) => x.numero === '100200');
  assert.equal(c.nombreQb, 'D0200 100200 Cliente Nuevo');
  assert.equal(c.notas, 'Envío: Calle 2');
});
