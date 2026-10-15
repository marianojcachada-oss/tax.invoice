import { Router } from 'express';
import { db } from '../db.js';
import { alQuedarPagas } from '../postPago.js';
import { generarId, aCentavos, aDolares, registrarAuditoria } from '../utils.js';

export const pagosRouter = Router();

async function serializarPago(row, ejecutor = db) {
  const aplicaciones = (await ejecutor.prepare('SELECT factura_id, monto FROM pago_aplicaciones WHERE pago_id = ?').all(row.id)).map(
    (a) => ({ facturaId: a.factura_id, monto: aDolares(a.monto) })
  );
  return {
    id: row.id,
    numero: row.numero,
    clienteId: row.cliente_id,
    fecha: row.fecha,
    monto: aDolares(row.monto),
    metodo: row.metodo,
    referencia: row.referencia ?? undefined,
    cuentaId: row.cuenta_id ?? undefined,
    aplicaciones,
    editado: !!row.editado,
  };
}

async function recalcularEstadoFactura(tx, facturaId) {
  const f = await tx.prepare('SELECT * FROM facturas WHERE id = ?').get(facturaId);
  const estado = f.monto_pagado >= f.monto ? 'pagada' : f.monto_pagado > 0 ? 'parcial' : 'pendiente';
  await tx.prepare('UPDATE facturas SET estado = ? WHERE id = ?').run(estado, facturaId);
}

pagosRouter.get('/', async (req, res) => {
  const filas = await db.prepare('SELECT * FROM pagos ORDER BY fecha DESC').all();
  res.json(await Promise.all(filas.map((f) => serializarPago(f))));
});

pagosRouter.post('/', async (req, res) => {
  const b = req.body;
  const cliente = await db.prepare('SELECT * FROM clientes WHERE id = ?').get(b.clienteId);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });
  if (!Array.isArray(b.aplicaciones) || b.aplicaciones.length === 0) {
    return res.status(400).json({ error: 'Hay que aplicar el pago a al menos una factura.' });
  }

  // Validación server-side: nunca confiar solo en lo que valida el
  // navegador. Ninguna aplicación puede superar el saldo pendiente real
  // de esa factura en este momento.
  for (const a of b.aplicaciones) {
    const f = await db.prepare('SELECT * FROM facturas WHERE id = ?').get(a.facturaId);
    if (!f) return res.status(404).json({ error: `Factura ${a.facturaId} no encontrada.` });
    const saldoPendiente = aDolares(f.monto - f.monto_pagado);
    if (a.monto > saldoPendiente + 0.01) {
      return res.status(400).json({ error: `No se puede aplicar más de $${saldoPendiente} a la factura #${f.numero}.` });
    }
  }

  const montoTotal = Math.round(b.aplicaciones.reduce((acc, a) => acc + a.monto, 0) * 100) / 100;
  const numero = ((await db.prepare('SELECT MAX(numero) as n FROM pagos').get()).n ?? 0) + 1;
  const id = generarId('pago');
  const hoy = new Date().toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO pagos (id, numero, cliente_id, fecha, monto, metodo, referencia, cuenta_id, editado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, false)`
      )
      .run(id, numero, b.clienteId, hoy, aCentavos(montoTotal), b.metodo, b.referencia || null, b.cuentaId || null);

    for (const a of b.aplicaciones) {
      await tx.prepare('INSERT INTO pago_aplicaciones (pago_id, factura_id, monto) VALUES (?, ?, ?)').run(id, a.facturaId, aCentavos(a.monto));
      await tx.prepare('UPDATE facturas SET monto_pagado = monto_pagado + ? WHERE id = ?').run(aCentavos(a.monto), a.facturaId);
      await recalcularEstadoFactura(tx, a.facturaId);
    }
  });

  const detalleFacturas = (
    await Promise.all(
      b.aplicaciones.map(async (a) => {
        const f = await db.prepare('SELECT numero FROM facturas WHERE id = ?').get(a.facturaId);
        return `#${f?.numero ?? '?'} ($${a.monto})`;
      })
    )
  ).join(', ');
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Registró pago',
    entidad: 'Pago',
    entidadId: id,
    resumen: `Pago #${numero} de $${montoTotal} por ${b.metodo}${b.referencia ? ` (ref. ${b.referencia})` : ''} a nombre de ${cliente.nombre}, aplicado a factura(s) ${detalleFacturas}`,
  });

  await alQuedarPagas(b.aplicaciones.map((a) => a.facturaId), req.usuario.nombre);

  const creado = await db.prepare('SELECT * FROM pagos WHERE id = ?').get(id);
  res.status(201).json(await serializarPago(creado));
});

pagosRouter.patch('/:id', async (req, res) => {
  const pagoActual = await db.prepare('SELECT * FROM pagos WHERE id = ?').get(req.params.id);
  if (!pagoActual) return res.status(404).json({ error: 'Pago no encontrado.' });

  const b = req.body;
  const aplicacionesViejas = await db.prepare('SELECT factura_id, monto FROM pago_aplicaciones WHERE pago_id = ?').all(req.params.id);

  await db.transaction(async (tx) => {
    if (Array.isArray(b.aplicaciones)) {
      // Revertir lo viejo
      for (const a of aplicacionesViejas) {
        await tx.prepare('UPDATE facturas SET monto_pagado = monto_pagado - ? WHERE id = ?').run(a.monto, a.factura_id);
      }
      await tx.prepare('DELETE FROM pago_aplicaciones WHERE pago_id = ?').run(req.params.id);

      // Aplicar lo nuevo
      for (const a of b.aplicaciones) {
        await tx.prepare('INSERT INTO pago_aplicaciones (pago_id, factura_id, monto) VALUES (?, ?, ?)').run(req.params.id, a.facturaId, aCentavos(a.monto));
        await tx.prepare('UPDATE facturas SET monto_pagado = monto_pagado + ? WHERE id = ?').run(aCentavos(a.monto), a.facturaId);
      }

      // Recalcular estado de TODAS las facturas tocadas (viejas + nuevas)
      const idsTocados = new Set([...aplicacionesViejas.map((a) => a.factura_id), ...b.aplicaciones.map((a) => a.facturaId)]);
      for (const facturaId of idsTocados) await recalcularEstadoFactura(tx, facturaId);

      const nuevoMonto = Math.round(b.aplicaciones.reduce((acc, a) => acc + a.monto, 0) * 100) / 100;
      await tx.prepare('UPDATE pagos SET monto = ? WHERE id = ?').run(aCentavos(nuevoMonto), req.params.id);
    }

    await tx.prepare('UPDATE pagos SET metodo = ?, referencia = ?, cuenta_id = ?, editado = true WHERE id = ?').run(
      b.metodo ?? pagoActual.metodo,
      b.referencia !== undefined ? b.referencia : pagoActual.referencia,
      b.cuentaId !== undefined ? b.cuentaId : pagoActual.cuenta_id,
      req.params.id
    );
  });

  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Editó pago',
    entidad: 'Pago',
    entidadId: req.params.id,
    resumen: `Se corrigió el pago #${pagoActual.numero}`,
  });

  const actualizado = await db.prepare('SELECT * FROM pagos WHERE id = ?').get(req.params.id);
  res.json(await serializarPago(actualizado));
});
