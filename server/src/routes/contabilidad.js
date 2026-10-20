import { Router } from 'express';
import { db } from '../db.js';
import { requiereAdmin } from '../auth.js';
import { generarId, aCentavos, aDolares, registrarAuditoria } from '../utils.js';
import { asegurarPlan, guardarConfig, leerConfig } from '../contabilidad/config.js';
import { ErrorContable, saldoLibroAR } from '../contabilidad/libro.js';
import { arAgingSummary, balanceSheet, profitAndLoss } from '../contabilidad/informes.js';
import { aCsv, aPdf, aXlsx, nombreArchivo, TIPOS_CONTENIDO } from '../contabilidad/exportar.js';
import { cargarArranque } from '../contabilidad/importarQB.js';
import { hoyAtlanta } from '../contabilidad/tipos.js';

export const contabilidadRouter = Router();
contabilidadRouter.use(requiereAdmin);

const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const generadores = {
  'profit-and-loss': async (q) => {
    const hoy = hoyAtlanta();
    const desde = q.desde ?? `${hoy.slice(0, 4)}-01-01`;
    const hasta = q.hasta ?? hoy;
    if (!esFecha(desde) || !esFecha(hasta) || desde > hasta) throw new ErrorContable('Fechas inválidas.');
    return profitAndLoss({ desde, hasta });
  },
  'balance-sheet': async (q) => {
    const al = q.al ?? q.hasta ?? hoyAtlanta();
    if (!esFecha(al)) throw new ErrorContable('Fecha inválida.');
    return balanceSheet({ hasta: al });
  },
  'ar-aging-summary': async (q) => {
    const al = q.al ?? q.hasta ?? hoyAtlanta();
    if (!esFecha(al)) throw new ErrorContable('Fecha inválida.');
    return arAgingSummary({ al });
  },
};

contabilidadRouter.get('/informes/:tipo', async (req, res) => {
  const gen = generadores[req.params.tipo];
  if (!gen) return res.status(404).json({ error: 'Informe desconocido.' });
  try {
    await asegurarPlan();
    const r = await gen(req.query);
    const formato = String(req.query.formato ?? 'json').toLowerCase();
    if (formato === 'json') return res.json({ ...r.modelo, avisos: r.avisos, cuadra: r.cuadra });
    if (!['csv', 'xlsx', 'pdf'].includes(formato)) return res.status(400).json({ error: 'Formato inválido (csv, xlsx o pdf).' });
    const cuerpo = formato === 'csv' ? aCsv(r.modelo) : formato === 'xlsx' ? await aXlsx(r.modelo) : await aPdf(r.modelo);
    res.set('Content-Type', TIPOS_CONTENIDO[formato]);
    res.set('Content-Disposition', `attachment; filename="${nombreArchivo(r.modelo, formato)}"`);
    res.set('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(cuerpo);
  } catch (e) {
    if (e instanceof ErrorContable) return res.status(e.estado).json({ error: e.message });
    throw e;
  }
});

// A/R del libro contra el A/R Aging: tienen que dar lo mismo.
contabilidadRouter.get('/conciliacion', async (req, res) => {
  const al = req.query.al ?? hoyAtlanta();
  if (!esFecha(al)) return res.status(400).json({ error: 'Fecha inválida.' });
  try {
    await asegurarPlan();
    const libro = await saldoLibroAR(al);
    const aging = (await arAgingSummary({ al })).total;
    const bs = await balanceSheet({ hasta: al });
    res.json({
      al,
      arLibro: aDolares(libro),
      arAging: aDolares(aging),
      diferenciaAR: aDolares(libro - aging),
      balanceCuadra: bs.cuadra,
      diferenciaBalance: aDolares(bs.totalActivos - bs.totalPasivoYPatrimonio),
      avisos: bs.avisos,
    });
  } catch (e) {
    if (e instanceof ErrorContable) return res.status(e.estado).json({ error: e.message });
    throw e;
  }
});

contabilidadRouter.get('/config', async (req, res) => {
  const { count } = await db.prepare('SELECT COUNT(*)::int AS count FROM saldos_iniciales').get();
  res.json({ ...(await leerConfig()), saldosCargados: count });
});

contabilidadRouter.put('/config', async (req, res) => {
  const permitidas = ['corte', 'zelle', 'kotapay', 'efectivo', 'banco', 'ingresoDefault', 'notaCredito', 'reembolso', 'billDefault', 'gastoPorCategoria', 'empresa'];
  const parcial = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => permitidas.includes(k)));
  if (parcial.corte !== undefined && !esFecha(parcial.corte)) return res.status(400).json({ error: 'Fecha de corte inválida.' });
  await asegurarPlan();
  const plan = new Set((await db.prepare('SELECT numero FROM plan_cuentas').all()).map((c) => c.numero));
  const cuentasDadas = [
    ...['zelle', 'kotapay', 'efectivo', 'banco', 'ingresoDefault', 'notaCredito', 'reembolso', 'billDefault'].map((k) => parcial[k]),
    ...Object.values(parcial.gastoPorCategoria ?? {}),
  ].filter((x) => x !== undefined);
  const malas = cuentasDadas.filter((c) => !plan.has(String(c)));
  if (malas.length) return res.status(400).json({ error: `Cuenta(s) inexistente(s) en el plan: ${malas.join(', ')}` });
  const nueva = await guardarConfig(parcial);
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Cambió ajustes de contabilidad', entidad: 'Contabilidad', entidadId: 'config', resumen: Object.keys(parcial).join(', ') });
  res.json(nueva);
});

