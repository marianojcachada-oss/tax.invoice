// Lee desde Microsoft Graph (Outlook / Microsoft 365) las notificaciones
// de Zelle que llegan al buzón de la empresa. Sin modo simulado: si no
// está configurado, falla con un error claro (un modo falso inventaría pagos).

const GRAPH = 'https://graph.microsoft.com/v1.0';
const carpetasConocidas = { inbox: 'inbox', 'bandeja de entrada': 'inbox', archive: 'archive', archivo: 'archive' };
let cacheCarpeta = null;

export class OutlookError extends Error {
  constructor(mensaje, estado = 502) {
    super(mensaje);
    this.estado = estado;
  }
}

export function outlookConfigurado() {
  return !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_MAILBOX);
}

export async function obtenerToken() {
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;
  const r = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new OutlookError(`Microsoft rechazó las credenciales: ${j.error_description?.split('\r')[0] ?? r.status}`);
  return j.access_token;
}

export function limpiarHtml(html = '') {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#36;|&dollar;/gi, '$')
    .replace(/\s+/g, ' ')
    .trim();
}

// Devuelve { remitente, monto, descripcion } o null si no es una notificación de pago.
// Formato BofA (es): "<Nombre> le envió $165.00" + descripción + "Consultar su saldo".
export function parsearContenido(asunto = '', cuerpo = '') {
  // Solicitud: la unidad nos PIDIÓ plata en vez de enviarla ("Juan Cardenas ha solicitado $155.00").
  const reSolEs = /^\s*(.+?)\s+ha solicitado\s*\$?\s*([\d,]+\.\d{2})/i;
  const reSolEn = /^\s*(.+?)\s+(?:has )?requested\s*\$?\s*([\d,]+\.\d{2})/i;
  const sol = asunto.match(reSolEs) || asunto.match(reSolEn) || cuerpo.match(/(.{2,80}?)\s+ha solicitado\s*\$?\s*([\d,]+\.\d{2})/i) || cuerpo.match(/(.{2,80}?)\s+requested\s*\$?\s*([\d,]+\.\d{2})/i);
  if (sol && !/le envi[óo]|sent you/i.test(asunto)) {
    const remitente = sol[1].trim();
    const monto = Number(sol[2].replace(/,/g, ''));
    const despues = cuerpo.slice(cuerpo.search(/solicit|requested/i));
    const d = despues.replace(/^[^$]*\$\s*[\d,]+\.\d{2}/, '').match(/^(.*?)(?:Enviar dinero|Send money|Despu[eé]s de que|After you)/i);
    const descripcion = (d ? d[1] : '').replace(/^[\s:.\-–—]+/, '').trim().slice(0, 300);
    if (remitente && monto > 0) return { remitente, monto, descripcion: descripcion || null, resultado: 'solicitud' };
  }
  const reEs = /^\s*(.+?)\s+le envi[óo]\s*\$?\s*([\d,]+\.\d{2})/i;
  const reEn = /^\s*(.+?)\s+sent you\s*\$?\s*([\d,]+\.\d{2})/i;
  let m = asunto.match(reEs) || asunto.match(reEn);
  let resto = cuerpo;
  if (!m) {
    m = cuerpo.match(/(.{2,80}?)\s+le envi[óo]\s*\$?\s*([\d,]+\.\d{2})/i) || cuerpo.match(/(.{2,80}?)\s+sent you\s*\$?\s*([\d,]+\.\d{2})/i);
    if (!m) return null;
    resto = cuerpo.slice(m.index + m[0].length);
  } else {
    const i = cuerpo.search(/le envi[óo]|sent you/i);
    if (i >= 0) resto = cuerpo.slice(i).replace(/^(le envi[óo]|sent you)\s*\$?\s*[\d,]+\.\d{2}/i, '');
  }
  const remitente = m[1].trim();
  const monto = Number(m[2].replace(/,/g, ''));
  if (!remitente || !(monto > 0)) return null;
  const d = resto.match(/^(.*?)(?:Consultar su saldo|Check your balance|Por favor, espere|Please allow)/i);
  const descripcion = (d ? d[1] : '').replace(/^[\s:.\-–—]+/, '').trim().slice(0, 300);
  return { remitente, monto, descripcion: descripcion || null };
}

