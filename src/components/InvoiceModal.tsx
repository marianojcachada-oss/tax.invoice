import { useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { InvoiceDocument } from './InvoiceDocument';
import { PaymentModal } from './PaymentModal';
import { DocumentAuditHistory } from './DocumentAuditHistory';
import { saldoPendiente } from '../lib/aging';

export function InvoiceModal({
  facturaId,
  onClose,
}: {
  facturaId: string;
  onClose: () => void;
}) {
  const { facturas, getCliente, descargarFacturaPdf, enviarFacturaPorMail, editarFactura, usuarioActual } = useDataStore();
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
    setErrorEdicion(null);
    setEditando(true);
  }

  async function handleGuardarEdicion() {
    const montoNumero = Number(montoEdit);
    if (!conceptoEdit.trim()) return setErrorEdicion('El motivo no puede quedar vacío.');
    if (!montoEdit || Number.isNaN(montoNumero) || montoNumero <= 0) return setErrorEdicion('El monto tiene que ser mayor a 0.');
    await editarFactura(facturaId, { concepto: conceptoEdit.trim(), monto: montoNumero, fechaVencimiento: vencimientoEdit });
    setEditando(false);
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
            {esAdmin && (
              <button className="text-accent hover:underline font-medium" onClick={handleAbrirEdicion}>
                Editar factura
              </button>
            )}
          </div>
        )}

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
