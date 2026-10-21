import { Router } from 'express';
import { db } from '../db.js';
import { generarId, aCentavos, aDolares, registrarAuditoria } from '../utils.js';
import { requiereAdmin } from '../auth.js';
import { leerConfig, asegurarPlan } from '../contabilidad/config.js';
import { ErrorHttp, responderError } from '../permisos.js';

// Undeposited Funds: lo cobrado por Kotapay y en efectivo queda acá hasta que la administración
// decide a qué banco se deposita (10200 BofA 1611 o 10201 BofA 9859). El depósito genera el asiento
// banco / undeposited y las líneas quedan ligadas a los pagos que se depositaron.
export const undepositedRouter = Router();
undepositedRouter.use(requiereAdmin);

const DESTINOS = { '10200': 'Bank of America 1611 (10200)', '10201': 'Bank of America 9859 (10201)' };

async function pagosPendientes() {
  const cfg = await leerConfig();
  const filas = await db
    .prepare(
      `SELECT p.id, p.numero, p.fecha, p.monto, p.metodo, p.referencia, c.codigo, c.nombre, cu.cuenta_contable
       FROM pagos p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN cuentas cu ON cu.id = p.cuenta_id
       WHERE substr(p.fecha, 1, 10) > ? AND NOT EXISTS (SELECT 1 FROM deposito_pagos d WHERE d.pago_id = p.id)
       ORDER BY p.fecha, p.numero`
    )
    .all(cfg.corte);
  const undeposited = cfg.kotapay;
  return filas.filter((p) => {
    if (p.cuenta_contable) return p.cuenta_contable === undeposited;
    const m = String(p.metodo ?? '').toLowerCase();
    return m.includes('kota') || m.includes('efectivo') || m.includes('cash');
  });
}

undepositedRouter.get('/', async (req, res) => {
  const pend = await pagosPendientes();
  const deps = await db.prepare('SELECT * FROM depositos_undeposited ORDER BY fecha DESC, id DESC LIMIT 200').all();
  const links = await db.prepare('SELECT d.deposito_id, p.numero FROM deposito_pagos d JOIN pagos p ON p.id = d.pago_id').all();
  res.json({
    destinos: Object.entries(DESTINOS).map(([cuenta, nombre]) => ({ cuenta, nombre })),
    pendientes: pend.map((p) => ({ pagoId: p.id, numero: p.numero, fecha: p.fecha, cliente: `${p.codigo} ${p.nombre}`, metodo: p.metodo, referencia: p.referencia ?? undefined, monto: aDolares(p.monto) })),
    total: aDolares(pend.reduce((a, p) => a + p.monto, 0)),
    depositos: deps.map((d) => ({
      id: d.id, fecha: d.fecha, destino: d.destino, destinoNombre: DESTINOS[d.destino] ?? d.destino, monto: aDolares(d.monto), nota: d.nota ?? undefined, creadoPor: d.creado_por ?? undefined,
      pagos: links.filter((l) => l.deposito_id === d.id).map((l) => l.numero),
    })),
  });
});

undepositedRouter.post('/depositar', async (req, res, next) => {
  try {
    const { pagoIds, destino, fecha, nota } = req.body ?? {};
    if (!DESTINOS[destino]) throw new ErrorHttp(400, 'Elegí el banco de destino (10200 o 10201).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) throw new ErrorHttp(400, 'Fecha inválida.');
    if (!Array.isArray(pagoIds) || pagoIds.length === 0) throw new ErrorHttp(400, 'Elegí al menos un pago.');
    const cfg = await leerConfig();
    const validos = new Map((await pagosPendientes()).map((p) => [p.id, p]));
    const elegidos = [...new Set(pagoIds)].map((id) => validos.get(id));
    if (elegidos.some((p) => !p)) throw new ErrorHttp(409, 'Alguno de los pagos ya fue depositado o no está en Undeposited. Actualizá la pantalla.');
    const total = elegidos.reduce((a, p) => a + p.monto, 0);
    await asegurarPlan();
    const id = generarId('dep');
    const asientoId = generarId('asiento');
    await db.transaction(async (tx) => {
      await tx.prepare('INSERT INTO asientos (id, fecha, descripcion, creado_por) VALUES (?, ?, ?, ?)')
        .run(asientoId, fecha, `Depósito de Undeposited Funds a ${DESTINOS[destino]} (${elegidos.length} pago/s)${nota ? ` · ${nota}` : ''}`, req.usuario.nombre);
      await tx.prepare('INSERT INTO asiento_lineas (asiento_id, cuenta, debe, haber) VALUES (?, ?, ?, 0)').run(asientoId, destino, total);
      await tx.prepare('INSERT INTO asiento_lineas (asiento_id, cuenta, debe, haber) VALUES (?, ?, 0, ?)').run(asientoId, cfg.kotapay, total);
      await tx.prepare('INSERT INTO depositos_undeposited (id, fecha, destino, monto, nota, asiento_id, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, fecha, destino, total, nota || null, asientoId, req.usuario.nombre);
      for (const p of elegidos) await tx.prepare('INSERT INTO deposito_pagos (deposito_id, pago_id) VALUES (?, ?)').run(id, p.id);
    });
    await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Depositó Undeposited Funds', entidad: 'Deposito', entidadId: id, resumen: `$${aDolares(total)} a ${DESTINOS[destino]} (${elegidos.length} pagos)` });
    res.status(201).json({ id, monto: aDolares(total) });
  } catch (e) {
    responderError(res, e, next);
  }
});

undepositedRouter.delete('/depositos/:id', async (req, res) => {
  const d = await db.prepare('SELECT * FROM depositos_undeposited WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Depósito no encontrado.' });
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM depositos_undeposited WHERE id = ?').run(d.id); // borra los vínculos (los pagos vuelven a Undeposited)
    if (d.asiento_id) await tx.prepare('DELETE FROM asientos WHERE id = ?').run(d.asiento_id);
  });
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Deshizo un depósito', entidad: 'Deposito', entidadId: d.id, resumen: `$${aDolares(d.monto)} a ${DESTINOS[d.destino] ?? d.destino} (${d.fecha})` });
  res.json({ ok: true });
});
