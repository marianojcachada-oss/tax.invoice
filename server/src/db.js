import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'Falta DATABASE_URL en las variables de entorno. Copiá server/.env.example a server/.env y completá la cadena de conexión (ver server/BASE_DE_DATOS.md — tanto para Postgres local como para Supabase).'
  );
  process.exit(1);
}

// Supabase (y la mayoría de los Postgres alojados) piden SSL, pero con un
// certificado que Node no siempre puede validar de cadena completa sin
// configuración extra — por eso "rejectUnauthorized: false". Para una base
// local (desarrollo/pruebas) no hace falta SSL.
const esLocal = /localhost|127\.0\.0\.1/.test(connectionString);
export const pool = new Pool({
  connectionString,
  ssl: esLocal ? false : { rejectUnauthorized: false },
});

// ─────────────────────────────────────────────────────────────────────
// Capa de compatibilidad: el resto del código (rutas ya escritas) usa el
// mismo patrón que con better-sqlite3 — db.prepare(sql).get()/.all()/.run()
// con "?" como placeholder — para no tener que reescribir cada consulta a
// mano. Acá adentro se convierte "?" a "$1,$2,..." (sintaxis de Postgres)
// y se ejecuta contra el pool. La única diferencia real para quien escribe
// una ruta nueva es que estos métodos son ASYNC ahora (hay que usar
// "await"), porque una conexión de red de verdad no puede ser síncrona
// como lo era el archivo local de SQLite.
// ─────────────────────────────────────────────────────────────────────

function convertirPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function crearPrepare(ejecutar) {
  return function prepare(sql) {
    const sqlConvertido = convertirPlaceholders(sql);
    return {
      async get(...params) {
        const res = await ejecutar(sqlConvertido, params);
        return res.rows[0];
      },
      async all(...params) {
        const res = await ejecutar(sqlConvertido, params);
        return res.rows;
      },
      async run(...params) {
        const res = await ejecutar(sqlConvertido, params);
        return { changes: res.rowCount };
      },
    };
  };
}

export const db = {
  prepare: crearPrepare((sql, params) => pool.query(sql, params)),

  /** Corre `fn(tx)` dentro de una transacción real (BEGIN/COMMIT/ROLLBACK)
   * sobre UNA misma conexión del pool. Hay que usar `tx.prepare(...)` en
   * vez de `db.prepare(...)` adentro de `fn`, para que todas las consultas
   * de esa transacción vayan por la misma conexión — si se mezclara con
   * `db.prepare` (que toma cualquier conexión libre del pool), dos
   * consultas de la "misma" transacción podrían terminar en conexiones
   * distintas y la atomicidad se rompería. */
  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = { prepare: crearPrepare((sql, params) => client.query(sql, params)) };
      const resultado = await fn(tx);
      await client.query('COMMIT');
      return resultado;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
};

const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
await pool.query(schema);
