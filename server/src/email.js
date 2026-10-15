// ─────────────────────────────────────────────────────────────────────
// Envío de mails (factura en PDF al cliente).
// La cuenta que envía se configura en la pantalla Configuración → "Mail
// de facturas" (se guarda en la base). Si ahí no hay datos, se usan las
// variables SMTP_* de server/.env como respaldo. Si no hay ninguna de las
// dos, el envío queda SIMULADO (consola + Auditoría, no sale ningún mail).
// ─────────────────────────────────────────────────────────────────────

import nodemailer from 'nodemailer';
import { db } from './db.js';
import { obtenerToken } from './outlookInbox.js';

export async function cargarConfigMail() {
  const c = (await db.prepare('SELECT * FROM configuracion WHERE id = 1').get()) ?? {};
  const host = c.smtp_host || process.env.SMTP_HOST;
  const usuario = c.smtp_usuario || process.env.SMTP_USER;
  const clave = c.smtp_clave || process.env.SMTP_PASS;
  const puerto = c.smtp_puerto || (process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587);
  const direccion = c.mail_remitente_direccion || process.env.SMTP_FROM || usuario;
  const nombre = c.mail_remitente_nombre || c.empresa_nombre || '';
  const smtpListo = Boolean(host && usuario && clave);
  const msListo = Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
  const metodo = c.mail_metodo || (smtpListo ? 'smtp' : 'graph');
  const buzonEnvio = c.mail_buzon_envio || '';
  return {
    auto: !!c.mail_auto,
    metodo,
    buzonEnvio,
    direccionVisible: c.mail_remitente_direccion || '',
    nombreVisible: nombre,
    configurado: metodo === 'graph' ? Boolean(msListo && buzonEnvio) : smtpListo,
    host, usuario, clave, puerto,
    from: direccion ? (nombre ? `"${nombre.replace(/"/g, '')}" <${direccion}>` : direccion) : undefined,
    replyTo: c.mail_responder_a || undefined,
    asunto: c.mail_asunto || 'Factura #{numero} pagada — {empresa}',
    mensaje:
      c.mail_mensaje ||
      'Hola {nombre},\n\nRecibimos tu pago. Te adjuntamos la factura #{numero} ({concepto}) por {monto}, ya saldada.\n\nGracias,\n{empresa}',
    empresa: c.empresa_nombre || '',
  };
}

export function rellenarPlantilla(texto, vars) {
  return texto.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/** Manda un mail (con adjunto opcional). Devuelve { ok, simulado, detalle }. */
export async function enviarMail({ para, asunto, texto, nombreArchivo, contenido }) {
  const cfg = await cargarConfigMail();
  if (!cfg.configurado) {
    console.info('[Email SIMULADO — falta configurar el mail] Se enviaría:', { para, asunto, nombreArchivo });
    return { ok: true, simulado: true, detalle: 'Simulado — configurá la cuenta de correo en Configuración → Mail de facturas pagas.' };
  }
  if (cfg.metodo === 'graph') return enviarPorGraph(cfg, { para, asunto, texto, nombreArchivo, contenido });
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.puerto,
      secure: cfg.puerto === 465,
      auth: { user: cfg.usuario, pass: cfg.clave },
    });
    await transporter.sendMail({
      from: cfg.from,
      replyTo: cfg.replyTo,
      to: para,
      subject: asunto,
      text: texto,
      attachments: contenido ? [{ filename: nombreArchivo, content: contenido }] : [],
    });
    return { ok: true, simulado: false, detalle: 'Enviado por correo.' };
  } catch (err) {
    console.error('Error enviando mail:', err);
    return { ok: false, simulado: false, detalle: `Error de correo: ${err.message ?? err}` };
  }
}

async function enviarPorGraph(cfg, { para, asunto, texto, nombreArchivo, contenido }) {
  try {
    const token = await obtenerToken();
    const mensaje = {
      subject: asunto,
      body: { contentType: 'Text', content: texto },
      toRecipients: [{ emailAddress: { address: para } }],
    };
    if (cfg.replyTo) mensaje.replyTo = [{ emailAddress: { address: cfg.replyTo } }];
    // Si se quiere mostrar otra dirección (ej. pagos@), el buzón que envía necesita permiso "Enviar como" sobre ella.
    if (cfg.direccionVisible && cfg.direccionVisible.toLowerCase() !== cfg.buzonEnvio.toLowerCase()) {
      mensaje.from = { emailAddress: { address: cfg.direccionVisible, ...(cfg.nombreVisible ? { name: cfg.nombreVisible } : {}) } };
    }
    if (contenido) {
      mensaje.attachments = [
        { '@odata.type': '#microsoft.graph.fileAttachment', name: nombreArchivo, contentType: 'application/pdf', contentBytes: Buffer.from(contenido).toString('base64') },
      ];
    }
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.buzonEnvio)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: mensaje, saveToSentItems: true }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const msg = j.error?.message ?? `HTTP ${r.status}`;
      const pista = r.status === 403 ? ' (¿falta el permiso Mail.Send con consentimiento de administrador, o "Enviar como" para esa dirección?)' : '';
      return { ok: false, simulado: false, detalle: `Microsoft Graph: ${msg}${pista}` };
    }
    return { ok: true, simulado: false, detalle: 'Enviado por correo.' };
  } catch (err) {
    return { ok: false, simulado: false, detalle: `Error de correo: ${err.message ?? err}` };
  }
}

// Compatibilidad con el envío manual desde la factura.
export const enviarMailConAdjunto = enviarMail;

export async function emailConfigurado() {
  return (await cargarConfigMail()).configurado;
}
