import { Router } from 'express';
import { db } from '../db.js';
import { generarId, registrarAuditoria } from '../utils.js';
import { hashPin, verificarPin, crearToken, requiereSesion, requiereAdmin } from '../auth.js';

export const authRouter = Router();

function serializarUsuario(row) {
  return { id: row.id, nombre: row.nombre, email: row.email, rol: row.rol, activo: !!row.activo };
}

// Lista pública de quién puede entrar (nombre y rol, nunca el PIN) para
// armar la pantalla de login sin necesitar sesión todavía.
authRouter.get('/usuarios-para-login', async (req, res) => {
  const filas = await db.prepare('SELECT id, nombre, rol FROM usuarios WHERE activo = true').all();
  res.json(filas);
});

// Bloqueo simple por usuario: 5 PIN incorrectos seguidos → 15 minutos de espera.
const intentos = new Map();
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

authRouter.post('/login', async (req, res) => {
  const { usuarioId, pin } = req.body;
  const reg = intentos.get(usuarioId);
  if (reg && reg.hasta && reg.hasta > Date.now()) {
    const min = Math.ceil((reg.hasta - Date.now()) / 60000);
    return res.status(429).json({ error: `Demasiados intentos. Probá de nuevo en ${min} min.` });
  }
  const usuario = await db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = true').get(usuarioId);
  if (!usuario || !verificarPin(pin, usuario.pin_hash)) {
    const r = intentos.get(usuarioId) ?? { n: 0, hasta: 0 };
    r.n += 1;
    if (r.n >= MAX_INTENTOS) { r.hasta = Date.now() + BLOQUEO_MS; r.n = 0; }
    intentos.set(usuarioId, r);
    return res.status(401).json({ error: 'Usuario o PIN incorrecto.' });
  }
  intentos.delete(usuarioId);
  const token = crearToken(usuario);
  await registrarAuditoria({ usuario: usuario.nombre, accion: 'Inició sesión', entidad: 'Usuario', entidadId: usuario.id, resumen: `${usuario.nombre} inició sesión` });
  res.json({ token, usuario: serializarUsuario(usuario) });
});

authRouter.post('/logout', requiereSesion, async (req, res) => {
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Cerró sesión', entidad: 'Usuario', entidadId: req.usuario.id, resumen: `${req.usuario.nombre} cerró sesión` });
  res.json({ ok: true });
});

authRouter.get('/yo', requiereSesion, async (req, res) => {
  const usuario = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
  res.json(serializarUsuario(usuario));
});

authRouter.get('/usuarios', requiereSesion, requiereAdmin, async (req, res) => {
  const filas = await db.prepare('SELECT * FROM usuarios').all();
  res.json(filas.map(serializarUsuario));
});

authRouter.post('/usuarios', requiereSesion, requiereAdmin, async (req, res) => {
  const { nombre, email, rol, pin } = req.body;
  if (!nombre || !rol || !pin || pin.length !== 4) {
    return res.status(400).json({ error: 'Faltan datos (nombre, rol, pin de 4 dígitos).' });
  }
  const id = generarId('user');
  await db.prepare('INSERT INTO usuarios (id, nombre, email, rol, pin_hash, activo) VALUES (?, ?, ?, ?, ?, true)').run(
    id,
    nombre,
    email || null,
    rol,
    hashPin(pin)
  );
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Creó usuario', entidad: 'Usuario', entidadId: id, resumen: `Alta de ${nombre} (${rol})` });
  const creado = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  res.status(201).json(serializarUsuario(creado));
});

authRouter.patch('/usuarios/:id', requiereSesion, requiereAdmin, async (req, res) => {
  const { id } = req.params;
  const actual = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!actual) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const rol = req.body.rol ?? actual.rol;
  const activo = req.body.activo !== undefined ? !!req.body.activo : actual.activo;
  const pinHash = req.body.pin ? hashPin(req.body.pin) : actual.pin_hash;

  await db.prepare('UPDATE usuarios SET rol = ?, activo = ?, pin_hash = ? WHERE id = ?').run(rol, activo, pinHash, id);
  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Editó usuario', entidad: 'Usuario', entidadId: id, resumen: `Se actualizó a ${actual.nombre}` });
  const actualizado = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  res.json(serializarUsuario(actualizado));
});
