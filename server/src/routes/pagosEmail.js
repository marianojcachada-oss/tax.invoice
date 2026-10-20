import { Router } from 'express';
import { db } from '../db.js';
import { generarId, aCentavos, aDolares, registrarAuditoria } from '../utils.js';
import { alQuedarPagas } from '../postPago.js';
import { requiereAdmin } from '../auth.js';
import { outlookConfigurado, buscarNotificacionesZelle, OutlookError } from '../outlookInbox.js';
import { gmailConfigurado, buscarPagosKotapay } from '../kotapayGmail.js';

export const bandejaConfigurada = () => outlookConfigurado() || gmailConfigurado();

export const pagosEmailRouter = Router();

const serializar = async (r) => {
  let detalle = {};
  if (r.pago_id) {
    const p = await db.prepare('SELECT numero FROM pagos WHERE id = ?').get(r.pago_id);
    const ap = await db.prepare('SELECT COALESCE(SUM(monto),0) AS t, COUNT(*) AS n FROM pago_aplicaciones WHERE pago_id = ?').get(r.pago_id);
    detalle = {
      pagoNumero: p?.numero,
      aplicadoAFacturas: aDolares(Number(ap.t)),
      facturasCubiertas: Number(ap.n),
      comoCredito: aDolares(r.monto - Number(ap.t)),
    };
  }
  return { ...base(r), ...detalle };
};
const base = (r) => ({
  id: r.id,
  fecha: r.fecha,
  hora: r.hora ?? undefined,
  remitente: r.remitente,
  descripcion: r.descripcion ?? undefined,
  origen: r.origen ?? 'zelle',
  resultado: r.resultado ?? 'aprobado',
  motivoRechazo: r.motivo_rechazo ?? undefined,
  monto: aDolares(r.monto),
  estado: r.estado,
  clienteId: r.cliente_id ?? undefined,
  pagoId: r.pago_id ?? undefined,
});

pagosEmailRouter.get('/estado-outlook', requiereAdmin, (req, res) => res.json({ configurado: bandejaConfigurada(), outlook: outlookConfigurado(), gmail: gmailConfigurado() }));

pagosEmailRouter.get('/', requiereAdmin, async (req, res) => {
  const filas = await db.prepare('SELECT * FROM pagos_email ORDER BY fecha DESC, hora DESC NULLS LAST, id DESC').all();
  res.json(await Promise.all(filas.map(serializar)));
});

