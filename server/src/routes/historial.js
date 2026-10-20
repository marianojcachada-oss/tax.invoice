import { Router } from 'express';
import { db } from '../db.js';
import { registrarAuditoria } from '../utils.js';
import { requiereAdmin } from '../auth.js';
import { importarLote } from '../migracion/historialQB.js';

export const historialRouter = Router();

const TIPOS = new Set(['Invoice', 'Payment', 'Deposit', 'Credit Memo', 'Refund', 'Expense', 'Check']);
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Importa (por lotes de clientes) el reporte "Transaction List by Customer" de QuickBooks.
// El front corta el archivo en lotes chicos y llama a esta ruta varias veces; un cliente
// que ya tiene su historial importado se omite, así que repetir un lote no duplica nada.
historialRouter.post('/importar-historial', requiereAdmin, async (req, res) => {
  const { bloques, desde = null } = req.body ?? {};
  if (!Array.isArray(bloques) || bloques.length === 0) return res.status(400).json({ error: 'No se recibió ningún bloque para importar.' });
  if (desde !== null && !esFecha(desde)) return res.status(400).json({ error: 'La fecha "desde" es inválida.' });
  for (const b of bloques) {
    if (!b?.nombreQb || !Array.isArray(b.transacciones)) return res.status(400).json({ error: 'Hay un bloque sin nombre de cliente o sin transacciones.' });
    for (const t of b.transacciones) {
      if (!TIPOS.has(t.tipo) || !esFecha(t.fecha) || !Number.isFinite(Number(t.monto))) {
        return res.status(400).json({ error: `Movimiento inválido en "${b.nombreQb}": ${JSON.stringify(t).slice(0, 120)}` });
      }
    }
  }
  const r = await importarLote(db, { bloques, desde, usuario: req.usuario.nombre });
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Importó historial de QuickBooks',
    entidad: 'Sistema',
    entidadId: 'importar-historial',
    resumen: `Lote: ${r.clientes} clientes, ${r.facturas} facturas, ${r.pagos} pagos, ${r.notasCredito} notas de crédito, ${r.reembolsos} reembolsos${desde ? ` (resumido antes de ${desde})` : ''}. ${r.yaImportados.length} ya importados, ${r.sinCliente.length} sin cliente.`,
  });
  res.json(r);
});
