import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { api, descargarArchivo } from '../data/apiClient';
import { useDataStore } from '../data/DataContext';
import { AjustesContables } from '../components/AjustesContables';

interface FilaInforme {
  etiqueta: string;
  nivel: number;
  negrita: boolean;
  total?: boolean;
  valores: (number | null)[];
  moneda?: boolean[];
}
interface Informe {
  empresa: string;
  titulo: string;
  rango: string;
  columnas: string[];
  filas: FilaInforme[];
  pie: string;
  avisos: string[];
  cuadra?: boolean;
}

type TipoInforme = 'profit-and-loss' | 'balance-sheet' | 'ar-aging-summary';
const INFORMES: { id: TipoInforme; nombre: string; ayuda: string }[] = [
  { id: 'ar-aging-summary', nombre: 'A/R Aging Summary Report', ayuda: 'Lo que deben las unidades, por antigüedad.' },
  { id: 'profit-and-loss', nombre: 'Profit and Loss', ayuda: 'Ingresos, costos y gastos de un período.' },
  { id: 'balance-sheet', nombre: 'Balance Sheet', ayuda: 'Activos, pasivos y patrimonio a una fecha.' },
];
const ARCHIVOS: Record<TipoInforme, string> = {
  'profit-and-loss': 'TAXI_LASER_LLC_Profit_and_Loss',
  'balance-sheet': 'TAXI_LASER_LLC_Balance_Sheet',
  'ar-aging-summary': 'TAXI_LASER_LLC_A_R_Aging_Summary_Report',
};

const num = (c: number) => (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dinero = (c: number, moneda: boolean) => `${c < 0 ? '-' : ''}${moneda ? '$' : ''}${num(c)}`;
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

export function Informes() {
  const { usuarioActual } = useDataStore();
  const esAdmin = usuarioActual?.rol === 'admin';
  const [tipo, setTipo] = useState<TipoInforme>('profit-and-loss');
  const [desde, setDesde] = useState(`${hoy().slice(0, 4)}-01-01`);
  const [hasta, setHasta] = useState(hoy());
  const [informe, setInforme] = useState<Informe | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // sube cuando cambian los ajustes, para recalcular

  const query = useCallback(
    (formato?: string) => {
      const p = new URLSearchParams();
      if (tipo === 'profit-and-loss') { p.set('desde', desde); p.set('hasta', hasta); } else p.set('al', hasta);
      if (formato) p.set('formato', formato);
      return p.toString();
    },
    [tipo, desde, hasta]
  );

  useEffect(() => {
    if (!esAdmin) return;
    let vivo = true;
    setCargando(true);
    setError('');
    api
      .get<Informe>(`/contabilidad/informes/${tipo}?${query()}`)
      .then((r) => { if (vivo) setInforme(r); })
      .catch((e) => { if (vivo) { setInforme(null); setError(e.message); } })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [tipo, query, esAdmin, version]);

  async function exportar(formato: 'csv' | 'xlsx' | 'pdf') {
    setDescargando(formato);
    setError('');
    try {
      const blob = await descargarArchivo(`/contabilidad/informes/${tipo}?${query(formato)}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ARCHIVOS[tipo]}.${formato}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDescargando(null);
    }
  }

  if (!esAdmin) {
    return <div className="px-6 md:px-8 py-6 text-ink-soft">Los informes contables son solo para administradores.</div>;
  }

  const unaFecha = tipo !== 'profit-and-loss';
  return (
    <div className="px-6 md:px-8 py-6 max-w-[1100px]">
      <div className="mb-4">
        <h1 className="font-semibold text-[22px]">Informes contables</h1>
        <p className="text-ink-soft text-[13px]">Los mismos informes que usa el estudio contable en QuickBooks, con los mismos nombres y cuentas, para el cierre del año fiscal.</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Elegir informe">
        {INFORMES.map((i) => (
          <button key={i.id} onClick={() => setTipo(i.id)} aria-pressed={tipo === i.id} className={tipo === i.id ? 'chip-accent' : 'chip'} title={i.ayuda}>
            {i.nombre}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        {!unaFecha && (
          <label className="text-[12px] text-ink-soft flex flex-col gap-1">
            Desde
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-9 px-2 border border-line rounded-[5px] bg-surface text-[13px]" />
          </label>
        )}
        <label className="text-[12px] text-ink-soft flex flex-col gap-1">
          {unaFecha ? 'Al día' : 'Hasta'}
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="h-9 px-2 border border-line rounded-[5px] bg-surface text-[13px]" />
        </label>
        <div className="flex gap-2 ml-auto">
          {([['xlsx', 'Excel', FileSpreadsheet], ['csv', 'CSV', Download], ['pdf', 'PDF', FileText]] as const).map(([f, nombre, Icono]) => (
            <button key={f} className="btn-outline inline-flex items-center gap-1.5" onClick={() => exportar(f)} disabled={descargando !== null || !informe}>
              {descargando === f ? <Loader2 size={14} className="animate-spin" /> : <Icono size={14} aria-hidden />}
              {nombre}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="panel p-3 mb-4 text-[13px] flex gap-2 items-start text-danger-dark">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </div>
      )}
      {informe?.avisos?.map((a) => (
        <div key={a} className="panel p-3 mb-3 text-[12.5px] text-ink-soft flex gap-2 items-start">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {a}
        </div>
      ))}

      {cargando && !informe && <div className="text-ink-soft text-[13px] flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Calculando…</div>}

      {informe && (
        <div className={`panel overflow-x-auto mb-6 ${cargando ? 'opacity-60' : ''}`}>
          <div className="text-center py-4 border-b border-line-soft">
            <div className="font-semibold text-[16px]">{informe.empresa}</div>
            <div className="font-semibold text-[14px]">{informe.titulo}</div>
            <div className="text-[12.5px] text-ink-soft">{informe.rango}</div>
            {informe.cuadra !== undefined && (
              <div className={`mt-2 inline-flex ${informe.cuadra ? 'chip-success' : 'chip-danger'}`}>
                {informe.cuadra ? <CheckCircle2 size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />}
                {informe.cuadra ? 'El balance cuadra' : 'El balance NO cuadra'}
              </div>
            )}
          </div>
          <table className="w-full text-[12.5px] tabular-nums">
            <thead>
              <tr className="border-b border-line">
                <th className="text-left px-4 py-2 font-semibold" scope="col"><span className="sr-only">Cuenta</span></th>
                {informe.columnas.map((c) => (
                  <th key={c} scope="col" className="text-right px-3 py-2 font-semibold whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {informe.filas.length === 0 && (
                <tr><td colSpan={informe.columnas.length + 1} className="px-4 py-6 text-center text-ink-soft">No hay nada para mostrar en esta fecha.</td></tr>
              )}
              {informe.filas.map((f, i) => (
                <tr key={i} className={f.total ? 'border-t border-line' : ''}>
                  <td className={`py-1 pr-3 ${f.negrita ? 'font-semibold' : ''}`} style={{ paddingLeft: 16 + f.nivel * 16 }}>{f.etiqueta}</td>
                  {informe.columnas.map((_, c) => {
                    const v = f.valores[c];
                    return (
                      <td key={c} className={`px-3 py-1 text-right whitespace-nowrap ${f.negrita ? 'font-semibold' : ''}`}>
                        {v == null ? '' : dinero(v, f.moneda ? !!f.moneda[c] : !!f.total)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-center text-[11.5px] text-ink-faint py-3 border-t border-line-soft">{informe.pie.trim()}</div>
        </div>
      )}

      <AjustesContables onCambio={() => setVersion((v) => v + 1)} />
    </div>
  );
}
