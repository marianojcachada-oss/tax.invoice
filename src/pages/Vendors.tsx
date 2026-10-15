import { useMemo, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { calcularAntiguedadBills, diasDeAtraso, formatoMoneda, saldoPendiente } from '../lib/aging';
import { CreateBillModal } from '../components/CreateBillModal';
import { PayBillModal } from '../components/PayBillModal';
import { Pagination } from '../components/Pagination';
import { HistoryButton } from '../components/HistoryButton';
import { SortableHeader } from '../components/SortableHeader';
import { Trash2 } from 'lucide-react';
import type { Proveedor } from '../types';

type SubTab = 'proveedores' | 'bills';
type CampoOrdenProveedor = 'nombre' | 'saldo';

export function Vendors() {
  const [tab, setTab] = useState<SubTab>('proveedores');

  return (
    <div className="px-6 md:px-8 py-6 max-w-[1400px]">
      <div className="font-semibold text-xl mb-4">Proveedores</div>
      <div className="flex gap-5 border-b border-line mb-4">
        {(
          [
            ['proveedores', 'Proveedores'],
            ['bills', 'Bills (cuentas por pagar)'],
          ] as [SubTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`text-[13px] pb-2.5 font-medium transition-colors ${
              tab === id ? 'border-b-2 border-accent text-accent' : 'text-ink-faint hover:text-ink-soft border-b-2 border-transparent'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'proveedores' && <ProveedoresTab />}
      {tab === 'bills' && <BillsTab />}
    </div>
  );
}

function ProveedoresTab() {
  const { proveedores, bills, agregarProveedor, eliminarProveedor, usuarioActual } = useDataStore();
  const esAdmin = usuarioActual?.rol === 'admin';
  const antiguedad = useMemo(() => calcularAntiguedadBills(proveedores, bills), [proveedores, bills]);
  const saldoPorProveedor = useMemo(() => new Map(antiguedad.map((f) => [f.clienteId, f.total])), [antiguedad]);

  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [condiciones, setCondiciones] = useState('Net 30');
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
  const [ordenCampo, setOrdenCampo] = useState<CampoOrdenProveedor>('nombre');
  const [ordenDir, setOrdenDir] = useState<'asc' | 'desc'>('asc');

  function toggleOrden(campo: CampoOrdenProveedor) {
    if (ordenCampo === campo) {
      setOrdenDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrdenCampo(campo);
      setOrdenDir(campo === 'nombre' ? 'asc' : 'desc');
    }
  }

  const proveedoresOrdenados = useMemo(() => {
    const dir = ordenDir === 'asc' ? 1 : -1;
    return [...proveedores].sort((a, b) => {
      if (ordenCampo === 'saldo') {
        return ((saldoPorProveedor.get(a.id) ?? 0) - (saldoPorProveedor.get(b.id) ?? 0)) * dir;
      }
      return a.nombre.localeCompare(b.nombre) * dir;
    });
  }, [proveedores, saldoPorProveedor, ordenCampo, ordenDir]);

  function handleCrear() {
    if (!nombre.trim()) return;
    agregarProveedor({
      nombre: nombre.trim(),
      empresa: empresa || undefined,
      telefono: telefono || undefined,
      email: email || undefined,
      condicionesPago: condiciones,
      estado: 'activo',
    });
    setAbierto(false);
    setNombre('');
    setEmpresa('');
    setTelefono('');
    setEmail('');
  }

  async function handleEliminar(p: Proveedor) {
    if (!window.confirm(`¿Eliminar a ${p.nombre}? Esta acción no se puede deshacer.`)) return;
    const res = await eliminarProveedor(p.id);
    setErrorEliminar(res.ok ? null : res.motivo ?? 'No se pudo eliminar.');
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3.5">
        {errorEliminar ? <span className="text-danger-dark text-[12.5px]">{errorEliminar}</span> : <span />}
        <button className="btn-accent" onClick={() => setAbierto(true)}>Agregar proveedor</button>
      </div>
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[880px]">
            <div className="grid grid-cols-[1.2fr_1fr_1fr_.8fr_.7fr_80px] gap-2 px-5 py-2.5 border-b border-line bg-surface-2">
              <SortableHeader campo="nombre" activo={ordenCampo === 'nombre'} direccion={ordenDir} onClick={toggleOrden}>Proveedor</SortableHeader>
              <span className="th-label">Teléfono</span>
              <span className="th-label">Email</span>
              <span className="th-label">Condiciones</span>
              <SortableHeader campo="saldo" activo={ordenCampo === 'saldo'} direccion={ordenDir} onClick={toggleOrden}>Saldo</SortableHeader>
              <span className="th-label"></span>
            </div>
            {proveedoresOrdenados.map((p) => (
              <div key={p.id} className="grid grid-cols-[1.2fr_1fr_1fr_.8fr_.7fr_80px] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] items-center hover:bg-surface-2 transition-colors">
                <div>
                  <div className="font-medium">{p.nombre}</div>
                  {p.empresa && <div className="text-ink-faint text-[11px]">{p.empresa}</div>}
                </div>
                <span className="text-ink-soft num">{p.telefono ?? '—'}</span>
                <span className="text-ink-soft">{p.email ?? '—'}</span>
                <span className="text-ink-soft">{p.condicionesPago ?? '—'}</span>
                <span className={`num ${saldoPorProveedor.get(p.id) ? 'font-medium text-danger-dark' : ''}`}>
                  {formatoMoneda(saldoPorProveedor.get(p.id) ?? 0)}
                </span>
                <div className="flex items-center justify-end gap-2.5">
                  <HistoryButton entidad="Proveedor" entidadId={p.id} titulo={p.nombre} />
                  {esAdmin && (
                    <button className="text-ink-faint hover:text-danger-dark" title="Eliminar proveedor" onClick={() => handleEliminar(p)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {abierto && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50 overflow-y-auto pb-10" onClick={() => setAbierto(false)}>
          <div className="panel w-[min(440px,94vw)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <span className="font-semibold text-[15px]">Agregar proveedor</span>
              <button onClick={() => setAbierto(false)} className="text-lg leading-none hover:text-accent">✕</button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div>
                <div className="th-label mb-1">Nombre</div>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
              </div>
              <div>
                <div className="th-label mb-1">Empresa (opcional)</div>
                <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="th-label mb-1">Teléfono</div>
                  <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
                </div>
                <div>
                  <div className="th-label mb-1">Email</div>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
                </div>
              </div>
              <div>
                <div className="th-label mb-1">Condiciones de pago</div>
                <div className="flex gap-1.5">
                  {['Al contado', 'Net 15', 'Net 30'].map((c) => (
                    <button key={c} onClick={() => setCondiciones(c)} aria-pressed={condiciones === c} className={condiciones === c ? 'chip-accent' : 'chip'}>{c}</button>
                  ))}
                </div>
              </div>
              <button className="btn-accent w-fit" onClick={handleCrear} disabled={!nombre.trim()}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type FiltroBill = 'todas' | 'vencidas' | 'abiertas' | 'pagadas';
type CampoOrdenBill = 'fecha' | 'numero' | 'proveedor' | 'monto' | 'estado';

function BillsTab() {
  const { proveedores, bills } = useDataStore();
  const [filtro, setFiltro] = useState<FiltroBill>('todas');
  const [crearAbierto, setCrearAbierto] = useState(false);
  const [pagarProveedor, setPagarProveedor] = useState<Proveedor | null>(null);
  const [pagina, setPagina] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [ordenCampo, setOrdenCampo] = useState<CampoOrdenBill>('fecha');
  const [ordenDir, setOrdenDir] = useState<'asc' | 'desc'>('desc');
  const proveedorPorId = useMemo(() => new Map(proveedores.map((p) => [p.id, p])), [proveedores]);

  function toggleOrden(campo: CampoOrdenBill) {
    if (ordenCampo === campo) {
      setOrdenDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrdenCampo(campo);
      setOrdenDir(campo === 'proveedor' ? 'asc' : 'desc');
    }
    setPagina(1);
  }

  function urgenciaBill(b: (typeof bills)[number]): number {
    if (saldoPendiente(b) <= 0) return -1;
    return diasDeAtraso(b.fechaVencimiento);
  }

  const ordenadas = useMemo(() => {
    const dir = ordenDir === 'asc' ? 1 : -1;
    return [...bills].sort((a, b) => {
      if (ordenCampo === 'fecha') return (a.fechaVencimiento < b.fechaVencimiento ? -1 : 1) * dir;
      if (ordenCampo === 'numero') return (a.numero - b.numero) * dir;
      if (ordenCampo === 'monto') return (a.monto - b.monto) * dir;
      if (ordenCampo === 'estado') return (urgenciaBill(a) - urgenciaBill(b)) * dir;
      const nombreA = proveedorPorId.get(a.proveedorId)?.nombre ?? '';
      const nombreB = proveedorPorId.get(b.proveedorId)?.nombre ?? '';
      return nombreA.localeCompare(nombreB) * dir;
    });
  }, [bills, ordenCampo, ordenDir, proveedorPorId]);
  const filtradas = ordenadas.filter((b) => {
    const pendiente = saldoPendiente(b);
    if (filtro === 'vencidas') return pendiente > 0 && diasDeAtraso(b.fechaVencimiento) > 0;
    if (filtro === 'abiertas') return pendiente > 0;
    if (filtro === 'pagadas') return pendiente <= 0;
    return true;
  });
  const totalPendiente = ordenadas.reduce((a, b) => a + saldoPendiente(b), 0);
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / pageSize));
  const visibles = filtradas.slice((pagina - 1) * pageSize, pagina * pageSize);

  return (
    <div>
      <div className="flex justify-between items-center flex-wrap gap-2 mb-3.5">
        <div className="flex gap-1.5">
          {(
            [
              ['todas', 'Todas'],
              ['vencidas', 'Vencidas'],
              ['abiertas', 'Abiertas'],
              ['pagadas', 'Pagadas'],
            ] as [FiltroBill, string][]
          ).map(([v, l]) => (
            <button key={v} onClick={() => setFiltro(v)} aria-pressed={filtro === v} className={filtro === v ? 'chip-accent' : 'chip'}>{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-ink-soft text-[13px]">
            Total pendiente: <b className="text-danger-dark num">{formatoMoneda(totalPendiente)}</b>
          </span>
          <button className="btn-accent" onClick={() => setCrearAbierto(true)}>Nueva bill</button>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[880px]">
            <div className="grid grid-cols-[.7fr_.6fr_1.3fr_1fr_.7fr_1fr_120px] gap-2 px-5 py-2.5 border-b border-line bg-surface-2">
              <SortableHeader campo="fecha" activo={ordenCampo === 'fecha'} direccion={ordenDir} onClick={toggleOrden}>Fecha</SortableHeader>
              <SortableHeader campo="numero" activo={ordenCampo === 'numero'} direccion={ordenDir} onClick={toggleOrden}>N°</SortableHeader>
              <SortableHeader campo="proveedor" activo={ordenCampo === 'proveedor'} direccion={ordenDir} onClick={toggleOrden}>Proveedor</SortableHeader>
              <span className="th-label">Concepto</span>
              <SortableHeader campo="monto" activo={ordenCampo === 'monto'} direccion={ordenDir} onClick={toggleOrden}>Monto</SortableHeader>
              <SortableHeader campo="estado" activo={ordenCampo === 'estado'} direccion={ordenDir} onClick={toggleOrden}>Estado</SortableHeader>
              <span className="th-label"></span>
            </div>

            {visibles.map((b) => {
              const proveedor = proveedorPorId.get(b.proveedorId);
              const pendiente = saldoPendiente(b);
              const dias = diasDeAtraso(b.fechaVencimiento);
              return (
                <div key={b.id} className="grid grid-cols-[.7fr_.6fr_1.3fr_1fr_.7fr_1fr_120px] gap-2 items-center px-5 py-2.5 border-b border-line-soft text-[13px] hover:bg-surface-2 transition-colors">
                  <span className="text-ink-soft num">{b.fechaVencimiento}</span>
                  <span className="text-ink-faint num">{b.numero}</span>
                  <span className="font-medium">{proveedor?.nombre ?? '—'}</span>
                  <span className="text-ink-soft">{b.concepto}</span>
                  <span className="num">{formatoMoneda(b.monto)}</span>
                  <span>
                    {pendiente <= 0 ? (
                      <span className="chip-success w-fit">Pagada</span>
                    ) : dias > 0 ? (
                      <span className="chip-danger w-fit">Vencida hace {dias} d</span>
                    ) : (
                      <span className="chip w-fit">Abierta</span>
                    )}
                  </span>
                  <div className="flex items-center justify-end gap-2.5">
                    {pendiente > 0 && proveedor && (
                      <button className="text-[12.5px] text-accent font-medium hover:underline" onClick={() => setPagarProveedor(proveedor)}>
                        Pagar
                      </button>
                    )}
                    <HistoryButton entidad="Bill" entidadId={b.id} titulo={`Bill #${b.numero}`} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Pagination
          pagina={pagina}
          totalPaginas={totalPaginas}
          totalItems={filtradas.length}
          pageSize={pageSize}
          onPageChange={setPagina}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPagina(1);
          }}
          etiqueta="bills"
        />
      </div>

      {crearAbierto && <CreateBillModal onClose={() => setCrearAbierto(false)} />}
      {pagarProveedor && <PayBillModal proveedorId={pagarProveedor.id} onClose={() => setPagarProveedor(null)} />}
    </div>
  );
}
