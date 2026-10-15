// Envío AUTOMÁTICO de la factura cuando queda totalmente paga.
// Solo si el switch está prendido en Configuración, la factura está
// pagada, el cliente tiene email y todavía no se le mandó.
import { db } from './db.js';
import { aDolares, registrarAuditoria } from './utils.js';
import { cargarConfigMail, enviarMail, rellenarPlantilla } from './email.js';
import { datosParaPdf } from './routes/facturas.js';

export async function notificarFacturasPagadas(facturaIds, usuario = 'Sistema') {
  const cfg = await cargarConfigMail();
  if (!cfg.auto) return;
  for (const id of new Set(facturaIds)) {
    try {
      const f = await db.prepare('SELECT * FROM facturas WHERE id = ?').get(id);
      if (!f || f.estado !== 'pagada' || f.mail_enviado) continue;
      const datos = await datosParaPdf(id);
      const email = datos?.cliente.email;
      if (!email) {
        await registrarAuditoria({ usuario, accion: 'Mail automático omitido', entidad: 'Factura', entidadId: id, resumen: `Factura #${f.numero} pagada, pero ${datos?.cliente.nombre ?? 'el cliente'} no tiene email cargado.` });
        continue;
      }
      const vars = { nombre: datos.cliente.nombre, numero: f.numero, concepto: f.concepto, monto: `$${aDolares(f.monto).toFixed(2)}`, empresa: cfg.empresa };
      const r = await enviarMail({
        para: email,
        asunto: rellenarPlantilla(cfg.asunto, vars),
        texto: rellenarPlantilla(cfg.mensaje, vars),
        nombreArchivo: `factura-${f.numero}.pdf`,
        contenido: datos.pdf,
      });
      if (r.ok && !r.simulado) await db.prepare('UPDATE facturas SET mail_enviado = ? WHERE id = ?').run(new Date().toISOString(), id);
      await registrarAuditoria({ usuario, accion: 'Mail automático de factura paga', entidad: 'Factura', entidadId: id, resumen: `Factura #${f.numero} → ${email}: ${r.detalle}` });
    } catch (e) {
      console.error('[mail automático] falló para la factura', id, e);
    }
  }
}
