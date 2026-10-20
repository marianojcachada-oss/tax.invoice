import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../data/apiClient';

interface CuentaPlan { numero: string; nombre: string; tipo: string }
interface Config {
  corte: string;
  zelle: string; kotapay: string; efectivo: string; banco: string;
  ingresoDefault: string; notaCredito: string; reembolso: string;
  saldosCargados: number;
}
interface Mapeos {
  fees: { id: string; codigo: string; etiqueta: string; cuentaIngreso: string | null }[];
  cuentas: { id: string; nombre: string; tipo: string; cuentaContable: string | null }[];
}
interface Asiento { id: string; fecha: string; descripcion: string; lineas: { cuenta: string; debe: number; haber: number }[] }
interface Conciliacion { al: string; arLibro: number; arAging: number; diferenciaAR: number; balanceCuadra: boolean; diferenciaBalance: number }

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

function aBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    r.readAsDataURL(file);
  });
}

function SelectCuenta({ plan, valor, onChange, tipos, vacio, etiqueta }: { plan: CuentaPlan[]; valor: string | null; onChange: (v: string) => void; tipos?: string[]; vacio?: string; etiqueta: string }) {
  const opciones = plan.filter((c) => !tipos || tipos.includes(c.tipo) || c.numero === valor);
  return (
    <select aria-label={etiqueta} value={valor ?? ''} onChange={(e) => onChange(e.target.value)} className="h-8 px-2 border border-line rounded-[5px] bg-surface text-[12.5px] max-w-[260px]">
      {vacio !== undefined && <option value="">{vacio}</option>}
      {opciones.map((c) => (
        <option key={c.numero} value={c.numero}>{c.numero} {c.nombre}</option>
      ))}
    </select>
  );
}

