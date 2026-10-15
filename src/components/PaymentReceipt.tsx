import type { CSSProperties } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { formatoMoneda } from '../lib/aging';

export interface ReciboItem {
  numero: number;
  fecha: string;
  concepto: string;
  pago: number;
  saldo: number;
  estado: string;
}

interface Props {
  pagoNumero?: number;
  fecha: string;
  clienteNombre: string;
  metodo: string;
  referencia?: string;
  cuentaNombre?: string;
  montoTotal: number;
  items: ReciboItem[];
  recordatorioEnviado?: boolean;
  excedenteAFavor?: number;
}

export function PaymentReceipt({
  pagoNumero,
  fecha,
  clienteNombre,
  metodo,
  referencia,
  cuentaNombre,
  montoTotal,
  items,
  recordatorioEnviado,
  excedenteAFavor,
}: Props) {
  // Igual que la factura: el recibo impreso siempre queda en papel claro,
  // sin importar el tema activo en el resto de la app.
  const coloresPapel = {
    '--color-ink': '#161826',
    '--color-ink-soft': '#63678a',
    '--color-line': '#cfd3e5',
    '--color-success': '#2f7d5d',
  } as CSSProperties;

  return (
    <div className="printable bg-white text-ink p-1" style={coloresPapel}>
      <div className="flex items-center gap-2 text-lg font-semibold mb-3 text-ink">
        <CheckCircle2 size={20} className="text-success" />
        Pago registrado
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm mb-4">
        {pagoNumero !== undefined && (
          <div>
            <div className="th-label">Pago N°</div>
            <div>{pagoNumero}</div>
          </div>
        )}
        <div>
          <div className="th-label">Fecha</div>
          <div>{fecha}</div>
        </div>
        <div>
          <div className="th-label">Cliente</div>
          <div>{clienteNombre}</div>
        </div>
        <div>
          <div className="th-label">Método</div>
          <div className="capitalize">
            {metodo}
            {referencia && <span className="text-ink-soft"> · ref {referencia}</span>}
          </div>
        </div>
        {cuentaNombre && (
          <div>
            <div className="th-label">Cuenta</div>
            <div>{cuentaNombre}</div>
          </div>
        )}
      </div>

      <div className="border-t border-line">
        <div className="grid grid-cols-[.6fr_.9fr_1.3fr_.7fr_.7fr_.8fr] px-0 py-1.5 border-b border-line">
          {['Factura', 'Fecha', 'Concepto', 'Pago', 'Saldo', 'Estado'].map((h) => (
            <span key={h} className="th-label">
              {h}
            </span>
          ))}
        </div>
        {items.map((it) => (
          <div
            key={it.numero}
            className="grid grid-cols-[.6fr_.9fr_1.3fr_.7fr_.7fr_.8fr] py-1.5 border-b border-line text-sm items-center"
          >
            <span className="text-ink-soft">{it.numero}</span>
            <span>{it.fecha}</span>
            <span>{it.concepto}</span>
            <span>{formatoMoneda(it.pago)}</span>
            <span>{formatoMoneda(it.saldo)}</span>
            <span className="chip w-fit">{it.estado}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center pt-3 font-semibold text-[15px]">
        <span>Total pagado</span>
        <span>{formatoMoneda(montoTotal)}</span>
      </div>

      {excedenteAFavor !== undefined && excedenteAFavor > 0 && (
        <div className="flex justify-between items-center mt-1 text-[13px]">
          <span className="text-ink-soft">Saldo a favor generado</span>
          <span className="text-success font-medium">{formatoMoneda(excedenteAFavor)}</span>
        </div>
      )}

      {recordatorioEnviado && (
        <div className="text-ink-soft text-[11.5px] mt-2">
          Recibo enviado a {clienteNombre}.
        </div>
      )}
    </div>
  );
}
