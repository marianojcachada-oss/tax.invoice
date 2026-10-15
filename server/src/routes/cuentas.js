import { Router } from 'express';
import { db } from '../db.js';
import { generarId, aCentavos, aDolares, registrarAuditoria } from '../utils.js';
import { requiereAdmin } from '../auth.js';

export const cuentasRouter = Router();

function serializar(row) {
  return { id: row.id, nombre: row.nombre, tipo: row.tipo, saldoInicial: aDolares(row.saldo_inicial) };
}

function serializarTransferencia(row) {
  return {
    id: row.id,
    fecha: row.fecha,
    cuentaOrigenId: row.cuenta_origen_id,
    cuentaDestinoId: row.cuenta_destino_id,
    monto: aDolares(row.monto),
    nota: row.nota ?? undefined,
  };
}

cuentasRouter.get('/', async (req, res) => {
  const filas = await db.prepare('SELECT * FROM cuentas ORDER BY nombre').all();
  res.json(filas.map(serializar));
});

cuentasRouter.post('/', async (req, res) => {
  const b = req.body;
  const id = generarId('cta');
  await db.prepare('INSERT INTO cuentas (id, nombre, tipo, saldo_inicial) VALUES (?, ?, ?, ?)').run(id, b.nombre, b.tipo, aCentavos(b.saldoInicial || 0));
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Creó cuenta', entidad: 'Cuenta', entidadId: id, resumen: `Alta de cuenta ${b.nombre}` });
  const creada = await db.prepare('SELECT * FROM cuentas WHERE id = ?').get(id);
  res.status(201).json(serializar(creada));
});

cuentasRouter.delete('/:id', requiereAdmin, async (req, res) => {
  const cuenta = await db.prepare('SELECT * FROM cuentas WHERE id = ?').get(req.params.id);
  if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada.' });
  // COUNT(*) devuelve bigint, que "pg" entrega como string — hay que
  // convertir con Number() antes de sumar (si no, "2" + "0" concatena
  // en vez de sumar y da "20").
  const pagosCount = Number((await db.prepare('SELECT COUNT(*) as n FROM pagos WHERE cuenta_id = ?').get(req.params.id)).n);
  const transferCount = Number(
    (await db.prepare('SELECT COUNT(*) as n FROM transferencias WHERE cuenta_origen_id = ? OR cuenta_destino_id = ?').get(req.params.id, req.params.id)).n
  );
  if (pagosCount + transferCount > 0) {
    return res.status(400).json({ error: 'No se puede eliminar: esta cuenta tiene movimientos registrados.' });
  }
  await db.prepare('DELETE FROM cuentas WHERE id = ?').run(req.params.id);
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Eliminó cuenta', entidad: 'Cuenta', entidadId: req.params.id, resumen: `Se eliminó la cuenta ${cuenta.nombre}` });
  res.json({ ok: true });
});

cuentasRouter.get('/transferencias', async (req, res) => {
  const filas = await db.prepare('SELECT * FROM transferencias ORDER BY fecha DESC').all();
  res.json(filas.map(serializarTransferencia));
});

cuentasRouter.post('/transferencias', async (req, res) => {
  const b = req.body;
  const id = generarId('tr');
  await db
    .prepare('INSERT INTO transferencias (id, fecha, cuenta_origen_id, cuenta_destino_id, monto, nota) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, b.fecha, b.cuentaOrigenId, b.cuentaDestinoId, aCentavos(b.monto), b.nota || null);
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Registró transferencia', entidad: 'Transferencia', entidadId: id, resumen: `Transferencia de $${b.monto}` });
  const creada = await db.prepare('SELECT * FROM transferencias WHERE id = ?').get(id);
  res.status(201).json(serializarTransferencia(creada));
});
