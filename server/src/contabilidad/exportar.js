import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

// Exporta un informe (el "modelo" que arman informes.js) a CSV, Excel o PDF.

const dolares = (c) => (c == null ? null : c / 100);
const letra = (i) => String.fromCharCode(65 + i); // A, B, C... (hasta 26 columnas)
const FILA_INICIAL = 6; // fila de Excel de la primera fila del informe (igual que el sistema anterior)

export const nombreArchivo = (modelo, ext) => `${modelo.empresa.replace(/[^A-Za-z0-9]+/g, '_')}_${modelo.titulo.replace(/[^A-Za-z0-9]+/g, '_')}.${ext}`;

const mostrar = (c) => (c == null ? '' : (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const mostrarMoneda = (c) => (c == null ? '' : `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const conSigno = (c) => (c == null ? '' : c < 0 ? `-${mostrar(-c)}` : mostrar(c));

// ─── CSV ─────────────────────────────────────────────────────────────
const celdaCsv = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function aCsv(modelo) {
  const n = modelo.columnas.length;
  const vacias = (k) => Array(k).fill('');
  const linea = (celdas) => celdas.map(celdaCsv).join(',');
  const out = [
    linea([modelo.empresa, ...vacias(n)]),
    linea([modelo.titulo, ...vacias(n)]),
    linea([modelo.rango, ...vacias(n)]),
    '',
    linea(['', ...modelo.columnas]),
  ];
  for (const f of modelo.filas) {
    out.push(linea([`${'   '.repeat(f.nivel ?? 0)}${f.etiqueta}`, ...f.valores.map((v) => (v == null ? '' : (v / 100).toFixed(2)))]));
  }
  out.push('', '', '', modelo.pie);
  return `﻿${out.join('\r\n')}\r\n`;
}

// ─── Excel ───────────────────────────────────────────────────────────
function formulaDeCelda(fila, col, nCols) {
  const f = fila.formulas?.[col];
  if (!f) return null;
  if (f.columnas) return f.columnas.map((c) => `${letra(c + 1)}${FILA_INICIAL + fila.__idx}`).join('+');
  const col1 = letra(col + 1);
  const terminos = f.filas.map((r, k) => ({ ref: `${col1}${FILA_INICIAL + r.fila}`, signo: r.signo, primero: k === 0 }));
  let txt = f.cero ? '0' : '';
  for (const t of terminos) {
    if (!txt) txt = t.signo < 0 ? `-${t.ref}` : t.ref;
    else txt += `${t.signo < 0 ? '-' : '+'}${t.ref}`;
  }
  void nCols;
  return txt || null;
}

export async function aXlsx(modelo) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'tax.invoice';
  const ws = wb.addWorksheet('Sheet1', { pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const n = modelo.columnas.length;
  const ultima = letra(n);
  const arial = (sz, bold = false) => ({ name: 'Arial', size: sz, bold });

  ws.getColumn(1).width = n > 1 ? 46 : modelo.titulo === 'Balance Sheet' ? 36.75 : 31.6;
  for (let c = 1; c <= n; c++) ws.getColumn(c + 1).width = n > 1 ? (c === n || c === 5 ? 12 : 10) : modelo.titulo === 'Balance Sheet' ? 17 : 16.1;

  [[modelo.empresa, 14], [modelo.titulo, 12], [modelo.rango, 10]].forEach(([txt, sz], i) => {
    ws.mergeCells(`A${i + 1}:${ultima}${i + 1}`);
    const c = ws.getCell(`A${i + 1}`);
    c.value = txt;
    c.font = arial(sz, true);
    c.alignment = { horizontal: 'center' };
  });

  const encabezado = ['', ...modelo.columnas];
  encabezado.forEach((t, i) => {
    const c = ws.getCell(5, i + 1);
    c.value = t;
    c.font = arial(9, true);
    c.alignment = { horizontal: 'center' };
    c.border = { bottom: { style: 'thin' } };
  });

  modelo.filas.forEach((fila, idx) => {
    fila.__idx = idx;
    const r = FILA_INICIAL + idx;
    const a = ws.getCell(r, 1);
    a.value = fila.etiqueta;
    a.font = arial(8, !!fila.negrita);
    a.alignment = { horizontal: 'left', indent: fila.nivel ?? 0 };
    if (fila.total && n > 1) a.border = { top: { style: 'thin' } };
    for (let col = 0; col < n; col++) {
      const celda = ws.getCell(r, col + 2);
      const v = fila.valores[col];
      const formula = formulaDeCelda(fila, col, n);
      if (formula) celda.value = { formula, result: v == null ? 0 : v / 100 };
      else if (v != null) celda.value = v / 100;
      const moneda = fila.moneda ? fila.moneda[col] : !!fila.total;
      celda.numFmt = moneda ? '"$"#,##0.00' : '#,##0.00';
      celda.font = arial(8, !!fila.negrita);
      if (fila.total) celda.border = { top: { style: 'thin' } };
    }
  });

  const ultimaFila = FILA_INICIAL + modelo.filas.length - 1;
  const pie = ultimaFila + 4;
  ws.mergeCells(`A${pie}:${ultima}${pie}`);
  const p = ws.getCell(`A${pie}`);
  p.value = modelo.pie;
  p.font = arial(8);
  p.alignment = { horizontal: 'center' };

  for (const f of modelo.filas) delete f.__idx;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── PDF ─────────────────────────────────────────────────────────────
export function aPdf(modelo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 40, bottom: 50, left: 40, right: 40 }, bufferPages: true });
    const trozos = [];
    doc.on('data', (t) => trozos.push(t));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);

    const n = modelo.columnas.length;
    const ancho = doc.page.width - 80;
    const anchoCol = n > 1 ? 62 : 110;
    const anchoEtiqueta = ancho - anchoCol * n;
    const x0 = 40;
    const alto = 13;

    const titulo = () => {
      doc.font('Helvetica-Bold').fontSize(14).text(modelo.empresa, x0, 40, { width: ancho, align: 'center' });
      doc.fontSize(12).text(modelo.titulo, { width: ancho, align: 'center' });
      doc.fontSize(10).text(modelo.rango, { width: ancho, align: 'center' });
      doc.moveDown(0.8);
    };
    const cabecera = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8);
      modelo.columnas.forEach((c, i) => doc.text(c, x0 + anchoEtiqueta + i * anchoCol, y, { width: anchoCol - 4, align: 'right', lineBreak: false }));
      doc.moveTo(x0, y + alto - 1).lineTo(x0 + ancho, y + alto - 1).lineWidth(0.5).stroke();
      doc.y = y + alto + 3;
    };

    titulo();
    cabecera();
    for (const f of modelo.filas) {
      if (doc.y > doc.page.height - 70) {
        doc.addPage();
        doc.y = 40;
        cabecera();
      }
      const y = doc.y;
      doc.font(f.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      if (f.total && n > 1) doc.moveTo(x0, y - 2.5).lineTo(x0 + ancho, y - 2.5).lineWidth(0.4).stroke();
      doc.text(f.etiqueta, x0 + (f.nivel ?? 0) * 10, y, { width: anchoEtiqueta - (f.nivel ?? 0) * 10 - 4, lineBreak: false, ellipsis: true });
      f.valores.forEach((v, i) => {
        if (v == null) return;
        const moneda = f.moneda ? f.moneda[i] : !!f.total;
        doc.text(moneda ? mostrarMoneda(v) : conSigno(v), x0 + anchoEtiqueta + i * anchoCol, y, { width: anchoCol - 4, align: 'right', lineBreak: false });
      });
      if (f.total && n === 1) doc.moveTo(x0 + anchoEtiqueta, y - 2.5).lineTo(x0 + ancho, y - 2.5).lineWidth(0.4).stroke();
      doc.y = y + alto;
    }

    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // si no, escribir el pie (debajo del margen) abriría otra página
      doc.font('Helvetica').fontSize(8);
      doc.text(modelo.pie.trim(), x0, doc.page.height - 38, { width: ancho - 80, align: 'left', lineBreak: false });
      doc.text(`Page ${i + 1} of ${paginas.count}`, x0 + ancho - 80, doc.page.height - 38, { width: 80, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

export const TIPOS_CONTENIDO = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
export { dolares };
