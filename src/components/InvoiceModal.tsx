import { useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { InvoiceDocument } from './InvoiceDocument';
import { PaymentModal } from './PaymentModal';
import { DocumentAuditHistory } from './DocumentAuditHistory';
import { ClienteSelect } from './ClienteSelect';
import { saldoPendiente, formatoMoneda } from '../lib/aging';

export function InvoiceModal({
  facturaId,
  onClose,
}: {
  facturaId: string;
  onClose: () => void;
}) {
  const { facturas, getCliente, descargarFacturaPdf, enviarFacturaPorMail, editarFactura, eliminarFactura, asignarSaldoAFavor, clientes, notasCredito, usuarioActual } = useDataStore();
  const [pagoAbierto, setPagoAbierto] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [enviandoMail, setEnviandoMail] = useState(false);
  const [emailDestino, setEmailDestino] = useState<string | null>(null);
  const [mensajeEnvio, setMensajeEnvio] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [conceptoEdit, setConceptoEdit] = useState('');
  const [montoEdit, setMontoEdit] = useState('');
  const [vencimientoEdit, setVencimientoEdit] = useState('');
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const [fechaEdit, setFechaEdit] = useState('');
  const [codigoEdit, setCodigoEdit] = useState('');
  const [clienteEdit, setClienteEdit] = useState('');
  const [filasSaf, setFilasSaf] = useState<{ clienteId: string; monto: string }[]>([{ clienteId: '', monto: '' }]);
  const [errorSaf, setErrorSaf] = useState<string | null>(null);
  const [asignando, setAsignando] = useState(false);

  // Se busca la factura viva en cada render (no una copia fija tomada al
  // abrir el modal), para que si se paga desde acá adentro, se vea reflejado
  // al instante sin tener que cerrar y volver a abrir.
  const factura = facturas.find((f) => f.id === facturaId);
  const cliente = factura ? getCliente(factura.clienteId) : undefined;

  if (!factura || !cliente) return null;

  const pendiente = saldoPendiente(factura) > 0;
  const esAdmin = usuarioActual?.rol === 'admin';

  function handleAbrirEdicion() {
    if (!factura) return;
    setConceptoEdit(factura.concepto);
    setMontoEdit(String(factura.monto));
    setVencimientoEdit(factura.fechaVencimiento);
    setFechaEdit(factura.fecha);
    setCodigoEdit(factura.codigo ?? '');
    setClienteEdit(factura.clienteId);
    setErrorEdicion(null);
    setEditando(true);
  }

  async function handleGuardarEdicion() {
    const montoNumero = Number(montoEdit);
    if (!conceptoEdit.trim()) return setErrorEdicion('El motivo no puede quedar vacío.');
    if (!montoEdit || Number.isNaN(montoNumero) || montoNumero <= 0) return setErrorEdicion('El monto tiene que ser mayor a 0.');
    try {
      await editarFactura(facturaId, {
        concepto: conceptoEdit.trim(),
        monto: montoNumero,
        fechaVencimiento: vencimientoEdit,
        fecha: fechaEdit,
        codigo: codigoEdit.trim(),
        clienteId: clienteEdit,
      });
      setEditando(false);
    } catch (e) {
      setErrorEdicion(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
  }

  async function handleEliminar() {
    if (!factura) return;
    const aviso = esAdmin
      ? `¿Eliminar la factura #${factura.numero}? Esta acción no se puede deshacer.`
      : `Las facturas solo las borra el sector contable. ¿Querés pedir la eliminación de la factura #${factura.numero}?`;
    if (!window.confirm(aviso)) return;
    try {
      await eliminarFactura(factura.id);
      if (esAdmin) onClose();
    } catch (e) {
      setErrorEdicion(e instanceof Error ? e.message : 'No se pudo eliminar.');
      setEditando(true);
    }
  }

  async function handleDescargarPdf() {
    if (!factura) return;
    setDescargando(true);
    try {
      await descargarFacturaPdf(factura.id, factura.numero);
    } finally {
      setDescargando(false);
    }
  }

  async function handleEnviarMail() {
    if (!factura) return;
    const destino = emailDestino ?? cliente?.email ?? '';
    if (!destino) {
      setMensajeEnvio('Este cliente no tiene un email cargado. Escribilo arriba antes de enviar.');
      return;
    }
    setEnviandoMail(true);
    const resultado = await enviarFacturaPorMail(factura.id, destino);
    setEnviandoMail(false);
    setMensajeEnvio(resultado.enviado ? `Enviado a ${destino}. ${resultado.motivo}` : `No se pudo enviar: ${resultado.motivo}`);
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-start justify-center pt-10 z-50 overflow-y-auto pb-10"
      onClick={onClose}
    >
      <div
        className="panel w-[min(680px,94vw)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line no-print">
          <span className="font-semibold text-[15px]">Factura #{factura.numero}</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">
            ✕
          </button>
        </div>

        {editando ? (
          <div className="px-4 py-3 border-b border-line no-print flex flex-col gap-3">
            <div>
              <div className="th-label mb-1">Motivo</div>
              <input
                value={conceptoEdit}
                onChange={(e) => setConceptoEdit(e.target.value)}
                className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="th-label mb-1">Monto</div>
                <input
                  type="number"
                  value={montoEdit}
                  onChange={(e) => setMontoEdit(e.target.value)}
                  className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm num focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <div className="th-label mb-1">Vencimiento</div>
                <input
                  type="date"
                  value={vencimientoEdit}
                  onChange={(e) => setVencimientoEdit(e.target.value)}
                  className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="th-label mb-1">Fecha de la factura</div>
                <input type="date" value={fechaEdit} onChange={(e) => setFechaEdit(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
              </div>
              <div>
                <div className="th-label mb-1">Código (ej. 1090PB)</div>
                <input value={codigoEdit} onChange={(e) => setCodigoEdit(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm num focus:outline-none focus:border-accent" />
              </div>
            </div>
            <div>
              <div className="th-label mb-1">Unidad / cliente (se puede pasar a otra si no tiene pagos)</div>
              <ClienteSelect clientes={clientes} value={clienteEdit} onChange={setClienteEdit} />
            </div>
            {errorEdicion && <div className="text-danger-dark text-[12.5px]">{errorEdicion}</div>}
            <div className="flex gap-2">
              <button className="btn-accent" onClick={handleGuardarEdicion}>Guardar cambios</button>
              <button className="btn-outline" onClick={() => setEditando(false)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <InvoiceDocument factura={factura} cliente={cliente} />
        )}

        {!editando && (
          <div className="px-4 py-2 border-t border-line no-print text-ink-faint text-[11px] flex items-center justify-between">
            <span>{factura.creadoPor ? `Creada por ${factura.creadoPor}` : ''}</span>
            <span className="flex items-center gap-3">
              <button className="text-accent hover:underline font-medium" onClick={handleAbrirEdicion}>
                Editar factura
              </button>
              <button className="text-danger-dark hover:underline font-medium" onClick={handleEliminar}>
                {esAdmin ? 'Eliminar' : 'Pedir eliminación'}
              </button>
            </span>
          </div>
        )}

        {factura.codigo === '1090CI' && esAdmin && (() => {
          const hechas = notasCredito.filter((n) => n.origenFacturaId === factura.id);
          const asignado = hechas.reduce((a, n) => a + n.monto, 0);
          const restante = Math.round((factura.monto - asignado) * 100) / 100;
          const pagada = factura.montoPagado >= factura.monto;
          const sumaFilas = filasSaf.reduce((a, f) => a + (Number(f.monto) || 0), 0);
          async function asignar() {
            setErrorSaf(null);
            const asig = filasSaf.filter((f) => f.clienteId && Number(f.monto) > 0).map((f) => ({ clienteId: f.clienteId, monto: Number(f.monto) }));
            if (asig.length === 0) return setErrorSaf('Elegí al menos una unidad y un monto.');
            setAsignando(true);
            try {
              await asignarSaldoAFavor(factura!.id, asig);
              setFilasSaf([{ clienteId: '', monto: '' }]);
            } catch (e) {
              setErrorSaf(e instanceof Error ? e.message : 'No se pudo asignar.');
            } finally {
              setAsignando(false);
            }
          }
          return (
            <div className="px-4 py-3 border-t border-line no-print bg-success-bg">
              <div className="font-semibold text-[13px] mb-0.5">Saldo a favor por cobro indebido (1090SAF)</div>
              <div className="text-ink-soft text-[12px] mb-2">
                Asignado {formatoMoneda(asignado)} de {formatoMoneda(factura.monto)} · queda {formatoMoneda(restante)}.
                {!pagada && ' Se habilita cuando esta factura esté pagada.'}
              </div>
              {hechas.map((n) => (
                <div key={n.id} className="text-[12px] text-ink-soft">NC #{n.numero} · {getCliente(n.clienteId)?.codigo ?? '?'} · {formatoMoneda(n.monto)}</div>
              ))}
              {pagada && restante > 0 && (
                <div className="mt-2 flex flex-col gap-2">
                  {filasSaf.map((f, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <div className="flex-1"><ClienteSelect clientes={clientes.filter((c) => c.id !== factura.clienteId)} value={f.clienteId} onChange={(id) => setFilasSaf((p) => p.map((x, j) => (j === i ? { ...x, clienteId: id } : x)))} placeholder="Unidad que descontó al cliente…" /></div>
                      <input type="number" aria-label="Monto a asignar" placeholder="0.00" value={f.monto} onChange={(e) => setFilasSaf((p) => p.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))} className="w-24 border border-line rounded-[5px] bg-surface px-2 py-1.5 text-sm num" />
                    </div>
                  ))}
                  <div className="flex gap-3 items-center flex-wrap">
                    <button className="text-[12px] text-accent hover:underline" onClick={() => setFilasSaf((p) => [...p, { clienteId: '', monto: '' }])}>+ Agregar otra unidad</button>
                    <button className="btn-accent" onClick={asignar} disabled={asignando || sumaFilas <= 0}>Crear notas de crédito 1090SAF · {formatoMoneda(sumaFilas)}</button>
                  </div>
                  {errorSaf && <div className="text-danger-dark text-[12.5px]">{errorSaf}</div>}
                </div>
              )}
            </div>
          );
        })()}

        <div className="px-4 py-3 border-t border-line no-print">
          <DocumentAuditHistory entidad="Factura" entidadId={factura.id} />
        </div>

        <div className="px-4 py-3 border-t border-line no-print">
          <div className="flex gap-2 flex-wrap mb-2">
            <button className="btn-outline" onClick={() => window.print()}>
              Imprimir
            </button>
            <button className="btn-outline" onClick={handleDescargarPdf} disabled={descargando}>
              {descargando ? 'Generando PDF…' : 'Descargar PDF'}
            </button>
            {pendiente && (
              <button className="btn-accent" onClick={() => setPagoAbierto(true)}>
                Recibir pago
              </button>
            )}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="email"
              value={emailDestino ?? cliente.email ?? ''}
              onChange={(e) => setEmailDestino(e.target.value)}
              placeholder="Email del cliente"
              className="border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm w-56 focus:outline-none focus:border-accent"
            />
            <button className="btn-outline text-[13px]" onClick={handleEnviarMail} disabled={enviandoMail}>
              {enviandoMail ? 'Enviando…' : 'Enviar por mail'}
            </button>
          </div>
          {mensajeEnvio && <div className="text-ink-soft text-[12px] mt-1.5">{mensajeEnvio}</div>}
        </div>
      </div>

      {pagoAbierto && (
        <PaymentModal clienteId={cliente.id} onClose={() => setPagoAbierto(false)} />
      )}
    </div>
  );
}
