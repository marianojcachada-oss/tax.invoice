import { useMemo, useRef, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { saldoPendiente, formatoMoneda, diasDeAtraso } from '../lib/aging';
import { CuentaSelect } from './CuentaSelect';
import type { MetodoPago } from '../types';

const METODOS: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'ach', etiqueta: 'ACH' },
  { valor: 'tarjeta', etiqueta: 'Tarjeta' },
  { valor: 'zelle', etiqueta: 'Zelle' },
  { valor: 'efectivo', etiqueta: 'Efectivo' },
];

export function PayBillModal({ proveedorId, onClose }: { proveedorId: string; onClose: () => void }) {
  const { getProveedor, getBillsDeProveedor, registrarPagoBill, cuentas } = useDataStore();
  const proveedor = getProveedor(proveedorId);
  const billsPendientes = getBillsDeProveedor(proveedorId).filter((b) => saldoPendiente(b) > 0);

  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(
    () => new Set(billsPendientes.map((b) => b.id))
  );
  const [metodo, setMetodo] = useState<MetodoPago>('ach');
  const [cuentaId, setCuentaId] = useState(cuentas.find((c) => c.tipo === 'banco')?.id ?? '');
  const [guardado, setGuardado] = useState(false);
  const enviandoRef = useRef(false);

  const montoTotal = useMemo(
    () => billsPendientes.filter((b) => seleccionadas.has(b.id)).reduce((a, b) => a + saldoPendiente(b), 0),
    [billsPendientes, seleccionadas]
  );

  if (!proveedor) return null;

  function toggle(id: string) {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleGuardar() {
    if (enviandoRef.current) return;
    if (montoTotal <= 0) return;
    enviandoRef.current = true;
    registrarPagoBill({
      proveedorId,
      monto: montoTotal,
      metodo,
      cuentaId: cuentaId || undefined,
      billIds: Array.from(seleccionadas),
    });
    setGuardado(true);
    setTimeout(onClose, 900);
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-16 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(520px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Pagar a {proveedor.nombre}</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>

        {guardado ? (
          <div className="p-6 text-center">
            <div className="text-lg font-semibold mb-1">Pago registrado ✓</div>
            <div className="text-ink-soft text-sm">{formatoMoneda(montoTotal)} pagados a {proveedor.nombre}</div>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-line grid grid-cols-2 gap-3.5">
              <div>
                <div className="th-label mb-1">Método</div>
                <div className="flex gap-1.5 flex-wrap">
                  {METODOS.map((m) => (
                    <button key={m.valor} onClick={() => setMetodo(m.valor)} aria-pressed={metodo === m.valor} className={metodo === m.valor ? 'chip-accent' : 'chip'}>
                      {m.etiqueta}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="th-label mb-1">Cuenta de origen</div>
                <CuentaSelect cuentas={cuentas} value={cuentaId} onChange={setCuentaId} incluirVacio={false} />
              </div>
            </div>

            <div className="px-4 py-3 border-b border-line max-h-[220px] overflow-y-auto">
              <div className="th-label mb-1.5">Bills a pagar</div>
              {billsPendientes.length === 0 && (
                <div className="text-ink-soft text-sm">Este proveedor no tiene bills pendientes.</div>
              )}
              {billsPendientes.map((b) => {
                const dias = diasDeAtraso(b.fechaVencimiento);
                return (
                  <label key={b.id} className="flex items-center gap-2.5 py-1 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={seleccionadas.has(b.id)}
                      onChange={() => toggle(b.id)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="flex-1">
                      Bill #{b.numero} · {b.concepto} {dias > 0 && <span className="text-ink-soft">venc. {dias} d</span>}
                    </span>
                    <span>{formatoMoneda(saldoPendiente(b))}</span>
                  </label>
                );
              })}
            </div>

            <div className="px-4 py-3 flex items-center gap-2">
              <button className="btn-accent" onClick={handleGuardar} disabled={montoTotal <= 0 || enviandoRef.current}>
                Pagar {formatoMoneda(montoTotal)}
              </button>
              <button className="btn-outline" onClick={onClose}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
