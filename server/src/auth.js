import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

// En producción esto tiene que venir de una variable de entorno real y
// mantenerse en secreto. Se genera un valor por defecto solo para que el
// servidor arranque sin configuración extra en desarrollo.
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  // En un servidor público un secreto por defecto permitiría falsificar sesiones de admin.
  console.error('Falta JWT_SECRET (mínimo 32 caracteres) en producción. Generá uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-este-secreto-en-produccion';
const JWT_EXPIRES_IN = '12h';

export function hashPin(pin) {
  return bcrypt.hashSync(pin, 10);
}

export function verificarPin(pin, hash) {
  return bcrypt.compareSync(pin, hash);
}

export function crearToken(usuario) {
  return jwt.sign({ id: usuario.id, rol: usuario.rol, nombre: usuario.nombre }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/** Middleware: exige un token válido en el header Authorization. */
export async function requiereSesion(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No hay sesión activa.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const usuario = await db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = true').get(payload.id);
    if (!usuario) return res.status(401).json({ error: 'La sesión ya no es válida.' });
    req.usuario = { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol };
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o vencida.' });
  }
}

/** Middleware: además de tener sesión, exige rol admin. */
export function requiereAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') {
    return res.status(403).json({ error: 'Esta acción es solo para administradores.' });
  }
  next();
}
