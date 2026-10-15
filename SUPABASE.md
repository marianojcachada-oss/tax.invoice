# Conectar la base de datos a Supabase

El servidor ya está migrado a Postgres (antes era SQLite), así que se
conecta directo a Supabase — Supabase, en el fondo, es Postgres alojado
más un montón de extras. No hace falta usar el SDK ni la API de Supabase
para esto: alcanza con la cadena de conexión de Postgres.

## Paso a paso

1. **Creá la cuenta y el proyecto.** Andá a [supabase.com](https://supabase.com),
   creá una cuenta (gratis) y un proyecto nuevo. Elegí una contraseña
   fuerte para la base de datos — Supabase te la pide al crear el
   proyecto y no se puede ver después, solo resetear. Guardala en un
   lugar seguro.

2. **Esperá a que el proyecto termine de aprovisionarse** (1-2 minutos).

3. **Sacá la cadena de conexión.** Dentro del proyecto: `Project Settings`
   (el ícono de engranaje) -> `Database` -> `Connection string`. Elegí el
   modo **"Session"** (puerto 5432) para uso normal, o **"Transaction"**
   (puerto 6543, con pgbouncer) si vas a tener muchas conexiones
   simultáneas más adelante. Para este proyecto, con "Session" alcanza y
   sobra. Copiá la cadena completa — se ve así:
   ```
   postgresql://postgres.xxxxxxxxxxxx:[TU-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   ```
   Reemplazá `[TU-PASSWORD]` por la contraseña real que pusiste en el
   paso 1 (Supabase la deja como placeholder literal en el string que
   copiás, hay que pegarla a mano).

4. **Pegala en `server/.env`:**
   ```
   DATABASE_URL=postgresql://postgres.xxxxxxxxxxxx:tu-password-real@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   ```

5. **Corré el servidor.** La primera vez que arranca, `db.js` crea todas
   las tablas solo (lee `schema.sql` y lo ejecuta) — no hace falta correr
   nada a mano en el SQL Editor de Supabase, salvo que prefieras revisar
   el esquema ahí antes.
   ```bash
   cd server
   npm install
   npm run seed   # crea los usuarios y unos clientes de ejemplo (una sola vez)
   npm run dev
   ```

6. **Confirmá que se conectó de verdad.** Entrá a tu proyecto de Supabase
   -> `Table Editor` -> deberías ver las tablas (`clientes`, `facturas`,
   `pagos`, etc.) ya creadas, y las filas de ejemplo si corriste el seed.

## Cosas para tener en cuenta

- **`sslmode`**: la cadena de conexión de Supabase no siempre incluye
  `?sslmode=require` explícito, pero el servidor ya fuerza SSL
  automáticamente para cualquier conexión que no sea `localhost` (ver
  `server/src/db.js`), así que no hace falta agregarlo a mano.
- **El plan gratis de Supabase pausa el proyecto** si no tiene actividad
  por un tiempo prolongado (normalmente una semana). Se reactiva solo con
  el primer pedido, pero esa primera conexión puede tardar unos segundos
  más de lo normal.
- **Esto NO usa Supabase Auth, ni Row Level Security, ni Storage.** Se
  está usando Supabase pura y exclusivamente como una base de datos
  Postgres alojada — la autenticación (PIN + JWT) y toda la lógica de
  negocio siguen viviendo en este servidor Express, no en Supabase. Es
  una decisión a propósito: ya teníamos esa lógica escrita y probada en
  JavaScript, reescribirla como funciones de Postgres (PL/pgSQL) para
  aprovechar RLS hubiera sido un trabajo mucho más grande y arriesgado
  para el mismo resultado práctico.
- **El servidor Express en sí segue corriendo en tu computadora** (como
  pediste) — Supabase aloja la base, no el servidor. El día que quieras
  que el sitio completo sea accesible desde cualquier lado, ese Express
  hay que subirlo a algún lado (Railway, Render, Fly.io son buenas
  opciones con plan gratis) apuntando al mismo `DATABASE_URL`.
