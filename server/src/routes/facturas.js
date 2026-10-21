import { Router } from 'express';
import { db } from '../db.js';
import { generarId, aCentavos, aDolares, registrarAuditoria } from '../utils.js';
import { generarFacturaPdf } from '../facturaPdf.js';
import { enviarMailConAdjunto } from '../email.js';
import { requiereAdmin } from '../auth.js';

export const facturasRouter = Router();

// Para el precio de la cuota semanal según el día — normativa: $145 los
// lunes, con descuento si se corre después. Se calcula en hora de
// Atlanta de verdad (America/New_York), no la del servidor.
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
function diaDeHoyAtlanta() {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' });
  const nombreIngles = fmt.format(new Date());
  const mapa = { Sunday: 'domingo', Monday: 'lunes', Tuesday: 'martes', Wednesday: 'miercoles', Thursday: 'jueves', Friday: 'viernes', Saturday: 'sabado' };
  return mapa[nombreIngles] ?? DIAS_SEMANA[new Date().getDay()];
}

function serializar(row) {
  return {
    id: row.id,
    numero: row.numero,
    clienteId: row.cliente_id,
    semana: row.semana,
    fecha: row.fecha,
    fechaVencimiento: row.fecha_vencimiento,
    concepto: row.concepto,
    monto: aDolares(row.monto),
    montoPagado: aDolares(row.monto_pagado),
    estado: row.estado,
    codigo: row.codigo ?? undefined,
    creadoPor: row.creado_por ?? undefined,
    beneficiarioId: row.beneficiario_id ?? undefined,
    recuperoNcId: row.recupero_nc_id ?? undefined,
  };
}

facturasRouter.get('/', async (req, res) => {
  const filas = await db.prepare('SELECT * FROM facturas ORDER BY fecha_vencimiento DESC').all();
  res.json(filas.map(serializar));
});

facturasRouter.post('/', async (req, res) => {
  const b = req.body;
  const cliente = await db.prepare('SELECT * FROM clientes WHERE id = ?').get(b.clienteId);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

  let beneficiarioId = null;
  if (b.codigo === '1060DR') {
    if (!b.beneficiarioId || b.beneficiarioId === b.clienteId) {
      return res.status(400).json({ error: 'Una factura 1060DR necesita la unidad beneficiaria del saldo a favor (distinta a la que la paga).' });
    }
    const ben = await db.prepare('SELECT id FROM clientes WHERE id = ?').get(b.beneficiarioId);
    if (!ben) return res.status(400).json({ error: 'La unidad beneficiaria no existe.' });
    beneficiarioId = b.beneficiarioId;
  }
  const numero = ((await db.prepare('SELECT MAX(numero) as n FROM facturas').get()).n ?? 40000) + 1;
  const hoy = new Date().toISOString().slice(0, 10);
  const id = generarId('fac-manual');
  const semanaActual = (await db.prepare('SELECT MAX(semana) as s FROM facturas').get()).s ?? 1;

  await db
    .prepare(
      `INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado, codigo, creado_por, beneficiario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pendiente', ?, ?, ?)`
    )
    .run(id, numero, b.clienteId, semanaActual, hoy, b.fechaVencimiento || hoy, b.concepto, aCentavos(b.monto), b.codigo || null, req.usuario.nombre, beneficiarioId);

  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Creó factura',
    entidad: 'Factura',
    entidadId: id,
    resumen: `Factura #${numero} · ${b.concepto} · $${b.monto} a ${cliente.nombre}`,
  });
  const creada = await db.prepare('SELECT * FROM facturas WHERE id = ?').get(id);
  res.status(201).json(serializar(creada));
});

