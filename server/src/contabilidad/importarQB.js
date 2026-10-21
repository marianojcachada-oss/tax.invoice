import ExcelJS from 'exceljs';
import { db } from '../db.js';
import { asegurarPlan, guardarConfig } from './config.js';
import { ErrorContable } from './libro.js';
import { esResultados } from './tipos.js';

const MESES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function valorCelda(c) {
  const v = c?.value;
  if (v && typeof v === 'object' && 'result' in v) return v.result;
  return v;
}

/** "Oct 20, 2026" / "October 20, 2026" -> 2026-10-20 */
function aIso(texto) {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(String(texto ?? ''));
  if (!m || !MESES[m[1].toLowerCase()]) return null;
  return `${m[3]}-${String(MESES[m[1].toLowerCase()]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

/** Lee un reporte de QuickBooks (Balance Sheet o Profit and Loss) exportado a Excel. */
export async function leerReporteQB(base64) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(base64, 'base64'));
  } catch {
    throw new ErrorContable('No se pudo leer el archivo: tiene que ser el Excel (.xlsx) exportado desde el sistema anterior.');
  }
  const ws = wb.worksheets[0];
  const titulo = String(valorCelda(ws.getCell('A2')) ?? '').trim();
  const periodo = String(valorCelda(ws.getCell('A3')) ?? '').trim();
  const cuentas = [];
  ws.eachRow((fila) => {
    const a = String(valorCelda(fila.getCell(1)) ?? '');
    const m = /^(\d{4,6})\s+(.+)$/.exec(a.trim());
    const b = valorCelda(fila.getCell(2));
    if (!m || typeof b !== 'number') return;
    cuentas.push({ numero: m[1], nombre: m[2], monto: Math.round(b * 100) });
  });
  return { titulo, periodo, cuentas, fechaFin: aIso(periodo) };
}

/**
 * Carga como saldos de arranque el Balance Sheet y el Profit and Loss de
 * QuickBooks a la misma fecha. Reemplaza los saldos anteriores.
 */
export async function cargarArranque({ balance, resultados }) {
  const bs = await leerReporteQB(balance);
  const pl = await leerReporteQB(resultados);
  if (!/balance sheet/i.test(bs.titulo)) throw new ErrorContable('El primer archivo no parece un Balance Sheet del sistema anterior.');
  if (!/profit and loss/i.test(pl.titulo)) throw new ErrorContable('El segundo archivo no parece un Profit and Loss del sistema anterior.');
  if (!bs.fechaFin || bs.fechaFin !== pl.fechaFin) {
    throw new ErrorContable(`Las fechas no coinciden: el Balance Sheet es "${bs.periodo}" y el Profit and Loss es "${pl.periodo}". Tienen que estar a la misma fecha.`);
  }
  if (!/^January 1-/i.test(pl.periodo)) throw new ErrorContable('El Profit and Loss tiene que empezar el 1 de enero (acumulado del año hasta la fecha de corte).');

  await asegurarPlan();
  const plan = new Map((await db.prepare('SELECT numero, tipo FROM plan_cuentas').all()).map((c) => [c.numero, c.tipo]));
  const desconocidas = [];
  const filas = new Map();
  for (const c of [...bs.cuentas, ...pl.cuentas]) {
    if (!plan.has(c.numero)) { desconocidas.push(`${c.numero} ${c.nombre}`); continue; }
    // cada archivo aporta solo su tipo de cuentas
    const doBalance = bs.cuentas.includes(c);
    if (doBalance === esResultados(plan.get(c.numero))) continue;
    filas.set(c.numero, c.monto);
  }
  if (desconocidas.length) {
    throw new ErrorContable(`Estas cuentas no están en el plan de cuentas: ${desconocidas.join('; ')}. Agregalas al plan primero.`);
  }
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM saldos_iniciales').run();
    for (const [cuenta, monto] of filas) await tx.prepare('INSERT INTO saldos_iniciales (cuenta, monto) VALUES (?, ?)').run(cuenta, monto);
  });
  await guardarConfig({ corte: bs.fechaFin });
  return { corte: bs.fechaFin, cuentasCargadas: filas.size };
}
