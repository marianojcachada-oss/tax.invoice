// ─────────────────────────────────────────────────────────────────────
// Integración real con RingCentral, ahora del lado del servidor — que es
// donde tiene que vivir: el Client Secret y el JWT de RingCentral NUNCA
// deben viajar al navegador. El frontend solo llama a nuestro propio
// endpoint (POST /api/recordatorios/enviar); este módulo es el único que
// habla con RingCentral de verdad.
//
// CONFIGURACIÓN NECESARIA (variables de entorno, ver server/.env.example):
//   RC_CLIENT_ID, RC_CLIENT_SECRET, RC_JWT, RC_NUMERO_DESDE
//   RC_SERVER_URL (opcional, por defecto el server de producción de RC)
//
// Si esas variables no están cargadas, este módulo cae automáticamente a
// un modo SIMULADO (igual que hacía el stub del lado del frontend) para
// que el resto de la app funcione mientras se termina de configurar la
// cuenta real de RingCentral.
// ─────────────────────────────────────────────────────────────────────

import { SDK } from '@ringcentral/sdk';

const RC_CLIENT_ID = process.env.RC_CLIENT_ID;
const RC_CLIENT_SECRET = process.env.RC_CLIENT_SECRET;
const RC_JWT = process.env.RC_JWT;
const RC_NUMERO_DESDE = process.env.RC_NUMERO_DESDE;
const RC_SERVER_URL = process.env.RC_SERVER_URL || 'https://platform.ringcentral.com';

const configurado = Boolean(RC_CLIENT_ID && RC_CLIENT_SECRET && RC_JWT && RC_NUMERO_DESDE);

let platform = null;
if (configurado) {
  const rcsdk = new SDK({ server: RC_SERVER_URL, clientId: RC_CLIENT_ID, clientSecret: RC_CLIENT_SECRET });
  platform = rcsdk.platform();
}

async function asegurarSesion() {
  const datosAuth = platform.auth().data();
  const yaVencido = !datosAuth?.access_token || Date.now() > Number(datosAuth.expire_time ?? 0);
  if (yaVencido) {
    await platform.login({ jwt: RC_JWT });
  }
}

/**
 * Envía un SMS por RingCentral. Devuelve { ok, detalle }. Si las
 * credenciales todavía no están configuradas, simula el envío (loguea en
 * consola) para no bloquear el resto del flujo.
 */
export async function enviarSms({ telefono, mensaje }) {
  if (!configurado) {
    console.info('[RingCentral SIMULADO — faltan credenciales en .env] Se enviaría:', { telefono, mensaje });
    return { ok: true, detalle: 'Simulado — configurá RC_CLIENT_ID/RC_CLIENT_SECRET/RC_JWT/RC_NUMERO_DESDE en server/.env para conectar RingCentral de verdad.' };
  }

  try {
    await asegurarSesion();
    await platform.post('/restapi/v1.0/account/~/extension/~/sms', {
      from: { phoneNumber: RC_NUMERO_DESDE },
      to: [{ phoneNumber: telefono }],
      text: mensaje,
    });
    return { ok: true, detalle: 'Enviado por RingCentral.' };
  } catch (err) {
    console.error('Error enviando SMS por RingCentral:', err);
    return { ok: false, detalle: `Error de RingCentral: ${err.message ?? err}` };
  }
}

export function ringCentralConfigurado() {
  return configurado;
}
