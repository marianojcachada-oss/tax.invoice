import { Router } from 'express';
import { db } from '../db.js';
import { generarId, aCentavos, aDolares, registrarAuditoria } from '../utils.js';
import { requiereAdmin } from '../auth.js';

export const catalogoFeesRouter = Router();

// Catálogo estándar que pidió el usuario — se carga solo la primera vez
// que se abre "Configuración -> Catálogo de fees" (si la tabla está
// vacía), para no tener que cargar 26 ítems a mano. Los que tienen un
// rango de precio (no un valor fijo) quedan en $0 a propósito — el
// usuario dijo explícitamente que esos se escriben a mano en cada
// factura, no se auto-completan.
const CATALOGO_ESTANDAR = [
  ['1090PB', 'Pago de base / cuota semanal', 145],
  ['1060RA', 'Reactivación', 10],
  ['1060RI', 'Reinscripción', 20],
  ['1060CA', 'Ceder el app a un tercero', 500],
  ['1060VNR', 'Trabajar en vehículo distinto al que está en sistema', 100],
  ['1060TA', 'Trabajar acompañado', 100],
  ['1060VS', 'Vehículo sucio', 20],
  ['1060PNR', 'Trabajar con una placa distinta a la registrada en el sistema', 50],
  ['1060MNCFA', 'Dar servicios a clientes por fuera de la app', 250],
  ['1060NI', 'Negarse a inspección', 100],
  ['1060DS', 'Demorar o rechazar hacer un servicio después de aceptarlo', 20],
  ['1060RFM', 'Revisión por falla mecánica', 10],
  ['1060CI', 'Cobros indebidos', 50],
  ['1060RC', 'Reclamos de cliente (motivos varios) — rango $20 a $50, cargar a mano', 0],
  ['1060W', 'Warning', 10],
  ['1060R20', 'Retirarse del 20 sin autorización / cerrar un servicio para no realizarlo', 50],
  ['1060CE', 'Recoger cliente distinto al de la información', 20],
  ['1060RE', 'Re-entrenamiento', 20],
  ['1040CB', 'Irrespetar a la Base o a la Administración', 50],
  ['1060NRC', 'No responder copias', 10],
  ['1060D5C', 'Dejar 10-5 a un compañero', 20],
  ['1060RP', 'Reparación de daño pendiente', 20],
  ['1060MUA', 'Mal uso de aplicación — rango $20 a $30, cargar a mano', 0],
  ['1060NSN', 'Dejar cliente 10-5 por no cargar silla para niños o boosters', 20],
  ['1060ED', 'Error de dirección (salir a otro 10-20 o a la dirección del destino anterior)', 10],
  ['1090ACT', 'Asistencia con TaxiCaller (fuera de la oficina)', 5],
  ['1090ADA', 'Asistencia con descarga de aplicaciones', 10],
];

async function asegurarCatalogoEstandar() {
  const hayAlguno = (await db.prepare('SELECT COUNT(*) as n FROM catalogo_fees').get()).n;
  if (Number(hayAlguno) > 0) return;
  let orden = 0;
  for (const [codigo, etiqueta, monto] of CATALOGO_ESTANDAR) {
    orden += 1;
    await db
      .prepare('INSERT INTO catalogo_fees (id, codigo, etiqueta, monto, orden) VALUES (?, ?, ?, ?, ?)')
      .run(generarId('fee'), codigo, etiqueta, aCentavos(monto), orden);
  }
}

function serializar(row) {
  return { id: row.id, codigo: row.codigo, etiqueta: row.etiqueta, monto: aDolares(row.monto), orden: row.orden, seArrastra: row.se_arrastra !== false, visibleEnFicha: row.visible_en_ficha === true };
}

