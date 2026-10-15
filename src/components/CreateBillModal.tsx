import { useRef, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { ProveedorSelect } from './ProveedorSelect';
import { formatoMoneda } from '../lib/aging';
import type { CategoriaGasto } from '../types';

const CATEGORIAS: { valor: CategoriaGasto; etiqueta: string }[] = [
  { valor: 'mantenimiento', etiqueta: 'Mantenimiento' },
  { valor: 'seguro', etiqueta: 'Seguro' },
  { valor: 'combustible', etiqueta: 'Combustible' },
  { valor: 'neumaticos', etiqueta: 'Neumáticos' },
  { valor: 'oficina', etiqueta: 'Oficina' },
  { valor: 'software', etiqueta: 'Software' },
  { valor: 'nomina', etiqueta: 'Nómina' },
  { valor: 'publicidad', etiqueta: 'Publicidad' },
  { valor: 'servicios', etiqueta: 'Servicios' },
  { valor: 'otro', etiqueta: 'Otro' },
];

export function CreateBillModal({
  proveedorId: proveedorIdFijo,
  onClose,
}: {
  proveedorId?: string;
  onClose: () => void;
}) {
  const { proveedores, getProveedor, agregarBill } = useDataStore();
  const [proveedorId, setProveedorId] = useState(proveedorIdFijo ?? '');
  const [concepto, setConcepto] = useState('');
  const [categoria, setCategoria] = useState<CategoriaGasto>('mantenimiento');
  const [monto, setMonto] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const enviandoRef = useRef(false);

  const proveedor = proveedorId ? getProveedor(proveedorId) : undefined;
  const montoNumero = Number(monto);
  const montoValido = monto !== '' && !Number.isNaN(montoNumero) && montoNumero > 0;

  function handleGuardar() {
    if (enviandoRef.current) return;
    if (!proveedorId) return setError('Elegí un proveedor.');
    if (!montoValido) return setError('El valor tiene que ser un número mayor a 0.');
    if (!concepto.trim()) return setError('Escribí un motivo para la bill.');
    setError(null);
    enviandoRef.current = true;
    agregarBill({
      proveedorId,
      concepto: concepto.trim(),
      monto: montoNumero,
      fecha: new Date().toISOString().slice(0, 10),
      fechaVencimiento,
    });
    setGuardado(true);
    setTimeout(onClose, 900);
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-16 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(480px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Nueva bill</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>

        {guardado ? (
          <div className="p-6 text-center">
            <div className="text-lg font-semibold mb-1">Bill creada ✓</div>
            <div className="text-ink-soft text-sm">
              {formatoMoneda(montoNumero)} · {concepto} · {proveedor?.nombre}
            </div>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-line">
              <div className="th-label mb-1">Proveedor</div>
              {proveedorIdFijo ? (
                <div className="border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm bg-line-soft">{proveedor?.nombre}</div>
              ) : (
                <ProveedorSelect proveedores={proveedores} value={proveedorId} onChange={setProveedorId} />
              )}
            </div>
            <div className="px-4 py-3 border-b border-line">
              <div className="th-label mb-1">Motivo</div>
              <input
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                placeholder="Ej. Mantenimiento TL-118, Póliza de seguro…"
                className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <div className="px-4 py-3 border-b border-line">
              <div className="th-label mb-1.5">Categoría</div>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIAS.map((c) => (
                  <button
                    key={c.valor}
                    onClick={() => setCategoria(c.valor)}
                    aria-pressed={categoria === c.valor} className={categoria === c.valor ? 'chip-accent' : 'chip'}
                  >
                    {c.etiqueta}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-4 py-3 border-b border-line grid grid-cols-2 gap-3.5">
              <div>
                <div className="th-label mb-1">Valor</div>
                <input
                  type="number"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-line rounded-md px-2.5 py-1.5 text-[15px] font-semibold focus:outline-none focus:border-accent"
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
            {error && <div className="px-4 py-2 text-danger text-[12.5px] border-b border-line">{error}</div>}
            <div className="px-4 py-3 flex gap-2">
              <button className="btn-accent" onClick={handleGuardar} disabled={guardado}>Guardar bill</button>
              <button className="btn-outline" onClick={onClose}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
