# Publicar tax.invoice (versión de prueba) en Render + Supabase

## Cómo queda armado

```
Navegador ──► Render "Static Site"  (el front: React, carpeta dist)
                  │  llama a
                  ▼
              Render "Web Service"  (la API: Node/Express, carpeta server)
                  │  se conecta a
                  ▼
              Supabase (Postgres)   ← acá viven los datos
```

Un *Static Site* solo sirve el front. Este proyecto además tiene servidor
(login, Outlook, Gmail, PDFs, mails), así que hacen falta **los dos** servicios
de Render. Supabase es solo la base de datos: el servidor se conecta con la
cadena `DATABASE_URL`, no usa nada más de Supabase.

> **Importante: usá el plan Starter (≈ US$7/mes) para la API.** El plan gratis
> se "duerme" a los 15 minutos sin visitas, y mientras duerme **no lee los
> mails de Zelle/Kotapay**. Para probar con el front alcanza con el gratis
> (con la primera carga lenta), pero la bandeja automática necesita Starter.

---

## 1. Supabase (la base)

1. Creá el proyecto en supabase.com. Región: **East US (N. Virginia)**, la más
   cercana a Atlanta. Guardá la contraseña de la base.
2. `Project Settings → Database → Connection string`. Elegí **Session pooler**
   (puerto 5432). Render solo tiene IPv4 y la conexión "Direct" de Supabase es
   IPv6: con esa no conecta.
3. Copiá la cadena y reemplazá `[YOUR-PASSWORD]` por la real:
   `postgresql://postgres.xxxx:TU-PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres`

Las tablas se crean solas la primera vez que arranca el servidor, y quedan con
**Row Level Security activado** (sin eso, la API pública de Supabase podría
leer tus clientes con la clave "anon").

## 2. Pasar tus datos de la base local a Supabase

Hacelo una sola vez, desde la PC con tu Postgres local (usa `pg_dump` y `psql`,
que vienen con Postgres):

1. En `server/.env` poné **temporalmente** la `DATABASE_URL` de Supabase, corré
   `npm run dev` dentro de `server`, esperá el mensaje "escuchando" y cortalo
   con Ctrl+C. Con eso se crearon las tablas vacías. Dejá el `.env` como estaba.
2. Sacá los datos de la base local:
   ```
   pg_dump "postgresql://postgres:taxi123@localhost:5432/taxi_cobros" --data-only --no-owner --column-inserts -f datos.sql
   ```
3. Cargalos en Supabase:
   ```
   psql "postgresql://postgres.xxxx:TU-PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres" -f datos.sql
   ```
4. Ajustá los contadores automáticos (en el SQL Editor de Supabase):
   ```sql
   SELECT setval(pg_get_serial_sequence('pago_aplicaciones','id'), COALESCE((SELECT MAX(id) FROM pago_aplicaciones),0)+1, false);
   SELECT setval(pg_get_serial_sequence('nota_credito_facturas','id'), COALESCE((SELECT MAX(id) FROM nota_credito_facturas),0)+1, false);
   SELECT setval(pg_get_serial_sequence('bill_pago_aplicaciones','id'), COALESCE((SELECT MAX(id) FROM bill_pago_aplicaciones),0)+1, false);
   ```
5. Borrá `datos.sql` de tu PC cuando termines: tiene todos los datos de clientes.

Si todavía no tenés datos reales (versión de prueba vacía), salteá esta sección.

## 3. Subir el código a GitHub

1. Creá un repositorio **privado** y subí la carpeta del proyecto (no subas
   `node_modules`, `dist` ni `server/.env`: ya están en los `.gitignore`).
2. Revisá antes de subir que `server/.env` **no** aparezca en `git status`.

## 4. Render

1. En Render: **New → Blueprint** y elegí el repositorio. Lee `render.yaml` y
   propone los dos servicios (`tax-invoice-api` y `tax-invoice`).
2. Cargá las variables que quedan en blanco:

   **tax-invoice-api**
   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | la cadena del Session pooler de Supabase |
   | `CORS_ORIGIN` | la URL del sitio (ej. `https://tax-invoice.onrender.com`) |
   | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_MAILBOX` | las mismas del `.env` local (Zelle) |
   | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | cuando quieras activar Kotapay |

   `JWT_SECRET` lo genera Render solo. `NODE_ENV=production` ya viene puesto.

   **tax-invoice** (el sitio)
   | Variable | Valor |
   |---|---|
   | `VITE_API_URL` | la URL de la API + `/api` (ej. `https://tax-invoice-api.onrender.com/api`) |

   Las URLs exactas las ves en Render después de crear los servicios; si
   cambian, corregí las dos variables y volvé a desplegar el sitio (el front
   toma `VITE_API_URL` al *construirse*).
3. Probá `https://…-api.onrender.com/api/salud`: tiene que responder `{"ok":true…}`.

## 5. Crear tu usuario administrador

**No corras `npm run seed` en producción**: crea usuarios de ejemplo con PINs
conocidos (1234 y 5678). Si pasaste tus datos en el paso 2, tus usuarios reales
ya están. Si no, creá el administrador desde la pestaña *Shell* del servicio de
Render (o desde tu PC con la `DATABASE_URL` de Supabase):

```
npm run crear-admin -- "Tu Nombre" 4821
```

(elegí un PIN que no sea 1234, 0000, etc.: el comando los rechaza). Si pasaste
datos de la base local y alguno de tus usuarios todavía tiene PIN 1234 o 5678,
cambialo desde Configuración antes de compartir la URL.

## 6. Actualizar en el futuro

- **Cambios de código:** hacés `git push` y Render redespliega solo (API y
  sitio). Las tablas nuevas o columnas nuevas se aplican solas al reiniciar
  la API (el esquema usa `IF NOT EXISTS`).
- **Cambios de variables:** se editan en Render y la API se reinicia.
- **Respaldo:** Supabase gratis no incluye backups descargables automáticos.
  Antes de operar de verdad, programá un `pg_dump` periódico o pasá a un plan
  con backups.

## Seguridad antes de compartir la URL

- Es un sistema con datos reales de clientes y el acceso es por **PIN de 4
  dígitos**. El servidor bloquea 15 minutos tras 5 intentos fallidos por
  usuario, pero para uso real conviene pasar a una clave más larga o poner
  el sitio detrás de un acceso adicional. Para la prueba: no publiques la URL
  y usá PINs no obvios.
- `JWT_SECRET`, `MS_CLIENT_SECRET` y `GMAIL_APP_PASSWORD` solo van en las
  variables de Render, nunca en el código ni en GitHub.
- Si probás con datos reales, avisá a quien corresponda: el dato de clientes
  (nombres, teléfonos, direcciones) queda alojado en Supabase y Render.
