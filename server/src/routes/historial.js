import { Router } from 'express';
import { db } from '../db.js';
import { generarId, aCentavos, registrarAuditoria } from '../utils.js';

export const historialRouter = Router();

// El reporte "Transaction List by Customer" de QuickBooks no dice
// explícitamente qué pago corresponde a qué factura — es un librito
// cronológico por cliente. Se reconstruye con la misma regla que
// cualquier sistema contable usaría: cada pago se aplica primero a la
// factura más vieja sin cobrar (FIFO), en el mismo orden en que
// aparecen los movimientos en el reporte. Con el patrón real de estos
// datos (los drivers pagan el mismo día que se les generó la factura)
// esto acierta casi siempre — pero para clientes con historial más
// irregular es una reconstrucción razonable, no una verificación
// exacta factura por factura.

function metodoDesdeCuenta(cuenta) {
  if (!cuenta) return 'efectivo';
  if (cuenta.includes('Bank of America')) return 'zelle';
  if (cuenta.includes('Undeposited Funds')) return 'kotapay';
  return 'efectivo';
}

historialRouter.post('/importar-historial', async (req, res) => {
  const bloques = req.body.bloques;
  if (!Array.isArray(bloques) || bloques.length === 0) {
    return res.status(400).json({ error: 'No se recibió ningún bloque para importar.' });
  }

  let numeroFactura = (await db.prepare('SELECT MAX(numero) as n FROM facturas').get()).n ?? 40000;
  let numeroPago = (await db.prepare('SELECT MAX(numero) as n FROM pagos').get()).n ?? 0;
  let numeroNota = (await db.prepare('SELECT MAX(numero) as n FROM notas_credito').get()).n ?? 5000;

  let clientesConMovimientos = 0;
  let facturasCreadas = 0;
  let pagosCreados = 0;
  let excedentesGenerados = 0;
  const clientesSinMatch = [];

  await db.transaction(async (tx) => {
    for (const bloque of bloques) {
      const cliente = await tx.prepare('SELECT * FROM clientes WHERE codigo = ?').get(bloque.codigo);
      if (!cliente) {
        clientesSinMatch.push(bloque.nombre);
        continue;
      }
      clientesConMovimientos += 1;

      // Cola de facturas abiertas de ESTE cliente, en orden — se arma en
      // memoria a medida que se van procesando las transacciones, no hace
      // falta leerla de la base porque son todas nuevas en este mismo lote.
      const abiertas = [];

      for (const t of bloque.transacciones) {
        if (t.tipo === 'Invoice') {
          const facturaId = generarId('fac-historico');
          await tx
            .prepare(
              `INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado, creado_por)
               VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0, 'pendiente', ?)`
            )
            .run(facturaId, ++numeroFactura, cliente.id, t.fecha, t.fecha, 'Migración histórica QuickBooks', aCentavos(t.monto), req.usuario.nombre);
          facturasCreadas += 1;
          abiertas.push({ facturaId, restanteCentavos: aCentavos(t.monto) });
        } else if (t.tipo === 'Payment') {
          let restantePagoCentavos = aCentavos(t.monto);
          const aplicaciones = [];
          while (restantePagoCentavos > 0 && abiertas.length > 0) {
            const factura = abiertas[0];
            const aplicar = Math.min(factura.restanteCentavos, restantePagoCentavos);
            aplicaciones.push({ facturaId: factura.facturaId, centavos: aplicar });
            factura.restanteCentavos -= aplicar;
            restantePagoCentavos -= aplicar;
            if (factura.restanteCentavos <= 0) abiertas.shift();
          }

          if (aplicaciones.length > 0) {
            const pagoId = generarId('pago-historico');
            const montoTotalAplicado = aplicaciones.reduce((a, x) => a + x.centavos, 0);
            await tx
              .prepare(
                `INSERT INTO pagos (id, numero, cliente_id, fecha, monto, metodo, referencia, cuenta_id, editado)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NULL, false)`
              )
              .run(pagoId, ++numeroPago, cliente.id, t.fecha, montoTotalAplicado, metodoDesdeCuenta(t.cuenta), 'Migración QuickBooks');
            for (const a of aplicaciones) {
              await tx.prepare('INSERT INTO pago_aplicaciones (pago_id, factura_id, monto) VALUES (?, ?, ?)').run(pagoId, a.facturaId, a.centavos);
              await tx.prepare('UPDATE facturas SET monto_pagado = monto_pagado + ? WHERE id = ?').run(a.centavos, a.facturaId);
            }
            pagosCreados += 1;
          }

          // Si sobró pago después de cubrir todas las facturas abiertas de
          // ese momento, se guarda como nota de crédito (mismo criterio que
          // ya usa la app para un pago que excede lo que debía la factura).
          if (restantePagoCentavos > 0) {
            await tx
              .prepare(
                `INSERT INTO notas_credito (id, numero, cliente_id, fecha, monto, monto_aplicado, motivo, aplicada)
                 VALUES (?, ?, ?, ?, ?, 0, ?, false)`
              )
              .run(generarId('nc-historico'), ++numeroNota, cliente.id, t.fecha, restantePagoCentavos, 'Excedente — migración histórica QuickBooks');
            excedentesGenerados += 1;
          }
        }
      }

      // Recalcular el estado final de cada factura tocada (pagada/parcial/pendiente).
      const facturasDelCliente = await tx.prepare('SELECT id, monto, monto_pagado FROM facturas WHERE cliente_id = ? AND semana = 0').all(cliente.id);
      for (const f of facturasDelCliente) {
        const estado = f.monto_pagado >= f.monto ? 'pagada' : f.monto_pagado > 0 ? 'parcial' : 'pendiente';
        await tx.prepare('UPDATE facturas SET estado = ? WHERE id = ?').run(estado, f.id);
      }
    }
  });

  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Importó historial de QuickBooks',
    entidad: 'Sistema',
    entidadId: 'importar-historial',
    resumen: `Se importaron ${facturasCreadas} facturas y ${pagosCreados} pagos históricos (${clientesConMovimientos} clientes, ${excedentesGenerados} excedentes como nota de crédito). ${clientesSinMatch.length} bloques sin cliente que coincida.`,
  });

  res.json({ clientesConMovimientos, facturasCreadas, pagosCreados, excedentesGenerados, clientesSinMatch });
});
