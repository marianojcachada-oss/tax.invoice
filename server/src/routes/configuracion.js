import { Router } from 'express';
import { db } from '../db.js';
import { aCentavos, aDolares, registrarAuditoria } from '../utils.js';
import { requiereAdmin } from '../auth.js';
import { enviarMail, emailConfigurado, cargarConfigMail, rellenarPlantilla } from '../email.js';
import { generarFacturaPdf } from '../facturaPdf.js';

export const configuracionRouter = Router();

function serializar(row) {
  return {
    cuotaSemanalPorDefecto: aDolares(row.cuota_semanal_por_defecto),
    diaEmision: row.dia_emision,
    metodosHabilitados: JSON.parse(row.metodos_habilitados),
    precioPorDia: {
      lunes: row.precio_lunes != null ? aDolares(row.precio_lunes) : undefined,
      martes: row.precio_martes != null ? aDolares(row.precio_martes) : undefined,
      miercoles: row.precio_miercoles != null ? aDolares(row.precio_miercoles) : undefined,
      jueves: row.precio_jueves != null ? aDolares(row.precio_jueves) : undefined,
      viernes: row.precio_viernes != null ? aDolares(row.precio_viernes) : undefined,
    },
    recordatorios: {
      activo: !!row.recordatorios_activo,
      semanasActividadReciente: row.recordatorios_semanas,
      soloConSaldoVencido: !!row.recordatorios_solo_vencido,
      plantillaMensaje: row.recordatorios_plantilla,
      ringcentral: {
        clientId: row.ringcentral_client_id ?? undefined,
        // El secret NUNCA se manda de vuelta al navegador una vez
        // guardado — por eso mismo tiene sentido que viva acá y no en
        // localStorage del lado del cliente.
        clientSecret: row.ringcentral_client_secret ? '••••••••' : undefined,
        numeroDesde: row.ringcentral_numero_desde ?? undefined,
      },
    },
    mail: {
      envioAutomatico: !!row.mail_auto,
      metodo: row.mail_metodo ?? 'graph',
      buzonEnvio: row.mail_buzon_envio ?? '',
      remitenteNombre: row.mail_remitente_nombre ?? '',
      remitenteDireccion: row.mail_remitente_direccion ?? '',
      responderA: row.mail_responder_a ?? '',
      asunto: row.mail_asunto ?? '',
      mensaje: row.mail_mensaje ?? '',
      smtp: {
        host: row.smtp_host ?? '',
        puerto: row.smtp_puerto ?? 587,
        usuario: row.smtp_usuario ?? '',
        clave: row.smtp_clave ? '••••••••' : '',
      },
    },
    empresa: {
      nombre: row.empresa_nombre ?? '',
      direccion: row.empresa_direccion ?? '',
      email: row.empresa_email ?? '',
    },
  };
}

configuracionRouter.post('/mail-prueba', requiereAdmin, async (req, res) => {
  const para = req.body?.para;
  if (!para) return res.status(400).json({ error: 'Indicá a qué dirección mandar la prueba.' });
  if (!(await emailConfigurado())) return res.status(400).json({ error: 'Falta completar la configuración del mail (buzón que envía, o servidor/usuario/contraseña si usás SMTP).' });
  let r;
  if (req.body?.conFactura) {
    // Factura de EJEMPLO ya paga, con el asunto y mensaje configurados: sirve para ver cómo le llega al cliente.
    const cfg = await cargarConfigMail();
    const emp = await db.prepare('SELECT * FROM configuracion WHERE id = 1').get();
    const hoy = new Date().toISOString().slice(0, 10);
    const factura = { numero: 9999, fecha: hoy, fechaVencimiento: hoy, concepto: '1090PB Semana 40 (FACTURA DE EJEMPLO)', monto: 145, montoPagado: 145 };
    const cliente = { codigo: 'D0000', nombre: 'Unidad de Ejemplo', telefonos: '' };
    const pdf = await generarFacturaPdf({
      factura,
      cliente,
      empresa: { nombre: emp.empresa_nombre, direccion: emp.empresa_direccion, email: emp.empresa_email },
      saldoPendiente: 0,
      estado: 'PAGADA',
    });
    const vars = { nombre: cliente.nombre, numero: factura.numero, concepto: factura.concepto, monto: '$145.00', empresa: cfg.empresa };
    r = await enviarMail({
      para,
      asunto: rellenarPlantilla(cfg.asunto, vars),
      texto: rellenarPlantilla(cfg.mensaje, vars),
      nombreArchivo: `factura-${factura.numero}.pdf`,
      contenido: pdf,
    });
  } else {
    r = await enviarMail({ para, asunto: 'Prueba de tax.invoice', texto: 'Si recibís esto, el mail de facturas está bien configurado.' });
  }
  if (!r.ok) return res.status(502).json({ error: r.detalle });
  res.json({ ok: true });
});

