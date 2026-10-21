import { useMemo, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import type { Cliente } from '../types';
import { formatoMoneda } from '../lib/aging';

/** Pop-up al dar de alta (o reactivar) una unidad: crear la cuota semanal (1090PB) y la reactivación (1090RA) o reinscripción (1090RI). */
export function AltaFacturaModal({ cliente, sugerido, onClose }: { cliente: Cliente; sugerido: 'RA' | 'RI'; onClose: () => void }) {
  const { catalogoFees, configuracion, agregarFactura } = useDataStore();
  const itemRA = catalogoFees.find((f) => f.codigo === '1090RA');
  const itemRI = catalogoFees.find((f) => f.codigo === '1090RI');
  const [crearPB, setCrearPB] = useState(true);
  const [montoPB, setMontoPB] = useState(String(cliente.cuotaSemanal || configuracion.cuotaSemanalPorDefecto));
  const [crearFee, setCrearFee] = useState(true);
  const [tipoFee, setTipoFee] = useState<'RA' | 'RI'>(sugerido);
  const itemFee = tipoFee === 'RA' ? itemRA : itemRI;
  const montoDefecto = tipoFee === 'RA' ? 10 : 20;
  const [montoFee, setMontoFee] = useState('');
  const montoFeeNum = montoFee !== '' ? Number(montoFee) : itemFee?.monto ?? montoDefecto;
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const total = useMemo(() => (crearPB ? Number(montoPB) || 0 : 0) + (crearFee ? montoFeeNum || 0 : 0), [crearPB, montoPB, crearFee, montoFeeNum]);

  async function handleCrear() {
    setError(null);
    setGuardando(true);
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      if (crearPB) {
        if (!(Number(montoPB) > 0)) throw new Error('El monto de la cuota semanal tiene que ser mayor a 0.');
        await agregarFactura({ clienteId: cliente.id, concepto: '1090PB Cuota semanal (alta)', monto: Number(montoPB), codigo: '1090PB', fechaVencimiento: hoy });
      }
      if (crearFee) {
        if (!(montoFeeNum > 0)) throw new Error('El monto tiene que ser mayor a 0.');
        await agregarFactura({
          clienteId: cliente.id,
          concepto: itemFee?.etiqueta ?? (tipoFee === 'RA' ? 'Reactivación' : 'Reinscripción'),
          monto: montoFeeNum,
          codigo: `1090${tipoFee}`,
          fechaVencimiento: hoy,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron crear las facturas.');
    } finally {
      setGuardando(false);
    }
  }

  const inp = 'border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm num w-28 focus:outline-none focus:border-accent';
  return (
    <div role="dialog" aria-label="Facturar el alta" className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50 overflow-y-auto pb-10">
      <div className="panel w-[min(460px,94vw)] shadow-2xl">
        <div className="px-4 py-3 border-b border-line">
          <div className="font-semibold text-[15px]">Facturar el alta de {cliente.codigo} {cliente.nombre}</div>
          <div className="text-ink-soft text-[12px]">Elegí qué facturas crear ahora. Podés editar los montos.</div>
        </div>
        <div className="p-4 flex flex-col gap-3.5 text-[13px]">
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={crearPB} onChange={(e) => setCrearPB(e.target.checked)} />
            <span className="flex-1"><b>1090PB</b> · Cuota semanal</span>
            <input aria-label="Monto 1090PB" type="number" value={montoPB} onChange={(e) => setMontoPB(e.target.value)} className={inp} disabled={!crearPB} />
          </label>
          <div className="flex items-center gap-2.5">
            <input type="checkbox" checked={crearFee} onChange={(e) => setCrearFee(e.target.checked)} aria-label="Crear reactivación o reinscripción" />
            <div className="flex-1 flex gap-1.5">
              {(['RA', 'RI'] as const).map((t) => (
                <button key={t} aria-pressed={tipoFee === t} onClick={() => { setTipoFee(t); setMontoFee(''); }} className={tipoFee === t ? 'chip-accent' : 'chip'}>
                  1090{t} · {t === 'RA' ? 'Reactivación' : 'Reinscripción'}
                </button>
              ))}
            </div>
            <input aria-label="Monto reactivación o reinscripción" type="number" value={montoFee !== '' ? montoFee : String(itemFee?.monto ?? montoDefecto)} onChange={(e) => setMontoFee(e.target.value)} className={inp} disabled={!crearFee} />
          </div>
          <div className="text-ink-soft text-[12px]">
            Sugerencia: {sugerido === 'RA' ? 'reactivación (volvió dentro de los 28 días de su última factura)' : 'reinscripción (alta nueva o pasaron más de 28 días)'}.
          </div>
          {error && <div role="alert" className="text-danger-dark text-[12.5px]">{error}</div>}
          <div className="flex items-center gap-2">
            <button className="btn-accent" onClick={handleCrear} disabled={guardando || (!crearPB && !crearFee)}>
              {guardando ? 'Creando…' : `Crear facturas · ${formatoMoneda(total)}`}
            </button>
            <button className="btn-outline" onClick={onClose} disabled={guardando}>Ahora no</button>
          </div>
        </div>
      </div>
    </div>
  );
}
