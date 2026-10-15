import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDataStore } from '../data/DataContext';
import { estadoFacturaTexto, formatoMoneda, saldoPendiente, diasDeAtraso } from '../lib/aging';
import { PaymentModal } from '../components/PaymentModal';
import { PaymentReceiptModal } from '../components/PaymentReceiptModal';
import { EditPaymentModal } from '../components/EditPaymentModal';
import { CreateInvoiceModal } from '../components/CreateInvoiceModal';
import { GenerateWeeklyInvoicesModal } from '../components/GenerateWeeklyInvoicesModal';
import { InvoiceModal } from '../components/InvoiceModal';
import { ClienteSelect } from '../components/ClienteSelect';
import { CreateCreditMemoModal } from '../components/CreateCreditMemoModal';
import { EditCreditMemoModal } from '../components/EditCreditMemoModal';
import { ApplyCreditMemoModal } from '../components/ApplyCreditMemoModal';
import { Pagination } from '../components/Pagination';
import { SortableHeader } from '../components/SortableHeader';
import { HistoryButton } from '../components/HistoryButton';
import { AlertCircle, CheckCircle2, Clock, FileText, Mail, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import type { MetodoPago, Pago, NotaCredito, PagoEmail, Cliente } from '../types';

type SubTab = 'facturas' | 'pagos' | 'notas' | 'reembolsos' | 'bandeja';

const SUBTABS: { id: SubTab; label: string }[] = [
  { id: 'facturas', label: 'Facturas' },
  { id: 'pagos', label: 'Pagos' },
  { id: 'notas', label: 'Notas de crédito' },
  { id: 'reembolsos', label: 'Reembolsos' },
  { id: 'bandeja', label: 'Pagos ingresados por mail' },
];

export function Sales() {
  const [tab, setTab] = useState<SubTab>('facturas');
  const { usuarioActual, getPagosEmail } = useDataStore();
  const [mailsPend, setMailsPend] = useState(0);
  const [mailsRojos, setMailsRojos] = useState(0);
  useEffect(() => {
    if (usuarioActual?.rol !== 'admin') return;
    let vivo = true;
    const cargar = () => getPagosEmail().then((l) => { if (!vivo) return; const pend = l.filter((p) => p.estado === 'pendiente'); setMailsPend(pend.length); setMailsRojos(pend.filter((p) => p.resultado && p.resultado !== 'aprobado').length); }).catch(() => {});
    cargar();
    const t = setInterval(cargar, 30000);
    return () => { vivo = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioActual?.rol, tab]);
  const subtabs = SUBTABS.filter((t) => t.id !== 'bandeja' || usuarioActual?.rol === 'admin');

  return (
    <div className="px-6 md:px-8 py-6 max-w-[1400px]">
      <div className="font-semibold text-xl mb-4">Cobros</div>
      <div className="flex gap-5 border-b border-line mb-4">
        {subtabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`text-[13px] pb-2.5 min-h-[32px] font-medium transition-colors ${
              tab === t.id ? 'border-b-2 border-accent text-accent' : 'text-ink-faint hover:text-ink-soft border-b-2 border-transparent'
            }`}
          >
            {t.label}
            {t.id === 'bandeja' && mailsPend > 0 && <span className={`ml-2 rounded-full text-[11px] font-semibold px-2 py-px num ${mailsRojos > 0 ? 'bg-danger text-white' : 'bg-accent text-on-accent'}`}>{mailsPend}{mailsRojos > 0 ? ` · ${mailsRojos} ⚠` : ''}</span>}
          </button>
        ))}
      </div>

      {tab === 'facturas' && <FacturasTab />}
      {tab === 'pagos' && <PagosTab />}
      {tab === 'notas' && <NotasCreditoTab />}
      {tab === 'reembolsos' && <ReembolsosTab />}
      {tab === 'bandeja' && <BandejaPagosEmailTab />}
    </div>
  );
}

// ── Facturas: la vista global de "cuentas por cobrar" con overdue/paid ──
type FiltroFactura = 'todas' | 'vencidas' | 'pendientes' | 'pagadas';
type CampoOrdenFactura = 'fecha' | 'numero' | 'cliente' | 'estado';

