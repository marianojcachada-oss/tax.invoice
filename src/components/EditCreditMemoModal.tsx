import { useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { ClienteSelect } from './ClienteSelect';
import type { NotaCredito } from '../types';

export function EditCreditMemoModal({ nota, onClose }: { nota: NotaCredito; onClose: () => void }) {
  const { editarNotaCredito, clientes } = useDataStore();
  const [fecha, setFecha] = useState(nota.fecha);
  const [clienteId, setClienteId] = useState(nota.clienteId);
  const [motivo, setMotivo] = useState(nota.motivo);
  const [monto, setMonto] = useState(String(nota.monto));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleGuardar() {
    const montoNumero = Number(monto);
    if (!motivo.trim()) return setError('El motivo no puede quedar vacío.');
    if (!monto || Number.isNaN(montoNumero) || montoNumero <= 0) return setError('El monto tiene que ser mayor a 0.');
    setError(null);
    setGuardando(true);
    try {
      await editarNotaCredito(nota.id, { motivo: motivo.trim(), monto: montoNumero, fecha, clienteId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(420px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Editar nota de crédito #{nota.numero}</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <div className="th-label mb-1">Motivo</div>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <div className="th-label mb-1">Unidad / cliente</div>
            <ClienteSelect clientes={clientes} value={clienteId} onChange={setClienteId} />
            {clienteId !== nota.clienteId && (
              <div className="text-ink-faint text-[11px] mt-1">Se pasa la nota a otra unidad y el motivo deja constancia (editalo arriba si querés otro concepto).</div>
            )}
          </div>
          <div>
            <div className="th-label mb-1">Fecha</div>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
          </div>
          <div>
            <div className="th-label mb-1">Monto</div>
            <input
              type="number"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm num focus:outline-none focus:border-accent"
            />
            {nota.montoAplicado > 0 && (
              <div className="text-ink-faint text-[11px] mt-1">
                Ya se aplicaron ${nota.montoAplicado} de esta nota — no se puede bajar de ahí.
              </div>
            )}
          </div>
          {error && <div className="text-danger-dark text-[12.5px]">{error}</div>}
          <button className="btn-accent w-fit" onClick={handleGuardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}
