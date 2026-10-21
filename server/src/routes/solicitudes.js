import { Router } from 'express';
import { db } from '../db.js';
import { registrarAuditoria } from '../utils.js';
import { requiereAdmin } from '../auth.js';
import { ejecutorDe, esAdmin, serializarSolicitud, cierreHasta, ErrorHttp, responderError } from '../permisos.js';

export const solicitudesRouter = Router();

// Administradores: todas. El resto: solo las propias.
solicitudesRouter.get('/', async (req, res) => {
  const filas = esAdmin(req.usuario)
    ? await db.prepare('SELECT * FROM solicitudes ORDER BY creada DESC LIMIT 500').all()
    : await db.prepare('SELECT * FROM solicitudes WHERE solicitante_id = ? ORDER BY creada DESC LIMIT 200').all(req.usuario.id);
  res.json(filas.map(serializarSolicitud));
});

solicitudesRouter.get('/pendientes', async (req, res) => {
  const f = esAdmin(req.usuario)
    ? await db.prepare(`SELECT COUNT(*)::int AS n FROM solicitudes WHERE estado = 'pendiente'`).get()
    : await db.prepare(`SELECT COUNT(*)::int AS n FROM solicitudes WHERE estado = 'pendiente' AND solicitante_id = ?`).get(req.usuario.id);
  res.json({ cantidad: f.n });
});

solicitudesRouter.post('/:id/aprobar', requiereAdmin, async (req, res, next) => {
  try {
    const sol = await db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(req.params.id);
    if (!sol) throw new ErrorHttp(404, 'Solicitud no encontrada.');
    if (sol.estado !== 'pendiente') throw new ErrorHttp(409, 'Esa solicitud ya fue resuelta.');
    const ejecutar = ejecutorDe(sol.tipo);
    if (!ejecutar) throw new ErrorHttp(400, 'No se sabe ejecutar este tipo de solicitud.');
    try {
      await ejecutar(JSON.parse(sol.payload), { autor: `${sol.solicitante} (autorizado por ${req.usuario.nombre})` });
    } catch (e) {
      const mensaje = e instanceof ErrorHttp ? e.message : 'No se pudo aplicar el cambio.';
      await db.prepare(`UPDATE solicitudes SET estado = 'fallida', resuelta_por = ?, resuelta = ?, nota = ? WHERE id = ?`).run(req.usuario.nombre, new Date().toISOString(), mensaje, sol.id);
      throw new ErrorHttp(409, `No se pudo aplicar: ${mensaje}`);
    }
    await db.prepare(`UPDATE solicitudes SET estado = 'aprobada', resuelta_por = ?, resuelta = ?, nota = ? WHERE id = ?`).run(req.usuario.nombre, new Date().toISOString(), req.body?.nota ?? null, sol.id);
    await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Aprobó solicitud', entidad: sol.entidad, entidadId: sol.entidad_id, resumen: `${sol.resumen} — pedido por ${sol.solicitante}` });
    res.json(serializarSolicitud(await db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(sol.id)));
  } catch (e) {
    responderError(res, e, next);
  }
});

solicitudesRouter.post('/:id/rechazar', requiereAdmin, async (req, res, next) => {
  try {
    const sol = await db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(req.params.id);
    if (!sol) throw new ErrorHttp(404, 'Solicitud no encontrada.');
    if (sol.estado !== 'pendiente') throw new ErrorHttp(409, 'Esa solicitud ya fue resuelta.');
    await db.prepare(`UPDATE solicitudes SET estado = 'rechazada', resuelta_por = ?, resuelta = ?, nota = ? WHERE id = ?`).run(req.usuario.nombre, new Date().toISOString(), req.body?.nota ?? null, sol.id);
    await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Rechazó solicitud', entidad: sol.entidad, entidadId: sol.entidad_id, resumen: `${sol.resumen} — pedido por ${sol.solicitante}${req.body?.nota ? `. Motivo: ${req.body.nota}` : ''}` });
    res.json(serializarSolicitud(await db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(sol.id)));
  } catch (e) {
    responderError(res, e, next);
  }
});

// Cierre contable: hasta qué fecha los documentos no se pueden tocar.
solicitudesRouter.get('/cierre/actual', async (req, res) => {
  res.json({ cierreHasta: await cierreHasta() });
});

solicitudesRouter.put('/cierre/actual', requiereAdmin, async (req, res) => {
  const f = req.body?.cierreHasta ?? null;
  if (f !== null && !(typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f))) return res.status(400).json({ error: 'Fecha inválida.' });
  const antes = await cierreHasta();
  await db.prepare('UPDATE configuracion SET cierre_hasta = ? WHERE id = 1').run(f);
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: f ? 'Cerró el período' : 'Reabrió todos los períodos',
    entidad: 'Sistema',
    entidadId: 'cierre-contable',
    resumen: `Cierre contable: ${antes ?? 'sin cierre'} → ${f ?? 'sin cierre'}`,
  });
  res.json({ cierreHasta: f });
});
