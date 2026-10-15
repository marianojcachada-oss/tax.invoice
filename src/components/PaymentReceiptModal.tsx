import { useDataStore } from '../data/DataContext';
import { construirReciboDesdePago } from '../lib/aging';
import { PaymentReceipt } from './PaymentReceipt';
import { DocumentAuditHistory } from './DocumentAuditHistory';
import type { Pago } from '../types';

export function PaymentReceiptModal({ pago, onClose }: { pago: Pago; onClose: () => void }) {
  const { facturas, getCliente, cuentas } = useDataStore();
  const cliente = getCliente(pago.clienteId);
  const items = construirReciboDesdePago(pago, facturas);
  const cuentaNombre = cuentas.find((c) => c.id === pago.cuentaId)?.nombre;

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-start justify-center pt-16 z-50 overflow-y-auto pb-10"
      onClick={onClose}
    >
      <div
        className="panel w-[min(560px,94vw)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Recibo de pago</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">
            ✕
          </button>
        </div>
        <div className="p-4">
          <PaymentReceipt
            pagoNumero={pago.numero}
            fecha={pago.fecha}
            clienteNombre={cliente ? `${cliente.codigo} · ${cliente.nombre}` : '—'}
            metodo={pago.metodo}
            referencia={pago.referencia}
            cuentaNombre={cuentaNombre}
            montoTotal={pago.monto}
            items={items}
          />
        </div>
        <div className="px-4 border-t border-line">
          <DocumentAuditHistory entidad="Pago" entidadId={pago.id} />
        </div>
        <div className="px-4 py-3 border-t border-line flex gap-2">
          <button className="btn-accent" onClick={onClose}>
            Cerrar
          </button>
          <button className="btn-outline" onClick={() => window.print()}>
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}