async function graph(token, url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="html"' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new OutlookError(`Microsoft Graph respondió ${r.status}: ${j.error?.message ?? 'error desconocido'}`);
  return j;
}

async function resolverIdCarpeta(token) {
  const nombre = (process.env.MS_CARPETA || 'Inbox').trim();
  const conocida = carpetasConocidas[nombre.toLowerCase()];
  if (conocida) return conocida;
  if (cacheCarpeta?.nombre === nombre) return cacheCarpeta.id;
  const j = await graph(token, `${GRAPH}/users/${encodeURIComponent(process.env.MS_MAILBOX)}/mailFolders?$top=100&$select=id,displayName`);
  const f = j.value.find((x) => x.displayName.toLowerCase() === nombre.toLowerCase());
  if (!f) throw new OutlookError(`No encontré la carpeta "${nombre}" en el buzón. Revisá MS_CARPETA.`, 400);
  cacheCarpeta = { nombre, id: f.id };
  return f.id;
}

function horaAtlanta(iso) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

function fechaAtlanta(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
}

const hilosVistos = new Set(); // hilos de grupo ya leídos: no se vuelven a pedir en cada refresh

async function buscarEnGrupo(token) {
  const mail = process.env.MS_MAILBOX;
  const g = await graph(token, `${GRAPH}/groups?$filter=${encodeURIComponent(`mail eq '${mail}'`)}&$select=id,displayName`);
  const grupo = g.value?.[0];
  if (!grupo) throw new OutlookError(`No encontré ningún usuario ni grupo con la dirección ${mail}. Revisá MS_MAILBOX.`, 400);
  const hilos = await graph(token, `${GRAPH}/groups/${grupo.id}/threads?$top=50`);
  const salida = [];
  for (const h of hilos.value ?? []) {
    if (hilosVistos.has(h.id)) continue;
    const posts = await graph(token, `${GRAPH}/groups/${grupo.id}/threads/${h.id}/posts?$top=1`);
    const post = posts.value?.[0];
    if (!post) continue;
    hilosVistos.add(h.id);
    const cuerpo = limpiarHtml(post.body?.content ?? '');
    const p = parsearContenido(h.topic ?? '', cuerpo);
    if (p) salida.push({ messageId: post.id, fecha: fechaAtlanta(post.receivedDateTime ?? h.lastDeliveredDateTime), hora: horaAtlanta(post.receivedDateTime ?? h.lastDeliveredDateTime), ...p });
  }
  return salida;
}

export async function buscarNotificacionesZelle() {
  if (!outlookConfigurado()) {
    throw new OutlookError('Outlook no está configurado. Completá las variables MS_* en server/.env (ver OUTLOOK.md).', 400);
  }
  const token = await obtenerToken();
  const buzon = encodeURIComponent(process.env.MS_MAILBOX);
  const esGrupo = process.env.MS_TIPO?.toLowerCase() === 'grupo';
  if (esGrupo) return buscarEnGrupo(token);

  const carpeta = await resolverIdCarpeta(token).catch((e) => {
    if (/is invalid|not found|ResourceNotFound/i.test(e.message)) return null;
    throw e;
  });
  if (carpeta === null) return buscarEnGrupo(token); // no es un usuario: se prueba como grupo de Microsoft 365
  const url =
    `${GRAPH}/users/${buzon}/mailFolders/${carpeta}/messages` +
    `?$top=50&$orderby=receivedDateTime desc&$select=id,receivedDateTime,subject,body,bodyPreview`;
  const j = await graph(token, url);
  const salida = [];
  for (const msg of j.value ?? []) {
    const cuerpo = limpiarHtml(msg.body?.content ?? '') || msg.bodyPreview || '';
    const p = parsearContenido(msg.subject ?? '', cuerpo);
    if (p) salida.push({ messageId: msg.id, fecha: fechaAtlanta(msg.receivedDateTime), hora: horaAtlanta(msg.receivedDateTime), ...p });
  }
  return salida;
}
