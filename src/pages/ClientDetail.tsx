import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDataStore } from '../data/DataContext';
import { diasDeAtraso, formatoMoneda, formatoSaldoConSigno, saldoPendiente } from '../lib/aging';
import { PaymentModal } from '../components/PaymentModal';
import { PaymentReceiptModal } from '../components/PaymentReceiptModal';
import { CreateInvoiceModal } from '../components/CreateInvoiceModal';
import { InvoiceModal } from '../components/InvoiceModal';
import { ClientFormModal } from '../components/ClientFormModal';
import { CreateCreditMemoModal } from '../components/CreateCreditMemoModal';
import { ApplyCreditMemoModal } from '../components/ApplyCreditMemoModal';
import { DocumentAuditHistory } from '../components/DocumentAuditHistory';
import { PaymentPlanModal } from '../components/PaymentPlanModal';
import { AltaFacturaModal } from '../components/AltaFacturaModal';
import { FileText, Trash2, ArrowLeft } from 'lucide-react';
import type { Pago, Factura, NotaCredito, DocumentoCliente, Reembolso } from '../types';

type Tab = 'cuenta' | 'historial' | 'documentos' | 'notas';

const TABS: { id: Tab; label: string }[] = [
  { id: 'cuenta', label: 'Cuenta corriente' },
  { id: 'historial', label: 'Historial de pagos' },
  { id: 'documentos', label: 'Documentos' },
  { id: 'notas', label: 'Notas' },
];

