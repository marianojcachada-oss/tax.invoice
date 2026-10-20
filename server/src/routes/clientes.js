import { Router } from 'express';
import { db } from '../db.js';
import { generarId, aCentavos, aDolares, registrarAuditoria } from '../utils.js';
import { insertarFilas } from '../migracion/historialQB.js';

export const clientesRouter = Router();

// Regla de reactivación automática (28 días desde la última factura, con
// el corte a las 5 PM hora Atlanta — así lo pidió el usuario). Se calcula
// en hora de Atlanta de verdad, no en la hora del servidor, para que dé
// lo mismo sin importar dónde esté corriendo el server.
function fechaHoraAtlantaAhora() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

function limiteReactivacion(fechaUltimaFactura) {
  // Blindaje: si por lo que sea la fecha no viene en formato limpio
  // (debería ser siempre 'YYYY-MM-DD'), se toma solo los primeros 10
  // caracteres y se valida — así nunca calcula un límite inválido que
  // termine favoreciendo por error la opción más barata.
  const fechaLimpia = String(fechaUltimaFactura).slice(0, 10);
  const d = new Date(`${fechaLimpia}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Fecha de factura con formato inesperado: "${fechaUltimaFactura}"`);
  }
  d.setUTCDate(d.getUTCDate() + 28);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dia}T17:00:00`;
}

function serializar(row) {
  return {
    id: row.id,
    codigo: row.codigo,
    numero: row.numero,
    nombre: row.nombre,
    email: row.email ?? undefined,
    tipo: row.tipo ?? undefined,
    licenciaInfo: row.licencia_info ?? '',
    telefonos: row.telefonos ?? '',
    direccion: row.direccion ?? undefined,
    notas: row.notas ?? undefined,
    nombreQb: row.nombre_qb ?? undefined,
    cuotaSemanal: aDolares(row.cuota_semanal),
    fechaAlta: row.fecha_alta,
    estado: row.estado,
  };
}

clientesRouter.get('/', async (req, res) => {
  const filas = await db.prepare('SELECT * FROM clientes ORDER BY nombre').all();
  res.json(filas.map(serializar));
});

// Importación masiva: mucho más rápido que crear uno por uno cuando son
// miles de filas (ej. migrando el catálogo completo de QuickBooks). Cada
// cliente puede venir con un "saldoInicial" opcional — si viene, se le
// genera una factura de apertura para que la cuenta corriente arranque
// reflejando la deuda que ya tenía antes de migrar.
clientesRouter.post('/importar-lote', async (req, res) => {
  const filas = req.body.clientes;
  if (!Array.isArray(filas) || filas.length === 0) {
    return res.status(400).json({ error: 'No se recibió ninguna fila para importar.' });
  }

  const hoy = new Date().toISOString().slice(0, 10);
  let numeroFactura = (await db.prepare('SELECT MAX(numero) as n FROM facturas').get()).n ?? 40000;
  const semanaActual = (await db.prepare('SELECT MAX(semana) as s FROM facturas').get()).s ?? 1;

  // Clientes de QuickBooks que ya existen (por nombre completo exacto) se omiten:
  // así subir dos veces el mismo archivo no duplica nada.
  const nombres = filas.map((f) => f.nombreQb).filter(Boolean);
  const existentes = new Set(
    nombres.length ? (await db.prepare('SELECT nombre_qb FROM clientes WHERE nombre_qb = ANY(?)').all(nombres)).map((r) => r.nombre_qb) : []
  );
  const vistos = new Set();
  const nuevas = [];
  let omitidos = 0;
  for (const f of filas) {
    if (f.nombreQb && (existentes.has(f.nombreQb) || vistos.has(f.nombreQb))) { omitidos += 1; continue; }
    if (f.nombreQb) vistos.add(f.nombreQb);
    nuevas.push(f);
  }

  let conSaldoInicial = 0;
  await db.transaction(async (tx) => {
    const clientes = [];
    const aperturas = [];
    for (const f of nuevas) {
      const clienteId = generarId('cli');
      clientes.push([
        clienteId, f.codigo ?? '', f.numero || String(100000 + Math.floor(Math.random() * 900000)), f.nombre, f.email || null,
        f.licenciaInfo || null, f.telefonos || null, f.direccion || null, f.notas || null, aCentavos(f.cuotaSemanal || 0), hoy,
        f.estado === 'inactivo' ? 'inactivo' : 'activo', f.nombreQb || null,
      ]);
      if (f.saldoInicial && f.saldoInicial > 0) {
        aperturas.push([generarId('fac-migracion'), ++numeroFactura, clienteId, semanaActual, hoy, hoy, 'Saldo inicial (migración desde QuickBooks)', aCentavos(f.saldoInicial), 0, 'pendiente', req.usuario.nombre]);
        conSaldoInicial += 1;
      }
    }
    await insertarFilas(tx, 'clientes', ['id', 'codigo', 'numero', 'nombre', 'email', 'licencia_info', 'telefonos', 'direccion', 'notas', 'cuota_semanal', 'fecha_alta', 'estado', 'nombre_qb'], clientes);
    await insertarFilas(tx, 'facturas', ['id', 'numero', 'cliente_id', 'semana', 'fecha', 'fecha_vencimiento', 'concepto', 'monto', 'monto_pagado', 'estado', 'creado_por'], aperturas);
  });

  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Importó clientes en lote',
    entidad: 'Cliente',
    entidadId: 'importacion-masiva',
    resumen: `Se importaron ${nuevas.length} clientes (${conSaldoInicial} con saldo inicial migrado como factura de apertura); ${omitidos} ya existían.`,
  });

  res.json({ importados: nuevas.length, conSaldoInicial, omitidos });
});

clientesRouter.get('/:id', async (req, res) => {
  const row = await db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado.' });
  res.json(serializar(row));
});

clientesRouter.post('/', async (req, res) => {
  const b = req.body;
  const id = generarId('cli');
  await db
    .prepare(
      `INSERT INTO clientes (id, codigo, numero, nombre, email, tipo, licencia_info, telefonos, direccion, notas, cuota_semanal, fecha_alta, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      b.codigo,
      b.numero,
      b.nombre,
      b.email || null,
      b.tipo || null,
      b.licenciaInfo || '',
      b.telefonos || '',
      b.direccion || null,
      b.notas || null,
      aCentavos(b.cuotaSemanal),
      b.fechaAlta,
      b.estado || 'activo'
    );
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Creó cliente', entidad: 'Cliente', entidadId: id, resumen: `Alta de ${b.nombre} (${b.codigo})` });
  const creado = await db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  res.status(201).json(serializar(creado));
});

