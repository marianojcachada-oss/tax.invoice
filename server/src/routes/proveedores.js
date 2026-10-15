import { Router } from 'express';
import { db } from '../db.js';
import { generarId, registrarAuditoria } from '../utils.js';
import { requiereAdmin } from '../auth.js';

export const proveedoresRouter = Router();

function serializar(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    empresa: row.empresa ?? undefined,
    telefono: row.telefono ?? undefined,
    email: row.email ?? undefined,
    condicionesPago: row.condiciones_pago ?? undefined,
    estado: row.estado,
  };
}

proveedoresRouter.get('/', async (req, res) => {
  const filas = await db.prepare('SELECT * FROM proveedores ORDER BY nombre').all();
  res.json(filas.map(serializar));
});

proveedoresRouter.post('/', async (req, res) => {
  const b = req.body;
  const id = generarId('prov');
  await db
    .prepare('INSERT INTO proveedores (id, nombre, empresa, telefono, email, condiciones_pago, estado) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, b.nombre, b.empresa || null, b.telefono || null, b.email || null, b.condicionesPago || null, b.estado || 'activo');
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Creó proveedor', entidad: 'Proveedor', entidadId: id, resumen: `Alta de ${b.nombre}` });
  const creado = await db.prepare('SELECT * FROM proveedores WHERE id = ?').get(id);
  res.status(201).json(serializar(creado));
});

proveedoresRouter.delete('/:id', requiereAdmin, async (req, res) => {
  const bills = Number((await db.prepare('SELECT COUNT(*) as n FROM bills WHERE proveedor_id = ?').get(req.params.id)).n);
  if (bills > 0) {
    return res.status(400).json({ error: 'No se puede eliminar: este proveedor tiene bills registradas.' });
  }
  const proveedor = await db.prepare('SELECT * FROM proveedores WHERE id = ?').get(req.params.id);
  if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado.' });
  await db.prepare('DELETE FROM proveedores WHERE id = ?').run(req.params.id);
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Eliminó proveedor', entidad: 'Proveedor', entidadId: req.params.id, resumen: `Se eliminó a ${proveedor.nombre}` });
  res.json({ ok: true });
});
