import type { CSSProperties } from 'react';
import { useDataStore } from '../data/DataContext';
import { formatoMoneda, saldoPendiente } from '../lib/aging';
import { Wordmark } from './Wordmark';
import type { Cliente, Factura } from '../types';

export function InvoiceDocument({ factura, cliente }: { factura: Factura; cliente: Cliente }) {
  const { configuracion } = useDataStore();
  const saldo = saldoPendiente(factura);
  const pagada = saldo <= 0;
  const empresa = configuracion.empresa;

  // El documento de factura siempre se ve como papel: fondo e ints fijos en
  // claro, sin importar el tema activo en el resto de la app (igual que una
  // hoja impresa no cambia de color según la luz del cuarto).
  const coloresPapel = {
    '--color-ink': '#161826',
    '--color-ink-soft': '#63678a',
    '--color-line': '#cfd3e5',
    '--color-line-soft': '#e7e9f4',
    '--color-danger': '#c4392b',
    '--color-success': '#2f7d5d',
  } as CSSProperties;

  return (
    <div id="invoice-print-area" className="printable bg-white text-ink p-8 font-sans" style={coloresPapel}>
      <div className="flex justify-between items-start mb-8 pb-6 border-b border-line">
        <div>
          {empresa.nombre === 'tax.invoice' ? (
            <Wordmark size={22} monocromo />
          ) : empresa.nombre ? (
            <div className="font-bold text-lg">{empresa.nombre}</div>
          ) : (
            <div className="font-bold text-lg italic text-ink-soft">sin nombre todavía</div>
          )}
          <div className="text-ink-soft text-[12.5px] mt-1">
            {empresa.direccion || 'Dirección de la empresa · Ciudad, Estado ZIP'}
          </div>
          <div className="text-ink-soft text-[12.5px]">{empresa.email || 'correo@tunegocio.com'}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tracking-wide">FACTURA</div>
          <div
            className={`inline-block mt-1.5 px-2.5 py-1 text-xs font-semibold ${
              pagada ? 'bg-ink text-white' : 'bg-danger text-white'
            }`}
          >
            {pagada ? 'PAGADA' : 'SALDO PENDIENTE'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-8">
        <div>
          <div className="th-label mb-1.5">Facturar a</div>
          <div className="border border-line bg-line-soft p-3 text-sm leading-relaxed">
            <div className="font-semibold">
              {cliente.codigo} {cliente.numero} {cliente.nombre}
            </div>
            <div className="text-ink-soft">{cliente.licenciaInfo}</div>
            {cliente.direccion && <div className="text-ink-soft">{cliente.direccion}</div>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-y-2.5 text-sm content-start">
          <span className="th-label">N° de factura</span>
          <span className="text-right font-medium">{factura.numero}</span>
          <span className="th-label">Fecha</span>
          <span className="text-right">{factura.fecha}</span>
          <span className="th-label">Vencimiento</span>
          <span className="text-right">{factura.fechaVencimiento}</span>
          <span className="th-label">Términos</span>
          <span className="text-right">Vencimiento inmediato</span>
        </div>
      </div>

      <table className="w-full text-sm mb-6 border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className="text-left py-2 th-label font-semibold">Concepto</th>
            <th className="text-right py-2 th-label font-semibold w-20">Cant.</th>
            <th className="text-right py-2 th-label font-semibold w-28">Valor</th>
            <th className="text-right py-2 th-label font-semibold w-28">Importe</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line">
            <td className="py-3">{factura.concepto}</td>
            <td className="py-3 text-right">1</td>
            <td className="py-3 text-right">{formatoMoneda(factura.monto)}</td>
            <td className="py-3 text-right">{formatoMoneda(factura.monto)}</td>
          </tr>
        </tbody>
      </table>

      <div className="flex justify-end mb-8">
        <div className="w-64">
          <div className="flex justify-between py-1 text-sm">
            <span className="text-ink-soft">Subtotal</span>
            <span>{formatoMoneda(factura.monto)}</span>
          </div>
          <div className="flex justify-between py-1 text-sm">
            <span className="text-ink-soft">Pagado</span>
            <span>{formatoMoneda(factura.montoPagado)}</span>
          </div>
          <div className="flex justify-between py-2.5 mt-1 border-t border-line font-bold text-base">
            <span>Saldo</span>
            <span className={saldo > 0 ? 'text-danger' : ''}>{formatoMoneda(saldo)}</span>
          </div>
        </div>
      </div>

      <div className="text-ink-soft text-[11.5px] border-t border-line pt-3">
        El pago realizado no es transferible ni reembolsable.
      </div>
    </div>
  );
}
