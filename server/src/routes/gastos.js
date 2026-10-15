import { Router } from 'express';
import { db } from '../db.js';
import { generarId, aCentavos, aDolares, registrarAuditoria } from '../utils.js';

export const gastosRouter = Router();
export const reembolsosRouter = Router();

function serializarGasto(row) {
  return {
    id: row.id,
    fecha: row.fecha,
    proveedor: row.proveedor,
    categoria: row.categoria,
    cuentaId: row.cuenta_id ?? undefined,
    metodo: row.metodo ?? undefined,
    monto: aDolares(row.monto),
    nota: row.nota ?? undefined,
  };
}

gastosRouter.get('/', async (req, res) => {
  const filas = await db.prepare('SELECT * FROM gastos ORDER BY fecha DESC').all();
  res.json(filas.map(serializarGasto));
});

gastosRouter.post('/', async (req, res) => {
  const b = req.body;
  const id = generarId('gasto');
  await db
    .prepare('INSERT INTO gastos (id, fecha, proveedor, categoria, cuenta_id, metodo, monto, nota) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, b.fecha, b.proveedor, b.categoria, b.cuentaId || null, b.metodo || null, aCentavos(b.monto), b.nota || null);
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Registró gasto', entidad: 'Gasto', entidadId: id, resumen: `Gasto de $${b.monto} · ${b.categoria} · ${b.proveedor}` });
  const creado = await db.prepare('SELECT * FROM gastos WHERE id = ?').get(id);
  res.status(201).json(serializarGasto(creado));
});

async function serializarReembolso(row) {
  let pagoNumero;
  let facturas = [];
  if (row.pago_id) {
    const pago = await db.prepare('SELECT numero FROM pagos WHERE id = ?').get(row.pago_id);
    pagoNumero = pago?.numero;
    facturas = (
      await db
        .prepare('SELECT f.id, f.numero FROM pago_aplicaciones a JOIN facturas f ON f.id = a.factura_id WHERE a.pago_id = ? ORDER BY f.numero')
        .all(row.pago_id)
    ).map((f) => ({ id: f.id, numero: f.numero }));
  }
  return {
    id: row.id,
    numero: row.numero,
    clienteId: row.cliente_id,
    fecha: row.fecha,
    monto: aDolares(row.monto),
    metodo: row.metodo,
    cuentaId: row.cuenta_id ?? undefined,
    motivo: row.motivo,
    pagoId: row.pago_id ?? undefined,
    pagoNumero,
    facturas,
  };
}

reembolsosRouter.get('/', async (req, res) => {
  const filas = await db.prepare('SELECT * FROM reembolsos ORDER BY fecha DESC, numero DESC').all();
  res.json(await Promise.all(filas.map(serializarReembolso)));
});

reembolsosRouter.post('/', async (req, res) => {
  const b = req.body;
  const monto = aCentavos(b.monto);
  if (!b.clienteId || !(monto > 0)) return res.status(400).json({ error: 'Indicá cliente y un monto mayor a 0.' });
  let cuentaId = b.cuentaId || null;
  let metodo = b.metodo;
  if (b.pagoId) {
    const pago = await db.prepare('SELECT * FROM pagos WHERE id = ?').get(b.pagoId);
    if (!pago || pago.cliente_id !== b.clienteId) return res.status(400).json({ error: 'Ese pago no pertenece al cliente.' });
    const ya = (await db.prepare('SELECT COALESCE(SUM(monto),0) AS t FROM reembolsos WHERE pago_id = ?').get(b.pagoId)).t;
    const disponible = pago.monto - Number(ya);
    if (monto > disponible) {
      return res.status(400).json({ error: `Solo se pueden reembolsar $${aDolares(disponible).toFixed(2)} de ese pago (ya se devolvió $${aDolares(Number(ya)).toFixed(2)}).` });
    }
    cuentaId = cuentaId || pago.cuenta_id || null;
    metodo = metodo || pago.metodo;
  }
  const numero = ((await db.prepare('SELECT MAX(numero) as n FROM reembolsos').get()).n ?? 0) + 1;
  const id = generarId('re');
  await db
    .prepare('INSERT INTO reembolsos (id, numero, cliente_id, fecha, monto, metodo, motivo, pago_id, cuenta_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, numero, b.clienteId, b.fecha, monto, metodo, b.motivo || 'Sin especificar', b.pagoId || null, cuentaId);
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Registró reembolso', entidad: 'Reembolso', entidadId: id, resumen: `Reembolso #${numero} de $${b.monto}${b.pagoId ? ' (sobre un pago)' : ''}` });
  const creado = await db.prepare('SELECT * FROM reembolsos WHERE id = ?').get(id);
  res.status(201).json(await serializarReembolso(creado));
});
