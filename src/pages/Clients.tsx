import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDataStore } from '../data/DataContext';
import { calcularAntiguedad, formatoSaldoConSigno } from '../lib/aging';
import { PaymentModal } from '../components/PaymentModal';
import { CreateInvoiceModal } from '../components/CreateInvoiceModal';
import { CreateCreditMemoModal } from '../components/CreateCreditMemoModal';
import { ClientFormModal } from '../components/ClientFormModal';
import { ImportClientsModal } from '../components/ImportClientsModal';
import { Pagination } from '../components/Pagination';
import { SortableHeader } from '../components/SortableHeader';

type Filtro = 'todos' | 'activos' | 'mora' | 'inactivos';
type CampoOrdenCliente = 'nombre' | 'saldo' | 'estado';

export function Clients() {
  const { clientes, facturas, notasCredito } = useDataStore();
  const navigate = useNavigate();
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [ordenCampo, setOrdenCampo] = useState<CampoOrdenCliente>('nombre');
  const [ordenDir, setOrdenDir] = useState<'asc' | 'desc'>('asc');
  const [pagina, setPagina] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [modalClienteId, setModalClienteId] = useState<string | null>(null);
  const [crearFacturaClienteId, setCrearFacturaClienteId] = useState<string | null>(null);
  const [notaCreditoClienteId, setNotaCreditoClienteId] = useState<string | null>(null);
  const [formularioAbierto, setFormularioAbierto] = useState(false);
  const [importarAbierto, setImportarAbierto] = useState(false);

  function toggleOrden(campo: CampoOrdenCliente) {
    if (ordenCampo === campo) {
      setOrdenDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrdenCampo(campo);
      setOrdenDir(campo === 'nombre' ? 'asc' : 'desc');
    }
    setPagina(1);
  }

  const deudas = useMemo(() => {
    const filas = calcularAntiguedad(clientes, facturas);
    return new Map(filas.map((f) => [f.clienteId, f.total]));
  }, [clientes, facturas]);

  const creditos = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notasCredito) {
      const disponible = Math.max(0, n.monto - n.montoAplicado);
      if (disponible > 0) m.set(n.clienteId, (m.get(n.clienteId) ?? 0) + disponible);
    }
    return m;
  }, [notasCredito]);

  const saldos = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clientes) {
      const neto = (creditos.get(c.id) ?? 0) - (deudas.get(c.id) ?? 0);
      m.set(c.id, neto);
    }
    return m;
  }, [clientes, deudas, creditos]);

  function cuentaFiltro(v: Filtro): number {
    if (v === 'activos') return clientes.filter((c) => c.estado === 'activo').length;
    if (v === 'inactivos') return clientes.filter((c) => c.estado === 'inactivo').length;
    if (v === 'mora') return clientes.filter((c) => (deudas.get(c.id) ?? 0) > 0).length;
    return clientes.length;
  }

  const filtrados = useMemo(() => {
    const base = clientes.filter((c) => {
      const deuda = deudas.get(c.id) ?? 0;
      if (filtro === 'activos' && c.estado !== 'activo') return false;
      if (filtro === 'mora' && deuda <= 0) return false;
      if (filtro === 'inactivos' && c.estado !== 'inactivo') return false;
      if (busqueda) {
        const q = busqueda.toLowerCase();
        const matches =
          c.nombre.toLowerCase().includes(q) ||
          c.codigo.toLowerCase().includes(q) ||
          c.numero.includes(q) ||
          c.telefonos.toLowerCase().includes(q) ||
          c.licenciaInfo.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });

    const dir = ordenDir === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      if (ordenCampo === 'nombre') return a.nombre.localeCompare(b.nombre) * dir;
      if (ordenCampo === 'estado') return a.estado.localeCompare(b.estado) * dir;
      const saldoA = saldos.get(a.id) ?? 0;
      const saldoB = saldos.get(b.id) ?? 0;
      return (saldoA - saldoB) * dir;
    });
  }, [clientes, deudas, saldos, filtro, busqueda, ordenCampo, ordenDir]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / pageSize));
  const visibles = filtrados.slice((pagina - 1) * pageSize, pagina * pageSize);

  return (
    <div className="px-6 md:px-8 py-6 max-w-[1400px]">
      <div className="flex justify-between items-center flex-wrap gap-3 mb-5">
        <div>
          <div className="font-semibold text-xl">Clientes</div>
          <div className="text-ink-soft text-[13px]">
            {clientes.length} en total · {clientes.filter((c) => c.estado === 'activo').length} activos
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => setImportarAbierto(true)}>Importar clientes</button>
          <button className="btn-accent" onClick={() => setFormularioAbierto(true)}>Agregar cliente</button>
        </div>
      </div>

      <div className="flex gap-2 items-center flex-wrap mb-3.5">
        <input
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setPagina(1);
          }}
          placeholder="Buscar por nombre, código, teléfono o licencia"
          className="flex-1 min-w-[220px] border border-line rounded-[5px] bg-surface px-3 py-1.5 text-[13px] focus:outline-none focus:border-accent"
        />
        {(
          [
            ['todos', 'Todos'],
            ['activos', 'Activos'],
            ['mora', 'Con deuda'],
            ['inactivos', 'Inactivos'],
          ] as [Filtro, string][]
        ).map(([valor, etiqueta]) => (
          <button
            key={valor}
            onClick={() => {
              setFiltro(valor);
              setPagina(1);
            }}
            aria-pressed={filtro === valor} className={filtro === valor ? 'chip-accent' : 'chip'}
          >
            {etiqueta} · {cuentaFiltro(valor)}
          </button>
        ))}
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[880px]">
            <div className="grid grid-cols-[1.4fr_1.3fr_1fr_.6fr_.7fr_190px] gap-3 px-5 py-2.5 border-b border-line bg-surface-2">
              <SortableHeader campo="nombre" activo={ordenCampo === 'nombre'} direccion={ordenDir} onClick={toggleOrden}>Cliente</SortableHeader>
              <span className="th-label">Licencia</span>
              <span className="th-label">Teléfono(s)</span>
              <SortableHeader campo="saldo" activo={ordenCampo === 'saldo'} direccion={ordenDir} onClick={toggleOrden}>Saldo</SortableHeader>
              <SortableHeader campo="estado" activo={ordenCampo === 'estado'} direccion={ordenDir} onClick={toggleOrden}>Estado</SortableHeader>
              <span className="th-label"></span>
            </div>

            {visibles.map((c) => {
              const deuda = deudas.get(c.id) ?? 0;
              const saldoNeto = saldos.get(c.id) ?? 0;
              return (
                <div
                  key={c.id}
                  className="grid grid-cols-[1.4fr_1.3fr_1fr_.6fr_.7fr_190px] gap-3 px-5 py-2.5 border-b border-line-soft text-[13px] items-center hover:bg-surface-2 transition-colors"
                >
                  <span onClick={() => navigate(`/clientes/${c.id}`)} className="cursor-pointer min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="num font-semibold text-[13px] bg-surface-2 border border-line rounded-[4px] px-1.5 shrink-0">{c.codigo}</span>
                      <span className="font-medium truncate">{c.nombre}</span>
                    </span>
                  </span>
                  <span className="text-ink-soft text-[12px] truncate">{c.licenciaInfo}</span>
                  <span className="text-ink-soft text-[12px] num">{c.telefonos}</span>
                  <span className={`num font-medium ${saldoNeto < 0 ? 'text-danger-dark' : saldoNeto > 0 ? 'text-success' : 'text-ink-soft'}`}>
                    {formatoSaldoConSigno(saldoNeto)}
                    <span className="block text-[11px] font-normal text-ink-soft">{saldoNeto < 0 ? 'Debe' : saldoNeto > 0 ? 'A favor' : 'Al día'}</span>
                  </span>
                  <span>
                    {c.estado === 'activo' ? (
                      <span className="chip-success w-fit">Activo</span>
                    ) : (
                      <span className="chip w-fit">Dado de baja</span>
                    )}
                  </span>
                  <div className="flex flex-col items-end gap-0.5">
                    {deuda > 0 ? (
                      <button className="text-[12.5px] text-accent font-medium hover:underline whitespace-nowrap" onClick={() => setModalClienteId(c.id)}>
                        Recibir pago
                      </button>
                    ) : (
                      <button className="text-[12.5px] font-medium hover:underline whitespace-nowrap" onClick={() => setCrearFacturaClienteId(c.id)}>
                        Crear factura
                      </button>
                    )}
                    <button className="text-[11.5px] text-ink-faint hover:underline hover:text-ink-soft whitespace-nowrap" onClick={() => setNotaCreditoClienteId(c.id)}>
                      + Nota de crédito
                    </button>
                  </div>
                </div>
              );
            })}

            {visibles.length === 0 && (
              <div className="px-5 py-10 text-center text-ink-soft text-sm">
                {clientes.length === 0 ? (
                  <>Todavía no hay clientes. Usá <b>Importar clientes</b> (CSV o Excel) o <b>Agregar cliente</b>.</>
                ) : (
                  <>Ningún cliente coincide. {(busqueda || filtro !== 'todos') && <button className="text-accent underline" onClick={() => { setBusqueda(''); setFiltro('todos'); }}>Limpiar búsqueda y filtros</button>}</>
                )}
              </div>
            )}
          </div>
        </div>

        <Pagination
          pagina={pagina}
          totalPaginas={totalPaginas}
          totalItems={filtrados.length}
          pageSize={pageSize}
          onPageChange={setPagina}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPagina(1);
          }}
          etiqueta="clientes"
        />
      </div>

      {modalClienteId && (
        <PaymentModal clienteId={modalClienteId} onClose={() => setModalClienteId(null)} />
      )}
      {crearFacturaClienteId && (
        <CreateInvoiceModal
          clienteId={crearFacturaClienteId}
          onClose={() => setCrearFacturaClienteId(null)}
        />
      )}
      {formularioAbierto && <ClientFormModal onClose={() => setFormularioAbierto(false)} />}
      {importarAbierto && <ImportClientsModal onClose={() => setImportarAbierto(false)} />}
      {notaCreditoClienteId && (
        <CreateCreditMemoModal clienteId={notaCreditoClienteId} onClose={() => setNotaCreditoClienteId(null)} />
      )}
    </div>
  );
}