clientesRouter.patch('/:id', async (req, res) => {
  const actual = await db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const b = req.body;
  const cambios = [];
  if (b.codigo && b.codigo !== actual.codigo) cambios.push({ campo: 'Código', anterior: actual.codigo, nuevo: b.codigo });
  if (b.estado && b.estado !== actual.estado) cambios.push({ campo: 'Estado', anterior: actual.estado, nuevo: b.estado });
  if (b.cuotaSemanal !== undefined && aCentavos(b.cuotaSemanal) !== actual.cuota_semanal) {
    cambios.push({ campo: 'Cuota semanal', anterior: String(aDolares(actual.cuota_semanal)), nuevo: String(b.cuotaSemanal) });
  }

  await db
    .prepare(
      `UPDATE clientes SET
      codigo = ?, numero = ?, nombre = ?, email = ?, tipo = ?, licencia_info = ?, telefonos = ?, direccion = ?, notas = ?,
      cuota_semanal = ?, estado = ?
     WHERE id = ?`
    )
    .run(
      b.codigo ?? actual.codigo,
      b.numero ?? actual.numero,
      b.nombre ?? actual.nombre,
      b.email ?? actual.email,
      b.tipo ?? actual.tipo,
      b.licenciaInfo ?? actual.licencia_info,
      b.telefonos ?? actual.telefonos,
      b.direccion ?? actual.direccion,
      b.notas ?? actual.notas,
      b.cuotaSemanal !== undefined ? aCentavos(b.cuotaSemanal) : actual.cuota_semanal,
      b.estado ?? actual.estado,
      req.params.id
    );

  if (cambios.length > 0) {
    await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Editó cliente', entidad: 'Cliente', entidadId: req.params.id, resumen: `Se actualizó a ${actual.nombre}`, cambios });
  }

  // Reactivación automática: si pasa de inactivo a activo, se factura
  // solo Reactivación ($10, 1060RA) o Reinscripción ($20, 1060RI) según
  // hayan pasado o no 28 días desde la última factura, contados hasta
  // las 5 PM hora Atlanta — regla que dio el usuario.
  let feeAutomatico = null;
  const seReactiva = b.estado === 'activo' && actual.estado === 'inactivo';
  if (seReactiva) {
    const ultimaFactura = await db.prepare('SELECT fecha FROM facturas WHERE cliente_id = ? ORDER BY fecha DESC LIMIT 1').get(req.params.id);
    if (ultimaFactura) {
      const dentroDePlazo = fechaHoraAtlantaAhora() <= limiteReactivacion(ultimaFactura.fecha);
      const codigo = dentroDePlazo ? '1060RA' : '1060RI';
      const itemCatalogo = await db.prepare('SELECT * FROM catalogo_fees WHERE codigo = ?').get(codigo);
      const etiqueta = itemCatalogo?.etiqueta ?? (dentroDePlazo ? 'Reactivación' : 'Reinscripción');
      const monto = itemCatalogo?.monto ?? aCentavos(dentroDePlazo ? 10 : 20);
      const numeroFactura = ((await db.prepare('SELECT MAX(numero) as n FROM facturas').get()).n ?? 40000) + 1;
      const hoy = new Date().toISOString().slice(0, 10);
      const facturaId = generarId('fac-reactivacion');
      await db
        .prepare(
          `INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado, codigo, creado_por)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0, 'pendiente', ?, ?)`
        )
        .run(facturaId, numeroFactura, req.params.id, hoy, hoy, etiqueta, monto, codigo, req.usuario.nombre);
      feeAutomatico = { codigo, etiqueta, monto: aDolares(monto), facturaId };
      await registrarAuditoria({
        usuario: req.usuario.nombre,
        accion: 'Generó fee automático de reactivación',
        entidad: 'Factura',
        entidadId: facturaId,
        resumen: `${actual.nombre} se reactivó ${dentroDePlazo ? 'dentro' : 'después'} de los 28 días desde su última factura (${ultimaFactura.fecha}) — se facturó ${etiqueta} ($${aDolares(monto)}, ${codigo}) automáticamente.`,
      });
    }
  }

  const actualizado = await db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  res.json({ ...serializar(actualizado), feeAutomatico });
});