contabilidadRouter.get('/plan', async (req, res) => {
  await asegurarPlan();
  const filas = await db.prepare('SELECT * FROM plan_cuentas ORDER BY numero').all();
  res.json(filas.map((c) => ({ numero: c.numero, nombre: c.nombre, tipo: c.tipo, detalle: c.detalle, padre: c.padre, activa: c.activa, mostrarEnCero: c.mostrar_en_cero })));
});

// Carga el Balance Sheet y el Profit and Loss de QuickBooks como saldos de arranque.
contabilidadRouter.post('/arranque', async (req, res) => {
  const { balance, resultados } = req.body ?? {};
  if (!balance || !resultados) return res.status(400).json({ error: 'Faltan los dos archivos (Balance Sheet y Profit and Loss).' });
  try {
    const r = await cargarArranque({ balance, resultados });
    const bs = await balanceSheet({ hasta: r.corte });
    await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Cargó saldos de arranque contables', entidad: 'Contabilidad', entidadId: 'arranque', resumen: `${r.cuentasCargadas} cuentas al ${r.corte}` });
    res.json({ ...r, balanceCuadra: bs.cuadra, totalActivos: aDolares(bs.totalActivos), netIncome: aDolares(bs.netIncome) });
  } catch (e) {
    if (e instanceof ErrorContable) return res.status(e.estado).json({ error: e.message });
    throw e;
  }
});

// Mapeos: a qué cuenta contable va cada fee, cada cuenta de la app.
contabilidadRouter.get('/mapeos', async (req, res) => {
  const fees = await db.prepare('SELECT id, codigo, etiqueta, cuenta_ingreso FROM catalogo_fees ORDER BY orden, codigo').all();
  const cuentas = await db.prepare('SELECT id, nombre, tipo, cuenta_contable FROM cuentas ORDER BY nombre').all();
  res.json({
    fees: fees.map((f) => ({ id: f.id, codigo: f.codigo, etiqueta: f.etiqueta, cuentaIngreso: f.cuenta_ingreso ?? null })),
    cuentas: cuentas.map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, cuentaContable: c.cuenta_contable ?? null })),
  });
});