configuracionRouter.get('/', async (req, res) => {
  const fila = await db.prepare('SELECT * FROM configuracion WHERE id = 1').get();
  res.json(serializar(fila));
});

configuracionRouter.patch('/', requiereAdmin, async (req, res) => {
  const actual = await db.prepare('SELECT * FROM configuracion WHERE id = 1').get();
  const b = req.body;

  await db
    .prepare(
      `UPDATE configuracion SET
      cuota_semanal_por_defecto = ?, dia_emision = ?, metodos_habilitados = ?,
      precio_lunes = ?, precio_martes = ?, precio_miercoles = ?, precio_jueves = ?, precio_viernes = ?,
      recordatorios_activo = ?, recordatorios_semanas = ?, recordatorios_solo_vencido = ?, recordatorios_plantilla = ?,
      ringcentral_client_id = ?, ringcentral_client_secret = COALESCE(?, ringcentral_client_secret), ringcentral_numero_desde = ?,
      empresa_nombre = ?, empresa_direccion = ?, empresa_email = ?,
      mail_auto = ?, mail_remitente_nombre = ?, mail_remitente_direccion = ?, mail_responder_a = ?, mail_asunto = ?, mail_mensaje = ?,
      mail_metodo = ?, mail_buzon_envio = ?, smtp_host = ?, smtp_puerto = ?, smtp_usuario = ?, smtp_clave = COALESCE(?, smtp_clave)
     WHERE id = 1`
    )
    .run(
      aCentavos(b.cuotaSemanalPorDefecto ?? aDolares(actual.cuota_semanal_por_defecto)),
      b.diaEmision ?? actual.dia_emision,
      JSON.stringify(b.metodosHabilitados ?? JSON.parse(actual.metodos_habilitados)),
      b.precioPorDia?.lunes !== undefined ? aCentavos(b.precioPorDia.lunes) : actual.precio_lunes,
      b.precioPorDia?.martes !== undefined ? aCentavos(b.precioPorDia.martes) : actual.precio_martes,
      b.precioPorDia?.miercoles !== undefined ? aCentavos(b.precioPorDia.miercoles) : actual.precio_miercoles,
      b.precioPorDia?.jueves !== undefined ? aCentavos(b.precioPorDia.jueves) : actual.precio_jueves,
      b.precioPorDia?.viernes !== undefined ? aCentavos(b.precioPorDia.viernes) : actual.precio_viernes,
      !!b.recordatorios?.activo,
      b.recordatorios?.semanasActividadReciente ?? actual.recordatorios_semanas,
      !!b.recordatorios?.soloConSaldoVencido,
      b.recordatorios?.plantillaMensaje ?? actual.recordatorios_plantilla,
      b.recordatorios?.ringcentral?.clientId ?? actual.ringcentral_client_id,
      // el secret solo se pisa si mandan uno nuevo de verdad (no el
      // placeholder enmascarado "••••••••" que se les devolvió antes)
      b.recordatorios?.ringcentral?.clientSecret && b.recordatorios.ringcentral.clientSecret !== '••••••••'
        ? b.recordatorios.ringcentral.clientSecret
        : null,
      b.recordatorios?.ringcentral?.numeroDesde ?? actual.ringcentral_numero_desde,
      b.empresa?.nombre ?? actual.empresa_nombre,
      b.empresa?.direccion ?? actual.empresa_direccion,
      b.empresa?.email ?? actual.empresa_email,
      b.mail ? !!b.mail.envioAutomatico : !!actual.mail_auto,
      b.mail?.remitenteNombre ?? actual.mail_remitente_nombre,
      b.mail?.remitenteDireccion ?? actual.mail_remitente_direccion,
      b.mail?.responderA ?? actual.mail_responder_a,
      b.mail?.asunto ?? actual.mail_asunto,
      b.mail?.mensaje ?? actual.mail_mensaje,
      b.mail?.metodo ?? actual.mail_metodo,
      b.mail?.buzonEnvio ?? actual.mail_buzon_envio,
      b.mail?.smtp?.host ?? actual.smtp_host,
      b.mail?.smtp?.puerto ?? actual.smtp_puerto,
      b.mail?.smtp?.usuario ?? actual.smtp_usuario,
      b.mail?.smtp?.clave && b.mail.smtp.clave !== '••••••••' ? b.mail.smtp.clave : null
    );

  await registrarAuditoria({ usuario: req.usuario.nombre, accion: 'Actualizó configuración', entidad: 'Configuracion', entidadId: 'global', resumen: 'Se guardaron cambios en Configuración' });
  const actualizada = await db.prepare('SELECT * FROM configuracion WHERE id = 1').get();
  res.json(serializar(actualizada));
});
