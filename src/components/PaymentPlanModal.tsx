import { useRef, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { formatoMoneda } from '../lib/aging';

export function PaymentPlanModal({
  clienteId,
  deudaActual,
  onClose,
}: {
  clienteId: string;
  deudaActual: number;
  onClose: () => void;
}) {
  const { getCliente, agregarFactura } = useDataStore();
  const cliente = getCliente(clienteId);
  const enviandoRef = useRef(false);

  const [monto, setMonto] = useState(String(Math.round(deudaActual)));
  const [cuotas, setCuotas] = useState(4);
  const [frecuenciaDias, setFrecuenciaDias] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState<{ cuotas: number; montoCuota: number } | null>(null);

  const montoNumero = Number(monto);
  const montoCuota = cuotas > 0 ? Math.floor((montoNumero / cuotas) * 100) / 100 : 0;

  function handleCrear() {
    if (enviandoRef.current) return;
    if (!montoNumero || montoNumero <= 0) return setError('El monto tiene que ser mayor a 0.');
    if (!cuotas || cuotas < 1) return setError('Tiene que haber al menos 1 cuota.');
    setError(null);
    enviandoRef.current = true;

    const hoy = new Date();
    let restante = Math.round(montoNumero * 100) / 100;
    for (let i = 1; i <= cuotas; i++) {
      const esUltima = i === cuotas;
      const montoEstaCuota = esUltima ? restante : montoCuota;
      restante = Math.round((restante - montoEstaCuota) * 100) / 100;
      const vencimiento = new Date(hoy);
      vencimiento.setDate(vencimiento.getDate() + frecuenciaDias * i);
      agregarFactura({
        clienteId,
        concepto: `Plan de pago — cuota ${i}/${cuotas}`,
        monto: montoEstaCuota,
        fechaVencimiento: vencimiento.toISOString().slice(0, 10),
      });
    }

    setCreado({ cuotas, montoCuota });
  }

  if (!cliente) return null;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-16 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(460px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Plan de pago — {cliente.nombre}</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>

        {creado ? (
          <div className="p-6 text-center">
            <div className="text-lg font-semibold mb-1">Plan creado ✓</div>
            <div className="text-ink-soft text-sm">
              Se generaron {creado.cuotas} facturas nuevas de aproximadamente {formatoMoneda(creado.montoCuota)} cada una,
              espaciadas cada {frecuenciaDias} días.
            </div>
            <button className="btn-accent mt-4" onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-line text-[12px] text-ink-soft bg-line-soft">
              Esto genera facturas nuevas espaciadas en el tiempo para ordenar un pago en cuotas.
              No modifica ni cancela las facturas ya existentes — es un acuerdo aparte que queda
              registrado como facturas propias, fáciles de identificar por su concepto.
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div>
                <div className="th-label mb-1">Monto total a financiar</div>
                <input
                  type="number"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm num focus:outline-none focus:border-accent"
                />
                <div className="text-ink-soft text-[11px] mt-1">
                  Por defecto es la deuda actual ({formatoMoneda(deudaActual)}), pero se puede ajustar.
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="th-label mb-1">Cantidad de cuotas</div>
                  <input
                    type="number"
                    min={1}
                    value={cuotas}
                    onChange={(e) => setCuotas(Number(e.target.value))}
                    className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <div className="th-label mb-1">Cada cuántos días</div>
                  <input
                    type="number"
                    min={1}
                    value={frecuenciaDias}
                    onChange={(e) => setFrecuenciaDias(Number(e.target.value))}
                    className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
              <div className="text-sm border border-line rounded-md p-2.5 bg-line-soft">
                {cuotas} cuota{cuotas !== 1 ? 's' : ''} de aproximadamente <b>{formatoMoneda(montoCuota)}</b> cada una,
                cada {frecuenciaDias} día{frecuenciaDias !== 1 ? 's' : ''}.
              </div>
              {error && <div className="text-danger text-[12.5px]">{error}</div>}
              <div className="flex gap-2">
                <button className="btn-accent" onClick={handleCrear}>Generar plan</button>
                <button className="btn-outline" onClick={onClose}>Cancelar</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