async function asegurarDeudaRecuperada() {
  const hay = await db.prepare(`SELECT id FROM catalogo_fees WHERE codigo = '1060DR'`).get();
  if (hay) return;
  const orden = ((await db.prepare('SELECT MAX(orden) as n FROM catalogo_fees').get()).n ?? 0) + 1;
  await db
    .prepare('INSERT INTO catalogo_fees (id, codigo, etiqueta, monto, orden) VALUES (?, ?, ?, ?, ?)')
    .run(generarId('fee'), '1060DR', 'Deuda Recuperada (monto variable)', 0, orden);
}

catalogoFeesRouter.get('/', async (req, res) => {
  await asegurarCatalogoEstandar();
  await asegurarDeudaRecuperada();
  const filas = await db.prepare('SELECT * FROM catalogo_fees ORDER BY orden, codigo').all();
  res.json(filas.map(serializar));
});

catalogoFeesRouter.post('/', requiereAdmin, async (req, res) => {
  const b = req.body;
  if (!b.codigo?.trim() || !b.etiqueta?.trim()) {
    return res.status(400).json({ error: 'Código y etiqueta son obligatorios.' });
  }
  const orden = (await db.prepare('SELECT COALESCE(MAX(orden), 0) as n FROM catalogo_fees').get()).n;
  const id = generarId('fee');
  await db
    .prepare('INSERT INTO catalogo_fees (id, codigo, etiqueta, monto, orden) VALUES (?, ?, ?, ?, ?)')
    .run(id, b.codigo.trim().toUpperCase(), b.etiqueta.trim(), aCentavos(b.monto || 0), Number(orden) + 1);
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Agregó ítem al catálogo de fees',
    entidad: 'CatalogoFees',
    entidadId: id,
    resumen: `${b.codigo.trim().toUpperCase()} — ${b.etiqueta.trim()} ($${b.monto || 0})`,
  });
  const creado = await db.prepare('SELECT * FROM catalogo_fees WHERE id = ?').get(id);
  res.status(201).json(serializar(creado));
});

catalogoFeesRouter.patch('/:id', requiereAdmin, async (req, res) => {
  const actual = await db.prepare('SELECT * FROM catalogo_fees WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'No encontrado.' });
  const b = req.body;
  await db
    .prepare('UPDATE catalogo_fees SET codigo = ?, etiqueta = ?, monto = ?, se_arrastra = ?, visible_en_ficha = ? WHERE id = ?')
    .run(
      (b.codigo ?? actual.codigo).trim().toUpperCase(),
      (b.etiqueta ?? actual.etiqueta).trim(),
      b.monto !== undefined ? aCentavos(b.monto) : actual.monto,
      b.seArrastra !== undefined ? !!b.seArrastra : actual.se_arrastra,
      b.visibleEnFicha !== undefined ? !!b.visibleEnFicha : actual.visible_en_ficha,
      req.params.id
    );
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Editó ítem del catálogo de fees',
    entidad: 'CatalogoFees',
    entidadId: req.params.id,
    resumen: `Se actualizó ${actual.codigo}${b.visibleEnFicha !== undefined ? (b.visibleEnFicha ? ' (ahora aparece en la ficha del cliente)' : ' (ya no aparece en la ficha del cliente)') : ''}${b.seArrastra !== undefined ? (b.seArrastra ? ' (ahora se arrastra cada semana)' : ' (ahora es multa: se cobra una sola vez)') : ''}`,
  });
  const actualizado = await db.prepare('SELECT * FROM catalogo_fees WHERE id = ?').get(req.params.id);
  res.json(serializar(actualizado));
});

catalogoFeesRouter.delete('/:id', requiereAdmin, async (req, res) => {
  const actual = await db.prepare('SELECT * FROM catalogo_fees WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'No encontrado.' });
  await db.prepare('DELETE FROM catalogo_fees WHERE id = ?').run(req.params.id);
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Eliminó ítem del catálogo de fees',
    entidad: 'CatalogoFees',
    entidadId: req.params.id,
    resumen: `Se eliminó ${actual.codigo} — ${actual.etiqueta}`,
  });
  res.json({ ok: true });
});
