// Lado "normal" de cada tipo de cuenta de QuickBooks: 'D' (deudora) o 'C' (acreedora).
// El saldo "natural" es debe-haber en las deudoras y haber-debe en las acreedoras;
// es el signo con el que QuickBooks lo muestra en sus informes.
export const LADO = {
  'Bank': 'D',
  'Accounts receivable (A/R)': 'D',
  'Other Current Assets': 'D',
  'Fixed Assets': 'D',
  'Other Assets': 'D',
  'Accounts payable (A/P)': 'C',
  'Credit Card': 'C',
  'Other Current Liabilities': 'C',
  'Long Term Liabilities': 'C',
  'Equity': 'C',
  'Income': 'C',
  'Cost of Goods Sold': 'D',
  'Expenses': 'D',
  'Other Income': 'C',
  'Other Expense': 'D',
};

export const TIPOS_RESULTADOS = new Set(['Income', 'Cost of Goods Sold', 'Expenses', 'Other Income', 'Other Expense']);
export const esResultados = (tipo) => TIPOS_RESULTADOS.has(tipo);

/** Saldo natural a partir de debe y haber. */
export const natural = (tipo, debe, haber) => (LADO[tipo] === 'D' ? debe - haber : haber - debe);
/** Al revés: de un saldo natural a (debe, haber). */
export function aDebeHaber(tipo, monto) {
  const deudora = LADO[tipo] === 'D';
  const positivo = monto >= 0;
  const abs = Math.abs(monto);
  return deudora === positivo ? { debe: abs, haber: 0 } : { debe: 0, haber: abs };
}

export function sumarDias(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
export const hoyAtlanta = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
