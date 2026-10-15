// Pagos con tarjeta de Kotapay: llegan al Gmail de la empresa como
// "Receipt for Vehicle Number: 521-cc (Nombre)" desde WebAdmin.
// Se leen por IMAP con una contraseña de aplicación de Google.
// imapflow y mailparser se cargan recién al leer Gmail: si todavía no se corrió
// `npm install`, el servidor arranca igual y solo falla la lectura de Kotapay.

export function gmailConfigurado() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function campo(texto, etiqueta) {
  const m = texto.match(new RegExp(`${etiqueta}\\s*:?\\s*(.+?)(?=\\s{2,}|\\n|$)`, 'i'));
  return m ? m[1].trim() : null;
}

// Devuelve { remitente, monto, descripcion, origen:'kotapay', vehiculo, referencia,
// resultado:'aprobado'|'rechazado', motivoRechazo } o null si no es un mail de Kotapay.
// Hay dos formatos: "Receipt for Vehicle Number: 521-cc (Nombre)" (pago exitoso) y
// "Credit Card transaction declined (Nombre)" con "200-Decline" (rechazado).
export function parsearKotapay(asunto = '', cuerpo = '') {
  const texto = cuerpo.replace(/\u00a0/g, ' ');
  const rechazado = /transaction declined/i.test(asunto) || /\b\d{3}\s*-\s*Decline/i.test(texto);
  const exitoso = /Receipt for Vehicle Number/i.test(asunto) || /Your payment was successful/i.test(texto);
  if (!rechazado && !exitoso) return null;

  const tomar = (etiqueta, sig) => {
    const m = texto.match(new RegExp(`${etiqueta}\\s*:\\s*(.+?)\\s+(?:${sig})\\s*:`, 'i'));
    return m ? m[1].trim() : null;
  };
  const montoTxt = texto.match(/Amount\s*:\s*\$?\s*([\d,]+\.\d{2})/i);
  if (!montoTxt) return null;
  const monto = Number(montoTxt[1].replace(/,/g, ''));
  if (!(monto > 0)) return null;

  const nombreAsunto = (asunto.match(/\(([^()]+)\)\s*$/) || [])[1]?.trim();
  const vehiculo =
    (texto.match(/Vehicle Number\s*:\s*(\d+)/i) || [])[1] ||
    (asunto.match(/Vehicle Number:\s*(\d+)/i) || [])[1] ||
    null;
  const titularTarjeta = tomar('Cardholder', 'Card type');
  // el "remitente" es el chofer (el del asunto); el titular de la tarjeta puede ser otra persona
  const remitente = nombreAsunto || tomar('Name', 'Email') || titularTarjeta || 'Kotapay';
  const tipo = tomar('Card type', 'Card number');
  const tarjeta = (texto.match(/Card number\s*:\s*\*+\s*(\d{4})/i) || [])[1];
  const aprobacion = (texto.match(/Approval code\s*:\s*(\w+)/i) || [])[1];
  const transaccion = (texto.match(/Transaction ID\s*:\s*(\w+)/i) || [])[1];
  const codigoRechazo = (texto.match(/\b(\d{3}\s*-\s*Decline\w*)/i) || [])[1]?.replace(/\s+/g, '');

  const partes = [
    'Kotapay',
    rechazado ? `RECHAZADO${codigoRechazo ? ` (${codigoRechazo})` : ''}` : null,
    vehiculo ? `Vehículo ${vehiculo}` : null,
    tipo && tarjeta ? `${tipo} ****${tarjeta}` : null,
    titularTarjeta && nombreAsunto && titularTarjeta.toLowerCase() !== nombreAsunto.toLowerCase() ? `Titular: ${titularTarjeta}` : null,
    !rechazado && aprobacion ? `Aprob. ${aprobacion}` : null,
  ].filter(Boolean);
  return {
    remitente,
    monto,
    descripcion: partes.join(' · '),
    origen: 'kotapay',
    vehiculo,
    referencia: transaccion ?? aprobacion ?? null,
    resultado: rechazado ? 'rechazado' : 'aprobado',
    motivoRechazo: rechazado ? codigoRechazo ?? 'Decline' : null,
  };
}

function horaAtlanta(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
function fechaAtlanta(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

export async function buscarPagosKotapay() {
  let ImapFlow, simpleParser;
  try {
    ({ ImapFlow } = await import('imapflow'));
    ({ simpleParser } = await import('mailparser'));
  } catch {
    throw new Error('Faltan paquetes para leer Gmail: corré `npm install` dentro de la carpeta server y reiniciá.');
  }
  const cliente = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    logger: false,
  });
  const salida = [];
  try {
    await cliente.connect();
    const lock = await cliente.getMailboxLock(process.env.GMAIL_CARPETA || 'INBOX');
    try {
      const desde = new Date(Date.now() - 14 * 24 * 3600 * 1000);
      const uids = await cliente.search({ or: [{ subject: 'Receipt for Vehicle Number' }, { subject: 'transaction declined' }], since: desde });
      for (const uid of (uids || []).slice(-60)) {
        const msg = await cliente.fetchOne(uid, { source: true, envelope: true, internalDate: true });
        const mail = await simpleParser(msg.source);
        const cuerpo = (mail.text || '').replace(/\s+/g, ' ') || (mail.html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
        const p = parsearKotapay(mail.subject || '', cuerpo);
        if (!p) continue;
        const cuando = mail.date || msg.internalDate;
        salida.push({ messageId: mail.messageId || `gmail-${uid}`, fecha: fechaAtlanta(cuando), hora: horaAtlanta(cuando), ...p });
      }
    } finally {
      lock.release();
    }
  } finally {
    await cliente.logout().catch(() => {});
  }
  return salida;
}
