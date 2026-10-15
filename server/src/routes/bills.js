import { Router } from 'express';
import { db } from '../db.js';
import { generarId, aCentavos, aDolares, registrarAuditoria } from '../utils.js';

export const billsRouter = Router();

function serializarBill(row) {
  return {
    id: row.id,
    numero: row.numero,
    proveedorId: row.proveedor_id,
    fecha: row.fecha,
    fechaVencimiento: row.fecha_vencimiento,
    concepto: row.concepto,
    monto: aDolares(row.monto),
    montoPagado: aDolares(row.monto_pagado),
    estado: row.estado,
  };
}

async function serializarBillPago(row) {
  const aplicaciones = (await db.prepare('SELECT bill_id, monto FROM bill_pago_aplicaciones WHERE bill_pago_id = ?').all(row.id)).map(
    (a) => ({ billId: a.bill_id, monto: aDolares(a.monto) })
  );
  return {
    id: row.id,
    proveedorId: row.proveedor_id,
    fecha: row.fecha,
    monto: aDolares(row.monto),
    metodo: row.metodo,
    cuentaId: row.cuenta_id ?? undefined,
    aplicaciones,
  };
}

billsRouter.get('/', async (req, res) => {
  const filas = await db.prepare('SELECT * FROM bills ORDER BY fecha_vencimiento DESC').all();
  res.json(filas.map(serializarBill));
});

billsRouter.post('/', async (req, res) => {
  const b = req.body;
  const numero = ((await db.prepare('SELECT MAX(numero) as n FROM bills').get()).n ?? 9000) + 1;
  const id = generarId('bill');
  await db
    .prepare(
      `INSERT INTO bills (id, numero, proveedor_id, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pendiente')`
    )
    .run(id, numero, b.proveedorId, b.fecha, b.fechaVencimiento, b.concepto, aCentavos(b.monto));
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Creó bill', entidad: 'Bill', entidadId: id, resumen: `Bill #${numero} · ${b.concepto} · $${b.monto}` });
  const creada = await db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
  res.status(201).json(serializarBill(creada));
});

billsRouter.get('/pagos', async (req, res) => {
  const filas = await db.prepare('SELECT * FROM bill_pagos ORDER BY fecha DESC').all();
  res.json(await Promise.all(filas.map(serializarBillPago)));
});

billsRouter.post('/pagos', async (req, res) => {
  const b = req.body;
  const id = generarId('billpago');
  const montoTotal = Math.round(b.aplicaciones.reduce((acc, a) => acc + a.monto, 0) * 100) / 100;

  await db.transaction(async (tx) => {
    await tx
      .prepare('INSERT INTO bill_pagos (id, proveedor_id, fecha, monto, metodo, cuenta_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, b.proveedorId, b.fecha, aCentavos(montoTotal), b.metodo, b.cuentaId || null);
    for (const a of b.aplicaciones) {
      await tx.prepare('INSERT INTO bill_pago_aplicaciones (bill_pago_id, bill_id, monto) VALUES (?, ?, ?)').run(id, a.billId, aCentavos(a.monto));
      await tx.prepare('UPDATE bills SET monto_pagado = monto_pagado + ? WHERE id = ?').run(aCentavos(a.monto), a.billId);
      const bill = await tx.prepare('SELECT * FROM bills WHERE id = ?').get(a.billId);
      const estado = bill.monto_pagado >= bill.monto ? 'pagada' : bill.monto_pagado > 0 ? 'parcial' : bill.estado;
      await tx.prepare('UPDATE bills SET estado = ? WHERE id = ?').run(estado, a.billId);
    }
  });

  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Pagó bill(s)', entidad: 'BillPago', entidadId: id, resumen: `Pago de $${montoTotal} por ${b.metodo}` });
  const creado = await db.prepare('SELECT * FROM bill_pagos WHERE id = ?').get(id);
  res.status(201).json(await serializarBillPago(creado));
});
