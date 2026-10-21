import { db } from './db.js';
import { generarId, registrarAuditoria } from './utils.js';
import { notificarFacturasPagadas } from './facturaMail.js';

// Cuando una factura 1090DR (Deuda Recuperada) queda paga, la unidad que
// recuperó ese dinero hizo su parte: se genera un saldo a favor 1090SAF por
// el mismo monto para la unidad beneficiaria, ligado a la factura de origen.
// Es idempotente: recupero_nc_id evita crear dos veces la nota.
export async function generarSaldoAFavorPorRecupero(facturaIds, usuario) {
  for (const facturaId of [...new Set(facturaIds)]) {
    const f = await db.prepare('SELECT * FROM facturas WHERE id = ?').get(facturaId);
    if (!f || f.codigo !== '1090DR' || !f.beneficiario_id || f.recupero_nc_id) continue;
    if (f.monto_pagado < f.monto) continue;
    const origen = await db.prepare('SELECT codigo, numero FROM clientes WHERE id = ?').get(f.cliente_id);
    const unidad = origen ? origen.codigo : '';
    const motivo = `1090SAF · Saldo a favor por dinero recuperado por ${unidad} (factura #${f.numero})`;
    const notaId = generarId('nc');
    await db.transaction(async (tx) => {
      const numero = ((await tx.prepare('SELECT MAX(numero) as n FROM notas_credito').get()).n ?? 5000) + 1;
      await tx
        .prepare(
          `INSERT INTO notas_credito (id, numero, cliente_id, fecha, monto, monto_aplicado, motivo, aplicada, origen_factura_id)
           VALUES (?, ?, ?, ?, ?, 0, ?, false, ?)`
        )
        .run(notaId, numero, f.beneficiario_id, new Date().toISOString().slice(0, 10), f.monto, motivo, f.id);
      await tx.prepare('UPDATE facturas SET recupero_nc_id = ? WHERE id = ?').run(notaId, f.id);
    });
    await registrarAuditoria({
      usuario,
      accion: 'Generó saldo a favor por recupero',
      entidad: 'NotaCredito',
      entidadId: notaId,
      resumen: motivo,
    });
  }
}

export async function alQuedarPagas(facturaIds, usuario) {
  try {
    await generarSaldoAFavorPorRecupero(facturaIds, usuario);
  } catch (e) {
    console.error('Recupero:', e);
  }
  // el mail sale en segundo plano; el saldo a favor ya quedó guardado
  notificarFacturasPagadas(facturaIds, usuario).catch(console.error);
}
