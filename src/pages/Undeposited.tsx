import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../data/apiClient';
import { useDataStore } from '../data/DataContext';
import { formatoMoneda } from '../lib/aging';

interface Pendiente { pagoId: string; numero: number; fecha: string; cliente: string; metodo: string; referencia?: string; monto: number }
interface Deposito { id: string; fecha: string; destino: string; destinoNombre: string; monto: number; nota?: string; creadoPor?: string; pagos: number[] }
interface Datos { destinos: { cuenta: string; nombre: string }[]; pendientes: Pendiente[]; total: number; depositos: Deposito[] }

export function Undeposited() {
  const { usuarioActual } = useDataStore();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState('10200');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [nota, setNota] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [filtro, setFiltro] = useState<'todos' | 'kotapay' | 'efectivo'>('todos');
  const esAdmin = usuarioActual?.rol === 'admin';

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.get<Datos>('/undeposited'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar.');
    }
  }, []);
  useEffect(() => {
    if (esAdmin) cargar();
  }, [esAdmin, cargar]);

  const visibles = useMemo(
    () => (datos?.pendientes ?? []).filter((p) => filtro === 'todos' || (filtro === 'kotapay' ? /kota/i.test(p.metodo) : /efectivo|cash/i.test(p.metodo))),
    [datos, filtro]
  );
  const totalElegido = (datos?.pendientes ?? []).filter((p) => elegidos.has(p.pagoId)).reduce((a, p) => a + p.monto, 0);

  if (!esAdmin) {
    return (
      <div className="px-6 md:px-8 py-6">
        <div className="font-semibold text-lg mb-1">No tenés permiso para ver esta pantalla</div>
        <p className="text-ink-soft text-sm">Undeposited Funds lo maneja la administración.</p>
      </div>
    );
  }

  async function depositar() {
    setTrabajando(true);
    setError(null);
    try {
      await api.post('/undeposited/depositar', { pagoIds: [...elegidos], destino, fecha, nota: nota || undefined });
      setElegidos(new Set());
      setNota('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo depositar.');
    } finally {
      setTrabajando(false);
      await cargar();
    }
  }

  async function deshacer(d: Deposito) {
    if (!window.confirm(`¿Deshacer el depósito de ${formatoMoneda(d.monto)}? Los pagos vuelven a Undeposited.`)) return;
    try {
      await api.delete(`/undeposited/depositos/${d.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo deshacer.');
    }
    await cargar();
  }

  const toggle = (id: string) => setElegidos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todosMarcados = visibles.length > 0 && visibles.every((p) => elegidos.has(p.pagoId));

  return (
    <div className="px-6 md:px-8 py-6 max-w-[1100px]">
      <h1 className="text-[22px] font-bold mb-1">Undeposited Funds</h1>
      <p className="text-ink-soft text-[13px] mb-5">
        Lo cobrado por Kotapay y en efectivo espera acá hasta que lo deposites. Elegí los pagos y a qué banco van: 10200 (Bank of America 1611) o 10201 (Bank of America 9859).
        Los Zelle entran directo al 10201 y no pasan por acá.
      </p>
      {error && <div role="alert" className="text-danger-dark text-[12.5px] border border-danger/30 rounded-[6px] px-3 py-2 mb-4">{error}</div>}

      <div className="panel p-4 mb-5">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="font-semibold text-[14px] mr-2">Por depositar · {formatoMoneda(datos?.total ?? 0)}</span>
          {(['todos', 'kotapay', 'efectivo'] as const).map((f) => (
            <button key={f} aria-pressed={filtro === f} onClick={() => setFiltro(f)} className={filtro === f ? 'chip-accent capitalize' : 'chip capitalize'}>{f}</button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[640px]">
            <thead>
              <tr className="text-left th-label">
                <th className="py-1.5 w-8"><input type="checkbox" aria-label="Marcar todos" checked={todosMarcados} onChange={() => setElegidos(todosMarcados ? new Set() : new Set(visibles.map((p) => p.pagoId)))} /></th>
                <th className="py-1.5">Pago</th><th>Fecha</th><th>Cliente</th><th>Método</th><th className="text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.pagoId} className="border-t border-line-soft">
                  <td className="py-1.5"><input type="checkbox" aria-label={`Pago ${p.numero}`} checked={elegidos.has(p.pagoId)} onChange={() => toggle(p.pagoId)} /></td>
                  <td className="num">P-{p.numero}</td><td className="num">{p.fecha.slice(0, 10)}</td><td>{p.cliente}</td><td className="capitalize">{p.metodo}</td>
                  <td className="text-right num">{formatoMoneda(p.monto)}</td>
                </tr>
              ))}
              {visibles.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-ink-soft">No hay pagos esperando depósito.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-4 pt-3 border-t border-line">
          <div>
            <div className="th-label mb-1">Banco destino</div>
            <select aria-label="Banco destino" value={destino} onChange={(e) => setDestino(e.target.value)} className="border border-line rounded-[5px] bg-surface px-2 py-1.5 text-[13px]">
              {(datos?.destinos ?? []).map((d) => <option key={d.cuenta} value={d.cuenta}>{d.nombre}</option>)}
            </select>
          </div>
          <div>
            <div className="th-label mb-1">Fecha del depósito</div>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="border border-line rounded-[5px] bg-surface px-2 py-1.5 text-[13px]" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <div className="th-label mb-1">Nota (opcional)</div>
            <input value={nota} onChange={(e) => setNota(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-[13px]" />
          </div>
          <button className="btn-accent" disabled={trabajando || elegidos.size === 0} onClick={depositar}>Depositar {formatoMoneda(totalElegido)}</button>
        </div>
      </div>

      <h2 className="font-semibold text-[14px] mb-2">Depósitos hechos</h2>
      <div className="panel divide-y divide-line-soft">
        {(datos?.depositos ?? []).map((d) => (
          <div key={d.id} className="px-4 py-2.5 text-[13px] flex flex-wrap items-center justify-between gap-2">
            <div>
              <b className="num">{formatoMoneda(d.monto)}</b> → {d.destinoNombre} · {d.fecha}
              <div className="text-ink-faint text-[12px]">Pagos {d.pagos.map((n) => `P-${n}`).join(', ')}{d.nota ? ` · ${d.nota}` : ''}{d.creadoPor ? ` · ${d.creadoPor}` : ''}</div>
            </div>
            <button className="text-[12px] text-ink-soft hover:underline" onClick={() => deshacer(d)}>Deshacer</button>
          </div>
        ))}
        {(datos?.depositos ?? []).length === 0 && <div className="px-4 py-5 text-ink-soft text-sm">Todavía no hiciste depósitos.</div>}
      </div>
    </div>
  );
}
