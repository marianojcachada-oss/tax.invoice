import { useMemo, useRef, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { formatoMoneda, saldoDeCuenta, movimientosDeCuenta } from '../lib/aging';
import { CuentaSelect } from '../components/CuentaSelect';
import { HistoryButton } from '../components/HistoryButton';
import { SortableHeader } from '../components/SortableHeader';
import { Trash2 } from 'lucide-react';
import type { TipoCuenta } from '../types';

type CampoOrdenCuenta = 'nombre' | 'tipo' | 'saldo';

const TIPO_LABEL: Record<TipoCuenta, string> = {
  efectivo: 'Efectivo',
  banco: 'Banco',
  zelle: 'Zelle',
  stripe: 'Stripe',
  otro: 'Otro',
};

export function Accounts() {
  const { cuentas, pagos, gastos, reembolsos, transferencias, billPagos, eliminarCuenta, usuarioActual } = useDataStore();
  const esAdmin = usuarioActual?.rol === 'admin';
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState<string | null>(null);
  const [transferenciaAbierta, setTransferenciaAbierta] = useState(false);
  const [cuentaNuevaAbierta, setCuentaNuevaAbierta] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
  const [ordenCampo, setOrdenCampo] = useState<CampoOrdenCuenta>('nombre');
  const [ordenDir, setOrdenDir] = useState<'asc' | 'desc'>('asc');

  const datos = { pagos, gastos, reembolsos, transferencias, billPagos };
  const saldos = useMemo(
    () => new Map(cuentas.map((c) => [c.id, saldoDeCuenta(c, datos)])),
    [cuentas, pagos, gastos, reembolsos, transferencias, billPagos]
  );
  const totalCash = useMemo(() => cuentas.reduce((a, c) => a + (saldos.get(c.id) ?? 0), 0), [cuentas, saldos]);

  function toggleOrden(campo: CampoOrdenCuenta) {
    if (ordenCampo === campo) {
      setOrdenDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrdenCampo(campo);
      setOrdenDir(campo === 'saldo' ? 'desc' : 'asc');
    }
  }

  const cuentasOrdenadas = useMemo(() => {
    const dir = ordenDir === 'asc' ? 1 : -1;
    return [...cuentas].sort((a, b) => {
      if (ordenCampo === 'saldo') return ((saldos.get(a.id) ?? 0) - (saldos.get(b.id) ?? 0)) * dir;
      if (ordenCampo === 'tipo') return TIPO_LABEL[a.tipo].localeCompare(TIPO_LABEL[b.tipo]) * dir;
      return a.nombre.localeCompare(b.nombre) * dir;
    });
  }, [cuentas, saldos, ordenCampo, ordenDir]);

  const cuentaActiva = cuentaSeleccionada ? cuentas.find((c) => c.id === cuentaSeleccionada) : null;
  const movimientos = cuentaActiva ? movimientosDeCuenta(cuentaActiva.id, datos) : [];

  async function handleEliminar(nombre: string, id: string) {
    if (!window.confirm(`¿Eliminar la cuenta "${nombre}"? Esta acción no se puede deshacer.`)) return;
    const res = await eliminarCuenta(id);
    setErrorEliminar(res.ok ? null : res.motivo ?? 'No se pudo eliminar.');
  }

  return (
    <div className="px-6 md:px-8 py-6 max-w-[1400px]">
      <div className="flex justify-between items-center flex-wrap gap-3 mb-5">
        <div>
          <div className="font-semibold text-xl">Cuentas</div>
          <div className="text-ink-soft text-[13px]">Total disponible: <b className="num">{formatoMoneda(totalCash)}</b></div>
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => setCuentaNuevaAbierta(true)}>Nueva cuenta</button>
          <button className="btn-accent" onClick={() => setTransferenciaAbierta(true)}>Nueva transferencia</button>
        </div>
      </div>

      {errorEliminar && <div className="text-danger-dark text-[12.5px] mb-3">{errorEliminar}</div>}

      <div className="panel overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-[1.3fr_.8fr_.8fr_130px_70px] gap-2 px-5 py-2.5 border-b border-line bg-surface-2">
              <SortableHeader campo="nombre" activo={ordenCampo === 'nombre'} direccion={ordenDir} onClick={toggleOrden}>Cuenta</SortableHeader>
              <SortableHeader campo="tipo" activo={ordenCampo === 'tipo'} direccion={ordenDir} onClick={toggleOrden}>Tipo</SortableHeader>
              <SortableHeader campo="saldo" activo={ordenCampo === 'saldo'} direccion={ordenDir} onClick={toggleOrden}>Saldo</SortableHeader>
              <span className="th-label"></span>
              <span className="th-label"></span>
            </div>
            {cuentasOrdenadas.map((c) => (
              <div key={c.id} className="grid grid-cols-[1.3fr_.8fr_.8fr_130px_70px] items-center gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] hover:bg-surface-2 transition-colors">
                <span className="font-medium">{c.nombre}</span>
                <span className="text-ink-soft">{TIPO_LABEL[c.tipo]}</span>
                <b className="num">{formatoMoneda(saldos.get(c.id) ?? 0)}</b>
                <button className="text-[12.5px] text-accent font-medium hover:underline text-right" onClick={() => setCuentaSeleccionada(c.id)}>
                  Ver movimientos
                </button>
                <div className="flex items-center justify-end gap-2.5">
                  <HistoryButton entidad="Cuenta" entidadId={c.id} titulo={c.nombre} />
                  {esAdmin && (
                    <button className="text-ink-faint hover:text-danger-dark" title="Eliminar cuenta" onClick={() => handleEliminar(c.nombre, c.id)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel p-5">
        <div className="th-label mb-2">Transferencias recientes</div>
        {transferencias.slice(0, 5).map((t) => {
          const origen = cuentas.find((c) => c.id === t.cuentaOrigenId);
          const destino = cuentas.find((c) => c.id === t.cuentaDestinoId);
          return (
            <div key={t.id} className="flex justify-between text-[13px] py-1.5 border-b border-line-soft last:border-0">
              <span className="text-ink-soft">
                <span className="num">{t.fecha}</span> · {origen?.nombre} → {destino?.nombre} {t.nota && `· ${t.nota}`}
              </span>
              <b className="num">{formatoMoneda(t.monto)}</b>
            </div>
          );
        })}
        {transferencias.length === 0 && <div className="text-ink-soft text-sm">Sin transferencias todavía.</div>}
      </div>

      {cuentaActiva && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-10 z-50 overflow-y-auto pb-10" onClick={() => setCuentaSeleccionada(null)}>
          <div className="panel w-[min(560px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <span className="font-semibold text-[15px]">{cuentaActiva.nombre}</span>
              <button onClick={() => setCuentaSeleccionada(null)} className="text-lg leading-none hover:text-accent">✕</button>
            </div>
            <div className="px-4 py-3 border-b border-line flex justify-between items-center bg-surface-2">
              <span className="th-label">Saldo actual</span>
              <span className="font-semibold text-lg num">{formatoMoneda(saldos.get(cuentaActiva.id) ?? 0)}</span>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              <div className="grid grid-cols-[.8fr_1.4fr_.8fr] gap-2 px-4 py-2 border-b border-line">
                {['Fecha', 'Movimiento', 'Monto'].map((h) => (
                  <span key={h} className="th-label">{h}</span>
                ))}
              </div>
              {movimientos.map((m, i) => (
                <div key={i} className="grid grid-cols-[.8fr_1.4fr_.8fr] gap-2 px-4 py-2 border-b border-line-soft text-[13px]">
                  <span className="text-ink-soft num">{m.fecha}</span>
                  <span>
                    {m.tipo} <span className="text-ink-faint">· {m.descripcion}</span>
                  </span>
                  <span className={`num ${m.monto < 0 ? 'text-danger-dark' : ''}`}>{formatoMoneda(m.monto)}</span>
                </div>
              ))}
              {movimientos.length === 0 && (
                <div className="px-4 py-8 text-ink-soft text-sm text-center">Sin movimientos todavía.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {transferenciaAbierta && <NuevaTransferenciaModal onClose={() => setTransferenciaAbierta(false)} />}
      {cuentaNuevaAbierta && <NuevaCuentaModal onClose={() => setCuentaNuevaAbierta(false)} />}
    </div>
  );
}

function NuevaTransferenciaModal({ onClose }: { onClose: () => void }) {
  const { cuentas, registrarTransferencia } = useDataStore();
  const [origenId, setOrigenId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [monto, setMonto] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const enviandoRef = useRef(false);

  function handleGuardar() {
    if (enviandoRef.current) return;
    const montoNumero = Number(monto);
    if (!origenId || !destinoId) return setError('Elegí cuenta de origen y destino.');
    if (origenId === destinoId) return setError('La cuenta de origen y destino no pueden ser la misma.');
    if (!monto || Number.isNaN(montoNumero) || montoNumero <= 0) return setError('El monto tiene que ser mayor a 0.');
    setError(null);
    enviandoRef.current = true;
    registrarTransferencia({ fecha: new Date().toISOString().slice(0, 10), cuentaOrigenId: origenId, cuentaDestinoId: destinoId, monto: montoNumero, nota: nota || undefined });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(440px,94vw)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Nueva transferencia</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="th-label mb-1">Desde</div>
              <CuentaSelect cuentas={cuentas} value={origenId} onChange={setOrigenId} incluirVacio />
            </div>
            <div>
              <div className="th-label mb-1">Hacia</div>
              <CuentaSelect cuentas={cuentas} value={destinoId} onChange={setDestinoId} incluirVacio />
            </div>
          </div>
          <div>
            <div className="th-label mb-1">Monto</div>
            <input type="number" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm num focus:outline-none focus:border-accent" />
          </div>
          <div>
            <div className="th-label mb-1">Nota (opcional)</div>
            <input value={nota} onChange={(e) => setNota(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
          </div>
          {error && <div className="text-danger-dark text-[12.5px]">{error}</div>}
          <button className="btn-accent w-fit" onClick={handleGuardar}>Guardar transferencia</button>
        </div>
      </div>
    </div>
  );
}

function NuevaCuentaModal({ onClose }: { onClose: () => void }) {
  const { agregarCuenta } = useDataStore();
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<TipoCuenta>('banco');
  const [saldoInicial, setSaldoInicial] = useState('0');

  function handleGuardar() {
    if (!nombre.trim()) return;
    agregarCuenta({ nombre: nombre.trim(), tipo, saldoInicial: Number(saldoInicial) || 0 });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(400px,94vw)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Nueva cuenta</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <div className="th-label mb-1">Nombre</div>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Wells Fargo" className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
          </div>
          <div>
            <div className="th-label mb-1.5">Tipo</div>
            <div className="flex gap-1.5 flex-wrap">
              {(Object.keys(TIPO_LABEL) as TipoCuenta[]).map((t) => (
                <button key={t} onClick={() => setTipo(t)} aria-pressed={tipo === t} className={tipo === t ? 'chip-accent' : 'chip'}>{TIPO_LABEL[t]}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="th-label mb-1">Saldo inicial</div>
            <input type="number" value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm num focus:outline-none focus:border-accent" />
          </div>
          <button className="btn-accent w-fit" onClick={handleGuardar} disabled={!nombre.trim()}>Guardar cuenta</button>
        </div>
      </div>
    </div>
  );
}