export function AjustesContables({ onCambio }: { onCambio: () => void }) {
  const [plan, setPlan] = useState<CuentaPlan[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [mapeos, setMapeos] = useState<Mapeos | null>(null);
  const [asientos, setAsientos] = useState<Asiento[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [archBalance, setArchBalance] = useState<File | null>(null);
  const [archPyL, setArchPyL] = useState<File | null>(null);
  const [concil, setConcil] = useState<Conciliacion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nuevo, setNuevo] = useState({ fecha: hoy(), descripcion: '', lineas: [{ cuenta: '', debe: '', haber: '' }, { cuenta: '', debe: '', haber: '' }] });

  const cargar = useCallback(async () => {
    try {
      const [p, c, m, a] = await Promise.all([
        api.get<CuentaPlan[]>('/contabilidad/plan'),
        api.get<Config>('/contabilidad/config'),
        api.get<Mapeos>('/contabilidad/mapeos'),
        api.get<Asiento[]>('/contabilidad/asientos'),
      ]);
      setPlan(p); setConfig(c); setMapeos(m); setAsientos(a);
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message });
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const avisar = (ok: boolean, texto: string) => setMsg({ ok, texto });

  async function cargarArranque() {
    if (!archBalance || !archPyL) return;
    if (config && config.saldosCargados > 0 && !window.confirm('Ya hay saldos de arranque cargados. Cargar estos archivos los REEMPLAZA. ¿Seguro?')) return;
    setOcupado(true);
    try {
      const r = await api.post<{ corte: string; cuentasCargadas: number; balanceCuadra: boolean; netIncome: number }>('/contabilidad/arranque', {
        balance: await aBase64(archBalance),
        resultados: await aBase64(archPyL),
      });
      avisar(r.balanceCuadra, `Se cargaron ${r.cuentasCargadas} cuentas al ${r.corte}. Net Income: ${money(r.netIncome)}. ${r.balanceCuadra ? 'El balance cuadra.' : 'OJO: el balance no cuadra, revisá los archivos.'}`);
      setArchBalance(null); setArchPyL(null);
      await cargar(); onCambio();
    } catch (e) {
      avisar(false, (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function guardarConfig(parcial: Partial<Config>) {
    try {
      await api.put('/contabilidad/config', parcial);
      await cargar(); onCambio();
    } catch (e) { avisar(false, (e as Error).message); }
  }
  async function guardarMapeo(cambio: { fees?: { id: string; cuentaIngreso: string }[]; cuentas?: { id: string; cuentaContable: string }[] }) {
    try {
      await api.put('/contabilidad/mapeos', cambio);
      await cargar(); onCambio();
    } catch (e) { avisar(false, (e as Error).message); }
  }
  async function conciliar() {
    try { setConcil(await api.get<Conciliacion>(`/contabilidad/conciliacion?al=${hoy()}`)); }
    catch (e) { avisar(false, (e as Error).message); }
  }
  async function crearAsiento() {
    try {
      await api.post('/contabilidad/asientos', {
        fecha: nuevo.fecha,
        descripcion: nuevo.descripcion,
        lineas: nuevo.lineas.filter((l) => l.cuenta).map((l) => ({ cuenta: l.cuenta, debe: Number(l.debe) || 0, haber: Number(l.haber) || 0 })),
      });
      setNuevo({ fecha: hoy(), descripcion: '', lineas: [{ cuenta: '', debe: '', haber: '' }, { cuenta: '', debe: '', haber: '' }] });
      avisar(true, 'Asiento guardado.');
      await cargar(); onCambio();
    } catch (e) { avisar(false, (e as Error).message); }
  }
  async function borrarAsiento(id: string) {
    if (!window.confirm('¿Borrar este asiento?')) return;
    try { await api.delete(`/contabilidad/asientos/${id}`); await cargar(); onCambio(); }
    catch (e) { avisar(false, (e as Error).message); }
  }

  const caja = 'panel mb-3';
  const resumen = 'px-4 py-3 cursor-pointer font-semibold text-[14px] min-h-[44px] flex items-center';
  const cuentaCfg: [keyof Config, string, string[] | undefined][] = [
    ['zelle', 'Pagos por Zelle entran a', ['Bank', 'Other Current Assets']],
    ['kotapay', 'Pagos por Kotapay entran a', ['Bank', 'Other Current Assets']],
    ['efectivo', 'Pagos en efectivo entran a', ['Bank', 'Other Current Assets']],
    ['banco', 'Si no se indica de dónde salió, sale de', ['Bank', 'Credit Card']],
    ['ingresoDefault', 'Facturas sin cuenta de ingreso van a', ['Income', 'Other Income']],
    ['notaCredito', 'Notas de crédito (descuentos) van a', ['Income', 'Expenses']],
    ['reembolso', 'Reembolsos van a', ['Income', 'Expenses']],
  ];

  return (
    <section aria-label="Ajustes de contabilidad" className="mt-2">
      <h2 className="font-semibold text-[15px] mb-2">Ajustes de contabilidad</h2>
      {msg && (
        <div role="status" className={`panel p-3 mb-3 text-[13px] flex gap-2 items-start ${msg.ok ? '' : 'text-danger-dark'}`}>
          {msg.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />} {msg.texto}
        </div>
      )}

      <details className={caja} open={!!config && config.saldosCargados === 0}>
        <summary className={resumen}>1 · Saldos de arranque desde QuickBooks {config && <span className={`ml-2 ${config.saldosCargados ? 'chip-success' : 'chip-danger'}`}>{config.saldosCargados ? `${config.saldosCargados} cuentas al ${config.corte}` : 'sin cargar'}</span>}</summary>
        <div className="px-4 pb-4 text-[13px] flex flex-col gap-3">
          <p className="text-ink-soft">Exportá de QuickBooks el <b>Balance Sheet</b> y el <b>Profit and Loss</b> (enero 1 hasta la misma fecha) a Excel y subilos acá. Desde esa fecha de corte, tax.invoice suma todo lo nuevo que cargues.</p>
          <div className="flex flex-wrap gap-4 items-end">
            <label className="flex flex-col gap-1">Balance Sheet (.xlsx)
              <input type="file" accept=".xlsx" onChange={(e) => setArchBalance(e.target.files?.[0] ?? null)} />
            </label>
            <label className="flex flex-col gap-1">Profit and Loss (.xlsx)
              <input type="file" accept=".xlsx" onChange={(e) => setArchPyL(e.target.files?.[0] ?? null)} />
            </label>
            <button className="btn-accent inline-flex items-center gap-1.5" disabled={!archBalance || !archPyL || ocupado} onClick={cargarArranque}>
              <Upload size={14} aria-hidden /> Cargar saldos
            </button>
          </div>
          <div>
            <button className="btn-outline" onClick={conciliar}>Verificar que cuadra</button>
            {concil && (
              <div className="mt-2 text-ink-soft">
                A/R del libro {money(concil.arLibro)} · A/R Aging {money(concil.arAging)} ·{' '}
                <b className={concil.diferenciaAR === 0 ? 'text-success' : 'text-danger-dark'}>diferencia {money(concil.diferenciaAR)}</b> ·{' '}
                {concil.balanceCuadra ? 'el balance cuadra' : `el balance NO cuadra (${money(concil.diferenciaBalance)})`}
              </div>
            )}
          </div>
        </div>
      </details>

      <details className={caja}>
        <summary className={resumen}>2 · A qué cuenta contable va cada cosa</summary>
        <div className="px-4 pb-4 text-[13px] flex flex-col gap-4">
          {config && (
            <div className="grid gap-2 md:grid-cols-2">
              {cuentaCfg.map(([k, texto, tipos]) => (
                <label key={k} className="flex flex-col gap-1">{texto}
                  <SelectCuenta plan={plan} tipos={tipos} etiqueta={texto} valor={config[k] as string} onChange={(v) => guardarConfig({ [k]: v })} />
                </label>
              ))}
            </div>
          )}
          {mapeos && mapeos.fees.length > 0 && (
            <div>
              <div className="th-label mb-1.5">Ingreso de cada fee (catálogo)</div>
              <div className="flex flex-col gap-1.5">
                {mapeos.fees.map((f) => (
                  <div key={f.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-52 truncate" title={f.etiqueta}>{f.codigo} · {f.etiqueta}</span>
                    <SelectCuenta plan={plan} tipos={['Income', 'Other Income']} etiqueta={`Ingreso de ${f.codigo}`} valor={f.cuentaIngreso} vacio="(la de por defecto)" onChange={(v) => guardarMapeo({ fees: [{ id: f.id, cuentaIngreso: v }] })} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {mapeos && mapeos.cuentas.length > 0 && (
            <div>
              <div className="th-label mb-1.5">Cuentas de la app</div>
              <div className="flex flex-col gap-1.5">
                {mapeos.cuentas.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-52 truncate">{c.nombre}</span>
                    <SelectCuenta plan={plan} tipos={['Bank', 'Credit Card', 'Other Current Assets']} etiqueta={`Cuenta contable de ${c.nombre}`} valor={c.cuentaContable} vacio="(sin asignar)" onChange={(v) => guardarMapeo({ cuentas: [{ id: c.id, cuentaContable: v }] })} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </details>

      <details className={caja}>
        <summary className={resumen}>3 · Asientos manuales (nómina, depreciación, retiros…)</summary>
        <div className="px-4 pb-4 text-[13px] flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <input type="date" aria-label="Fecha del asiento" value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} className="h-8 px-2 border border-line rounded-[5px] bg-surface" />
            <input aria-label="Descripción del asiento" placeholder="Descripción" value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} className="h-8 px-2 border border-line rounded-[5px] bg-surface flex-1 min-w-[200px]" />
          </div>
          {nuevo.lineas.map((l, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <SelectCuenta plan={plan} etiqueta={`Cuenta de la línea ${i + 1}`} valor={l.cuenta} vacio="Cuenta…" onChange={(v) => setNuevo({ ...nuevo, lineas: nuevo.lineas.map((x, k) => (k === i ? { ...x, cuenta: v } : x)) })} />
              <input aria-label={`Debe línea ${i + 1}`} placeholder="Debe" inputMode="decimal" value={l.debe} onChange={(e) => setNuevo({ ...nuevo, lineas: nuevo.lineas.map((x, k) => (k === i ? { ...x, debe: e.target.value, haber: e.target.value ? '' : x.haber } : x)) })} className="h-8 w-28 px-2 border border-line rounded-[5px] bg-surface text-right" />
              <input aria-label={`Haber línea ${i + 1}`} placeholder="Haber" inputMode="decimal" value={l.haber} onChange={(e) => setNuevo({ ...nuevo, lineas: nuevo.lineas.map((x, k) => (k === i ? { ...x, haber: e.target.value, debe: e.target.value ? '' : x.debe } : x)) })} className="h-8 w-28 px-2 border border-line rounded-[5px] bg-surface text-right" />
            </div>
          ))}
          <div className="flex gap-2">
            <button className="btn-outline inline-flex items-center gap-1.5" onClick={() => setNuevo({ ...nuevo, lineas: [...nuevo.lineas, { cuenta: '', debe: '', haber: '' }] })}><Plus size={14} aria-hidden /> Línea</button>
            <button className="btn-accent" onClick={crearAsiento}>Guardar asiento</button>
          </div>
          {asientos.length > 0 && (
            <ul className="flex flex-col gap-1.5 border-t border-line-soft pt-3">
              {asientos.map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <div className="flex-1">
                    <b>{a.fecha}</b> · {a.descripcion}
                    <div className="text-ink-soft text-[12px]">{a.lineas.map((l) => `${l.cuenta} ${l.debe ? `D ${money(l.debe)}` : `H ${money(l.haber)}`}`).join('  ·  ')}</div>
                  </div>
                  <button aria-label={`Borrar asiento ${a.descripcion}`} className="p-2 text-ink-faint hover:text-danger-dark" onClick={() => borrarAsiento(a.id)}><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
