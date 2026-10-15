import { Router } from 'express';
import { db } from '../db.js';
import { aDolares, registrarAuditoria } from '../utils.js';
import { enviarSms, ringCentralConfigurado } from '../ringcentral.js';

export const recordatoriosRouter = Router();

function diasDeAtraso(fechaVencimiento, hoy = new Date()) {
  const dias = Math.floor((hoy.getTime() - new Date(fechaVencimiento).getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, dias);
}

function clienteElegible(cliente, facturasDelCliente, config, semanaActual) {
  if (!config.recordatorios_activo) return false;
  if (cliente.estado === 'inactivo') return false;
  const facturoRecientemente = facturasDelCliente.some((f) => f.semana > semanaActual - config.recordatorios_semanas);
  if (!facturoRecientemente) return false;
  if (config.recordatorios_solo_vencido) {
    return facturasDelCliente.some((f) => f.monto_pagado < f.monto);
  }
  return true;
}

function armarMensaje(plantilla, cliente, facturasDelCliente) {
  const saldo = facturasDelCliente.reduce((a, f) => a + Math.max(0, f.monto - f.monto_pagado), 0);
  const vencidas = facturasDelCliente.filter((f) => f.monto_pagado < f.monto).sort((a, b) => (a.fecha_vencimiento < b.fecha_vencimiento ? -1 : 1));
  const dias = vencidas[0] ? diasDeAtraso(vencidas[0].fecha_vencimiento) : 0;
  return plantilla
    .replaceAll('{nombre}', cliente.nombre)
    .replaceAll('{monto}', `$${aDolares(saldo)}`)
    .replaceAll('{dias}', String(dias));
}

recordatoriosRouter.get('/estado-ringcentral', (req, res) => {
  res.json({ configurado: ringCentralConfigurado() });
});

// Recordatorio a UN cliente puntual (desde su ficha).
recordatoriosRouter.post('/cliente/:id', async (req, res) => {
  const cliente = await db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const config = await db.prepare('SELECT * FROM configuracion WHERE id = 1').get();
  const facturas = await db.prepare('SELECT * FROM facturas WHERE cliente_id = ?').all(cliente.id);
  const semanaActual = (await db.prepare('SELECT MAX(semana) as s FROM facturas').get()).s ?? 1;

  if (!clienteElegible(cliente, facturas, config, semanaActual)) {
    return res.json({ enviado: false, motivo: cliente.estado === 'inactivo' ? 'Cliente dado de baja.' : 'No facturó recientemente o no tiene saldo vencido.' });
  }

  const mensaje = armarMensaje(config.recordatorios_plantilla, cliente, facturas);
  const resultado = await enviarSms({ telefono: cliente.telefonos, mensaje });

  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Envió recordatorio',
    entidad: 'Cliente',
    entidadId: cliente.id,
    resumen: `Recordatorio a ${cliente.nombre}: ${resultado.detalle}`,
  });

  res.json({ enviado: resultado.ok, motivo: resultado.detalle });
});

// Recordatorio masivo (desde el Dashboard).
recordatoriosRouter.post('/masivo', async (req, res) => {
  const config = await db.prepare('SELECT * FROM configuracion WHERE id = 1').get();
  const clientes = await db.prepare('SELECT * FROM clientes').all();
  const semanaActual = (await db.prepare('SELECT MAX(semana) as s FROM facturas').get()).s ?? 1;

  let enviados = 0;
  let salteados = 0;
  for (const cliente of clientes) {
    const facturas = await db.prepare('SELECT * FROM facturas WHERE cliente_id = ?').all(cliente.id);
    if (!clienteElegible(cliente, facturas, config, semanaActual)) {
      if (facturas.some((f) => f.monto_pagado < f.monto)) salteados += 1;
      continue;
    }
    const mensaje = armarMensaje(config.recordatorios_plantilla, cliente, facturas);
    await enviarSms({ telefono: cliente.telefonos, mensaje });
    enviados += 1;
  }

  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Envió recordatorios masivos',
    entidad: 'Sistema',
    entidadId: 'recordatorios-masivo',
    resumen: `Enviados ${enviados}, salteados ${salteados} (sin actividad reciente o dados de baja)`,
  });

  res.json({ enviados, salteados });
});