// Genera la cuota semanal para todos los clientes ACTIVOS que todavía no
// la tengan en la semana objetivo. A los dados de baja no se les genera
// nunca, sin importar el historial — la misma regla que ya vive en el
// frontend, ahora del lado del servidor (fuente de verdad única).
facturasRouter.post('/generar-semanal', async (req, res) => {
  const semanaMax = (await db.prepare('SELECT MAX(semana) as s FROM facturas').get()).s ?? 36;
  const semana = semanaMax + 1;
  const hoy = new Date().toISOString().slice(0, 10);
  let numero = (await db.prepare('SELECT MAX(numero) as n FROM facturas').get()).n ?? 40000;

  const clientesActivos = await db.prepare(`SELECT * FROM clientes WHERE estado = 'activo'`).all();
  const inactivos = Number((await db.prepare(`SELECT COUNT(*) as n FROM clientes WHERE estado = 'inactivo'`).get()).n);
  const config = await db.prepare('SELECT * FROM configuracion WHERE id = 1').get();

  // Precio del día de hoy (en Atlanta) para la cuota "estándar" — si ese
  // día no tiene un precio propio cargado, se usa el de siempre
  // (cuota_semanal_por_defecto). Un cliente con una cuota PROPIA distinta
  // al valor por defecto mantiene la suya, sin importar el día.
  const dia = diaDeHoyAtlanta();
  const columnaPorDia = { lunes: 'precio_lunes', martes: 'precio_martes', miercoles: 'precio_miercoles', jueves: 'precio_jueves', viernes: 'precio_viernes' };
  const precioDelDia = columnaPorDia[dia] ? config[columnaPorDia[dia]] ?? config.cuota_semanal_por_defecto : config.cuota_semanal_por_defecto;

  let generadas = 0;
  let yaExistian = 0;
  let feesAplicados = 0;

  await db.transaction(async (tx) => {
    for (const c of clientesActivos) {
      const yaTiene = await tx.prepare('SELECT 1 FROM facturas WHERE cliente_id = ? AND semana = ?').get(c.id, semana);
      if (yaTiene) {
        yaExistian += 1;
      } else {
        numero += 1;
        const montoAFacturar = c.cuota_semanal === config.cuota_semanal_por_defecto ? precioDelDia : c.cuota_semanal;
        await tx
          .prepare(
            `INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado, codigo, creado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pendiente', '1090PB', ?)`
          )
          .run(generarId('fac-semanal'), numero, c.id, semana, hoy, hoy, `1090PB Semana ${semana}`, montoAFacturar, req.usuario.nombre);
        generadas += 1;
      }

      // Fees tildados en la ficha del cliente: se facturan junto con la
      // cuota de esta corrida y se sacan de "pendientes" (ya se usaron).
      const feesPendientes = await tx
        .prepare(
          `SELECT cf.* FROM cliente_fees_pendientes cfp
           JOIN catalogo_fees cf ON cf.id = cfp.fee_id
           WHERE cfp.cliente_id = ?`
        )
        .all(c.id);
      for (const fee of feesPendientes) {
        numero += 1;
        await tx
          .prepare(
            `INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado, codigo, creado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pendiente', ?, ?)`
          )
          .run(generarId('fac-fee'), numero, c.id, semana, hoy, hoy, fee.etiqueta, fee.monto, fee.codigo, req.usuario.nombre);
        // Los fees que "se arrastran" (marcados así en el catálogo) quedan tildados hasta que
        // alguien los saque a mano. Las multas (no se arrastran) se facturan una sola vez y se destildan.
        if (fee.se_arrastra === false) {
          await tx.prepare('DELETE FROM cliente_fees_pendientes WHERE cliente_id = ? AND fee_id = ?').run(c.id, fee.id);
        }
        feesAplicados += 1;
      }
    }
  });

  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Generó facturas semanales',
    entidad: 'Factura',
    entidadId: `semana-${semana}`,
    resumen: `Corrida de la semana ${semana}: se generaron ${generadas} facturas nuevas${feesAplicados > 0 ? ` + ${feesAplicados} fee(s) tildados` : ''}. Se salteó a ${inactivos} cliente(s) dado(s) de baja${yaExistian > 0 ? ` y ${yaExistian} ya tenían factura de esa semana` : ''}.`,
  });

  res.json({ semana, generadas, salteadasInactivos: inactivos, yaExistian, feesAplicados });
});