contabilidadRouter.put('/mapeos', async (req, res) => {
  await asegurarPlan();
  const plan = new Set((await db.prepare('SELECT numero FROM plan_cuentas').all()).map((c) => c.numero));
  const { fees = [], cuentas = [] } = req.body ?? {};
  for (const x of [...fees.map((f) => f.cuentaIngreso), ...cuentas.map((c) => c.cuentaContable)]) {
    if (x && !plan.has(String(x))) return res.status(400).json({ error: `La cuenta ${x} no existe en el plan.` });
  }
  await db.transaction(async (tx) => {
    for (const f of fees) await tx.prepare('UPDATE catalogo_fees SET cuenta_ingreso = ? WHERE id = ?').run(f.cuentaIngreso || null, f.id);
    for (const c of cuentas) await tx.prepare('UPDATE cuentas SET cuenta_contable = ? WHERE id = ?').run(c.cuentaContable || null, c.id);
  });
  res.json({ ok: true });
});

// Asientos manuales (nómina, depreciación, retiros, ajustes).
contabilidadRouter.get('/asientos', async (req, res) => {
  const asientos = await db.prepare('SELECT * FROM asientos ORDER BY fecha DESC, id DESC').all();
  const lineas = await db.prepare('SELECT * FROM asiento_lineas ORDER BY id').all();
  res.json(
    asientos.map((a) => ({
      id: a.id,
      fecha: a.fecha,
      descripcion: a.descripcion,
      lineas: lineas.filter((l) => l.asiento_id === a.id).map((l) => ({ cuenta: l.cuenta, debe: aDolares(l.debe), haber: aDolares(l.haber) })),
    }))
  );
});

contabilidadRouter.post('/asientos', async (req, res) => {
  const { fecha, descripcion, lineas } = req.body ?? {};
  if (!esFecha(fecha)) return res.status(400).json({ error: 'Fecha inválida.' });
  if (!String(descripcion ?? '').trim()) return res.status(400).json({ error: 'Falta la descripción.' });
  if (!Array.isArray(lineas) || lineas.length < 2) return res.status(400).json({ error: 'Un asiento necesita al menos dos líneas.' });
  await asegurarPlan();
  const plan = new Set((await db.prepare('SELECT numero FROM plan_cuentas').all()).map((c) => c.numero));
  const ls = lineas.map((l) => ({ cuenta: String(l.cuenta), debe: aCentavos(l.debe || 0), haber: aCentavos(l.haber || 0) }));
  if (ls.some((l) => !plan.has(l.cuenta))) return res.status(400).json({ error: 'Hay una cuenta que no existe en el plan.' });
  if (ls.some((l) => l.debe < 0 || l.haber < 0 || (l.debe > 0 && l.haber > 0))) return res.status(400).json({ error: 'Cada línea va al debe o al haber, con montos positivos.' });
  const sumaDebe = ls.reduce((a, l) => a + l.debe, 0);
  const sumaHaber = ls.reduce((a, l) => a + l.haber, 0);
  if (sumaDebe !== sumaHaber) return res.status(400).json({ error: `El asiento no cuadra: debe $${aDolares(sumaDebe)} y haber $${aDolares(sumaHaber)}.` });
  const id = generarId('asiento');
  await db.transaction(async (tx) => {
    await tx.prepare('INSERT INTO asientos (id, fecha, descripcion, creado_por) VALUES (?, ?, ?, ?)').run(id, fecha, String(descripcion).trim(), req.usuario.nombre);
    for (const l of ls) await tx.prepare('INSERT INTO asiento_lineas (asiento_id, cuenta, debe, haber) VALUES (?, ?, ?, ?)').run(id, l.cuenta, l.debe, l.haber);
  });
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Creó asiento manual', entidad: 'Asiento', entidadId: id, resumen: `${fecha} · ${descripcion} · $${aDolares(sumaDebe)}` });
  res.status(201).json({ id });
});

contabilidadRouter.delete('/asientos/:id', async (req, res) => {
  const a = await db.prepare('SELECT * FROM asientos WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Asiento no encontrado.' });
  await db.prepare('DELETE FROM asientos WHERE id = ?').run(a.id);
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Borró asiento manual', entidad: 'Asiento', entidadId: a.id, resumen: `${a.fecha} · ${a.descripcion}` });
  res.json({ ok: true });
});
