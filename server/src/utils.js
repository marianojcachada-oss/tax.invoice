import crypto from 'node:crypto';
import { db } from './db.js';

export function generarId(prefijo) {
  return `${prefijo}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// Los montos viajan en dólares por la API (igual que antes en el
// frontend), pero se guardan en centavos en la base para evitar el típico
// problema de redondeo de punto flotante con plata.
export function aCentavos(dolares) {
  return Math.round(Number(dolares) * 100);
}

export function aDolares(centavos) {
  return Math.round(centavos) / 100;
}

export function registrarAuditoria({ usuario, accion, entidad, entidadId, resumen, cambios }) {
  return db
    .prepare(
      `INSERT INTO auditoria (id, fecha, usuario, accion, entidad, entidad_id, resumen, cambios)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(generarId('audit'), new Date().toISOString(), usuario, accion, entidad, entidadId, resumen, cambios ? JSON.stringify(cambios) : null);
}
