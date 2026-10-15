import { useRef, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { ClienteSelect } from './ClienteSelect';

interface Props {
  clienteId?: string; // si viene preseteado (ej. desde la ficha del cliente), no se puede cambiar
  onClose: () => void;
}

export function CreateCreditMemoModal({ clienteId: clienteIdFijo, onClose }: Props) {
  const { clientes, getCliente, agregarNotaCredito } = useDataStore();
  const [clienteId, setClienteId] = useState(clienteIdFijo ?? '');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const enviandoRef = useRef(false);

  const cliente = clienteId ? getCliente(clienteId) : undefined;

  function handleCrear() {
    if (enviandoRef.current) return;
    const montoNumero = Number(monto);
    if (!clienteId) return setError('Elegí un cliente.');
    if (!monto || Number.isNaN(montoNumero) || montoNumero <= 0) return setError('El monto tiene que ser mayor a 0.');
    setError(null);
    enviandoRef.current = true;
    agregarNotaCredito({
      clienteId,
      fecha: new Date().toISOString().slice(0, 10),
      monto: montoNumero,
      motivo: motivo.trim() || 'Sin especificar',
      aplicada: false,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(440px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Nueva nota de crédito</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <div className="th-label mb-1">Cliente</div>
            {clienteIdFijo ? (
              <div className="border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm bg-line-soft">
                {cliente?.codigo} · {cliente?.nombre}
              </div>
            ) : (
              <ClienteSelect clientes={clientes} value={clienteId} onChange={setClienteId} />
            )}
          </div>
          <div>
            <div className="th-label mb-1">Monto (saldo a favor)</div>
            <input
              type="number"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
              placeholder="0.00"
            />
          </div>
          <div>
            <div className="th-label mb-1">Motivo</div>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
              placeholder="Ej. corrección de cobro duplicado, cortesía…"
            />
          </div>
          {error && <div className="text-danger text-[12.5px]">{error}</div>}
          <div className="flex gap-2">
            <button className="btn-accent" onClick={handleCrear}>
              Guardar
            </button>
            <button className="btn-outline" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
