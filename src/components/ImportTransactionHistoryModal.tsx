import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useDataStore } from '../data/DataContext';

interface Transaccion {
  fecha: string;
  tipo: 'Invoice' | 'Payment';
  monto: number;
  cuenta: string;
}
interface Bloque {
  codigo: string;
  numero: string;
  nombre: string;
  transacciones: Transaccion[];
}

const PATRON_CODIGO_EN_NOMBRE = /^(D\d{3,6})\s+(\d{5,7})\s+(.+)$/i;

function aFechaISO(fecha: string): string {
  const partes = fecha.split('/');
  if (partes.length !== 3) return '';
  let [m, d, y] = partes;
  if (y.length === 2) y = `20${y}`;
  if (!m || !d || !y) return '';
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parsearReporte(filas: unknown[][]): { bloques: Bloque[]; ignoradas: number } {
  const indiceEncabezado = filas.findIndex((f) => String(f[1] ?? '').trim() === 'Date');
  const inicio = indiceEncabezado >= 0 ? indiceEncabezado + 1 : 5;

  const bloques: Bloque[] = [];
  let actual: Bloque | null = null;
  let ignoradas = 0;

  for (let i = inicio; i < filas.length; i++) {
    const fila = filas[i];
    const col0 = String(fila[0] ?? '').trim();
    const col1 = String(fila[1] ?? '').trim();

    if (!col0 && !col1) continue;
    if (col0.startsWith('Total for') || col0 === 'TOTAL') continue;

    if (col0 && !col1) {
      const m = col0.match(PATRON_CODIGO_EN_NOMBRE);
      actual = {
        codigo: m ? m[1].toUpperCase() : '',
        numero: m ? m[2] : '',
        nombre: m ? m[3].trim() : col0,
        transacciones: [],
      };
      bloques.push(actual);
      continue;
    }

    const tipo = String(fila[2] ?? '').trim();
    if ((tipo === 'Invoice' || tipo === 'Payment') && actual) {
      const monto = Math.abs(Number(String(fila[7] ?? '0').replace(/[^0-9.-]/g, '')) || 0);
      const fecha = aFechaISO(col1);
      if (monto > 0 && fecha) {
        actual.transacciones.push({ fecha, tipo, monto, cuenta: String(fila[6] ?? '') });
      }
    } else if (tipo && tipo !== 'Credit Memo') {
      ignoradas += 1;
    }
  }

  return { bloques: bloques.filter((b) => b.transacciones.length > 0), ignoradas };
}

export function ImportTransactionHistoryModal({ onClose }: { onClose: () => void }) {
  const { clientes, importarHistorial } = useDataStore();
  const [bloques, setBloques] = useState<Bloque[] | null>(null);
  const [ignoradas, setIgnoradas] = useState(0);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<{
    clientesConMovimientos: number;
    facturasCreadas: number;
    pagosCreados: number;
    excedentesGenerados: number;
    clientesSinMatch: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const codigosConocidos = new Set(clientes.map((c) => c.codigo));

  function handleArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setErrorArchivo(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: 'binary' });
        const hoja = wb.Sheets[wb.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: '', raw: false });
        const { bloques: b, ignoradas: ig } = parsearReporte(filas);
        if (b.length === 0) {
          setErrorArchivo('No se encontró ningún bloque de cliente reconocible en este archivo. ¿Es el reporte "Transaction List by Customer"?');
          return;
        }
        setBloques(b);
        setIgnoradas(ig);
      } catch {
        setErrorArchivo('No se pudo leer el archivo.');
      }
    };
    reader.onerror = () => setErrorArchivo('No se pudo leer el archivo.');
    reader.readAsBinaryString(archivo);
  }

  async function handleImportar() {
    if (!bloques) return;
    setImportando(true);
    const r = await importarHistorial(bloques.map(({ codigo, nombre, transacciones }) => ({ codigo, nombre, transacciones })));
    setImportando(false);
    setResultado(r);
  }

  const conMatch = bloques?.filter((b) => codigosConocidos.has(b.codigo)) ?? [];
  const sinMatch = bloques?.filter((b) => !codigosConocidos.has(b.codigo)) ?? [];
  const totalFacturas = bloques?.reduce((a, b) => a + b.transacciones.filter((t) => t.tipo === 'Invoice').length, 0) ?? 0;
  const totalPagos = bloques?.reduce((a, b) => a + b.transacciones.filter((t) => t.tipo === 'Payment').length, 0) ?? 0;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-8 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(620px,96vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Importar historial (facturas y pagos)</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>

        {resultado ? (
          <div className="p-6 text-center">
            <div className="text-lg font-semibold mb-1">Listo ✓</div>
            <div className="text-ink-soft text-sm">
              Se importaron <b>{resultado.facturasCreadas}</b> facturas y <b>{resultado.pagosCreados}</b> pagos de{' '}
              <b>{resultado.clientesConMovimientos}</b> clientes.
              {resultado.excedentesGenerados > 0 && <> Se generaron {resultado.excedentesGenerados} notas de crédito por excedentes de pago.</>}
            </div>
            {resultado.clientesSinMatch.length > 0 && (
              <div className="text-danger-dark text-[12.5px] mt-3 text-left border border-danger/30 rounded-[6px] p-2.5 max-h-[140px] overflow-y-auto">
                <b>{resultado.clientesSinMatch.length} bloques sin cliente que coincida</b> (no se importaron):
                <ul className="list-disc pl-4 mt-1">
                  {resultado.clientesSinMatch.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            <button className="btn-accent mt-4" onClick={onClose}>Cerrar</button>
          </div>
        ) : !bloques ? (
          <div className="p-4">
            <div className="text-sm text-ink-soft mb-3">
              Subí el reporte <b>"Transaction List by Customer"</b> de QuickBooks (Informes → Lista de
              transacciones, rango de fechas que quieras migrar). Los pagos se cruzan con las facturas
              más viejas sin cobrar de cada cliente (regla FIFO), en el mismo orden en que aparecen en
              el reporte — es una reconstrucción, no un vínculo exacto que traiga QuickBooks.
            </div>
            <div className="text-ink-faint text-[11.5px] mb-3 bg-line-soft rounded-[6px] p-2.5">
              Las notas de crédito del reporte no se importan en esta pasada. Los métodos de pago se
              infieren de la cuenta destino: "Bank of America" → Zelle, "Undeposited Funds" → Kotapay
              (podés corregirlos a mano después si hace falta).
            </div>
            <div className="border-t border-line pt-4">
              <div className="th-label mb-1.5">Subir archivo (CSV, XLS o XLSX)</div>
              <input ref={fileInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={handleArchivo} className="text-sm" />
              {errorArchivo && <div className="text-danger-dark text-[12.5px] mt-2">{errorArchivo}</div>}
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="text-sm mb-3">
              Se encontraron <b>{bloques.length}</b> clientes con movimientos: <span className="text-success">{conMatch.length} coinciden con clientes ya cargados</span>
              {sinMatch.length > 0 && <>, <span className="text-danger-dark">{sinMatch.length} sin coincidencia</span></>}.
              <br />
              <b>{totalFacturas}</b> facturas y <b>{totalPagos}</b> pagos en total para importar.
              {ignoradas > 0 && <> Se ignoraron {ignoradas} filas que no son factura/pago (depósitos, gastos, etc.).</>}
            </div>

            {sinMatch.length > 0 && (
              <div className="text-danger-dark text-[12px] mb-3 border border-danger/30 rounded-[6px] p-2.5 max-h-[120px] overflow-y-auto">
                <b>Sin coincidencia</b> (van a quedar afuera de la importación — el código no está en Clientes):
                <ul className="list-disc pl-4 mt-1">
                  {sinMatch.slice(0, 30).map((b, i) => (
                    <li key={i}>{b.codigo || '(sin código)'} — {b.nombre}</li>
                  ))}
                  {sinMatch.length > 30 && <li>… y {sinMatch.length - 30} más</li>}
                </ul>
              </div>
            )}

            <div className="flex gap-2">
              <button className="btn-accent" onClick={handleImportar} disabled={importando || conMatch.length === 0}>
                {importando ? 'Importando…' : `Importar ${conMatch.length} cliente${conMatch.length !== 1 ? 's' : ''}`}
              </button>
              <button className="btn-outline" onClick={() => setBloques(null)} disabled={importando}>
                Elegir otro archivo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
