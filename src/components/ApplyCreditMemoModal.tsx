import { useRef, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { saldoPendiente, formatoMoneda } from '../lib/aging';
import type { NotaCredito } from '../types';

export function ApplyCreditMemoModal({ nota, onClose }: { nota: NotaCredito; onClose: () => void }) {
  const { getCliente, getFacturasDeCliente, aplicarNotaCredito } = useDataStore();
  const cliente = getCliente(nota.clienteId);
  const disponible = nota.monto - nota.montoAplicado;
  const facturasPendientes = getFacturasDeCliente(nota.clienteId).filter((f) => saldoPendiente(f) > 0);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const enviandoRef = useRef(false);

  const montoAAplicar = facturasPendientes
    .filter((f) => seleccionadas.has(f.id))
    .reduce((a, f) => a + Math.min(saldoPendiente(f), disponible), 0);

  function toggle(id: string) {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleAplicar() {
    if (enviandoRef.current) return;
    if (seleccionadas.size === 0) return;
    enviandoRef.current = true;
    aplicarNotaCredito(nota.id, Array.from(seleccionadas));
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(480px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Aplicar nota de crédito #{nota.numero}</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>
        <div className="px-4 py-3 border-b border-line text-sm">
          <div className="text-ink-soft">Cliente</div>
          <div>{cliente?.codigo} · {cliente?.nombre}</div>
          <div className="text-ink-soft mt-2">Disponible para aplicar</div>
          <div className="font-bold text-lg">{formatoMoneda(disponible)}</div>
        </div>
        <div className="px-4 py-3 border-b border-line max-h-[240px] overflow-y-auto">
          <div className="th-label mb-1.5">Elegí a qué facturas aplicarla</div>
          {facturasPendientes.length === 0 && (
            <div className="text-ink-soft text-sm">Este cliente no tiene facturas pendientes.</div>
          )}
          {facturasPendientes.map((f) => (
            <label key={f.id} className="flex items-center gap-2.5 py-1 text-sm cursor-pointer">
              <input type="checkbox" checked={seleccionadas.has(f.id)} onChange={() => toggle(f.id)} className="accent-[var(--color-accent)]" />
              <span className="flex-1">Factura #{f.numero} · {f.concepto}</span>
              <span>{formatoMoneda(saldoPendiente(f))}</span>
            </label>
          ))}
        </div>
        <div className="px-4 py-3 flex items-center gap-2">
          <button className="btn-accent" onClick={handleAplicar} disabled={seleccionadas.size === 0}>
            Aplicar {formatoMoneda(montoAAplicar)}
          </button>
          <button className="btn-outline" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
