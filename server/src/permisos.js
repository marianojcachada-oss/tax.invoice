import { db } from './db.js';
import { generarId, registrarAuditoria } from './utils.js';

// Roles:
//   admin       control total (estudio contable / dueños): aprueba solicitudes y cierra períodos.
//   supervisor  ve todo (incluidos los informes) pero no borra facturas.
//   operador    crea facturas, recibe pagos y ve clientes; no ve informes ni modifica documentos.
export const ROLES = ['admin', 'supervisor', 'operador'];
export const esAdmin = (u) => u?.rol === 'admin';
export const puedeVerInformes = (u) => u?.rol === 'admin' || u?.rol === 'supervisor';

export class ErrorHttp extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

/** Respuesta a un error de negocio o, si es otra cosa, que lo maneje el manejador general. */
export function responderError(res, e, next) {
  if (e instanceof ErrorHttp) return res.status(e.estado).json({ error: e.message });
  return next(e);
}

export function requiereInformes(req, res, next) {
  if (!puedeVerInformes(req.usuario)) return res.status(403).json({ error: 'Tu rol no tiene acceso a los informes.' });
  next();
}

/** Los operadores pueden consultar pero no escribir (salvo lo que se exceptúe en `permitir`). */
export function soloLecturaParaOperador(permitir = () => false) {
  return (req, res, next) => {
    if (req.usuario?.rol === 'operador' && req.method !== 'GET' && !permitir(req)) {
      return res.status(403).json({ error: 'Tu rol solo puede consultar esta sección. Si necesitás un cambio, pedíselo al sector contable.' });
    }
    next();
  };
}

// ─── Cierre contable ─────────────────────────────────────────────────
export async function cierreHasta(conn = db) {
  const f = await conn.prepare('SELECT cierre_hasta FROM configuracion WHERE id = 1').get();
  return f?.cierre_hasta || null;
}
export async function periodoCerrado(fecha, conn = db) {
  const c = await cierreHasta(conn);
  return !!c && String(fecha).slice(0, 10) <= c;
}

// ─── Solicitudes ─────────────────────────────────────────────────────
const ejecutores = new Map();
/** Cada tipo de cambio registra cómo se ejecuta cuando un administrador lo aprueba. */
export function registrarEjecutor(tipo, fn) {
  ejecutores.set(tipo, fn);
}
export const ejecutorDe = (tipo) => ejecutores.get(tipo);

export const serializarSolicitud = (s) => ({
  id: s.id,
  tipo: s.tipo,
  entidad: s.entidad,
  entidadId: s.entidad_id,
  resumen: s.resumen,
  detalle: JSON.parse(s.detalle),
  motivo: s.motivo ?? undefined,
  solicitanteId: s.solicitante_id,
  solicitante: s.solicitante,
  creada: s.creada,
  estado: s.estado,
  resueltaPor: s.resuelta_por ?? undefined,
  resuelta: s.resuelta ?? undefined,
  nota: s.nota ?? undefined,
});

async function crearSolicitud(req, { tipo, entidad, entidadId, resumen, detalle, payload, motivo }) {
  const id = generarId('sol');
  await db
    .prepare(
      `INSERT INTO solicitudes (id, tipo, entidad, entidad_id, resumen, detalle, payload, motivo, solicitante_id, solicitante, creada, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')`
    )
    .run(id, tipo, entidad, entidadId, resumen, JSON.stringify(detalle), JSON.stringify(payload), motivo ?? null, req.usuario.id, req.usuario.nombre, new Date().toISOString());
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Pidió autorización',
    entidad,
    entidadId,
    resumen: `${resumen}${motivo ? ` (${motivo})` : ''}`,
    cambios: detalle,
  });
  return serializarSolicitud(await db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(id));
}

/**
 * Decide si un cambio se hace ahora o si queda como solicitud pendiente.
 *  - permitido: el rol puede hacerlo directo (según las reglas de cada acción).
 *  - fecha: fecha del documento, para saber si su mes está cerrado.
 * Un mes cerrado no se toca directo ni siquiera siendo administrador: se aprueba una solicitud o se reabre el período.
 */
export async function ejecutarOSolicitar(req, res, { tipo, entidad, entidadId, fecha, resumen, detalle, payload, permitido, aplicar }) {
  const cerrado = fecha ? await periodoCerrado(fecha) : false;
  if (cerrado && esAdmin(req.usuario)) {
    const hasta = await cierreHasta();
    throw new ErrorHttp(423, `Ese documento es de un período cerrado (hasta el ${hasta}). Reabrí el período en Configuración → Cierre contable para modificarlo.`);
  }
  if (!cerrado && permitido) return res.json(await aplicar());
  const motivo = cerrado ? 'el período está cerrado' : 'tu rol necesita autorización para este cambio';
  const solicitud = await crearSolicitud(req, { tipo, entidad, entidadId, resumen, detalle, payload, motivo });
  return res.status(202).json({
    solicitud,
    mensaje: 'El cambio se solicitó al sector contable. Se va a aplicar cuando lo aprueben.',
  });
}
