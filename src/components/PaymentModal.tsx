import { useMemo, useRef, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { saldoPendiente, formatoMoneda, diasDeAtraso } from '../lib/aging';
import { PaymentReceipt, type ReciboItem } from './PaymentReceipt';
import { CuentaSelect } from './CuentaSelect';
import { ClienteSelect } from './ClienteSelect';
import type { MetodoPago } from '../types';

interface Props {
  clienteId?: string;
  onClose: () => void;
}

const METODOS: { valor: MetodoPago; etiqueta: string; requiereReferencia: boolean }[] = [
  { valor: 'zelle', etiqueta: 'Zelle', requiereReferencia: true },
  { valor: 'efectivo', etiqueta: 'Efectivo', requiereReferencia: false },
  { valor: 'kotapay', etiqueta: 'Kotapay', requiereReferencia: true },
];

function parseMonto(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function PaymentModal({ clienteId: clienteIdFijo, onClose }: Props) {
  const { clientes, getCliente, getFacturasDeCliente, registrarPago, agregarNotaCredito, cuentas } = useDataStore();
  // Si no vino un cliente ya elegido (ej. se abrió desde un botón general
  // "Registrar pago" en vez de desde la ficha de un cliente puntual), se
  // pide elegirlo acá mismo con el combobox buscable.
  const [clienteIdElegido, setClienteIdElegido] = useState('');
  const clienteId = clienteIdFijo ?? clienteIdElegido;
  const cliente = clienteId ? getCliente(clienteId) : undefined;
  const facturasPendientes = clienteId ? getFacturasDeCliente(clienteId).filter((f) => saldoPendiente(f) > 0) : [];

  // Monto que el cliente efectivamente pagó — lo escribe el administrador,
  // no se calcula solo. Después se elige a qué factura(s) se aplica, pudiendo
  // cancelar solo una parte de una factura puntual.
  const [montoRecibido, setMontoRecibido] = useState('');
  const [aplicaciones, setAplicaciones] = useState<Record<string, string>>({});
  const [metodo, setMetodo] = useState<MetodoPago>('zelle');
  const [referencia, setReferencia] = useState('');
  const [cuentaId, setCuentaId] = useState(() => cuentas.find((c) => c.cuentaContable === '10201')?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const enviandoRef = useRef(false);
  const [recibo, setRecibo] = useState<{
    pagoNumero: number;
    fecha: string;
    items: ReciboItem[];
    excedente: number;
  } | null>(null);

  const montoRecibidoNum = parseMonto(montoRecibido);
  const totalAsignado = useMemo(
    () => Object.values(aplicaciones).reduce((a, v) => a + parseMonto(v), 0),
    [aplicaciones]
  );
  const sinAsignar = Math.round((montoRecibidoNum - totalAsignado) * 100) / 100;

  const metodoInfo = METODOS.find((m) => m.valor === metodo)!;

  function elegirMetodo(m: MetodoPago) {
    setMetodo(m);
    // Zelle entra directo a BofA 9859 (10201); Kotapay y efectivo quedan en Undeposited Funds (14500)
    // hasta que la administración los deposita en un banco.
    const contable = m === 'zelle' ? '10201' : '14500';
    const sugerida =
      cuentas.find((c) => c.cuentaContable === contable) ??
      (m === 'zelle' ? cuentas.find((c) => c.tipo === 'zelle') : m === 'efectivo' ? cuentas.find((c) => c.tipo === 'efectivo') : cuentas.find((c) => c.tipo === 'banco'));
    if (sugerida) setCuentaId(sugerida.id);
  }

  function setMontoFactura(facturaId: string, valor: string) {
    setAplicaciones((prev) => ({ ...prev, [facturaId]: valor }));
  }

  // Completa automáticamente esta factura: usa lo que quede sin asignar del
  // monto recibido, sin pasarse del saldo de la factura.
  function aplicarTodoAFactura(f: (typeof facturasPendientes)[number]) {
    const yaAsignadoAOtras = totalAsignado - parseMonto(aplicaciones[f.id] ?? '0');
    const disponible = Math.max(0, montoRecibidoNum - yaAsignadoAOtras);
    const monto = Math.min(saldoPendiente(f), disponible);
    setMontoFactura(f.id, monto > 0 ? String(monto) : '');
  }

  // Reparte el monto recibido automáticamente entre las facturas más
  // antiguas primero, como punto de partida editable (no es obligatorio
  // usarlo — se puede ajustar factura por factura después).
  function autocompletar() {
    let restante = montoRecibidoNum;
    const nuevas: Record<string, string> = {};
    for (const f of facturasPendientes) {
      if (restante <= 0) break;
      const aplicar = Math.min(saldoPendiente(f), restante);
      if (aplicar > 0) {
        nuevas[f.id] = String(aplicar);
        restante -= aplicar;
      }
    }
    setAplicaciones(nuevas);
  }

  async function handleGuardar() {
    // Traba síncrona contra doble clic: se chequea y se marca ANTES de
    // cualquier otra cosa, así ni un segundo clic disparado a los pocos
    // milisegundos del primero puede colarse (no depende de que React ya
    // haya re-renderizado el botón como deshabilitado).
    if (enviandoRef.current) return;

    if (!montoRecibidoNum || montoRecibidoNum <= 0) {
      return setError('Ingresá el monto que pagó el cliente.');
    }
    const aplicacionesFinales = Object.entries(aplicaciones)
      .map(([facturaId, valor]) => ({ facturaId, monto: parseMonto(valor) }))
      .filter((a) => a.monto > 0);

    if (aplicacionesFinales.length === 0) {
      return setError('Elegí a qué factura (o facturas) se aplica el pago.');
    }
    // Si sobra plata (el cliente pagó de más que lo que debía la factura),
    // no es un error: ese excedente se guarda como saldo a favor del
    // cliente. Solo es un error si se asignó MÁS de lo que efectivamente
    // pagó (eso sí sería un dato mal cargado).
    if (sinAsignar < -0.01) {
      return setError(`Asignaste ${formatoMoneda(Math.abs(sinAsignar))} de más: no podés aplicar más de lo que el cliente pagó.`);
    }
    for (const a of aplicacionesFinales) {
      const f = facturasPendientes.find((x) => x.id === a.facturaId);
      if (f && a.monto > saldoPendiente(f) + 0.01) {
        return setError(`No podés aplicar más de ${formatoMoneda(saldoPendiente(f))} a la factura #${f.numero}.`);
      }
    }
    setError(null);
    enviandoRef.current = true;
    setGuardando(true);

    const items: ReciboItem[] = aplicacionesFinales.map((a) => {
      const f = facturasPendientes.find((x) => x.id === a.facturaId)!;
      const saldoLuego = Math.max(0, Math.round((saldoPendiente(f) - a.monto) * 100) / 100);
      return {
        numero: f.numero,
        fecha: f.fechaVencimiento,
        concepto: f.concepto,
        pago: a.monto,
        saldo: saldoLuego,
        estado: saldoLuego <= 0 ? 'Pagado' : 'Parcial',
      };
    });

    const pago = await registrarPago({
      clienteId,
      metodo,
      referencia: referencia || undefined,
      cuentaId: cuentaId || undefined,
      aplicaciones: aplicacionesFinales,
    });

    const excedente = Math.round(sinAsignar * 100) / 100;
    if (excedente > 0.01) {
      await agregarNotaCredito({
        clienteId,
        fecha: new Date().toISOString().slice(0, 10),
        monto: excedente,
        motivo: `Excedente del pago #${pago.numero}`,
        aplicada: false,
      });
    }

    setRecibo({ pagoNumero: pago.numero, fecha: pago.fecha, items, excedente: excedente > 0.01 ? excedente : 0 });
    // No hace falta reabrir el botón (enviandoRef/guardando) porque una vez
    // guardado el modal pasa a mostrar el recibo, donde ese botón ya no
    // existe. Si en algún momento se necesitara volver al formulario, se
    // debería resetear acá.
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-10 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(580px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">{recibo ? 'Recibo de pago' : 'Registrar pago'}</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>

        {!clienteIdFijo && !recibo && (
          <div className="px-4 py-3 border-b border-line">
            <div className="th-label mb-1">Cliente</div>
            <ClienteSelect clientes={clientes} value={clienteIdElegido} onChange={setClienteIdElegido} />
          </div>
        )}

        {!cliente ? (
          <div className="px-4 py-8 text-center text-ink-soft text-sm">Elegí un cliente para continuar.</div>
        ) : recibo ? (
          <>
            <div className="p-4">
              <PaymentReceipt
                pagoNumero={recibo.pagoNumero}
                fecha={recibo.fecha}
                clienteNombre={`${cliente.codigo} · ${cliente.nombre}`}
                metodo={metodo}
                referencia={referencia || undefined}
                cuentaNombre={cuentas.find((c) => c.id === cuentaId)?.nombre}
                montoTotal={montoRecibidoNum}
                items={recibo.items}
                excedenteAFavor={recibo.excedente}
              />
            </div>
            <div className="px-4 py-3 border-t border-line flex gap-2">
              <button className="btn-accent" onClick={onClose}>Cerrar</button>
              <button className="btn-outline" onClick={() => window.print()}>Imprimir</button>
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-line">
              <div className="th-label mb-1">Cliente</div>
              <div className="border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm">
                {cliente.codigo} — {cliente.nombre} — {cliente.telefonos}
              </div>
            </div>

            <div className="px-4 py-3 border-b border-line grid grid-cols-2 gap-3.5">
              <div>
                <div className="th-label mb-1">Monto que pagó el cliente</div>
                <input
                  type="number"
                  value={montoRecibido}
                  onChange={(e) => setMontoRecibido(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-line rounded-md px-2.5 py-1.5 text-[17px] font-semibold num focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <div className="th-label mb-1">Fecha</div>
                <div className="border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm">
                  {new Date().toLocaleDateString('es-US')}
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
                      onClick={() => elegirMetodo(m.valor)}
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
                    className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm text-ink-soft placeholder:text-ink-soft focus:outline-none focus:border-accent"
                  />
                )}
              </div>
              <div>
                <div className="th-label mb-1.5">Cuenta destino</div>
                <CuentaSelect cuentas={cuentas} value={cuentaId} onChange={setCuentaId} />
              </div>
            </div>

            <div className="px-4 py-3 border-b border-line max-h-[260px] overflow-y-auto">
              <div className="flex items-center justify-between mb-1.5">
                <span className="th-label">Aplicar a (podés cancelar solo una parte de una factura)</span>
                <button
                  type="button"
                  className="text-[12px] text-accent hover:underline"
                  onClick={autocompletar}
                  disabled={!montoRecibidoNum}
                >
                  Autocompletar
                </button>
              </div>
              {facturasPendientes.length === 0 && (
                <div className="text-ink-soft text-sm">Este cliente no tiene facturas pendientes.</div>
              )}
              {facturasPendientes.map((f) => {
                const dias = diasDeAtraso(f.fechaVencimiento);
                return (
                  <div key={f.id} className="flex items-center gap-2.5 py-1.5 text-sm border-b border-line-soft last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">Factura #{f.numero} · {f.concepto}</div>
                      <div className="text-ink-soft text-[11.5px]">
                        Debe {formatoMoneda(saldoPendiente(f))}
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
                    <button
                      type="button"
                      className="text-[12px] text-ink-soft hover:text-accent hover:underline whitespace-nowrap"
                      onClick={() => aplicarTodoAFactura(f)}
                    >
                      Todo
                    </button>
                  </div>
                );
              })}
              <div className="flex justify-between text-[12.5px] mt-2 pt-2 border-t border-line">
                <span className="text-ink-soft">Asignado {formatoMoneda(totalAsignado)} de {formatoMoneda(montoRecibidoNum)}</span>
                {sinAsignar > 0.01 && (
                  <span className="text-ink-soft">
                    Sobran {formatoMoneda(sinAsignar)} → quedan como saldo a favor del cliente
                  </span>
                )}
                {sinAsignar < -0.01 && (
                  <span className="text-danger">Te pasaste por {formatoMoneda(Math.abs(sinAsignar))}</span>
                )}
              </div>
            </div>

            {error && <div className="px-4 py-2 text-danger text-[12.5px] border-b border-line">{error}</div>}

            <div className="px-4 py-3 flex gap-2">
              <button className="btn-accent" onClick={handleGuardar} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar pago'}
              </button>
              <button className="btn-outline" onClick={onClose} disabled={guardando}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