// Fees tildados en la ficha de un cliente, pendientes de facturarse en
// la próxima corrida semanal.
clientesRouter.get('/:id/fees-pendientes', async (req, res) => {
  const filas = await db.prepare('SELECT fee_id FROM cliente_fees_pendientes WHERE cliente_id = ?').all(req.params.id);
  res.json(filas.map((f) => f.fee_id));
});

clientesRouter.post('/:id/fees-pendientes/:feeId', async (req, res) => {
  const cliente = await db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  const fee = await db.prepare('SELECT * FROM catalogo_fees WHERE id = ?').get(req.params.feeId);
  if (!cliente || !fee) return res.status(404).json({ error: 'Cliente o fee no encontrado.' });
  await db.prepare('INSERT INTO cliente_fees_pendientes (cliente_id, fee_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.params.id, req.params.feeId);
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Marcó fee pendiente',
    entidad: 'Cliente',
    entidadId: req.params.id,
    resumen: `Se tildó ${fee.codigo} (${fee.etiqueta}) para facturar en la próxima corrida semanal de ${cliente.nombre}`,
  });
  res.json({ ok: true });
});

clientesRouter.delete('/:id/fees-pendientes/:feeId', async (req, res) => {
  await db.prepare('DELETE FROM cliente_fees_pendientes WHERE cliente_id = ? AND fee_id = ?').run(req.params.id, req.params.feeId);
  res.json({ ok: true });
});

export { serializar as serializarCliente };
