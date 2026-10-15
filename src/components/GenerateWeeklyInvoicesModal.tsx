import { useMemo, useRef, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { formatoMoneda } from '../lib/aging';

export function GenerateWeeklyInvoicesModal({ onClose }: { onClose: () => void }) {
  const { clientes, facturas, generarFacturasSemanales } = useDataStore();
  const enviandoRef = useRef(false);
  const [resultado, setResultado] = useState<{
    semana: number;
    generadas: number;
    salteadasInactivos: number;
    yaExistian: number;
    feesAplicados: number;
  } | null>(null);

  // Vista previa: se calcula con los mismos datos que ya están cargados,
  // sin tocar nada — el servidor recalcula la semana objetivo de forma
  // autoritativa cuando se confirma, esto es solo una estimación.
  const preview = useMemo(() => {
    const semana = Math.max(1, ...facturas.map((f) => f.semana)) + 1;
    const activos = clientes.filter((c) => c.estado === 'activo');
    const inactivos = clientes.length - activos.length;
    let aGenerar = 0;
    let yaExistian = 0;
    let montoTotal = 0;
    for (const c of activos) {
      const yaTiene = facturas.some((f) => f.clienteId === c.id && f.semana === semana);
      if (yaTiene) {
        yaExistian += 1;
      } else {
        aGenerar += 1;
        montoTotal += c.cuotaSemanal;
      }
    }
    return { semana, activos: activos.length, inactivos, aGenerar, yaExistian, montoTotal };
  }, [clientes, facturas]);

  async function handleGenerar() {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    const r = await generarFacturasSemanales();
    setResultado(r);
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-16 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(480px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Generar facturas de la semana</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>

        {resultado ? (
          <div className="p-6 text-center">
            <div className="text-lg font-semibold mb-1">Listo ✓</div>
            <div className="text-ink-soft text-sm">
              Semana {resultado.semana}: se generaron <b>{resultado.generadas}</b> facturas nuevas.
              {resultado.feesAplicados > 0 && (
                <> Se facturaron <b>{resultado.feesAplicados}</b> fee(s) que estaban tildados en clientes.</>
              )}
              {resultado.salteadasInactivos > 0 && (
                <> Se salteó a <b>{resultado.salteadasInactivos}</b> cliente(s) dado(s) de baja.</>
              )}
              {resultado.yaExistian > 0 && (
                <> {resultado.yaExistian} ya tenían factura de esa semana.</>
              )}
            </div>
            <button className="btn-accent mt-4" onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <>
            <div className="p-4 text-sm">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="border border-line rounded-md p-3">
                  <div className="th-label">Se les va a generar</div>
                  <div className="font-bold text-xl">{preview.aGenerar}</div>
                  <div className="text-ink-soft text-[11.5px]">clientes activos · {formatoMoneda(preview.montoTotal)} en total</div>
                </div>
                <div className="border border-line rounded-md p-3">
                  <div className="th-label">Se van a saltear</div>
                  <div className="font-bold text-xl text-danger">{preview.inactivos}</div>
                  <div className="text-ink-soft text-[11.5px]">clientes dados de baja</div>
                </div>
              </div>
              {preview.yaExistian > 0 && (
                <div className="text-ink-soft text-[12px] mb-2">
                  {preview.yaExistian} cliente(s) activo(s) ya tienen factura de la semana {preview.semana} (no se les va a duplicar).
                </div>
              )}
              <div className="text-ink-soft text-[12px]">
                Se va a generar la <b>cuota semana {preview.semana}</b>, usando la cuota semanal configurada
                para cada cliente (Configuración o la que se haya editado puntualmente).
              </div>
            </div>
            <div className="px-4 py-3 border-t border-line flex gap-2">
              <button className="btn-accent" onClick={handleGenerar} disabled={preview.aGenerar === 0}>
                Generar {preview.aGenerar} factura{preview.aGenerar !== 1 ? 's' : ''}
              </button>
              <button className="btn-outline" onClick={onClose}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
