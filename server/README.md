# Servidor de Taxi Cobros

Backend real (Node + Express + **Postgres**) para reemplazar el
localStorage del frontend. Mismo modelo de datos, misma lógica de negocio
(pagos parciales, edición de pagos, notas de crédito, facturación semanal
que respeta clientes activos/inactivos, roles admin/operador) — con
validaciones del lado del servidor y transacciones reales.

La base de datos vive en **Supabase** (Postgres alojado) — ver
`SUPABASE.md` para crear tu proyecto y conectar. También podés usar
cualquier otro Postgres (uno local, por ejemplo) apuntando `DATABASE_URL`
a esa conexión en su lugar.

## Instalar y correr

```bash
cd server
npm install
cp .env.example .env       # completar DATABASE_URL (ver SUPABASE.md)
npm run seed                # crea las tablas y los datos iniciales (una sola vez)
npm run dev                 # arranca en http://localhost:4000
```

Usuarios de prueba ya cargados: **Luis** (admin, PIN 1234) y **Ana**
(operador, PIN 5678).

## Conectar RingCentral de verdad

Completar en `server/.env`:
```
RC_CLIENT_ID=...
RC_CLIENT_SECRET=...
RC_JWT=...
RC_NUMERO_DESDE=...
```
Mientras estén vacías, los recordatorios funcionan en modo simulado (se
ven en la consola del servidor y quedan en Auditoría, pero no se manda
ningún SMS real).

## Pruebas automatizadas

```bash
npm test
```
Corre 9 pruebas (`node:test`, sin dependencias extra) contra una base de
Postgres de prueba — hay que tener Postgres disponible localmente para
correrlas (el script de test usa
`postgresql://postgres:postgres@localhost:5432/taxi_cobros_test` por
defecto; se puede ajustar en el script `test` de `package.json`). Las
tablas se limpian solas al principio de cada corrida, así que es seguro
correrlo las veces que haga falta.

## Qué falta para que el frontend lo use en producción

El servidor ya funciona de punta a punta contra Postgres real (probado a
mano y con pruebas automatizadas: login, pago parcial, corrección de
pago, exceso de aplicación rechazado, generación semanal, restricción de
rol). Sigue corriendo localmente en tu computadora, tal como decidiste —
para que sea un sitio accesible desde cualquier lado, el próximo paso
sería subir este servidor a un hosting (Railway, Render, Fly.io) apuntando
al mismo `DATABASE_URL` de Supabase, y el frontend a Vercel/Netlify.

## Endpoints principales

- `POST /api/auth/login` — `{ usuarioId, pin }` → `{ token, usuario }`
- `GET /api/clientes`, `POST /api/clientes`, `PATCH /api/clientes/:id`
- `GET /api/facturas`, `POST /api/facturas`, `POST /api/facturas/generar-semanal`
- `GET /api/pagos`, `POST /api/pagos`, `PATCH /api/pagos/:id`
- `POST /api/notas-credito`, `POST /api/notas-credito/:id/aplicar`
- `GET/POST /api/proveedores`, `GET/POST /api/bills`, `GET/POST /api/bills/pagos`
- `GET/POST /api/cuentas`, `GET/POST /api/cuentas/transferencias`
- `GET/POST /api/gastos`, `GET/POST /api/reembolsos`
- `GET/POST/DELETE /api/documentos`
- `GET/PATCH /api/configuracion` (PATCH solo admin)
- `GET /api/auditoria` (log completo solo admin; con `?entidad=X&entidadId=Y` cualquiera logueado)
- `POST /api/recordatorios/cliente/:id`, `POST /api/recordatorios/masivo`
