# Base de datos: local o Supabase

El servidor habla con Postgres a través de una sola variable
(`DATABASE_URL` en `server/.env`) — no le importa si ese Postgres está en
tu computadora o alojado en Supabase, la conexión funciona igual. Elegí
la opción que te sirva ahora; podés cambiar de una a otra después nomás
editando esa variable.

## Opción A: Postgres local (Windows) — la que estás usando ahora

1. **Instalar Postgres.** Dos formas:
   - Con winget (más rápido, desde PowerShell):
     ```
     winget install PostgreSQL.PostgreSQL
     ```
   - O bajando el instalador de siempre: https://www.postgresql.org/download/windows/
     (elegí la versión más reciente, 16 o 17).

2. **Durante la instalación**, te va a pedir una contraseña para el
   usuario `postgres` — anotala, la vas a necesitar. El puerto por
   defecto es `5432`, dejalo así salvo que ya tengas algo corriendo ahí.

3. **Crear la base de datos.** El instalador también instala **pgAdmin**
   (una interfaz gráfica). Abrilo, conectate con el usuario `postgres` y
   la contraseña que pusiste, click derecho en "Databases" -> "Create" ->
   "Database", y ponele de nombre `taxi_cobros`.

   (Si preferís la línea de comandos: abrí "SQL Shell (psql)" desde el
   menú de Windows, apretá Enter en todas las preguntas hasta que te pida
   la contraseña, y corré `CREATE DATABASE taxi_cobros;`)

4. **Configurar `server/.env`:**
   ```
   DATABASE_URL=postgresql://postgres:TU-CONTRASEÑA@localhost:5432/taxi_cobros
   ```
   (sin SSL — el servidor ya detecta que es `localhost` y no lo exige)

5. **Correr todo como siempre:**
   ```bash
   cd server
   npm install
   npm run seed
   npm run dev
   ```

Para empezar de cero en cualquier momento: borrá y volvé a crear la base
(`DROP DATABASE taxi_cobros; CREATE DATABASE taxi_cobros;` en psql, o los
mismos clics en pgAdmin) y corré `npm run seed` de nuevo.

## Opción B: Supabase (para cuando quieras alojarlo más adelante)

Si en el futuro upgradeás el plan de Supabase o liberás espacio borrando
otro proyecto, el camino es el mismo de siempre:

1. Crear el proyecto en [supabase.com](https://supabase.com).
2. `Project Settings -> Database -> Connection string` (modo "Session").
3. Pegar esa cadena en `DATABASE_URL` en vez de la local.
4. `npm run seed` (una sola vez) y listo.

No hace falta tocar nada más del código para pasar de una opción a la
otra — es literalmente cambiar una línea en `.env`.

## Nota sobre SSL

El servidor decide solo si usa SSL o no, mirando si `DATABASE_URL`
contiene `localhost` o `127.0.0.1` (ver `server/src/db.js`). Para
Postgres local no hace falta SSL; para Supabase (o cualquier otro
Postgres alojado) sí, y ya se activa automáticamente.
