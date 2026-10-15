export function descargarCSV(nombreArchivo: string, encabezados: string[], filas: (string | number)[][]) {
  const escapar = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [encabezados, ...filas].map((fila) => fila.map(escapar).join(','));
  // BOM al inicio para que Excel abra los acentos/ñ bien en Windows.
  const csv = '\uFEFF' + lineas.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}
