import { Router } from 'express';
import { db } from '../db.js';
import { requiereAdmin } from '../auth.js';

export const auditoriaRouter = Router();

function serializar(row) {
  return {
    id: row.id,
    fecha: row.fecha,
    usuario: row.usuario,
    accion: row.accion,
    entidad: row.entidad,
    entidadId: row.entidad_id,
    resumen: row.resumen,
    cambios: row.cambios ? JSON.parse(row.cambios) : undefined,
  };
}

// Cualquier usuario logueado puede pedir el historial de UN documento
// puntual (para verlo en contexto, ej. dentro de una factura). Ver todo
// el log completo (sin filtro) es solo para admin.
auditoriaRouter.get('/', async (req, res) => {
  const { entidad, entidadId } = req.query;
  if (entidad && entidadId) {
    const filas = await db
      .prepare('SELECT * FROM auditoria WHERE entidad = ? AND entidad_id = ? ORDER BY fecha DESC')
      .all(entidad, entidadId);
    return res.json(filas.map(serializar));
  }
  return requiereAdmin(req, res, async () => {
    const filas = await db.prepare('SELECT * FROM auditoria ORDER BY fecha DESC LIMIT 2000').all();
    res.json(filas.map(serializar));
  });
});