// Trae del buzón los pagos que todavía no están cargados. Se usa tanto
// desde el botón como desde el autorefresh del servidor.
export async function sincronizarPagosEmail() {
  if (!bandejaConfigurada()) {
    throw new OutlookError('No hay ningún buzón configurado. Completá las variables MS_* (Zelle) y/o GMAIL_* (Kotapay) en server/.env.', 400);
  }
  const encontrados = [];
  const errores = [];
  if (outlookConfigurado()) {
    try { encontrados.push(...(await buscarNotificacionesZelle())); } catch (e) { errores.push(e); }
  }
  if (gmailConfigurado()) {
    try { encontrados.push(...(await buscarPagosKotapay())); } catch (e) { errores.push(new OutlookError(`Gmail (Kotapay): ${e.message}`)); }
  }
  // si falló todo, se avisa; si falló solo una fuente, se siguen cargando las que anduvieron
  if (errores.length > 0 && encontrados.length === 0 && errores.length === [outlookConfigurado(), gmailConfigurado()].filter(Boolean).length) throw errores[0];
  let nuevos = 0;
  for (const p of encontrados) {
    const ya = await db.prepare('SELECT id, hora FROM pagos_email WHERE message_id = ?').get(p.messageId);
    if (ya) {
      if (!ya.hora && p.hora) await db.prepare('UPDATE pagos_email SET hora = ? WHERE id = ?').run(p.hora, ya.id);
      continue;
    }
    await db
      .prepare(
        `INSERT INTO pagos_email (id, message_id, fecha, hora, remitente, descripcion, monto, origen, referencia, estado, resultado, motivo_rechazo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        generarId('pem'), p.messageId, p.fecha, p.hora, p.remitente, p.descripcion, aCentavos(p.monto),
        p.origen ?? 'zelle', p.referencia ?? null,
        'pendiente', // rechazos y solicitudes también quedan pendientes (en rojo): hay que aplicarlos o descartarlos a mano
        p.resultado ?? 'aprobado', p.motivoRechazo ?? null
      );
    nuevos++;
  }
  return { encontrados: encontrados.length, nuevos };
}

pagosEmailRouter.post('/actualizar', requiereAdmin, async (req, res) => {
  try {
    res.json(await sincronizarPagosEmail());
  } catch (e) {
    if (e instanceof OutlookError) return res.status(e.estado).json({ error: e.message });
    throw e;
  }
});

// Aplica el pago al cliente elegido: FIFO sobre sus facturas abiertas,
// el excedente queda como nota de crédito.
pagosEmailRouter.post('/:id/aplicar', requiereAdmin, async (req, res) => {
  const { clienteId } = req.body ?? {};
  const fila = await db.prepare('SELECT * FROM pagos_email WHERE id = ?').get(req.params.id);
  if (!fila) return res.status(404).json({ error: 'Pago no encontrado.' });
  if (fila.resultado && fila.resultado !== 'aprobado' && !req.body?.confirmarSinDinero) {
    const que = fila.resultado === 'rechazado' ? 'La tarjeta fue rechazada' : 'La unidad pidió dinero en lugar de enviarlo';
    return res.status(400).json({ error: `${que}: el dinero NO entró. Si igual querés aplicarlo, confirmalo.`, requiereConfirmacion: true });
  }
  if (fila.estado !== 'pendiente') return res.status(400).json({ error: 'Este pago ya fue procesado.' });
  const cliente = clienteId ? await db.prepare('SELECT * FROM clientes WHERE id = ?').get(clienteId) : null;
  if (!cliente) return res.status(404).json({ error: 'Elegí un cliente válido.' });

  const pagoId = generarId('pago');
  let excedente = 0;
  const tocadas = [];
  await db.transaction(async (tx) => {
    const numero = ((await tx.prepare('SELECT MAX(numero) as n FROM pagos').get()).n ?? 0) + 1;
    const esKota = fila.origen === 'kotapay';
    const ref = esKota ? `${fila.descripcion ?? 'Kotapay'} — ${fila.remitente}${fila.referencia ? ` · Tx ${fila.referencia}` : ''}` : `Email: ${fila.remitente}${fila.descripcion ? ` — ${fila.descripcion}` : ''}`;
    await tx
      .prepare(
        `INSERT INTO pagos (id, numero, cliente_id, fecha, monto, metodo, referencia, cuenta_id, editado)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, false)`
      )
      .run(pagoId, numero, cliente.id, fila.fecha, fila.monto, esKota ? 'kotapay' : 'zelle', ref);

    let resto = fila.monto;
    const abiertas = await tx
      .prepare("SELECT * FROM facturas WHERE cliente_id = ? AND monto_pagado < monto AND estado <> 'anulada' ORDER BY fecha_vencimiento, fecha, id")
      .all(cliente.id);
    for (const f of abiertas) {
      if (resto <= 0) break;
      const aplicar = Math.min(resto, f.monto - f.monto_pagado);
      await tx.prepare('INSERT INTO pago_aplicaciones (pago_id, factura_id, monto) VALUES (?, ?, ?)').run(pagoId, f.id, aplicar);
      const nuevoPagado = f.monto_pagado + aplicar;
      await tx
        .prepare('UPDATE facturas SET monto_pagado = ?, estado = ? WHERE id = ?')
        .run(nuevoPagado, nuevoPagado >= f.monto ? 'pagada' : 'parcial', f.id);
      resto -= aplicar;
      tocadas.push(f.id);
    }
    excedente = resto;
    if (excedente > 0) {
      // El pago queda por lo que se aplicó a facturas; el resto vive en la nota de crédito
      // (mismo criterio que el cobro manual), así la contabilidad no cuenta el excedente dos veces.
      await tx.prepare('UPDATE pagos SET monto = ? WHERE id = ?').run(fila.monto - excedente, pagoId);
      const nNc = ((await tx.prepare('SELECT MAX(numero) as n FROM notas_credito').get()).n ?? 5000) + 1;
      await tx
        .prepare(
          `INSERT INTO notas_credito (id, numero, cliente_id, fecha, monto, monto_aplicado, motivo, aplicada)
           VALUES (?, ?, ?, ?, ?, 0, ?, false)`
        )
        .run(generarId('nc'), nNc, cliente.id, fila.fecha, excedente, `Excedente — pago por ${esKota ? 'Kotapay' : 'Zelle'} de ${fila.remitente}`);
    }
    await tx.prepare("UPDATE pagos_email SET estado = 'aplicado', cliente_id = ?, pago_id = ? WHERE id = ?").run(cliente.id, pagoId, fila.id);
  });

  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Aplicó pago recibido por mail',
    entidad: 'Pago',
    entidadId: pagoId,
    resumen: `${fila.resultado && fila.resultado !== 'aprobado' ? `[${fila.resultado} — aplicado sin que entrara dinero] ` : ''}${fila.origen === 'kotapay' ? 'Kotapay' : 'Zelle'} de ${fila.remitente} por $${aDolares(fila.monto)} asignado a ${cliente.nombre}${excedente > 0 ? ` (excedente $${aDolares(excedente)} como nota de crédito)` : ''}`,
  });
  await alQuedarPagas(tocadas, req.usuario.nombre);
  res.json(await serializar(await db.prepare('SELECT * FROM pagos_email WHERE id = ?').get(fila.id)));
});

pagosEmailRouter.post('/:id/descartar', requiereAdmin, async (req, res) => {
  const fila = await db.prepare('SELECT * FROM pagos_email WHERE id = ?').get(req.params.id);
  if (!fila) return res.status(404).json({ error: 'Pago no encontrado.' });
  if (fila.estado !== 'pendiente') return res.status(400).json({ error: 'Este pago ya fue procesado.' });
  await db.prepare("UPDATE pagos_email SET estado = 'descartado' WHERE id = ?").run(fila.id);
  await registrarAuditoria({
    usuario: req.usuario.nombre,
    accion: 'Descartó pago recibido por mail',
    entidad: 'PagoEmail',
    entidadId: fila.id,
    resumen: `Descartó el mail de ${fila.remitente} por $${aDolares(fila.monto)}`,
  });
  res.json(await serializar(await db.prepare("SELECT * FROM pagos_email WHERE id = ?").get(fila.id)));
});