export function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getCliente, getFacturasDeCliente, getPagosDeCliente, notasCredito, reembolsos, actualizarCliente, getDocumentosDeCliente, agregarDocumento, eliminarDocumento, enviarRecordatorioCliente, catalogoFees, getFeesPendientesDeCliente, marcarFeePendiente, desmarcarFeePendiente } = useDataStore();
  const [tab, setTab] = useState<Tab>('cuenta');
  const [modalAbierto, setModalAbierto] = useState(false);
  const [crearFacturaAbierto, setCrearFacturaAbierto] = useState(false);
  const [reciboAbierto, setReciboAbierto] = useState<Pago | null>(null);
  const [facturaVerAbierta, setFacturaVerAbierta] = useState<string | null>(null);
  const [editarAbierto, setEditarAbierto] = useState(false);
  const [notaCreditoAbierta, setNotaCreditoAbierta] = useState(false);
  const [notaAAplicar, setNotaAAplicar] = useState<NotaCredito | null>(null);
  const [planPagoAbierto, setPlanPagoAbierto] = useState(false);
  const [mensajeRecordatorio, setMensajeRecordatorio] = useState<string | null>(null);
  const [enviandoRecordatorio, setEnviandoRecordatorio] = useState(false);
  const [subiendoDocumento, setSubiendoDocumento] = useState(false);
  const [errorDocumento, setErrorDocumento] = useState<string | null>(null);

  const cliente = id ? getCliente(id) : undefined;
  const facturas = id ? getFacturasDeCliente(id) : [];
  const pagos = id ? getPagosDeCliente(id) : [];
  const [documentosDelCliente, setDocumentosDelCliente] = useState<DocumentoCliente[]>([]);
  const [feesPendientes, setFeesPendientes] = useState<string[]>([]);

  useEffect(() => {
    if (!id) return;
    getFeesPendientesDeCliente(id).then(setFeesPendientes).catch(() => setFeesPendientes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    getDocumentosDeCliente(id).then(setDocumentosDelCliente).catch(() => setDocumentosDelCliente([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const notasDelCliente = useMemo(
    () => notasCredito.filter((n) => n.clienteId === id).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
    [notasCredito, id]
  );

  const reembolsosDelCliente = useMemo(
    () => reembolsos.filter((r) => r.clienteId === id).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
    [reembolsos, id]
  );
  const totalReembolsado = reembolsosDelCliente.reduce((a, r) => a + r.monto, 0);

  const saldo = useMemo(() => facturas.reduce((a, f) => a + saldoPendiente(f), 0), [facturas]);
  const creditoDisponible = useMemo(
    () => notasDelCliente.reduce((a, n) => a + Math.max(0, n.monto - n.montoAplicado), 0),
    [notasDelCliente]
  );
  const pagadoAnio = useMemo(() => pagos.reduce((a, p) => a + p.monto, 0), [pagos]);
  const facturaEnMora = facturas.find((f) => saldoPendiente(f) > 0);
  const atraso = facturaEnMora ? diasDeAtraso(facturaEnMora.fechaVencimiento) : 0;

  type FilaCuenta =
    | { tipo: 'factura'; fecha: string; data: Factura }
    | { tipo: 'nota'; fecha: string; data: NotaCredito }
    | { tipo: 'pago'; fecha: string; data: Pago }
    | { tipo: 'reembolso'; fecha: string; data: Reembolso };
  const filasCuenta: FilaCuenta[] = useMemo(() => {
    const filas: FilaCuenta[] = [
      ...facturas.map((f) => ({ tipo: 'factura' as const, fecha: f.fechaVencimiento, data: f })),
      ...notasDelCliente.map((n) => ({ tipo: 'nota' as const, fecha: n.fecha, data: n })),
      ...pagos.map((p) => ({ tipo: 'pago' as const, fecha: p.fecha, data: p })),
      ...reembolsosDelCliente.map((r) => ({ tipo: 'reembolso' as const, fecha: r.fecha, data: r })),
    ];
    return filas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }, [facturas, notasDelCliente, pagos, reembolsosDelCliente]);

  if (!cliente) {
    return (
      <div className="px-6 md:px-8 py-6">
        <p className="text-sm text-ink-soft mb-3">Cliente no encontrado.</p>
        <button className="btn-outline" onClick={() => navigate('/clientes')}>
          Volver
        </button>
      </div>
    );
  }

  function leerArchivoComoDataUrl(archivo: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(archivo);
    });
  }

  function formatoTamano(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleSubirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo || !cliente) return;
    const LIMITE = 3 * 1024 * 1024;
    if (archivo.size > LIMITE) {
      setErrorDocumento('El archivo pesa más de 3 MB. Elegí uno más chico.');
      e.target.value = '';
      return;
    }
    setErrorDocumento(null);
    setSubiendoDocumento(true);
    try {
      const dataUrl = await leerArchivoComoDataUrl(archivo);
      await agregarDocumento({
        clienteId: cliente.id,
        nombre: archivo.name,
        tipo: archivo.type || 'application/octet-stream',
        tamano: archivo.size,
        fecha: new Date().toISOString().slice(0, 10),
        dataUrl,
      });
      setDocumentosDelCliente(await getDocumentosDeCliente(cliente.id));
    } catch {
      setErrorDocumento('No se pudo leer el archivo.');
    } finally {
      setSubiendoDocumento(false);
      e.target.value = '';
    }
  }

  const [altaSugerido, setAltaSugerido] = useState<'RA' | 'RI' | null>(null);

  async function handleReactivar() {
    if (!cliente) return;
    const fee = await actualizarCliente(cliente.id, { estado: 'activo' });
    setAltaSugerido(fee?.codigo === '1090RA' ? 'RA' : 'RI');
  }

  async function handleEnviarRecordatorio() {
    if (!cliente) return;
    setEnviandoRecordatorio(true);
    const resultado = await enviarRecordatorioCliente(cliente.id);
    setEnviandoRecordatorio(false);
    setMensajeRecordatorio(resultado.enviado ? `Recordatorio enviado a ${cliente.nombre}. ${resultado.motivo}` : `No se envió: ${resultado.motivo}`);
    setTimeout(() => setMensajeRecordatorio(null), 6000);
  }

  const saldoNeto = creditoDisponible - saldo;

  return (
    <div className="px-6 md:px-8 py-6 max-w-[1400px]">
      {altaSugerido && <AltaFacturaModal cliente={cliente} sugerido={altaSugerido} onClose={() => setAltaSugerido(null)} />}
      <button className="flex items-center gap-1.5 text-ink-soft text-[12.5px] hover:text-accent mb-4" onClick={() => navigate('/clientes')}>
        <ArrowLeft size={13} /> Clientes
      </button>

      <div className="flex justify-between items-start flex-wrap gap-3 mb-5">
        <div className="flex gap-3 items-center">
          <div className="w-11 h-11 rounded-[6px] bg-success-bg text-accent shrink-0 flex items-center justify-center font-medium num text-[13px]">
            {cliente.nombre.split(' ').map((n) => n[0]).slice(0, 2).join('')}
          </div>
          <div>
            <div className="font-semibold text-lg">{cliente.nombre}</div>
            <div className="text-ink-faint text-[11.5px] num">
              {cliente.codigo} {cliente.numero} · {cliente.licenciaInfo} · alta {cliente.fechaAlta} · {cliente.telefonos}
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-outline" onClick={() => setEditarAbierto(true)}>Editar</button>
          <button className="btn-outline" onClick={() => setCrearFacturaAbierto(true)}>Crear factura</button>
          <button className="btn-outline" onClick={() => setNotaCreditoAbierta(true)}>Nota de crédito</button>
          <button className="btn-accent" onClick={() => setModalAbierto(true)}>Registrar pago</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-line border border-line rounded-[6px] overflow-hidden mb-5">
        <div className="bg-surface p-3.5">
          <div className="th-label mb-1.5">Saldo</div>
          <div className={`num font-medium text-xl ${saldoNeto < 0 ? 'text-danger-dark' : saldoNeto > 0 ? 'text-success' : 'text-ink'}`}>
            {formatoSaldoConSigno(saldoNeto)}
          </div>
          {saldo > 0 && creditoDisponible > 0 && (
            <div className="text-ink-faint text-[10.5px] mt-1">
              Debe {formatoMoneda(saldo)} · {formatoMoneda(creditoDisponible)} a favor sin aplicar
            </div>
          )}
        </div>
        <Stat label="Cuota semanal" value={formatoMoneda(cliente.cuotaSemanal)} />
        <Stat label="Atraso" value={atraso > 0 ? `${atraso} d` : '—'} accent={atraso > 0} />
        <Stat label="Pagado histórico" value={formatoMoneda(pagadoAnio)} />
      </div>

      {catalogoFees.some((f) => f.visibleEnFicha) && (
        <div className="panel p-3.5 mb-5">
          <div className="th-label mb-2">
            Fees a facturar en la próxima corrida semanal
            {feesPendientes.length > 0 && <span className="chip-accent ml-2 normal-case tracking-normal">{feesPendientes.length}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {catalogoFees.filter((f) => f.visibleEnFicha).map((f) => {
              const marcado = feesPendientes.includes(f.id);
              return (
                <label
                  key={f.id}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] border text-[12.5px] cursor-pointer transition-colors ${
                    marcado ? 'border-accent bg-accent/10 text-accent' : 'border-line text-ink-soft hover:border-ink-faint'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={async () => {
                      if (!id) return;
                      if (marcado) {
                        await desmarcarFeePendiente(id, f.id);
                        setFeesPendientes((prev) => prev.filter((x) => x !== f.id));
                      } else {
                        await marcarFeePendiente(id, f.id);
                        setFeesPendientes((prev) => [...prev, f.id]);
                      }
                    }}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="num">{f.codigo}</span> — {f.etiqueta} ({formatoMoneda(f.monto)})
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-5 border-b border-line mb-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-[13px] pb-2.5 font-medium transition-colors ${
              tab === t.id ? 'border-b-2 border-accent text-accent' : 'text-ink-faint hover:text-ink-soft border-b-2 border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel !rounded-t-none border-t-0 overflow-hidden mb-4">
        {tab === 'cuenta' && (
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div className="grid grid-cols-[.6fr_.7fr_1fr_.6fr_.6fr_.7fr_.8fr_90px] gap-2 px-5 py-2.5 border-b border-line bg-surface-2">
                {['N°', 'Fecha', 'Concepto', 'Cargo', 'Crédito', 'Saldo', 'Estado', ''].map((h) => (
                  <span key={h} className="th-label">{h}</span>
                ))}
              </div>
              {filasCuenta.map((fila) => {
                if (fila.tipo === 'factura') {
                  const f = fila.data;
                  return (
                    <div
                      key={f.id}
                      onClick={() => setFacturaVerAbierta(f.id)}
                      className="grid grid-cols-[.6fr_.7fr_1fr_.6fr_.6fr_.7fr_.8fr_90px] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] cursor-pointer hover:bg-surface-2 transition-colors items-center"
                    >
                      <span className="text-ink-faint num">{f.numero}</span>
                      <span className="num">{f.fechaVencimiento}</span>
                      <span>
                        {f.concepto}
                        {f.beneficiarioId && (() => {
                          const b = getCliente(f.beneficiarioId);
                          return <span className="block text-[11.5px] text-ink-faint">{f.recuperoNcId ? 'SAF generado para' : 'Al pagarse genera SAF para'} {b ? `${b.codigo} ${b.nombre}` : 'otra unidad'}</span>;
                        })()}
                      </span>
                      <span className="num">{formatoMoneda(f.monto)}</span>
                      <span className="text-ink-faint">—</span>
                      <span className={`num font-medium ${saldoPendiente(f) > 0 ? 'text-danger-dark' : 'text-ink'}`}>{formatoMoneda(saldoPendiente(f))}</span>
                      <EstadoFacturaChip estado={f.estado} />
                      <span />
                    </div>
                  );
                }
                if (fila.tipo === 'reembolso') {
                  const r = fila.data;
                  return (
                    <div
                      key={r.id}
                      className="grid grid-cols-[.6fr_.7fr_1fr_.6fr_.6fr_.7fr_.8fr_90px] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] items-center hover:bg-surface-2 transition-colors"
                    >
                      <span className="text-ink-faint num">R-{r.numero}</span>
                      <span className="num">{r.fecha}</span>
                      <span className="text-ink-soft truncate" title={r.motivo}>
                        Reembolso · <span className="capitalize">{r.metodo}</span> · {r.motivo}
                        {r.pagoNumero != null ? ` · sobre P-${r.pagoNumero}` : ''}
                        {r.facturas && r.facturas.length > 0 ? ` (factura #${r.facturas.map((f) => f.numero).join(', #')})` : ''}
                      </span>
                      <span className="text-ink-faint">—</span>
                      <span className="num text-danger-dark">−{formatoMoneda(r.monto)}</span>
                      <span className="text-ink-faint">—</span>
                      <span className="chip w-fit">Devuelto</span>
                      <span />
                    </div>
                  );
                }
                if (fila.tipo === 'pago') {
                  const p = fila.data;
                  return (
                    <div
                      key={p.id}
                      className="grid grid-cols-[.6fr_.7fr_1fr_.6fr_.6fr_.7fr_.8fr_90px] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] items-center hover:bg-surface-2 transition-colors"
                    >
                      <span className="text-ink-faint num">P-{p.numero}</span>
                      <span className="num">{p.fecha}</span>
                      <span className="text-ink-soft truncate" title={p.referencia}>
                        Pago · <span className="capitalize">{p.metodo}</span>
                        {p.referencia ? ` · ${p.referencia}` : ''}
                        {(() => {
                          const dev = reembolsosDelCliente.filter((r) => r.pagoId === p.id).reduce((a, r) => a + r.monto, 0);
                          return dev > 0 ? <span className="text-danger-dark"> · devuelto {formatoMoneda(dev)} (neto {formatoMoneda(p.monto - dev)})</span> : null;
                        })()}
                      </span>
                      <span className="text-ink-faint">—</span>
                      <span className="text-success num">{formatoMoneda(p.monto)}</span>
                      <span className="text-ink-faint">—</span>
                      <span className="chip-success w-fit">Pago</span>
                      <button className="text-[12px] text-accent font-medium hover:underline text-right" onClick={() => setReciboAbierto(p)}>
                        Recibo
                      </button>
                    </div>
                  );
                }
                const n = fila.data;
                const disponible = Math.max(0, n.monto - n.montoAplicado);
                return (
                  <div
                    key={n.id}
                    className="grid grid-cols-[.6fr_.7fr_1fr_.6fr_.6fr_.7fr_.8fr_90px] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] items-center"
                    style={{ background: 'var(--color-success-bg)' }}
                  >
                    <span className="text-ink-faint num">NC-{n.numero}</span>
                    <span className="num">{n.fecha}</span>
                    <span className="text-ink-soft">Nota de crédito · {n.motivo}{n.origenFacturaNumero ? ` · origen factura #${n.origenFacturaNumero}` : ''}</span>
                    <span className="text-ink-faint">—</span>
                    <span className="text-success num">{formatoMoneda(n.monto)}</span>
                    <span className={`num ${disponible > 0 ? 'text-success font-medium' : 'text-ink-faint'}`}>
                      {formatoMoneda(disponible)}
                    </span>
                    <span className={disponible <= 0 ? 'chip w-fit' : n.montoAplicado > 0 ? 'chip-accent w-fit' : 'chip-success w-fit'}>
                      {disponible <= 0 ? 'Aplicada' : n.montoAplicado > 0 ? 'Parcial' : 'Disponible'}
                    </span>
                    {disponible > 0 ? (
                      <button className="text-[12px] text-accent font-medium hover:underline text-right" onClick={() => setNotaAAplicar(n)}>
                        Aplicar
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}
              {filasCuenta.length === 0 && (
                <div className="px-5 py-8 text-ink-soft text-sm text-center">Sin movimientos todavía.</div>
              )}
            </div>
            {reembolsosDelCliente.length > 0 && (
              <div className="border-t border-line px-5 py-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="th-label">Historial de reembolsos</span>
                  <span className="text-[12.5px] text-ink-soft">Total devuelto <b className="num text-danger-dark">{formatoMoneda(totalReembolsado)}</b></span>
                </div>
                <ul className="divide-y divide-line-soft text-[13px]">
                  {reembolsosDelCliente.map((r) => (
                    <li key={r.id} className="py-1.5 flex flex-wrap gap-x-4 justify-between">
                      <span><span className="num text-ink-faint mr-2">R-{r.numero}</span><span className="num mr-3">{r.fecha}</span>{r.motivo}
                        {r.pagoNumero != null && <span className="text-ink-faint"> · sobre P-{r.pagoNumero}{r.facturas && r.facturas.length > 0 ? ` (factura #${r.facturas.map((f) => f.numero).join(', #')})` : ''}</span>}
                      </span>
                      <span className="num">{formatoMoneda(r.monto)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'historial' && (
          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              <div className="grid grid-cols-[.6fr_.8fr_1fr_.7fr_.7fr_110px] gap-2 px-5 py-2.5 border-b border-line bg-surface-2">
                {['N° pago', 'Fecha', 'Referencia', 'Método', 'Monto', ''].map((h) => (
                  <span key={h} className="th-label">{h}</span>
                ))}
              </div>
              {pagos.map((p) => (
                <div key={p.id} className="grid grid-cols-[.6fr_.8fr_1fr_.7fr_.7fr_110px] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] items-center hover:bg-surface-2 transition-colors">
                  <span className="text-ink-faint num">{p.numero}</span>
                  <span className="num">{p.fecha}</span>
                  <span className="text-ink-soft">{p.referencia ?? '—'}</span>
                  <span className="capitalize">{p.metodo}</span>
                  <span className="num font-medium">{formatoMoneda(p.monto)}</span>
                  <button className="text-[12.5px] text-accent font-medium hover:underline text-right" onClick={() => setReciboAbierto(p)}>
                    Ver recibo
                  </button>
                </div>
              ))}
              {pagos.length === 0 && (
                <div className="px-5 py-8 text-ink-soft text-sm text-center">Todavía no registró pagos.</div>
              )}
            </div>
          </div>
        )}

        {tab === 'documentos' && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="th-label">Documentos ({documentosDelCliente.length})</div>
              <label className="btn-outline text-[12px] !py-1.5 cursor-pointer">
                {subiendoDocumento ? 'Subiendo…' : 'Subir archivo'}
                <input type="file" className="hidden" onChange={handleSubirArchivo} disabled={subiendoDocumento} />
              </label>
            </div>
            {errorDocumento && <div className="text-danger-dark text-[12px] mb-2">{errorDocumento}</div>}
            {documentosDelCliente.length === 0 ? (
              <div className="text-sm text-ink-soft">
                Sin documentos cargados (licencia, contrato, seguro). Subí el primero con el botón de arriba.
              </div>
            ) : (
              <div className="border border-line rounded-[6px] divide-y divide-line-soft">
                {documentosDelCliente.map((d) => (
                  <div key={d.id} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText size={15} className="text-ink-faint shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate text-[13px]">{d.nombre}</div>
                        <div className="text-ink-faint text-[10.5px] num">{formatoTamano(d.tamano)} · {d.fecha}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <a href={d.dataUrl} download={d.nombre} className="text-accent text-[12px] font-medium hover:underline">
                        Descargar
                      </a>
                      <button
                        className="text-ink-faint hover:text-danger-dark"
                        onClick={() => {
                          eliminarDocumento(d.id).then(() => {
                            if (cliente) getDocumentosDeCliente(cliente.id).then(setDocumentosDelCliente);
                          });
                        }}
                        title="Eliminar documento"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="text-ink-faint text-[10.5px] mt-2.5">
              Máximo 3 MB por archivo. Se guardan en el servidor junto con el resto de los datos.
            </div>
          </div>
        )}

        {tab === 'notas' && (
          <div className="p-5 text-sm text-ink-soft">
            Sin notas registradas para este cliente.
            <DocumentAuditHistory entidad="Cliente" entidadId={cliente.id} />
          </div>
        )}
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <button className="btn-outline text-[12.5px] !py-1.5" onClick={handleEnviarRecordatorio} disabled={enviandoRecordatorio}>
          {enviandoRecordatorio ? 'Enviando…' : 'Enviar recordatorio'}
        </button>
        <button className="btn-outline text-[12.5px] !py-1.5" onClick={() => setPlanPagoAbierto(true)}>Plan de pago</button>
        {cliente.estado === 'activo' ? (
          <button
            className="btn-outline text-[12.5px] !py-1.5 hover:!text-danger-dark hover:!border-danger"
            onClick={() => actualizarCliente(cliente.id, { estado: 'inactivo' })}
            title="Ya no se le van a generar facturas nuevas automáticamente"
          >
            Dar de baja (ya no trabaja)
          </button>
        ) : (
          <button className="btn-outline text-[12.5px] !py-1.5" onClick={handleReactivar}>
            Reactivar
          </button>
        )}
        {cliente.estado === 'inactivo' && <span className="chip">Dado de baja</span>}
        {mensajeRecordatorio && <span className="text-ink-soft text-[12px]">{mensajeRecordatorio}</span>}
      </div>

      {modalAbierto && <PaymentModal clienteId={cliente.id} onClose={() => setModalAbierto(false)} />}
      {crearFacturaAbierto && <CreateInvoiceModal clienteId={cliente.id} onClose={() => setCrearFacturaAbierto(false)} />}
      {reciboAbierto && <PaymentReceiptModal pago={reciboAbierto} onClose={() => setReciboAbierto(null)} />}
      {facturaVerAbierta && <InvoiceModal facturaId={facturaVerAbierta} onClose={() => setFacturaVerAbierta(null)} />}
      {editarAbierto && <ClientFormModal cliente={cliente} onClose={() => setEditarAbierto(false)} />}
      {notaCreditoAbierta && <CreateCreditMemoModal clienteId={cliente.id} onClose={() => setNotaCreditoAbierta(false)} />}
      {notaAAplicar && <ApplyCreditMemoModal nota={notaAAplicar} onClose={() => setNotaAAplicar(null)} />}
      {planPagoAbierto && <PaymentPlanModal clienteId={cliente.id} deudaActual={saldo} onClose={() => setPlanPagoAbierto(false)} />}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-surface p-3.5">
      <div className="th-label mb-1.5">{label}</div>
      <div className={`num font-medium text-xl ${accent ? 'text-danger-dark' : ''}`}>{value}</div>
    </div>
  );
}

function EstadoFacturaChip({ estado }: { estado: string }) {
  if (estado === 'vencida') return <span className="chip-danger">Vencida</span>;
  if (estado === 'pagada') return <span className="chip-success">Pagada</span>;
  if (estado === 'parcial') return <span className="chip-accent">Parcial</span>;
  if (estado === 'exenta') return <span className="chip">Exenta</span>;
  return <span className="chip">Pendiente</span>;
}
