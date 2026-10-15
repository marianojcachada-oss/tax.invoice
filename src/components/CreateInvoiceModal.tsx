import { useRef, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { ClienteSelect } from './ClienteSelect';
import { formatoMoneda } from '../lib/aging';

interface Props {
  clienteId?: string; // si viene preseteado (ej. desde la ficha del cliente), no se puede cambiar
  onClose: () => void;
}

const OTRO = '__otro__';

export function CreateInvoiceModal({ clienteId: clienteIdFijo, onClose }: Props) {
  const { clientes, getCliente, agregarFactura, catalogoFees } = useDataStore();
  const [clienteId, setClienteId] = useState(clienteIdFijo ?? '');
  const [itemId, setItemId] = useState(catalogoFees.length > 0 ? '' : OTRO);
  const [concepto, setConcepto] = useState('');
  const [codigo, setCodigo] = useState<string | undefined>(undefined);
  const [monto, setMonto] = useState('');
  const [beneficiarioId, setBeneficiarioId] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const enviandoRef = useRef(false);

  const cliente = clienteId ? getCliente(clienteId) : undefined;
  const montoNumero = Number(monto);
  const montoValido = monto !== '' && !Number.isNaN(montoNumero) && montoNumero > 0;
  const esOtro = itemId === OTRO;
  const esRecupero = codigo === '1060DR';

  function handleElegirItem(id: string) {
    setItemId(id);
    if (id === OTRO) {
      setConcepto('');
      setMonto('');
      setCodigo(undefined);
      return;
    }
    const item = catalogoFees.find((f) => f.id === id);
    if (item) {
      setConcepto(item.etiqueta);
      setMonto(String(item.monto));
      setCodigo(item.codigo);
    }
  }

  function handleGuardar() {
    if (enviandoRef.current) return;
    if (!clienteId) {
      setError('Elegí un cliente.');
      return;
    }
    if (!itemId) {
      setError('Elegí un motivo de la lista, o "Otro" para cargarlo a mano.');
      return;
    }
    if (!montoValido) {
      setError('El valor tiene que ser un número mayor a 0.');
      return;
    }
    if (!concepto.trim()) {
      setError('Escribí un motivo para la factura.');
      return;
    }
    if (esRecupero && (!beneficiarioId || beneficiarioId === clienteId)) {
      setError('Elegí la unidad que va a recibir el saldo a favor (distinta a la que recuperó el dinero).');
      return;
    }
    setError(null);
    enviandoRef.current = true;
    agregarFactura({
      beneficiarioId: esRecupero ? beneficiarioId : undefined,
      clienteId,
      concepto: concepto.trim(),
      monto: montoNumero,
      fechaVencimiento,
      codigo,
    });
    setGuardado(true);
    setTimeout(onClose, 900);
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-start justify-center pt-16 z-50 overflow-y-auto pb-10"
      onClick={onClose}
    >
      <div
        className="panel w-[min(480px,94vw)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Crear factura</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">
            ✕
          </button>
        </div>

        {guardado ? (
          <div className="p-6 text-center">
            <div className="text-lg font-semibold mb-1">Factura creada ✓</div>
            <div className="text-ink-soft text-sm">
              {formatoMoneda(montoNumero)} · {concepto} · {cliente?.nombre}
            </div>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-line">
              <div className="th-label mb-1">Cliente</div>
              {clienteIdFijo ? (
                <div className="border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm bg-line-soft">
                  {cliente?.codigo} · {cliente?.nombre}
                </div>
              ) : (
                <ClienteSelect clientes={clientes} value={clienteId} onChange={setClienteId} />
              )}
            </div>

            {catalogoFees.length > 0 && (
              <div className="px-4 py-3 border-b border-line">
                <div className="th-label mb-1">Ítem del catálogo</div>
                <select
                  value={itemId}
                  onChange={(e) => handleElegirItem(e.target.value)}
                  className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
                >
                  <option value="" disabled>
                    Elegí un motivo…
                  </option>
                  {catalogoFees.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.codigo} — {f.etiqueta} ({formatoMoneda(f.monto)})
                    </option>
                  ))}
                  <option value={OTRO}>Otro (cargar a mano)</option>
                </select>
              </div>
            )}

            {esRecupero && (
              <div className="px-4 py-3 border-b border-line bg-success-bg">
                <div className="th-label mb-1">Unidad a la que se le recuperó la deuda (recibe el 1060SAF)</div>
                <ClienteSelect clientes={clientes.filter((c) => c.id !== clienteId)} value={beneficiarioId} onChange={setBeneficiarioId} />
                <div className="text-ink-soft text-[12px] mt-1.5">
                  Cuando esta factura quede paga, se crea automáticamente una nota de crédito por el mismo monto en la ficha de esa unidad, ligada a esta factura.
                </div>
              </div>
            )}

            {(esOtro || catalogoFees.length === 0) && (
              <div className="px-4 py-3 border-b border-line">
                <div className="th-label mb-1">Motivo</div>
                <input
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                  placeholder="Ej. Multa por lavado, Ajuste manual…"
                  className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
                />
              </div>
            )}
            {!esOtro && itemId !== '' && catalogoFees.length > 0 && (
              <div className="px-4 py-3 border-b border-line">
                <div className="th-label mb-1">Motivo (editable)</div>
                <input
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                  className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
                />
              </div>
            )}

            <div className="px-4 py-3 border-b border-line grid grid-cols-2 gap-3.5">
              <div>
                <div className="th-label mb-1">Valor</div>
                <input
                  type="number"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-[15px] font-semibold focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <div className="th-label mb-1">Vencimiento</div>
                <input
                  type="date"
                  value={fechaVencimiento}
                  onChange={(e) => setFechaVencimiento(e.target.value)}
                  className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            {error && (
              <div className="px-4 py-2 text-danger-dark text-[12.5px] border-b border-line">{error}</div>
            )}

            <div className="px-4 py-3 flex gap-2 items-center">
              <button className="btn-accent" onClick={handleGuardar} disabled={guardado}>
                Guardar factura
              </button>
              <button className="btn-outline" onClick={onClose}>
                Cancelar
              </button>
              <span className="text-ink-soft text-[11.5px] ml-auto">
                Todos los campos se pueden corregir antes de guardar
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