function FacturasTab() {
  const { clientes, facturas } = useDataStore();
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState<FiltroFactura>('todas');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [ordenCampo, setOrdenCampo] = useState<CampoOrdenFactura>('fecha');
  const [ordenDir, setOrdenDir] = useState<'asc' | 'desc'>('desc');
  const [pagina, setPagina] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [modalClienteId, setModalClienteId] = useState<string | null>(null);
  const [crearFacturaAbierto, setCrearFacturaAbierto] = useState(false);
  const [generarSemanalAbierto, setGenerarSemanalAbierto] = useState(false);
  const [facturaVerAbierta, setFacturaVerAbierta] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [confirmarRecs, setConfirmarRecs] = useState(false);
  const [resultadoRecs, setResultadoRecs] = useState<string | null>(null);
  const { enviarRecordatorioCliente } = useDataStore();

  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);

  function toggleOrden(campo: CampoOrdenFactura) {
    if (ordenCampo === campo) {
      setOrdenDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrdenCampo(campo);
      setOrdenDir(campo === 'cliente' ? 'asc' : 'desc');
    }
    setPagina(1);
  }

  function urgencia(f: (typeof facturas)[number]): number {
    if (saldoPendiente(f) <= 0) return -1;
    return diasDeAtraso(f.fechaVencimiento);
  }

  const filtradas = useMemo(() => {
    let base = facturas.filter((f) => {
      const pendiente = saldoPendiente(f);
      if (filtro === 'vencidas' && !(pendiente > 0 && diasDeAtraso(f.fechaVencimiento) > 0)) return false;
      if (filtro === 'pendientes' && !(pendiente > 0)) return false;
      if (filtro === 'pagadas' && !(pendiente <= 0)) return false;
      if (fechaDesde && f.fechaVencimiento < fechaDesde) return false;
      if (fechaHasta && f.fechaVencimiento > fechaHasta) return false;
      return true;
    });

    const dir = ordenDir === 'asc' ? 1 : -1;
    base = [...base].sort((a, b) => {
      if (ordenCampo === 'fecha') return a.fechaVencimiento < b.fechaVencimiento ? -dir : dir;
      if (ordenCampo === 'numero') return (a.numero - b.numero) * dir;
      if (ordenCampo === 'estado') return (urgencia(a) - urgencia(b)) * dir;
      const nombreA = clientePorId.get(a.clienteId)?.nombre ?? '';
      const nombreB = clientePorId.get(b.clienteId)?.nombre ?? '';
      return nombreA.localeCompare(nombreB) * dir;
    });
    return base;
  }, [facturas, filtro, fechaDesde, fechaHasta, ordenCampo, ordenDir, clientePorId]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / pageSize));
  const visibles = filtradas.slice((pagina - 1) * pageSize, pagina * pageSize);

  const cuentaFiltro = (v: FiltroFactura) =>
    facturas.filter((f) => {
      const p = saldoPendiente(f);
      if (v === 'vencidas') return p > 0 && diasDeAtraso(f.fechaVencimiento) > 0;
      if (v === 'pendientes') return p > 0;
      if (v === 'pagadas') return p <= 0;
      return true;
    }).length;

  const seleccionadas = facturas.filter((f) => seleccion.has(f.id));
  const totalSeleccion = seleccionadas.reduce((a, f) => a + saldoPendiente(f), 0);
  // un recordatorio por cliente (con saldo y activo), no por factura
  const clientesARecordar = [...new Set(seleccionadas.filter((f) => saldoPendiente(f) > 0).map((f) => f.clienteId))]
    .map((id) => clientePorId.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c && c.estado === 'activo');

  async function enviarRecordatorios() {
    setConfirmarRecs(false);
    let ok = 0;
    for (const c of clientesARecordar) {
      const r = await enviarRecordatorioCliente(c.id);
      if (r.enviado) ok += 1;
    }
    setResultadoRecs(`Enviados ${ok} de ${clientesARecordar.length}`);
    setSeleccion(new Set());
    setTimeout(() => setResultadoRecs(null), 6000);
  }

  const totalVencido = facturas
    .filter((f) => saldoPendiente(f) > 0 && diasDeAtraso(f.fechaVencimiento) > 0)
    .reduce((a, f) => a + saldoPendiente(f), 0);

  return (
    <div>
      <div className="flex justify-between items-center flex-wrap gap-2 mb-3.5">
        <div className="flex gap-1.5 items-center flex-wrap">
          {(
            [
              ['todas', 'Todas'],
              ['vencidas', 'Vencidas'],
              ['pendientes', 'Pendientes'],
              ['pagadas', 'Pagadas'],
            ] as [FiltroFactura, string][]
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
          <span className="text-ink-faint text-[11.5px] ml-2">Vencimiento:</span>
          {(
            [
              ['hoy', 'Hoy'],
              ['ayer', 'Ayer'],
              ['semana', 'Esta semana'],
              ['mes', 'Este mes'],
            ] as [string, string][]
          ).map(([clave, etiqueta]) => (
            <button
              key={clave}
              className="chip"
              onClick={() => {
                const hoy = new Date();
                const aISO = (d: Date) => d.toISOString().slice(0, 10);
                if (clave === 'hoy') {
                  setFechaDesde(aISO(hoy));
                  setFechaHasta(aISO(hoy));
                } else if (clave === 'ayer') {
                  const ayer = new Date(hoy);
                  ayer.setDate(ayer.getDate() - 1);
                  setFechaDesde(aISO(ayer));
                  setFechaHasta(aISO(ayer));
                } else if (clave === 'semana') {
                  const inicio = new Date(hoy);
                  const diaSemana = (inicio.getDay() + 6) % 7;
                  inicio.setDate(inicio.getDate() - diaSemana);
                  setFechaDesde(aISO(inicio));
                  setFechaHasta(aISO(hoy));
                } else {
                  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
                  setFechaDesde(aISO(inicio));
                  setFechaHasta(aISO(hoy));
                }
                setPagina(1);
              }}
            >
              {etiqueta}
            </button>
          ))}
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => {
              setFechaDesde(e.target.value);
              setPagina(1);
            }}
            className="border border-line rounded-[5px] bg-surface px-2 py-1 text-[12.5px] num focus:outline-none focus:border-accent"
          />
          <span className="text-ink-faint text-[11.5px]">a</span>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => {
              setFechaHasta(e.target.value);
              setPagina(1);
            }}
            className="border border-line rounded-[5px] bg-surface px-2 py-1 text-[12.5px] num focus:outline-none focus:border-accent"
          />
          {(fechaDesde || fechaHasta) && (
            <button
              className="text-[12px] text-ink-soft hover:underline"
              onClick={() => {
                setFechaDesde('');
                setFechaHasta('');
              }}
            >
              Limpiar
            </button>
          )}
        </div>
        <span className="text-ink-soft text-[13px] flex items-center gap-3">
          Total vencido: <b className="text-danger-dark num">{formatoMoneda(totalVencido)}</b>
          <button className="btn-outline" onClick={() => setGenerarSemanalAbierto(true)}>
            Generar facturas de la semana
          </button>
          <button className="btn-accent" onClick={() => setCrearFacturaAbierto(true)}>
            Crear factura
          </button>
        </span>
      </div>

      {(seleccion.size > 0 || resultadoRecs) && (
        <div role="status" className="flex items-center gap-3 flex-wrap bg-success-bg border border-accent rounded-[6px] px-3.5 py-2 mb-3 text-[13px]">
          {resultadoRecs ? (
            <b>{resultadoRecs}</b>
          ) : (
            <>
              <b>{seleccion.size} seleccionada{seleccion.size === 1 ? '' : 's'}</b>
              <span className="text-ink-soft">Saldo {formatoMoneda(totalSeleccion)}</span>
              <span className="ml-auto flex gap-2">
                <button className="btn-accent" disabled={clientesARecordar.length === 0} onClick={() => setConfirmarRecs(true)}>Enviar recordatorio…</button>
                <button className="btn-outline" onClick={() => setSeleccion(new Set())}>Limpiar</button>
              </span>
            </>
          )}
        </div>
      )}

      {confirmarRecs && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center pt-20 z-50" onClick={() => setConfirmarRecs(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="conf-recs" className="panel w-[min(460px,94vw)] shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div id="conf-recs" className="font-semibold text-[15px] mb-1">¿Enviar recordatorio a {clientesARecordar.length} cliente{clientesARecordar.length === 1 ? '' : 's'}?</div>
            <p className="text-ink-soft text-[13px] mb-3">Un mail por cliente activo con saldo. No se puede deshacer.</p>
            <ul className="max-h-48 overflow-y-auto border border-line rounded-[5px] divide-y divide-line-soft mb-4">
              {clientesARecordar.map((c) => (
                <li key={c.id} className="px-3 py-1.5 text-[12.5px]"><span className="num font-semibold mr-2">{c.codigo}</span>{c.nombre}</li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setConfirmarRecs(false)}>Cancelar</button>
              <button className="btn-accent" autoFocus onClick={enviarRecordatorios}>Enviar {clientesARecordar.length}</button>
            </div>
          </div>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[940px]">
            <div className="grid grid-cols-[28px_.7fr_.55fr_1.3fr_.55fr_.65fr_.9fr_190px] gap-2 px-5 py-2.5 border-b border-line bg-surface-2 items-center">
              <input type="checkbox" aria-label="Seleccionar todas las de esta página" checked={visibles.length > 0 && visibles.every((f) => seleccion.has(f.id))} onChange={(e) => setSeleccion((prev) => { const n = new Set(prev); visibles.forEach((f) => (e.target.checked ? n.add(f.id) : n.delete(f.id))); return n; })} />
              <SortableHeader campo="fecha" activo={ordenCampo === 'fecha'} direccion={ordenDir} onClick={toggleOrden}>Fecha</SortableHeader>
              <SortableHeader campo="numero" activo={ordenCampo === 'numero'} direccion={ordenDir} onClick={toggleOrden}>N°</SortableHeader>
              <SortableHeader campo="cliente" activo={ordenCampo === 'cliente'} direccion={ordenDir} onClick={toggleOrden}>Cliente</SortableHeader>
              <span className="th-label">Monto</span>
              <span className="th-label">Saldo</span>
              <SortableHeader campo="estado" activo={ordenCampo === 'estado'} direccion={ordenDir} onClick={toggleOrden}>Estado</SortableHeader>
              <span className="th-label"></span>
            </div>

            {visibles.map((f) => {
              const cliente = clientePorId.get(f.clienteId);
              if (!cliente) return null;
              const { lineas, tono } = estadoFacturaTexto(f);
              const pagada = saldoPendiente(f) <= 0;
              return (
                <div
                  key={f.id}
                  className="grid grid-cols-[28px_.7fr_.55fr_1.3fr_.55fr_.65fr_.9fr_190px] gap-2 items-center px-5 py-2.5 border-b border-line-soft text-[13px] hover:bg-surface-2 transition-colors"
                >
                  <input type="checkbox" aria-label={`Seleccionar ${cliente.codigo}`} checked={seleccion.has(f.id)} onChange={(e) => setSeleccion((prev) => { const n = new Set(prev); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n; })} />
                  <span className="text-ink-soft num">{f.fechaVencimiento}</span>
                  <span className="text-ink-faint num">{f.numero}</span>
                  <span className="cursor-pointer hover:underline" onClick={() => navigate(`/clientes/${cliente.id}`)}>
                    <div className="flex items-baseline gap-2 font-medium">
                      <span className="num font-semibold bg-surface-2 border border-line rounded-[4px] px-1.5 shrink-0">{cliente.codigo}</span>
                      <span className="truncate">{cliente.nombre}</span>
                    </div>
                    <div className="text-ink-faint text-[11px] font-normal">{f.concepto}</div>
                  </span>
                  <span className="num">{formatoMoneda(f.monto)}</span>
                  <span className={`num ${pagada ? 'text-ink-faint' : 'font-medium'}`}>{formatoMoneda(saldoPendiente(f))}</span>
                  <span>
                    {lineas.map((l, i) => (
                      <div
                        key={i}
                        className={
                          i === 0
                            ? tono === 'alerta'
                              ? 'text-danger-dark flex items-center gap-1'
                              : 'flex items-center gap-1'
                            : 'text-ink-faint text-[11px]'
                        }
                      >
                        {i === 0 && tono === 'alerta' && <AlertCircle size={13} />}
                        {i === 0 && tono === 'ok' && <CheckCircle2 size={13} />}
                        {i === 0 && tono === 'neutro' && <Clock size={13} />}
                        {l}
                      </div>
                    ))}
                  </span>
                  <div className="flex gap-3 justify-end whitespace-nowrap">
                    <button className="text-[12.5px] font-medium hover:underline flex items-center gap-1" onClick={() => setFacturaVerAbierta(f.id)}>
                      <FileText size={13} /> Ver factura
                    </button>
                    {!pagada && (
                      <button className="text-[12.5px] text-accent font-medium hover:underline" onClick={() => setModalClienteId(cliente.id)}>
                        Recibir pago
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {visibles.length === 0 && (
              <div className="px-5 py-10 text-center text-ink-soft text-sm">
                No hay facturas con estos filtros. Probá otro estado o rango de fechas, o usá <b>Generar facturas de la semana</b>.
              </div>
            )}
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
          etiqueta="facturas"
        />
      </div>

      {modalClienteId && <PaymentModal clienteId={modalClienteId} onClose={() => setModalClienteId(null)} />}
      {crearFacturaAbierto && <CreateInvoiceModal onClose={() => setCrearFacturaAbierto(false)} />}
      {generarSemanalAbierto && <GenerateWeeklyInvoicesModal onClose={() => setGenerarSemanalAbierto(false)} />}
      {facturaVerAbierta && <InvoiceModal facturaId={facturaVerAbierta} onClose={() => setFacturaVerAbierta(null)} />}
    </div>
  );
}

// ── Pagos ──
type CampoOrdenPago = 'numero' | 'fecha' | 'cliente' | 'monto';

function PagosTab() {
  const { pagos, clientes, usuarioActual } = useDataStore();
  const esAdmin = usuarioActual?.rol === 'admin';
  const navigate = useNavigate();
  const [pagina, setPagina] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [reciboAbierto, setReciboAbierto] = useState<Pago | null>(null);
  const [editarAbierto, setEditarAbierto] = useState<Pago | null>(null);
  const [nuevoPagoAbierto, setNuevoPagoAbierto] = useState(false);
  const [ordenCampo, setOrdenCampo] = useState<CampoOrdenPago>('fecha');
  const [ordenDir, setOrdenDir] = useState<'asc' | 'desc'>('desc');
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);

  function toggleOrden(campo: CampoOrdenPago) {
    if (ordenCampo === campo) {
      setOrdenDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrdenCampo(campo);
      setOrdenDir(campo === 'cliente' ? 'asc' : 'desc');
    }
    setPagina(1);
  }

  const ordenados = useMemo(() => {
    const dir = ordenDir === 'asc' ? 1 : -1;
    return [...pagos].sort((a, b) => {
      if (ordenCampo === 'numero') return (a.numero - b.numero) * dir;
      if (ordenCampo === 'monto') return (a.monto - b.monto) * dir;
      if (ordenCampo === 'cliente') {
        const nombreA = clientePorId.get(a.clienteId)?.nombre ?? '';
        const nombreB = clientePorId.get(b.clienteId)?.nombre ?? '';
        return nombreA.localeCompare(nombreB) * dir;
      }
      return (a.fecha < b.fecha ? -1 : 1) * dir;
    });
  }, [pagos, ordenCampo, ordenDir, clientePorId]);
  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / pageSize));
  const visibles = ordenados.slice((pagina - 1) * pageSize, pagina * pageSize);

  return (
    <div>
      <div className="flex justify-end mb-3.5">
        <button className="btn-accent" onClick={() => setNuevoPagoAbierto(true)}>
          Registrar pago
        </button>
      </div>
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[880px]">
            <div className="grid grid-cols-[.6fr_.8fr_1.6fr_.8fr_1fr_.7fr_140px] gap-2 px-5 py-2.5 border-b border-line bg-surface-2">
              <SortableHeader campo="numero" activo={ordenCampo === 'numero'} direccion={ordenDir} onClick={toggleOrden}>N°</SortableHeader>
              <SortableHeader campo="fecha" activo={ordenCampo === 'fecha'} direccion={ordenDir} onClick={toggleOrden}>Fecha</SortableHeader>
              <SortableHeader campo="cliente" activo={ordenCampo === 'cliente'} direccion={ordenDir} onClick={toggleOrden}>Cliente</SortableHeader>
              <span className="th-label">Método</span>
              <span className="th-label">Referencia</span>
              <SortableHeader campo="monto" activo={ordenCampo === 'monto'} direccion={ordenDir} onClick={toggleOrden}>Monto</SortableHeader>
              <span className="th-label"></span>
            </div>
            {visibles.map((p) => {
              const cliente = clientePorId.get(p.clienteId);
              return (
                <div key={p.id} className="grid grid-cols-[.6fr_.8fr_1.6fr_.8fr_1fr_.7fr_140px] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] items-center hover:bg-surface-2 transition-colors">
                  <span className="text-ink-faint num">{p.numero}</span>
                  <span className="num">{p.fecha}</span>
                  <span className="cursor-pointer hover:underline font-medium" onClick={() => cliente && navigate(`/clientes/${cliente.id}`)}>
                    {cliente ? `${cliente.codigo} ${cliente.nombre}` : '—'}
                  </span>
                  <span className="capitalize">
                    {p.metodo}
                    {p.editado && <span className="chip ml-1.5 text-[10px]">corregido</span>}
                  </span>
                  <span className="text-ink-soft num">{p.referencia ?? '—'}</span>
                  <b className="num">{formatoMoneda(p.monto)}</b>
                  <div className="flex gap-3 justify-end">
                    {esAdmin && (
                      <button className="text-[12.5px] font-medium hover:underline" onClick={() => setEditarAbierto(p)}>
                        Editar
                      </button>
                    )}
                    <button className="text-[12.5px] text-accent font-medium hover:underline" onClick={() => setReciboAbierto(p)}>
                      Ver recibo
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <Pagination
          pagina={pagina}
          totalPaginas={totalPaginas}
          totalItems={ordenados.length}
          pageSize={pageSize}
          onPageChange={setPagina}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPagina(1);
          }}
          etiqueta="pagos"
        />
      </div>
      {reciboAbierto && <PaymentReceiptModal pago={reciboAbierto} onClose={() => setReciboAbierto(null)} />}
      {editarAbierto && <EditPaymentModal pago={editarAbierto} onClose={() => setEditarAbierto(null)} />}
      {nuevoPagoAbierto && <PaymentModal onClose={() => setNuevoPagoAbierto(false)} />}
    </div>
  );
}

// ── Notas de crédito ──
function NotasCreditoTab() {
  const { notasCredito, clientes, usuarioActual } = useDataStore();
  const esAdmin = usuarioActual?.rol === 'admin';
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const [abierto, setAbierto] = useState(false);
  const [notaAAplicar, setNotaAAplicar] = useState<NotaCredito | null>(null);
  const [notaAEditar, setNotaAEditar] = useState<NotaCredito | null>(null);

  return (
    <div>
      <div className="flex justify-end mb-3.5">
        <button className="btn-accent" onClick={() => setAbierto(true)}>
          Nueva nota de crédito
        </button>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[.6fr_.8fr_1.4fr_1.4fr_.7fr_.7fr_90px] gap-2 px-5 py-2.5 border-b border-line bg-surface-2">
              {['N°', 'Fecha', 'Cliente', 'Motivo', 'Estado', 'Monto', ''].map((h) => (
                <span key={h} className="th-label">{h}</span>
              ))}
            </div>
            {notasCredito.map((n) => {
              const cliente = clientePorId.get(n.clienteId);
              const disponible = n.monto - n.montoAplicado;
              return (
                <div key={n.id} className="grid grid-cols-[.6fr_.8fr_1.4fr_1.4fr_.7fr_.7fr_90px] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] items-center hover:bg-surface-2 transition-colors">
                  <span className="text-ink-faint num">{n.numero}</span>
                  <span className="num">{n.fecha}</span>
                  <span className="font-medium">{cliente ? `${cliente.codigo} ${cliente.nombre}` : '—'}</span>
                  <span className="text-ink-soft">{n.motivo}</span>
                  <span className={n.aplicada ? 'chip w-fit' : 'chip-danger w-fit'}>
                    {n.aplicada ? 'Aplicada' : disponible < n.monto ? 'Parcial' : 'Sin aplicar'}
                  </span>
                  <b className="num">{formatoMoneda(n.monto)}</b>
                  <span className="flex items-center justify-end gap-2.5">
                    {disponible > 0 && (
                      <button className="text-[12.5px] text-accent font-medium hover:underline" onClick={() => setNotaAAplicar(n)}>
                        Aplicar
                      </button>
                    )}
                    {esAdmin && (
                      <button className="text-[12px] text-ink-soft hover:underline" onClick={() => setNotaAEditar(n)}>
                        Editar
                      </button>
                    )}
                    <HistoryButton entidad="NotaCredito" entidadId={n.id} titulo={`Nota de crédito #${n.numero}`} />
                  </span>
                </div>
              );
            })}
            {notasCredito.length === 0 && (
              <div className="px-5 py-8 text-ink-soft text-sm text-center">No hay notas de crédito registradas.</div>
            )}
          </div>
        </div>
      </div>

      {abierto && <CreateCreditMemoModal onClose={() => setAbierto(false)} />}
      {notaAAplicar && <ApplyCreditMemoModal nota={notaAAplicar} onClose={() => setNotaAAplicar(null)} />}
      {notaAEditar && <EditCreditMemoModal nota={notaAEditar} onClose={() => setNotaAEditar(null)} />}
    </div>
  );
}

// ── Reembolsos ──
function ReembolsosTab() {
  const { reembolsos, clientes, agregarReembolso, pagos } = useDataStore();
  const [pagoId, setPagoId] = useState('');
  const [errorReembolso, setErrorReembolso] = useState<string | null>(null);
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const [abierto, setAbierto] = useState(false);
  const [clienteId, setClienteId] = useState('');
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('zelle');
  const [motivo, setMotivo] = useState('');
  const enviandoRef = useRef(false);

  // Pagos del cliente con cuánto queda por poder devolver de cada uno
  const pagosReembolsables = useMemo(() => {
    if (!clienteId) return [];
    return pagos
      .filter((p) => p.clienteId === clienteId)
      .map((p) => {
        const devuelto = reembolsos.filter((r) => r.pagoId === p.id).reduce((a, r) => a + r.monto, 0);
        return { pago: p, devuelto, disponible: Math.round((p.monto - devuelto) * 100) / 100 };
      })
      .filter((x) => x.disponible > 0)
      .sort((a, b) => (a.pago.fecha < b.pago.fecha ? 1 : -1));
  }, [pagos, reembolsos, clienteId]);
  const pagoElegido = pagosReembolsables.find((x) => x.pago.id === pagoId);

  async function handleCrear() {
    if (enviandoRef.current) return;
    if (!clienteId || !monto) return;
    if (pagoElegido && Number(monto) > pagoElegido.disponible) {
      setErrorReembolso(`Ese pago solo permite devolver hasta ${formatoMoneda(pagoElegido.disponible)}.`);
      return;
    }
    enviandoRef.current = true;
    try {
      await agregarReembolso({
        clienteId,
        fecha: new Date().toISOString().slice(0, 10),
        monto: Number(monto),
        metodo: pagoElegido?.pago.metodo ?? metodo,
        cuentaId: pagoElegido?.pago.cuentaId,
        pagoId: pagoElegido?.pago.id,
        motivo: motivo || 'Sin especificar',
      });
      setAbierto(false);
      setClienteId('');
      setPagoId('');
      setMonto('');
      setMotivo('');
      setErrorReembolso(null);
    } catch (e) {
      setErrorReembolso(e instanceof Error ? e.message : 'No se pudo guardar el reembolso.');
    } finally {
      enviandoRef.current = false;
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3.5">
        <button className="btn-accent" onClick={() => setAbierto(true)}>
          Nuevo reembolso
        </button>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[.6fr_.8fr_1.4fr_.7fr_1.3fr_.7fr_50px] gap-2 px-5 py-2.5 border-b border-line bg-surface-2">
              {['N°', 'Fecha', 'Cliente', 'Método', 'Motivo', 'Monto', ''].map((h) => (
                <span key={h} className="th-label">{h}</span>
              ))}
            </div>
            {reembolsos.map((r) => {
              const cliente = clientePorId.get(r.clienteId);
              return (
                <div key={r.id} className="grid grid-cols-[.6fr_.8fr_1.4fr_.7fr_1.3fr_.7fr_50px] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] items-center hover:bg-surface-2 transition-colors">
                  <span className="text-ink-faint num">{r.numero}</span>
                  <span className="num">{r.fecha}</span>
                  <span className="font-medium">{cliente ? `${cliente.codigo} ${cliente.nombre}` : '—'}</span>
                  <span className="capitalize">{r.metodo}</span>
                  <span className="text-ink-soft">
                    {r.motivo}
                    {r.pagoNumero != null && (
                      <span className="block text-[11.5px] text-ink-faint">
                        Sobre P-{r.pagoNumero}{r.facturas && r.facturas.length > 0 ? ` · factura${r.facturas.length > 1 ? 's' : ''} ${r.facturas.map((f) => `#${f.numero}`).join(', ')}` : ''}
                      </span>
                    )}
                  </span>
                  <b className="num">{formatoMoneda(r.monto)}</b>
                  <span className="justify-self-end">
                    <HistoryButton entidad="Reembolso" entidadId={r.id} titulo={`Reembolso #${r.numero}`} />
                  </span>
                </div>
              );
            })}
            {reembolsos.length === 0 && (
              <div className="px-5 py-8 text-ink-soft text-sm text-center">No hay reembolsos registrados.</div>
            )}
          </div>
        </div>
      </div>

      {abierto && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50 overflow-y-auto pb-10" onClick={() => setAbierto(false)}>
          <div className="panel w-[min(440px,94vw)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <span className="font-semibold text-[15px]">Nuevo reembolso</span>
              <button onClick={() => setAbierto(false)} className="text-lg leading-none hover:text-accent">✕</button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div>
                <div className="th-label mb-1">Cliente</div>
                <ClienteSelect clientes={clientes} value={clienteId} onChange={(v) => { setClienteId(v); setPagoId(''); setErrorReembolso(null); }} />
              </div>
              {clienteId && (
                <div>
                  <div className="th-label mb-1">Pago que se devuelve</div>
                  {pagosReembolsables.length === 0 ? (
                    <div className="text-ink-soft text-[12.5px]">Este cliente no tiene pagos con saldo para reembolsar. Se registra como reembolso suelto.</div>
                  ) : (
                    <select
                      value={pagoId}
                      onChange={(e) => {
                        setPagoId(e.target.value);
                        const x = pagosReembolsables.find((y) => y.pago.id === e.target.value);
                        if (x) setMonto(String(x.disponible));
                      }}
                      className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
                    >
                      <option value="">— Sin ligar a un pago —</option>
                      {pagosReembolsables.map(({ pago, disponible }) => (
                        <option key={pago.id} value={pago.id}>
                          P-{pago.numero} · {pago.fecha} · {pago.metodo} · pagó {formatoMoneda(pago.monto)} · se puede devolver {formatoMoneda(disponible)}
                        </option>
                      ))}
                    </select>
                  )}
                  {pagoElegido && (
                    <div className="text-ink-soft text-[12px] mt-1">Podés devolver cualquier monto hasta {formatoMoneda(pagoElegido.disponible)} (no hace falta devolver todo).</div>
                  )}
                </div>
              )}
              <div>
                <div className="th-label mb-1">Monto a devolver</div>
                <input
                  type="number"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm num focus:outline-none focus:border-accent"
                  placeholder="0.00"
                />
              </div>
              <div>
                <div className="th-label mb-1">Método</div>
                <div className="flex gap-1.5">
                  {(['zelle', 'efectivo', 'kotapay'] as MetodoPago[]).map((m) => (
                    <button key={m} onClick={() => setMetodo(m)} aria-pressed={metodo === m} className={metodo === m ? 'chip-accent capitalize' : 'chip capitalize'}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="th-label mb-1">Motivo</div>
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
                  placeholder="Ej. pago duplicado"
                />
              </div>
              {errorReembolso && <div role="alert" className="text-danger-dark text-[12.5px]">{errorReembolso}</div>}
              <button className="btn-accent w-fit" onClick={handleCrear} disabled={!clienteId || !monto}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pagos ingresados por mail (Zelle detectados en Outlook) ──
// "D135" en la descripción → unidad D0135.
function sugerirCliente(texto: string | undefined, activos: Cliente[]): string {
  if (!texto) return '';
  // Kotapay trae "Vehículo 521" (sin la D); Zelle suele traer "D135"
  const m = texto.match(/\bD\s?0*(\d{2,4})\b/i) || texto.match(/Veh[ií]culo\s+0*(\d{2,4})\b/i) || texto.match(/\b0*(\d{3,4})\b/);
  if (!m) return '';
  const codigo = `D${m[1].padStart(4, '0')}`;
  return activos.find((c) => c.codigo.toUpperCase() === codigo)?.id ?? '';
}

type FiltroBandeja = 'pendiente' | 'aplicado' | 'descartado';

function BandejaPagosEmailTab() {
  const { clientes, getPagosEmail, actualizarBandejaPagosEmail, aplicarPagoEmail, descartarPagoEmail, estadoOutlookConfigurado } = useDataStore();
  const [filas, setFilas] = useState<PagoEmail[]>([]);
  const [configurado, setConfigurado] = useState<boolean | null>(null);
  const [filtro, setFiltro] = useState<FiltroBandeja>('pendiente');
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const activos = useMemo(() => clientes.filter((c) => c.estado === 'activo'), [clientes]);
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);

  useEffect(() => {
    getPagosEmail().then(setFilas).catch((e) => setMensaje({ tipo: 'error', texto: e.message }));
    // autorefresh: el servidor revisa el buzón solo; acá se relee la lista cada 20 s
    const t = setInterval(() => {
      getPagosEmail().then(setFilas).catch(() => {});
    }, 20000);
    estadoOutlookConfigurado().then((r) => setConfigurado(r.configurado)).catch(() => setConfigurado(null));
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function actualizar() {
    setCargando(true);
    setMensaje(null);
    try {
      const r = await actualizarBandejaPagosEmail();
      setFilas(await getPagosEmail());
      setMensaje({ tipo: 'ok', texto: `${r.nuevos} nuevos de ${r.encontrados} pagos encontrados en el buzón.` });
    } catch (e) {
      setMensaje({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setCargando(false);
    }
  }

  async function aplicar(f: PagoEmail, confirmarSinDinero = false) {
    const clienteId = elegidos[f.id] ?? sugerirCliente(f.descripcion, activos);
    if (!clienteId) return;
    setTrabajando(f.id);
    setMensaje(null);
    try {
      const r = await aplicarPagoEmail(f.id, clienteId, confirmarSinDinero);
      setFilas((prev) => prev.map((x) => (x.id === f.id ? r : x)));
    } catch (e) {
      setMensaje({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setTrabajando(null);
    }
  }

  async function descartar(f: PagoEmail) {
    setTrabajando(f.id);
    try {
      await descartarPagoEmail(f.id);
      setFilas((prev) => prev.map((x) => (x.id === f.id ? { ...x, estado: 'descartado' } : x)));
    } catch (e) {
      setMensaje({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setTrabajando(null);
    }
  }

  const esRojo = (f: PagoEmail) => !!f.resultado && f.resultado !== 'aprobado';
  // los rojos (rechazados / solicitudes) van primero: son los que hay que resolver a mano
  const visibles = filas.filter((f) => f.estado === filtro).sort((a, b) => Number(esRojo(b)) - Number(esRojo(a)));
  const cuenta = (e: FiltroBandeja) => filas.filter((f) => f.estado === e).length;
  const rojosPendientes = filas.filter((f) => f.estado === 'pendiente' && esRojo(f)).length;
  const grid = 'grid grid-cols-[104px_minmax(140px,1fr)_minmax(160px,1.3fr)_90px_minmax(260px,1.6fr)] gap-2 px-5';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-2">
          {(['pendiente', 'aplicado', 'descartado'] as FiltroBandeja[]).map((e) => (
            <button
              key={e}
              onClick={() => setFiltro(e)}
              aria-pressed={filtro === e} className={`chip ${filtro === e ? 'chip-accent' : ''} cursor-pointer`}
            >
              {e === 'pendiente' ? 'Pendientes' : e === 'aplicado' ? 'Aplicados' : 'Descartados'} · {cuenta(e)}
              {e === 'pendiente' && rojosPendientes > 0 && <span className="chip-danger ml-1">{rojosPendientes} en rojo</span>}
            </button>
          ))}
        </div>
        <button onClick={actualizar} disabled={cargando || configurado === false} className="btn-accent inline-flex items-center gap-2 disabled:opacity-50">
          <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /> Actualizar bandeja
        </button>
      </div>

      {configurado === false && (
        <div className="panel px-4 py-3 mb-4 text-[13px] flex items-start gap-2">
          <Mail size={16} className="mt-0.5 shrink-0" />
          <span>
            Outlook todavía no está conectado. Completá las variables <span className="font-mono">MS_*</span> en <span className="font-mono">server/.env</span> siguiendo{' '}
            <span className="font-mono">server/OUTLOOK.md</span> y reiniciá el servidor.
          </span>
        </div>
      )}
      {mensaje && (
        <div className={`panel px-4 py-3 mb-4 text-[13px] ${mensaje.tipo === 'error' ? 'text-danger' : 'text-success'}`}>{mensaje.texto}</div>
      )}

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className={`${grid} py-2.5 border-b border-line bg-surface-2 th-label`}>
              <div>Fecha · hora ATL</div>
              <div>Remitente</div>
              <div>Descripción</div>
              <div className="text-right">Monto</div>
              <div>{filtro === 'pendiente' ? 'Asignar a unidad' : 'Unidad'}</div>
            </div>
            {visibles.map((f) => {
              const elegido = elegidos[f.id] ?? sugerirCliente(f.descripcion, activos);
              const asignado = f.clienteId ? clientePorId.get(f.clienteId) : undefined;
              return (
                <div
                  key={f.id}
                  className={`${grid} py-2.5 items-center border-b border-line-soft text-[13px] ${f.estado === 'pendiente' && esRojo(f) ? 'bg-danger/10 shadow-[inset_4px_0_0_var(--color-danger)]' : 'hover:bg-surface-2'}`}
                >
                  <div className="font-mono text-[12px] leading-tight">{f.fecha}<div className="text-ink-soft">{f.hora ?? '—'}</div></div>
                  <div className="font-medium truncate" title={f.remitente}>
                    {f.remitente}
                    <span className="chip ml-2 text-[11px]">{f.origen === 'kotapay' ? 'Kotapay' : 'Zelle'}</span>
                    {f.resultado === 'rechazado' && <span className="chip-danger ml-1 text-[11px]">✕ Tarjeta rechazada</span>}
                    {f.resultado === 'solicitud' && <span className="chip-danger ml-1 text-[11px]">↩ Pidió dinero</span>}
                  </div>
                  <div className="text-ink-soft truncate" title={f.descripcion}>{f.descripcion ?? '—'}</div>
                  <div className="num text-right">{formatoMoneda(f.monto)}</div>
                  <div>
                    {f.estado === 'pendiente' ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-[140px]">
                          <ClienteSelect
                            clientes={activos}
                            value={elegido}
                            onChange={(id) => setElegidos((p) => ({ ...p, [f.id]: id }))}
                            placeholder="Buscar unidad activa…"
                          />
                        </div>
                        {esRojo(f) && confirmando === f.id ? (
                          <>
                            <span className="text-danger-dark text-[12px] leading-tight max-w-[170px]">El dinero NO entró. ¿Aplicar igual?</span>
                            <button onClick={() => { setConfirmando(null); aplicar(f, true); }} disabled={!elegido || trabajando === f.id} className="btn-accent">Sí, aplicar</button>
                            <button onClick={() => setConfirmando(null)} className="btn-outline">No</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => (esRojo(f) ? setConfirmando(f.id) : aplicar(f))} disabled={!elegido || trabajando === f.id} className="btn-accent disabled:opacity-40">
                              Aplicar
                            </button>
                            <button onClick={() => descartar(f)} disabled={trabajando === f.id} className="btn-outline">
                              Descartar
                            </button>
                          </>
                        )}
                      </div>
                    ) : f.estado === 'aplicado' ? (
                      <div className="leading-tight">
                        <span className="chip chip-success">{asignado ? `${asignado.codigo} · ${asignado.nombre}` : 'Aplicado'}</span>
                        <div className="text-[11px] text-ink-soft mt-1">
                          Pago #{f.pagoNumero}
                          {(f.aplicadoAFacturas ?? 0) > 0 && ` · ${formatoMoneda(f.aplicadoAFacturas!)} a ${f.facturasCubiertas} factura(s)`}
                          {(f.comoCredito ?? 0) > 0 && ` · ${formatoMoneda(f.comoCredito!)} quedó como saldo a favor (sin facturas abiertas)`}
                        </div>
                      </div>
                    ) : (
                      <span className="chip">Descartado</span>
                    )}
                  </div>
                </div>
              );
            })}
            {visibles.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-ink-soft">
                {filtro === 'pendiente' ? 'No hay pagos pendientes. Apretá "Actualizar bandeja" para buscar en el mail.' : 'Nada por acá todavía.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
