import { Router } from 'express';
import { db } from '../db.js';
import { generarId, aCentavos, aDolares, registrarAuditoria } from '../utils.js';
import { alQuedarPagas } from '../postPago.js';
import { requiereAdmin } from '../auth.js';

export const notasCreditoRouter = Router();

async function serializar(row) {
  const facturasAplicadas = (await db.prepare('SELECT factura_id FROM nota_credito_facturas WHERE nota_id = ?').all(row.id)).map(
    (r) => r.factura_id
  );
  let origenFacturaNumero;
  let origenClienteId;
  if (row.origen_factura_id) {
    const o = await db.prepare('SELECT numero, cliente_id FROM facturas WHERE id = ?').get(row.origen_factura_id);
    origenFacturaNumero = o?.numero;
    origenClienteId = o?.cliente_id;
  }
  return {
    origenFacturaId: row.origen_factura_id ?? undefined,
    origenFacturaNumero,
    origenClienteId,
    id: row.id,
    numero: row.numero,
    clienteId: row.cliente_id,
    fecha: row.fecha,
    monto: aDolares(row.monto),
    montoAplicado: aDolares(row.monto_aplicado),
    motivo: row.motivo,
    aplicada: !!row.aplicada,
    facturasAplicadas,
  };
}

notasCreditoRouter.get('/', async (req, res) => {
  // Consultas en bloque (antes una o dos por cada nota: con miles de notas agotaba la memoria).
  const filas = await db.prepare('SELECT * FROM notas_credito ORDER BY fecha DESC').all();
  const aplicadas = new Map();
  for (const r of await db.prepare('SELECT nota_id, factura_id FROM nota_credito_facturas').all()) {
    if (!aplicadas.has(r.nota_id)) aplicadas.set(r.nota_id, []);
    aplicadas.get(r.nota_id).push(r.factura_id);
  }
  const origenes = new Map();
  for (const o of await db.prepare('SELECT id, numero, cliente_id FROM facturas WHERE id IN (SELECT origen_factura_id FROM notas_credito WHERE origen_factura_id IS NOT NULL)').all()) origenes.set(o.id, o);
  res.json(
    filas.map((row) => {
      const o = row.origen_factura_id ? origenes.get(row.origen_factura_id) : undefined;
      return {
        origenFacturaId: row.origen_factura_id ?? undefined,
        origenFacturaNumero: o?.numero,
        origenClienteId: o?.cliente_id,
        id: row.id,
        numero: row.numero,
        clienteId: row.cliente_id,
        fecha: row.fecha,
        monto: aDolares(row.monto),
        montoAplicado: aDolares(row.monto_aplicado),
        motivo: row.motivo,
        aplicada: !!row.aplicada,
        facturasAplicadas: aplicadas.get(row.id) ?? [],
      };
    })
  );
});

notasCreditoRouter.post('/', async (req, res) => {
  const b = req.body;
  const numero = ((await db.prepare('SELECT MAX(numero) as n FROM notas_credito').get()).n ?? 5000) + 1;
  const id = generarId('nc');
  await db
    .prepare(
      `INSERT INTO notas_credito (id, numero, cliente_id, fecha, monto, monto_aplicado, motivo, aplicada)
     VALUES (?, ?, ?, ?, ?, 0, ?, false)`
    )
    .run(id, numero, b.clienteId, b.fecha, aCentavos(b.monto), b.motivo || 'Sin especificar');

  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Creó nota de crédito',
    entidad: 'NotaCredito',
    entidadId: id,
    resumen: `Nota #${numero} de $${b.monto} · ${b.motivo}`,
  });
  const creada = await db.prepare('SELECT * FROM notas_credito WHERE id = ?').get(id);
  res.status(201).json(await serializar(creada));
});

