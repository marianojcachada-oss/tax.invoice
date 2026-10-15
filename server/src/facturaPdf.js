import PDFDocument from 'pdfkit';

// Paleta de la marca tax.invoice, en RGB para pdfkit (que no entiende
// variables CSS). Documento fiscal = siempre en tinta oscura sobre
// blanco, sin depender de ningún tema.
const INK = '#161826';
const INK_SOFT = '#63678a';
const LINE = '#cfd3e5';
const ACCENT = '#10402f'; // verde de marca, igual que --color-accent
const DANGER = '#c4392b';
const SUCCESS = '#2f7d5d';

function money(n) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Arma el PDF de una factura y lo devuelve como Buffer.
 * `factura`/`cliente`/`empresa` ya vienen serializados (en dólares, no
 * centavos) — mismo shape que usa el frontend.
 */
export function generarFacturaPdf({ factura, cliente, empresa, saldoPendiente, estado }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Encabezado: logotipo tax.invoice (si es el nombre configurado) o el nombre libre ──
    if (empresa.nombre === 'tax.invoice') {
      doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('tax', 50, 50, { continued: true });
      doc.font('Helvetica').fillColor(ACCENT).text('.', { continued: true });
      doc.font('Helvetica').fillColor(INK).text('invoice');
    } else {
      doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(empresa.nombre || 'Factura', 50, 50);
    }
    doc.font('Helvetica').fontSize(9).fillColor(INK_SOFT);
    if (empresa.direccion) doc.text(empresa.direccion);
    if (empresa.email) doc.text(empresa.email);

    // ── Datos de la factura, alineados a la derecha ──
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text('FACTURA', 350, 50, { width: 195, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(INK_SOFT);
    doc.text(`N° ${factura.numero}`, 350, 70, { width: 195, align: 'right' });
    doc.text(`Fecha: ${factura.fecha}`, { width: 195, align: 'right' });
    doc.text(`Vence: ${factura.fechaVencimiento}`, { width: 195, align: 'right' });

    doc.moveTo(50, 130).lineTo(545, 130).strokeColor(LINE).stroke();

    // ── Cliente ──
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Cliente', 50, 145);
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    doc.text(`${cliente.codigo} · ${cliente.nombre}`, 50, 162);
    if (cliente.telefonos) doc.fillColor(INK_SOFT).fontSize(9).text(cliente.telefonos);

    // ── Línea de concepto ──
    const tablaY = 220;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK_SOFT);
    doc.text('CONCEPTO', 50, tablaY);
    doc.text('MONTO', 450, tablaY, { width: 95, align: 'right' });
    doc.moveTo(50, tablaY + 15).lineTo(545, tablaY + 15).strokeColor(LINE).stroke();

    doc.font('Helvetica').fontSize(10).fillColor(INK);
    doc.text(factura.concepto, 50, tablaY + 25, { width: 380 });
    doc.text(money(factura.monto), 450, tablaY + 25, { width: 95, align: 'right' });

    doc.moveTo(50, tablaY + 55).lineTo(545, tablaY + 55).strokeColor(LINE).stroke();

    // ── Totales ──
    let y = tablaY + 70;
    doc.font('Helvetica').fontSize(10).fillColor(INK_SOFT).text('Total', 350, y, { width: 95, align: 'right' });
    doc.fillColor(INK).text(money(factura.monto), 450, y, { width: 95, align: 'right' });
    y += 18;
    doc.fillColor(INK_SOFT).text('Pagado', 350, y, { width: 95, align: 'right' });
    doc.fillColor(SUCCESS).text(money(factura.montoPagado), 450, y, { width: 95, align: 'right' });
    y += 18;
    doc.font('Helvetica-Bold').fillColor(INK_SOFT).text('Saldo pendiente', 350, y, { width: 95, align: 'right' });
    doc.fillColor(saldoPendiente > 0 ? DANGER : SUCCESS).text(money(saldoPendiente), 450, y, { width: 95, align: 'right' });

    // ── Estado ──
    y += 35;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(saldoPendiente > 0 ? DANGER : SUCCESS).text(estado, 50, y);

    doc.font('Helvetica').fontSize(8).fillColor(INK_SOFT).text(
      'Documento generado automáticamente.',
      50,
      750,
      { width: 495, align: 'center' }
    );

    doc.end();
  });
}
