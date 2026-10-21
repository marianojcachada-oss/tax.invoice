import { Router } from 'express';
import { db } from '../db.js';
import { registrarAuditoria } from '../utils.js';
import { requiereAdmin } from '../auth.js';
import { importarLote } from '../migracion/historialQB.js';

export const historialRouter = Router();

const TIPOS = new Set(['Invoice', 'Payment', 'Deposit', 'Credit Memo', 'Refund', 'Expense', 'Check']);
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Importa (por lotes de clientes) el reporte "Transaction List by Customer" de QuickBooks.
// El front corta el archivo en lotes chicos y llama a esta ruta varias veces; un cliente
// que ya tiene su historial importado se omite, así que repetir un lote no duplica nada.
historialRouter.post('/importar-historial', requiereAdmin, async (req, res) => {
  const { bloques, desde = null, hasta = null } = req.body ?? {};
  if (!Array.isArray(bloques) || bloques.length === 0) return res.status(400).json({ error: 'No se recibió ningún bloque para importar.' });
  if (desde !== null && !esFecha(desde)) return res.status(400).json({ error: 'La fecha "desde" es inválida.' });
  if (hasta !== null && !esFecha(hasta)) return res.status(400).json({ error: 'La fecha "hasta" es inválida.' });
  for (const b of bloques) {
    if (!b?.nombreQb || !Array.isArray(b.transacciones)) return res.status(400).json({ error: 'Hay un bloque sin nombre de cliente o sin transacciones.' });
    for (const t of b.transacciones) {
      if (!TIPOS.has(t.tipo) || !esFecha(t.fecha) || !Number.isFinite(Number(t.monto))) {
        return res.status(400).json({ error: `Movimiento inválido en "${b.nombreQb}": ${JSON.stringify(t).slice(0, 120)}` });
      }
    }
  }
  const r = await importarLote(db, { bloques, desde, hasta, usuario: req.usuario.nombre });
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Importó el historial de transacciones',
    entidad: 'Sistema',
    entidadId: 'importar-historial',
    resumen: `Lote: ${r.clientes} clientes, ${r.facturas} facturas, ${r.pagos} pagos, ${r.notasCredito} notas de crédito, ${r.reembolsos} reembolsos${desde ? ` (resumido antes de ${desde})` : ''}${hasta ? ` (hasta ${hasta})` : ''}. ${r.yaImportados.length} ya importados, ${r.sinCliente.length} sin cliente.`,
  });
  res.json(r);
});

// Compara, cliente por cliente, la deuda neta que dice el archivo de QuickBooks contra la que quedó en la app.
// Archivo: facturas − pagos − notas de crédito (el front manda el neto ya calculado). App: facturas abiertas menos notas de crédito sin aplicar.
historialRouter.post('/verificar', requiereAdmin, async (req, res) => {
  const lista = req.body?.clientes;
  if (!Array.isArray(lista)) return res.status(400).json({ error: 'Falta la lista de clientes del archivo.' });
  const filas = await db
    .prepare(
      `SELECT c.nombre_qb AS nombre, c.historial_importado AS importado,
              COALESCE((SELECT SUM(monto - monto_pagado) FROM facturas WHERE cliente_id = c.id), 0)
            - COALESCE((SELECT SUM(monto - monto_aplicado) FROM notas_credito WHERE cliente_id = c.id), 0) AS deuda,
              (SELECT COUNT(*) FROM facturas WHERE cliente_id = c.id) AS facturas,
              (SELECT COUNT(*) FROM pagos WHERE cliente_id = c.id) AS pagos
         FROM clientes c WHERE c.nombre_qb IS NOT NULL`
    )
    .all();
  const porNombre = new Map(filas.map((f) => [f.nombre, f]));
  const diferencias = [];
  const sinHistorial = [];
  const sinCliente = [];
  let ok = 0;
  let totalArchivo = 0;
  let totalApp = 0;
  let facturasApp = 0;
  let pagosApp = 0;
  for (const c of lista) {
    const f = porNombre.get(c.nombreQb);
    const archivo = Math.round(Number(c.neto) * 100);
    if (!f) { sinCliente.push(c.nombreQb); continue; }
    if (!f.importado) { sinHistorial.push(c.nombreQb); continue; }
    const app = Number(f.deuda);
    totalArchivo += archivo;
    totalApp += app;
    facturasApp += Number(f.facturas);
    pagosApp += Number(f.pagos);
    if (archivo === app) ok += 1;
    else diferencias.push({ nombreQb: c.nombreQb, archivo: archivo / 100, app: app / 100, dif: (app - archivo) / 100 });
  }
  diferencias.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
  // Cruce por rango: totales del archivo (dentro de desde/hasta) contra lo cargado en la app para esos mismos clientes.
  const nombres = lista.map((c) => c.nombreQb);
  const { desde = null, hasta = null, totales = null } = req.body;
  let rango = null;
  if (totales) {
    const lim = [desde || '0000-01-01', hasta || '9999-12-31'];
    const q = (sql) => db.prepare(sql).get(nombres, ...lim);
    const f = await q(`SELECT COUNT(*) AS n, COALESCE(SUM(f.monto),0) AS m FROM facturas f JOIN clientes c ON c.id = f.cliente_id
                       WHERE c.nombre_qb = ANY(?) AND f.id LIKE 'fac-h-%' AND f.concepto NOT LIKE 'Saldo inicial al %' AND f.fecha >= ? AND f.fecha <= ?`);
    const p = await q(`SELECT COUNT(*) AS n, COALESCE(SUM(p.monto),0) AS m FROM pagos p JOIN clientes c ON c.id = p.cliente_id
                       WHERE c.nombre_qb = ANY(?) AND p.id LIKE 'pago-h-%' AND p.fecha >= ? AND p.fecha <= ?`);
    const ex = await q(`SELECT COALESCE(SUM(n.monto),0) AS m FROM notas_credito n JOIN clientes c ON c.id = n.cliente_id
                        WHERE c.nombre_qb = ANY(?) AND n.id LIKE 'nc-h-%' AND n.motivo LIKE 'Excedente%' AND n.fecha >= ? AND n.fecha <= ?`);
    const cm = await q(`SELECT COUNT(*) AS n, COALESCE(SUM(n.monto),0) AS m FROM notas_credito n JOIN clientes c ON c.id = n.cliente_id
                        WHERE c.nombre_qb = ANY(?) AND n.id LIKE 'nc-h-%' AND n.motivo LIKE 'Migración · Credit Memo%' AND n.fecha >= ? AND n.fecha <= ?`);
    const fila = (nombre, a, cantApp, montoApp) => ({ concepto: nombre, cantArchivo: a.n, montoArchivo: a.monto, cantApp, montoApp: montoApp / 100, dif: Math.round((montoApp - Math.round(a.monto * 100))) / 100 });
    rango = [
      fila('Facturas', totales.facturas, Number(f.n), Number(f.m)),
      fila('Pagos (incluye excedentes)', totales.pagos, null, Number(p.m) + Number(ex.m)),
      fila('Notas de crédito', totales.creditos, Number(cm.n), Number(cm.m)),
    ];
  }
  res.json({
    rango,
    revisados: ok + diferencias.length, coinciden: ok, diferencias: diferencias.slice(0, 50), cantidadDiferencias: diferencias.length,
    totalArchivo: totalArchivo / 100, totalApp: totalApp / 100, sinHistorial, sinCliente, facturasApp, pagosApp,
  });
});