notasCreditoRouter.patch('/:id', requiereAdmin, async (req, res) => {
  const actual = await db.prepare('SELECT * FROM notas_credito WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Nota de crédito no encontrada.' });

  const b = req.body;
  const nuevoMonto = b.monto !== undefined ? aCentavos(b.monto) : actual.monto;
  if (nuevoMonto < actual.monto_aplicado) {
    return res.status(400).json({ error: `No se puede bajar el monto por debajo de lo que ya se aplicó ($${aDolares(actual.monto_aplicado)}).` });
  }

  const cambios = [];
  if (b.motivo !== undefined && b.motivo !== actual.motivo) cambios.push({ campo: 'Motivo', anterior: actual.motivo, nuevo: b.motivo });
  if (nuevoMonto !== actual.monto) cambios.push({ campo: 'Monto', anterior: String(aDolares(actual.monto)), nuevo: String(b.monto) });

  await db
    .prepare('UPDATE notas_credito SET motivo = ?, monto = ?, aplicada = ? WHERE id = ?')
    .run(b.motivo ?? actual.motivo, nuevoMonto, nuevoMonto <= actual.monto_aplicado, req.params.id);

  if (cambios.length > 0) {
    await registrarAuditoria({
      usuario: req.usuario.nombre,
      accion: 'Editó nota de crédito',
      entidad: 'NotaCredito',
      entidadId: req.params.id,
      resumen: `Se corrigió la nota #${actual.numero}`,
      cambios,
    });
  }
  const actualizada = await db.prepare('SELECT * FROM notas_credito WHERE id = ?').get(req.params.id);
  res.json(await serializar(actualizada));
});

notasCreditoRouter.post('/:id/aplicar', async (req, res) => {
  const nota = await db.prepare('SELECT * FROM notas_credito WHERE id = ?').get(req.params.id);
  if (!nota) return res.status(404).json({ error: 'Nota de crédito no encontrada.' });

  const disponible = nota.monto - nota.monto_aplicado;
  const facturaIds = req.body.facturaIds || [];
  if (disponible <= 0 || facturaIds.length === 0) {
    return res.status(400).json({ error: 'No hay saldo disponible o no se eligió ninguna factura.' });
  }

  // Plan de reparto calculado antes de tocar nada (mismo criterio que en
  // el frontend): evita depender de una variable mutable compartida.
  let restante = disponible;
  const plan = [];
  for (const facturaId of facturaIds) {
    if (restante <= 0) break;
    const f = await db.prepare('SELECT * FROM facturas WHERE id = ?').get(facturaId);
    if (!f) continue;
    const debe = Math.max(0, f.monto - f.monto_pagado);
    if (debe <= 0) continue;
    const aplicar = Math.min(debe, restante);
    plan.push({ facturaId, aplicar });
    restante -= aplicar;
  }
  const aplicadoTotal = disponible - restante;
  if (aplicadoTotal <= 0) return res.status(400).json({ error: 'Ninguna de esas facturas tiene saldo pendiente.' });

  await db.transaction(async (tx) => {
    for (const { facturaId, aplicar } of plan) {
      await tx.prepare('UPDATE facturas SET monto_pagado = monto_pagado + ? WHERE id = ?').run(aplicar, facturaId);
      const f = await tx.prepare('SELECT * FROM facturas WHERE id = ?').get(facturaId);
      const estado = f.monto_pagado >= f.monto ? 'pagada' : f.monto_pagado > 0 ? 'parcial' : f.estado;
      await tx.prepare('UPDATE facturas SET estado = ? WHERE id = ?').run(estado, facturaId);
      await tx.prepare('INSERT INTO nota_credito_facturas (nota_id, factura_id) VALUES (?, ?)').run(req.params.id, facturaId);
    }
    const nuevoAplicado = nota.monto_aplicado + aplicadoTotal;
    await tx
      .prepare('UPDATE notas_credito SET monto_aplicado = ?, aplicada = ? WHERE id = ?')
      .run(nuevoAplicado, nuevoAplicado >= nota.monto, req.params.id);
  });

  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Aplicó nota de crédito',
    entidad: 'NotaCredito',
    entidadId: req.params.id,
    resumen: `Nota #${nota.numero} aplicó $${aDolares(aplicadoTotal)} contra ${plan.length} factura(s)`,
  });

  await alQuedarPagas(plan.map((x) => x.facturaId), req.usuario.nombre);

  const actualizada = await db.prepare('SELECT * FROM notas_credito WHERE id = ?').get(req.params.id);
  res.json(await serializar(actualizada));
});
