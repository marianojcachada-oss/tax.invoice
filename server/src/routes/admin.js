import { Router } from 'express';
import { db } from '../db.js';
import { registrarAuditoria } from '../utils.js';
import { requiereAdmin } from '../auth.js';

export const adminRouter = Router();

// Borra TODOS los datos de negocio (clientes, facturas, pagos, notas de
// crédito, reembolsos, gastos, cuentas, transferencias, proveedores,
// bills, documentos, y el propio log de auditoría) para poder migrar de
// cero. A propósito NO se borran los usuarios (para no quedar afuera de
// la propia app) ni la configuración (nombre de la empresa, plantilla de
// recordatorios, etc.) — son ajustes, no datos a migrar.
adminRouter.post('/borrar-todo', requiereAdmin, async (req, res) => {
  if (req.body.confirmacion !== 'BORRAR TODO') {
    return res.status(400).json({ error: 'Falta escribir la confirmación exacta.' });
  }

  await db
    .prepare(
      `TRUNCATE TABLE
        documentos, bill_pago_aplicaciones, bill_pagos, bills, proveedores,
        pagos_email, transferencias, cuentas, gastos, reembolsos, nota_credito_facturas,
        notas_credito, pago_aplicaciones, pagos, facturas, clientes, auditoria
       RESTART IDENTITY CASCADE`
    )
    .run();

  // Se registra DESPUÉS del borrado (auditoria también se vació), como
  // primera entrada del historial nuevo — así queda constancia de cuándo
  // y quién hizo el borrado, aunque el resto del historial viejo ya no
  // esté.
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Borró todos los datos',
    entidad: 'Sistema',
    entidadId: 'borrar-todo',
    resumen: `${req.usuario.nombre} borró todos los datos de negocio para empezar una migración limpia.`,
  });

  res.json({ ok: true });
});
