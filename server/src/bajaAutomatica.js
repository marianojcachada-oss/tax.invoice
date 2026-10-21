import { db } from './db.js';
import { registrarAuditoria } from './utils.js';
import { requiereAdmin } from './auth.js';
import { Router } from 'express';

// Pasa a "inactivo" a quien no pagó la cuota semanal (1090PB) de la semana.
// Está apagada por defecto: la administración la prende y elige día y hora (hora de Atlanta).
// Solo mira cuotas vencidas en los últimos 7 días, para que un historial viejo importado no dé de baja a nadie.

export const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

export function ahoraAtlanta(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
      .formatToParts(d).map((x) => [x.type, x.value])
  );
  const dia = { Sun: 'dom', Mon: 'lun', Tue: 'mar', Wed: 'mie', Thu: 'jue', Fri: 'vie', Sat: 'sab' }[p.weekday];
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, dia };
}

/** Clientes activos con la cuota semanal vencida sin pagar. */
export async function morososDeLaSemana(hoy) {
  const desde = new Date(`${hoy}T00:00:00Z`);
  desde.setUTCDate(desde.getUTCDate() - 7);
  const desdeStr = desde.toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT c.id, c.codigo, c.nombre, MIN(f.numero) AS factura, MAX(f.monto - f.monto_pagado) AS debe
       FROM clientes c JOIN facturas f ON f.cliente_id = c.id
       WHERE c.estado = 'activo' AND f.codigo = '1090PB' AND f.estado <> 'anulada'
         AND f.monto_pagado < f.monto AND f.fecha_vencimiento < ? AND f.fecha_vencimiento >= ?
       GROUP BY c.id, c.codigo, c.nombre ORDER BY c.codigo`
    )
    .all(hoy, desdeStr);
}

export async function ejecutarBajaAutomatica(usuario = 'Sistema (baja automática)') {
  const { fecha } = ahoraAtlanta();
  const lista = await morososDeLaSemana(fecha);
  for (const c of lista) {
    await db.prepare("UPDATE clientes SET estado = 'inactivo' WHERE id = ?").run(c.id);
    await registrarAuditoria({
      usuario, accion: 'Baja automática por falta de pago', entidad: 'Cliente', entidadId: c.id,
      resumen: `${c.codigo} ${c.nombre} pasó a inactivo: no pagó la cuota semanal (factura #${c.factura}).`,
      cambios: [{ campo: 'Estado', anterior: 'activo', nuevo: 'inactivo' }],
    });
  }
  await db.prepare('UPDATE configuracion SET baja_auto_ultima = ? WHERE id = 1').run(fecha);
  return { fecha, cantidad: lista.length, clientes: lista.map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre })) };
}

/** Lo llama el servidor cada pocos minutos: corre una sola vez por día, a partir de la hora elegida. */
export async function revisarBajaAutomatica() {
  const cfg = await db.prepare('SELECT baja_auto_activa, baja_auto_dia, baja_auto_hora, baja_auto_ultima FROM configuracion WHERE id = 1').get();
  if (!cfg?.baja_auto_activa) return null;
  const a = ahoraAtlanta();
  if (a.dia !== cfg.baja_auto_dia || a.hora < cfg.baja_auto_hora || cfg.baja_auto_ultima === a.fecha) return null;
  return ejecutarBajaAutomatica();
}

export const bajaAutomaticaRouter = Router();
const serializar = (c) => ({ activa: !!c.baja_auto_activa, dia: c.baja_auto_dia, hora: c.baja_auto_hora, ultima: c.baja_auto_ultima ?? null });

bajaAutomaticaRouter.use(requiereAdmin);
bajaAutomaticaRouter.get('/', async (req, res) => {
  res.json(serializar(await db.prepare('SELECT * FROM configuracion WHERE id = 1').get()));
});
bajaAutomaticaRouter.put('/', async (req, res) => {
  const { activa, dia, hora } = req.body ?? {};
  if (!DIAS.includes(dia)) return res.status(400).json({ error: 'Día inválido.' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hora))) return res.status(400).json({ error: 'Hora inválida (HH:MM).' });
  await db.prepare('UPDATE configuracion SET baja_auto_activa = ?, baja_auto_dia = ?, baja_auto_hora = ? WHERE id = 1').run(!!activa, dia, hora);
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Configuró la baja automática', entidad: 'Sistema', entidadId: 'baja-automatica', resumen: `${activa ? 'Activa' : 'Apagada'} · ${dia} ${hora} (hora de Atlanta)` });
  res.json(serializar(await db.prepare('SELECT * FROM configuracion WHERE id = 1').get()));
});
bajaAutomaticaRouter.get('/vista-previa', async (req, res) => {
  res.json({ clientes: await morososDeLaSemana(ahoraAtlanta().fecha) });
});
bajaAutomaticaRouter.post('/ejecutar', async (req, res) => {
  res.json(await ejecutarBajaAutomatica(`${req.usuario.nombre} (baja manual)`));
});