facturasRouter.patch('/:id', requiereAdmin, async (req, res) => {
  const actual = await db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Factura no encontrada.' });

  const b = req.body;
  const cambios = [];
  if (b.concepto !== undefined && b.concepto !== actual.concepto) cambios.push({ campo: 'Concepto', anterior: actual.concepto, nuevo: b.concepto });
  if (b.monto !== undefined && aCentavos(b.monto) !== actual.monto) {
    cambios.push({ campo: 'Monto', anterior: String(aDolares(actual.monto)), nuevo: String(b.monto) });
  }
  if (b.fechaVencimiento !== undefined && b.fechaVencimiento !== actual.fecha_vencimiento) {
    cambios.push({ campo: 'Vencimiento', anterior: actual.fecha_vencimiento, nuevo: b.fechaVencimiento });
  }

  const nuevoMonto = b.monto !== undefined ? aCentavos(b.monto) : actual.monto;
  const estado = actual.monto_pagado >= nuevoMonto ? 'pagada' : actual.monto_pagado > 0 ? 'parcial' : 'pendiente';

  await db
    .prepare('UPDATE facturas SET concepto = ?, monto = ?, fecha_vencimiento = ?, estado = ? WHERE id = ?')
    .run(b.concepto ?? actual.concepto, nuevoMonto, b.fechaVencimiento ?? actual.fecha_vencimiento, estado, req.params.id);

  if (cambios.length > 0) {
    await registrarAuditoria({
      usuario: req.usuario.nombre,
      accion: 'Editó factura',
      entidad: 'Factura',
      entidadId: req.params.id,
      resumen: `Se corrigió la factura #${actual.numero}`,
      cambios,
    });
  }
  const actualizada = await db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
  res.json(serializar(actualizada));
});

export async function datosParaPdf(facturaId) {
  const facturaRow = await db.prepare('SELECT * FROM facturas WHERE id = ?').get(facturaId);
  if (!facturaRow) return null;
  const clienteRow = await db.prepare('SELECT * FROM clientes WHERE id = ?').get(facturaRow.cliente_id);
  const configRow = await db.prepare('SELECT * FROM configuracion WHERE id = 1').get();

  const factura = serializar(facturaRow);
  const saldoPend = Math.round((factura.monto - factura.montoPagado) * 100) / 100;
  const hoyISO = new Date().toISOString().slice(0, 10);
  const estado = saldoPend <= 0 ? 'PAGADA' : factura.fechaVencimiento < hoyISO ? 'VENCIDA' : 'PENDIENTE';

  const pdf = await generarFacturaPdf({
    factura,
    cliente: { codigo: clienteRow.codigo, nombre: clienteRow.nombre, telefonos: clienteRow.telefonos },
    empresa: { nombre: configRow.empresa_nombre, direccion: configRow.empresa_direccion, email: configRow.empresa_email },
    saldoPendiente: saldoPend,
    estado,
  });
  return { pdf, factura, cliente: clienteRow };
}

facturasRouter.get('/:id/pdf', async (req, res) => {
  const datos = await datosParaPdf(req.params.id);
  if (!datos) return res.status(404).json({ error: 'Factura no encontrada.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="factura-${datos.factura.numero}.pdf"`);
  res.send(datos.pdf);
});

facturasRouter.post('/:id/enviar', async (req, res) => {
  const datos = await datosParaPdf(req.params.id);
  if (!datos) return res.status(404).json({ error: 'Factura no encontrada.' });
  const destino = req.body.email || datos.cliente.email;
  if (!destino) return res.status(400).json({ error: 'Este cliente no tiene un email cargado.' });

  const resultado = await enviarMailConAdjunto({
    para: destino,
    asunto: `Factura #${datos.factura.numero}`,
    texto: `Hola ${datos.cliente.nombre}, te adjuntamos la factura #${datos.factura.numero} por $${datos.factura.monto}.`,
    nombreArchivo: `factura-${datos.factura.numero}.pdf`,
    contenido: datos.pdf,
  });

  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Envió factura por mail',
    entidad: 'Factura',
    entidadId: req.params.id,
    resumen: `Factura #${datos.factura.numero} enviada a ${destino}: ${resultado.detalle}`,
  });

  res.json({ enviado: resultado.ok, motivo: resultado.detalle });
});
