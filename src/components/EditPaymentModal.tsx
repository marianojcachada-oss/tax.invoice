import { useMemo, useRef, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { saldoPendiente, formatoMoneda, diasDeAtraso } from '../lib/aging';
import { CuentaSelect } from './CuentaSelect';
import { DocumentAuditHistory } from './DocumentAuditHistory';
import type { MetodoPago, Pago } from '../types';

const METODOS: { valor: MetodoPago; etiqueta: string; requiereReferencia: boolean }[] = [
  { valor: 'zelle', etiqueta: 'Zelle', requiereReferencia: true },
  { valor: 'efectivo', etiqueta: 'Efectivo', requiereReferencia: false },
  { valor: 'kotapay', etiqueta: 'Kotapay', requiereReferencia: true },
];

function parseMonto(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function EditPaymentModal({ pago, onClose }: { pago: Pago; onClose: () => void }) {
  const { getCliente, getFacturasDeCliente, editarPago, cuentas } = useDataStore();
  const cliente = getCliente(pago.clienteId);
  const todasLasFacturas = getFacturasDeCliente(pago.clienteId);

  // Ya que este pago ya se aplicó, para poder reasignarlo hay que ver el
  // saldo de cada factura COMO SI este pago todavía no se hubiera hecho
  // (se le "devuelve" lo que este pago le había aplicado).
  const aplicadoOriginal = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of pago.aplicaciones) m.set(a.facturaId, a.monto);
    return m;
  }, [pago]);

  const facturasRelevantes = todasLasFacturas
    .filter((f) => saldoPendiente(f) > 0 || aplicadoOriginal.has(f.id))
    .map((f) => ({ ...f, saldoDisponible: saldoPendiente(f) + (aplicadoOriginal.get(f.id) ?? 0) }));

  const [montoRecibido, setMontoRecibido] = useState(String(pago.monto));
  const [aplicaciones, setAplicaciones] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const a of pago.aplicaciones) inicial[a.facturaId] = String(a.monto);
    return inicial;
  });
  const [metodo, setMetodo] = useState<MetodoPago>(pago.metodo);
  const [referencia, setReferencia] = useState(pago.referencia ?? '');
  const [cuentaId, setCuentaId] = useState(pago.cuentaId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const enviandoRef = useRef(false);

  const montoRecibidoNum = parseMonto(montoRecibido);
  const totalAsignado = useMemo(
    () => Object.values(aplicaciones).reduce((a, v) => a + parseMonto(v), 0),
    [aplicaciones]
  );
  const sinAsignar = Math.round((montoRecibidoNum - totalAsignado) * 100) / 100;
  const metodoInfo = METODOS.find((m) => m.valor === metodo)!;

  if (!cliente) return null;

  function setMontoFactura(facturaId: string, valor: string) {
    setAplicaciones((prev) => ({ ...prev, [facturaId]: valor }));
  }

  function handleGuardar() {
    if (enviandoRef.current) return;

    if (!montoRecibidoNum || montoRecibidoNum <= 0) {
      return setError('El monto tiene que ser mayor a 0.');
    }
    const aplicacionesFinales = Object.entries(aplicaciones)
      .map(([facturaId, valor]) => ({ facturaId, monto: parseMonto(valor) }))
      .filter((a) => a.monto > 0);

    if (aplicacionesFinales.length === 0) {
      return setError('Elegí a qué factura (o facturas) se aplica el pago.');
    }
    if (Math.abs(sinAsignar) > 0.01) {
      return setError(
        sinAsignar > 0
          ? `Todavía te falta asignar ${formatoMoneda(sinAsignar)}.`
          : `Asignaste ${formatoMoneda(Math.abs(sinAsignar))} de más.`
      );
    }
    for (const a of aplicacionesFinales) {
      const f = facturasRelevantes.find((x) => x.id === a.facturaId);
      if (f && a.monto > f.saldoDisponible + 0.01) {
        return setError(`No podés aplicar más de ${formatoMoneda(f.saldoDisponible)} a la factura #${f.numero}.`);
      }
    }
    setError(null);
    enviandoRef.current = true;
    setGuardando(true);

    editarPago(pago.id, {
      metodo,
      referencia: referencia || undefined,
      cuentaId: cuentaId || undefined,
      aplicaciones: aplicacionesFinales,
    });
    setGuardado(true);
    setTimeout(onClose, 900);
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-10 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(580px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Editar pago #{pago.numero}</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>

        {guardado ? (
          <div className="p-6 text-center">
            <div className="text-lg font-semibold mb-1">Pago corregido ✓</div>
            <div className="text-ink-soft text-sm">Los cambios ya se reflejan en las facturas del cliente.</div>
          </div>
        ) : (
          <>
            <div className="px-4 py-2 text-ink-soft text-[11.5px] border-b border-line bg-line-soft">
              Corrigiendo un pago ya guardado — los cambios se auditan con el detalle de qué cambió.
            </div>

            <div className="px-4 py-3 border-b border-line grid grid-cols-2 gap-3.5">
              <div>
                <div className="th-label mb-1">Monto que pagó el cliente</div>
                <input
                  type="number"
                  value={montoRecibido}
                  onChange={(e) => setMontoRecibido(e.target.value)}
                  className="w-full border border-line rounded-md px-2.5 py-1.5 text-[17px] font-semibold num focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <div className="th-label mb-1">Cliente</div>
                <div className="border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm">
                  {cliente.codigo} · {cliente.nombre}
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-line grid grid-cols-2 gap-3.5">
              <div>
                <div className="th-label mb-1.5">Método</div>
                <div className="flex gap-1.5 mb-2">
                  {METODOS.map((m) => (
                    <button
                      key={m.valor}
                      type="button"
                      onClick={() => setMetodo(m.valor)}
                      aria-pressed={metodo === m.valor} className={metodo === m.valor ? 'chip-accent' : 'chip'}
                    >
                      {m.etiqueta}
                    </button>
                  ))}
                </div>
                {metodoInfo.requiereReferencia && (
                  <input
                    value={referencia}
                    onChange={(e) => setReferencia(e.target.value)}
                    placeholder="N° de referencia / confirmación"
                    className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
                  />
                )}
              </div>
              <div>
                <div className="th-label mb-1.5">Cuenta destino</div>
                <CuentaSelect cuentas={cuentas} value={cuentaId} onChange={setCuentaId} />
              </div>
            </div>

            <div className="px-4 py-3 border-b border-line max-h-[260px] overflow-y-auto">
              <div className="th-label mb-1.5">Aplicado a</div>
              {facturasRelevantes.map((f) => {
                const dias = diasDeAtraso(f.fechaVencimiento);
                return (
                  <div key={f.id} className="flex items-center gap-2.5 py-1.5 text-sm border-b border-line-soft last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">Factura #{f.numero} · {f.concepto}</div>
                      <div className="text-ink-soft text-[11.5px]">
                        Disponible {formatoMoneda(f.saldoDisponible)}
                        {dias > 0 && ` · venc. ${dias} d`}
                      </div>
                    </div>
                    <input
                      type="number"
                      value={aplicaciones[f.id] ?? ''}
                      onChange={(e) => setMontoFactura(f.id, e.target.value)}
                      placeholder="0.00"
                      className="w-24 border border-line rounded-md px-2 py-1 text-sm num text-right focus:outline-none focus:border-accent"
                    />
                  </div>
                );
              })}
              <div className="flex justify-between text-[12.5px] mt-2 pt-2 border-t border-line">
                <span className="text-ink-soft">Asignado {formatoMoneda(totalAsignado)} de {formatoMoneda(montoRecibidoNum)}</span>
                {Math.abs(sinAsignar) > 0.01 && (
                  <span className="text-danger">
                    {sinAsignar > 0 ? `Falta asignar ${formatoMoneda(sinAsignar)}` : `Te pasaste por ${formatoMoneda(Math.abs(sinAsignar))}`}
                  </span>
                )}
              </div>
            </div>

            <div className="px-4 py-3 border-b border-line">
              <DocumentAuditHistory entidad="Pago" entidadId={pago.id} />
            </div>

            {error && <div className="px-4 py-2 text-danger text-[12.5px] border-b border-line">{error}</div>}

            <div className="px-4 py-3 flex gap-2">
              <button className="btn-accent" onClick={handleGuardar} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar corrección'}
              </button>
              <button className="btn-outline" onClick={onClose}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