// Borra TODO lo que vino de la importación de QuickBooks (ids "fac-h-", "pago-h-", "nc-h-", "re-h-") y deja a los clientes
// listos para volver a importar. No toca nada de lo que se generó en la app (cobros, facturas semanales, etc.).
historialRouter.post('/borrar-historial-importado', requiereAdmin, async (req, res) => {
  if (req.body?.confirmacion !== 'BORRAR') return res.status(400).json({ error: 'Falta la confirmación.' });
  const usadas = await db
    .prepare(`SELECT COUNT(*) AS n FROM pago_aplicaciones WHERE pago_id NOT LIKE 'pago-h-%' AND factura_id LIKE 'fac-h-%'`)
    .get();
  if (Number(usadas.n) > 0) {
    return res.status(409).json({ error: `Hay ${usadas.n} pagos cargados en la app aplicados a facturas importadas. Borrarlas dejaría esos pagos sin factura; resolvelo primero.` });
  }
  const r = await db.transaction(async (tx) => {
    await tx.prepare(`DELETE FROM pago_aplicaciones WHERE pago_id LIKE 'pago-h-%' OR factura_id LIKE 'fac-h-%'`).run();
    await tx.prepare(`DELETE FROM nota_credito_facturas WHERE nota_id LIKE 'nc-h-%' OR factura_id LIKE 'fac-h-%'`).run();
    const re = await tx.prepare(`DELETE FROM reembolsos WHERE id LIKE 're-h-%'`).run();
    const pa = await tx.prepare(`DELETE FROM pagos WHERE id LIKE 'pago-h-%'`).run();
    const nc = await tx.prepare(`DELETE FROM notas_credito WHERE id LIKE 'nc-h-%'`).run();
    const fa = await tx.prepare(`DELETE FROM facturas WHERE id LIKE 'fac-h-%'`).run();
    const cl = await tx.prepare(`UPDATE clientes SET historial_importado = false WHERE historial_importado = true`).run();
    return { facturas: fa.changes ?? fa.rowCount, pagos: pa.changes ?? pa.rowCount, notasCredito: nc.changes ?? nc.rowCount, reembolsos: re.changes ?? re.rowCount, clientes: cl.changes ?? cl.rowCount };
  });
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Borró el historial importado',
    entidad: 'Sistema',
    entidadId: 'borrar-historial',
    resumen: `Se borraron ${r.facturas} facturas, ${r.pagos} pagos, ${r.notasCredito} notas de crédito y ${r.reembolsos} reembolsos importados; ${r.clientes} clientes quedaron listos para importar de nuevo.`,
  });
  res.json(r);
});
