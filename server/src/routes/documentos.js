import { Router } from 'express';
import { db } from '../db.js';
import { generarId, registrarAuditoria } from '../utils.js';

export const documentosRouter = Router();

const LIMITE_BYTES = 3 * 1024 * 1024;

function serializar(row) {
  return {
    id: row.id,
    clienteId: row.cliente_id,
    nombre: row.nombre,
    tipo: row.tipo,
    tamano: row.tamano,
    fecha: row.fecha,
    dataUrl: row.data_url,
  };
}

documentosRouter.get('/cliente/:clienteId', async (req, res) => {
  const filas = await db.prepare('SELECT * FROM documentos WHERE cliente_id = ? ORDER BY fecha DESC').all(req.params.clienteId);
  res.json(filas.map(serializar));
});

documentosRouter.post('/', async (req, res) => {
  const b = req.body;
  if (b.tamano > LIMITE_BYTES) {
    return res.status(400).json({ error: 'El archivo pesa más de 3 MB.' });
  }
  const cliente = await db.prepare('SELECT * FROM clientes WHERE id = ?').get(b.clienteId);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const id = generarId('doc');
  await db
    .prepare('INSERT INTO documentos (id, cliente_id, nombre, tipo, tamano, fecha, data_url) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, b.clienteId, b.nombre, b.tipo, b.tamano, b.fecha, b.dataUrl);
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Subió documento', entidad: 'Cliente', entidadId: b.clienteId, resumen: `Se adjuntó "${b.nombre}" a ${cliente.nombre}` });
  const creado = await db.prepare('SELECT * FROM documentos WHERE id = ?').get(id);
  res.status(201).json(serializar(creado));
});

documentosRouter.delete('/:id', async (req, res) => {
  const doc = await db.prepare('SELECT * FROM documentos WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });
  const cliente = await db.prepare('SELECT * FROM clientes WHERE id = ?').get(doc.cliente_id);
  await db.prepare('DELETE FROM documentos WHERE id = ?').run(req.params.id);
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Eliminó documento', entidad: 'Cliente', entidadId: doc.cliente_id, resumen: `Se eliminó "${doc.nombre}" de ${cliente?.nombre ?? doc.cliente_id}` });
  res.json({ ok: true });
});
