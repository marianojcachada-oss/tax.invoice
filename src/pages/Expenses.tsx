import { useMemo, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { formatoMoneda } from '../lib/aging';
import { CuentaSelect } from '../components/CuentaSelect';
import type { CategoriaGasto, MetodoPago } from '../types';

const CATEGORIAS: { valor: CategoriaGasto | 'todos'; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'mantenimiento', etiqueta: 'Mantenimiento' },
  { valor: 'seguro', etiqueta: 'Seguro' },
  { valor: 'combustible', etiqueta: 'Combustible' },
  { valor: 'oficina', etiqueta: 'Oficina' },
  { valor: 'software', etiqueta: 'Software' },
  { valor: 'servicios', etiqueta: 'Servicios' },
  { valor: 'otro', etiqueta: 'Otro' },
];

const TODAS_CATEGORIAS: { valor: CategoriaGasto; etiqueta: string }[] = CATEGORIAS.filter(
  (c) => c.valor !== 'todos'
) as { valor: CategoriaGasto; etiqueta: string }[];

export function Expenses() {
  const { gastos, facturas, cuentas } = useDataStore();
  const [filtro, setFiltro] = useState<CategoriaGasto | 'todos'>('todos');
  const [abierto, setAbierto] = useState(false);

  const gastosDelMes = gastos.reduce((a, g) => a + g.monto, 0);
  const semanaActual = useMemo(() => Math.max(0, ...facturas.map((f) => f.semana)), [facturas]);
  const cobradoDelMes = useMemo(
    () =>
      facturas
        .filter((f) => f.semana <= semanaActual && f.semana > semanaActual - 4)
        .reduce((a, f) => a + f.montoPagado, 0),
    [facturas, semanaActual]
  );
  const margen = cobradoDelMes - gastosDelMes;

  const filtrados = gastos.filter((g) => filtro === 'todos' || g.categoria === filtro);

  return (
    <div className="px-6 md:px-8 py-6 max-w-[1400px]">
      <div className="flex justify-between items-center mb-5">
        <div className="font-semibold text-xl">Gastos</div>
        <button className="btn-accent" onClick={() => setAbierto(true)}>Registrar gasto</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-3.5">
        <div className="panel p-4">
          <div className="th-label mb-1.5">Gastos totales</div>
          <div className="num font-medium text-[19px]">{formatoMoneda(gastosDelMes)}</div>
        </div>
        <div className="panel p-4">
          <div className="th-label mb-1.5">Cobrado (últimas 4 semanas)</div>
          <div className="num font-medium text-[19px]">{formatoMoneda(cobradoDelMes)}</div>
        </div>
        <div className="panel p-4">
          <div className="th-label mb-1.5">Margen</div>
          <div className={`num font-medium text-[19px] ${margen < 0 ? 'text-danger-dark' : ''}`}>{formatoMoneda(margen)}</div>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-3.5">
        {CATEGORIAS.map((c) => (
          <button key={c.valor} onClick={() => setFiltro(c.valor)} aria-pressed={filtro === c.valor} className={filtro === c.valor ? 'chip-accent' : 'chip'}>
            {c.etiqueta}
          </button>
        ))}
      </div>

      <div className="panel overflow-hidden">
        <div className="grid grid-cols-[.7fr_1fr_.9fr_.8fr_.7fr] gap-2 px-5 py-2.5 border-b border-line bg-surface-2">
          {['Fecha', 'Proveedor', 'Categoría', 'Cuenta', 'Monto'].map((h) => (
            <span key={h} className="th-label">{h}</span>
          ))}
        </div>

        {filtrados.map((g) => {
          const cuenta = cuentas.find((c) => c.id === g.cuentaId);
          return (
            <div key={g.id} className="grid grid-cols-[.7fr_1fr_.9fr_.8fr_.7fr] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] hover:bg-surface-2 transition-colors">
              <span className="num text-ink-soft">{g.fecha}</span>
              <span className="font-medium">{g.proveedor}</span>
              <span className="text-ink-soft capitalize">{g.categoria}</span>
              <span className="text-ink-soft">{cuenta?.nombre ?? '—'}</span>
              <b className="num">{formatoMoneda(g.monto)}</b>
            </div>
          );
        })}
        {filtrados.length === 0 && (
          <div className="px-5 py-8 text-ink-soft text-sm text-center">No hay gastos que coincidan con el filtro.</div>
        )}

        <div className="px-5 py-3 text-ink-faint text-[11px] bg-surface-2 border-t border-line-soft">
          Los gastos alimentan el margen real del negocio (cobrado − gastado) y el flujo de caja en Reportes.
        </div>
      </div>

      {abierto && <NuevoGastoModal onClose={() => setAbierto(false)} />}
    </div>
  );
}

function NuevoGastoModal({ onClose }: { onClose: () => void }) {
  const { agregarGasto, cuentas } = useDataStore();
  const [proveedor, setProveedor] = useState('');
  const [categoria, setCategoria] = useState<CategoriaGasto>('mantenimiento');
  const [monto, setMonto] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('tarjeta');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleGuardar() {
    const montoNumero = Number(monto);
    if (!proveedor.trim()) return setError('Escribí a quién se le pagó.');
    if (!monto || Number.isNaN(montoNumero) || montoNumero <= 0) return setError('El monto tiene que ser mayor a 0.');
    setError(null);
    agregarGasto({
      fecha: new Date().toISOString().slice(0, 10),
      proveedor: proveedor.trim(),
      categoria,
      cuentaId: cuentaId || undefined,
      metodo,
      nota: nota || undefined,
      monto: montoNumero,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-16 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(460px,94vw)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Registrar gasto</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <div className="th-label mb-1">Proveedor / a quién se le pagó</div>
            <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
          </div>
          <div>
            <div className="th-label mb-1.5">Categoría</div>
            <div className="flex flex-wrap gap-1.5">
              {TODAS_CATEGORIAS.map((c) => (
                <button key={c.valor} onClick={() => setCategoria(c.valor)} aria-pressed={categoria === c.valor} className={categoria === c.valor ? 'chip-accent' : 'chip'}>
                  {c.etiqueta}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="th-label mb-1">Monto</div>
              <input type="number" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm num focus:outline-none focus:border-accent" />
            </div>
            <div>
              <div className="th-label mb-1">Cuenta</div>
              <CuentaSelect cuentas={cuentas} value={cuentaId} onChange={setCuentaId} />
            </div>
          </div>
          <div>
            <div className="th-label mb-1.5">Método</div>
            <div className="flex flex-wrap gap-1.5">
              {(['tarjeta', 'ach', 'efectivo', 'zelle'] as MetodoPago[]).map((m) => (
                <button key={m} onClick={() => setMetodo(m)} aria-pressed={metodo === m} className={metodo === m ? 'chip-accent capitalize' : 'chip capitalize'}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="th-label mb-1">Nota (opcional)</div>
            <input value={nota} onChange={(e) => setNota(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
          </div>
          {error && <div className="text-danger-dark text-[12.5px]">{error}</div>}
          <button className="btn-accent w-fit" onClick={handleGuardar}>Guardar gasto</button>
        </div>
      </div>
    </div>
  );
}
