import express from 'express';
import cors from 'cors';
import 'express-async-errors'; // hace que Express reenvíe los errores de handlers async al middleware de errores en vez de dejar la respuesta colgada para siempre
import './db.js'; // se ejecuta primero: crea las tablas si no existen
import { authRouter } from './routes/auth.js';
import { clientesRouter } from './routes/clientes.js';
import { facturasRouter } from './routes/facturas.js';
import { pagosRouter } from './routes/pagos.js';
import { notasCreditoRouter } from './routes/notasCredito.js';
import { auditoriaRouter } from './routes/auditoria.js';
import { configuracionRouter } from './routes/configuracion.js';
import { proveedoresRouter } from './routes/proveedores.js';
import { billsRouter } from './routes/bills.js';
import { cuentasRouter } from './routes/cuentas.js';
import { gastosRouter, reembolsosRouter } from './routes/gastos.js';
import { documentosRouter } from './routes/documentos.js';
import { recordatoriosRouter } from './routes/recordatorios.js';
import { adminRouter } from './routes/admin.js';
import { historialRouter } from './routes/historial.js';
import { catalogoFeesRouter } from './routes/catalogoFees.js';
import { pagosEmailRouter } from './routes/pagosEmail.js';
import { contabilidadRouter } from './routes/contabilidad.js';
import { solicitudesRouter } from './routes/solicitudes.js';
import { soloLecturaParaOperador } from './permisos.js';
import { requiereSesion } from './auth.js';

export const app = express();
// Detrás del proxy de Render hay que confiar en él para ver la IP real.
app.set('trust proxy', 1);
// CORS_ORIGIN: URL(s) del front, separadas por coma (ej. https://tax-invoice.onrender.com).
// Sin definir (desarrollo local) se acepta cualquier origen.
const origenes = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors(origenes.length ? { origin: origenes } : undefined));
app.use(express.json({ limit: '5mb' })); // los documentos adjuntos viajan en base64

// Las rutas de auth no todas requieren sesión (login y la lista para
// elegir usuario tienen que ser accesibles SIN estar logueado todavía).
app.use('/api/auth', authRouter);

// Todo lo demás sí requiere sesión.
app.use('/api/clientes', requiereSesion, soloLecturaParaOperador((req) => /\/fees-pendientes/.test(req.path)), clientesRouter);
app.use('/api/facturas', requiereSesion, facturasRouter);
app.use('/api/pagos', requiereSesion, pagosRouter);
app.use('/api/notas-credito', requiereSesion, soloLecturaParaOperador((req) => req.method === 'PATCH'), notasCreditoRouter);
app.use('/api/auditoria', requiereSesion, auditoriaRouter);
app.use('/api/configuracion', requiereSesion, configuracionRouter);
app.use('/api/proveedores', requiereSesion, soloLecturaParaOperador(), proveedoresRouter);
app.use('/api/bills', requiereSesion, soloLecturaParaOperador(), billsRouter);
app.use('/api/cuentas', requiereSesion, soloLecturaParaOperador(), cuentasRouter);
app.use('/api/gastos', requiereSesion, soloLecturaParaOperador(), gastosRouter);
app.use('/api/reembolsos', requiereSesion, soloLecturaParaOperador(), reembolsosRouter);
app.use('/api/documentos', requiereSesion, documentosRouter);
app.use('/api/recordatorios', requiereSesion, recordatoriosRouter);
app.use('/api/admin', requiereSesion, adminRouter);
app.use('/api/facturas', requiereSesion, historialRouter);
app.use('/api/catalogo-fees', requiereSesion, catalogoFeesRouter);
app.use('/api/pagos-email', requiereSesion, pagosEmailRouter);

app.use('/api/contabilidad', requiereSesion, contabilidadRouter);
app.use('/api/solicitudes', requiereSesion, solicitudesRouter);

app.get('/api/salud', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

// Manejador de errores genérico: si algo tira una excepción no
// contemplada (ej. una restricción de la base de datos), no se cae el
// servidor entero — se devuelve un 500 prolijo.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});
