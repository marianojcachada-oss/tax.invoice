// Crea (o actualiza el PIN de) un usuario administrador SIN pasar por el seed,
// que crea usuarios de ejemplo con PINs conocidos. Uso:
//   npm run crear-admin -- "Nombre Apellido" 4821
import { db, pool } from './db.js';
import { hashPin } from './auth.js';
import { generarId } from './utils.js';

const [nombre, pin] = process.argv.slice(2);
const debiles = new Set(['0000', '1111', '1234', '4321', '5678', '1212', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '0123']);
if (!nombre || !/^\d{4}$/.test(pin ?? '')) {
  console.error('Uso: npm run crear-admin -- "Nombre Apellido" PIN_DE_4_DIGITOS');
  process.exit(1);
}
if (debiles.has(pin)) {
  console.error('Ese PIN es demasiado fácil de adivinar. Elegí otro.');
  process.exit(1);
}
const ya = await db.prepare('SELECT id FROM usuarios WHERE nombre = ?').get(nombre);
if (ya) {
  await db.prepare("UPDATE usuarios SET pin_hash = ?, rol = 'admin', activo = true WHERE id = ?").run(hashPin(pin), ya.id);
  console.log(`Se actualizó el PIN de ${nombre} (admin).`);
} else {
  await db
    .prepare('INSERT INTO usuarios (id, nombre, email, rol, pin_hash, activo) VALUES (?, ?, ?, ?, ?, true)')
    .run(generarId('user'), nombre, null, 'admin', hashPin(pin));
  console.log(`Administrador ${nombre} creado.`);
}
await pool.end();
