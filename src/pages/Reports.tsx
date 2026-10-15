import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDataStore } from '../data/DataContext';
import { calcularAntiguedad, totalizarAntiguedad, formatoMoneda } from '../lib/aging';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useTheme } from '../theme/ThemeContext';
import { CHART_COLORS } from '../theme/chartColors';
import { Pagination } from '../components/Pagination';
import { SortableHeader } from '../components/SortableHeader';
import { descargarCSV } from '../lib/exportCsv';
import type { CategoriaGasto } from '../types';

type Tab = 'cxc' | 'ventas' | 'gastos' | 'pyg' | 'flujo';
const TABS: { id: Tab; label: string }[] = [
  { id: 'cxc', label: 'Cuentas por cobrar' },
  { id: 'ventas', label: 'Ventas por cliente' },
  { id: 'gastos', label: 'Gastos por categoría' },
  { id: 'pyg', label: 'P&L' },
  { id: 'flujo', label: 'Flujo de caja' },
];

export function Reports() {
  const [tab, setTab] = useState<Tab>('cxc');
  return (
    <div className="px-6 md:px-8 py-6 max-w-[1400px]">
      <div className="font-semibold text-xl mb-4">Reportes</div>
      <div className="flex gap-5 border-b border-line mb-4 flex-wrap">
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
      {tab === 'cxc' && <CuentasPorCobrarTab />}
      {tab === 'ventas' && <VentasPorClienteTab />}
      {tab === 'gastos' && <GastosPorCategoriaTab />}
      {tab === 'pyg' && <PyGTab />}
      {tab === 'flujo' && <FlujoDeCajaTab />}
    </div>
  );
}

type CampoOrdenCxC = 'cliente' | 'total';

function CuentasPorCobrarTab() {
  const { clientes, facturas } = useDataStore();
  const navigate = useNavigate();
  const [pagina, setPagina] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [ordenCampo, setOrdenCampo] = useState<CampoOrdenCxC>('total');
  const [ordenDir, setOrdenDir] = useState<'asc' | 'desc'>('desc');

  const filasBase = useMemo(() => calcularAntiguedad(clientes, facturas), [clientes, facturas]);
  const totales = useMemo(() => totalizarAntiguedad(filasBase), [filasBase]);

  function toggleOrden(campo: CampoOrdenCxC) {
    if (ordenCampo === campo) {
      setOrdenDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrdenCampo(campo);
      setOrdenDir(campo === 'cliente' ? 'asc' : 'desc');
    }
    setPagina(1);
  }

  const filas = useMemo(() => {
    const dir = ordenDir === 'asc' ? 1 : -1;
    return [...filasBase].sort((a, b) =>
      ordenCampo === 'cliente' ? a.nombre.localeCompare(b.nombre) * dir : (a.total - b.total) * dir
    );
  }, [filasBase, ordenCampo, ordenDir]);

  const visibles = filas.slice((pagina - 1) * pageSize, pagina * pageSize);
  const totalPaginas = Math.max(1, Math.ceil(filas.length / pageSize));

  function handleExportar() {
    const encabezados = ['Cliente', 'Al día', '1-7 días', '8-14 días', '15-30 días', '+30 días', 'Total'];
    const filasCsv = filas.map((f) => [f.nombre, f.alDia, f.d1a7, f.d8a14, f.d15a30, f.masDe30, f.total]);
    filasCsv.push(['TOTAL', totales.alDia, totales.d1a7, totales.d8a14, totales.d15a30, totales.masDe30, totales.total]);
    descargarCSV(`cuentas-por-cobrar-${new Date().toISOString().slice(0, 10)}.csv`, encabezados, filasCsv);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3.5">
        <div className="text-ink-soft text-[12.5px]">
          al {new Date().toLocaleDateString('es-US', { day: '2-digit', month: 'short', year: 'numeric' })} · {clientes.length} clientes
        </div>
        <button className="chip" onClick={handleExportar}>Exportar CSV</button>
      </div>
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[1.5fr_repeat(5,.8fr)_.9fr] gap-2 px-5 py-2.5 border-b border-line bg-surface-2">
              <SortableHeader campo="cliente" activo={ordenCampo === 'cliente'} direccion={ordenDir} onClick={toggleOrden}>Cliente</SortableHeader>
              <span className="th-label">Al día</span>
              <span className="th-label">1-7</span>
              <span className="th-label">8-14</span>
              <span className="th-label">15-30</span>
              <span className="th-label">+30</span>
              <SortableHeader campo="total" activo={ordenCampo === 'total'} direccion={ordenDir} onClick={toggleOrden}>Total</SortableHeader>
            </div>
            {visibles.map((f) => (
              <div key={f.clienteId} onClick={() => navigate(`/clientes/${f.clienteId}`)} className="grid grid-cols-[1.5fr_repeat(5,.8fr)_.9fr] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] cursor-pointer hover:bg-surface-2 transition-colors">
                <span className="font-medium">{f.nombre}</span>
                <Celda valor={f.alDia} />
                <Celda valor={f.d1a7} />
                <Celda valor={f.d8a14} />
                <Celda valor={f.d15a30} />
                <Celda valor={f.masDe30} accent />
                <b className={`num ${f.total > 0 ? 'text-danger-dark' : ''}`}>{formatoMoneda(f.total)}</b>
              </div>
            ))}
            <div className="grid grid-cols-[1.5fr_repeat(5,.8fr)_.9fr] gap-2 px-5 py-2.5 border-t border-line bg-surface-2 font-semibold text-[13px]">
              <span>Total</span>
              <span className="num">{formatoMoneda(totales.alDia)}</span>
              <span className="num">{formatoMoneda(totales.d1a7)}</span>
              <span className="num">{formatoMoneda(totales.d8a14)}</span>
              <span className="num">{formatoMoneda(totales.d15a30)}</span>
              <span className="num text-danger-dark">{formatoMoneda(totales.masDe30)}</span>
              <span className="num text-danger-dark">{formatoMoneda(totales.total)}</span>
            </div>
          </div>
        </div>
        <Pagination
          pagina={pagina}
          totalPaginas={totalPaginas}
          totalItems={filas.length}
          pageSize={pageSize}
          onPageChange={setPagina}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPagina(1);
          }}
          etiqueta="clientes con saldo pendiente"
        />
      </div>
    </div>
  );
}

function Celda({ valor, accent }: { valor: number; accent?: boolean }) {
  if (valor <= 0) return <span className="text-ink-faint num">—</span>;
  return <span className={`num ${accent ? 'text-danger-dark' : ''}`}>{formatoMoneda(valor)}</span>;
}

function VentasPorClienteTab() {
  const { clientes, facturas } = useDataStore();
  const navigate = useNavigate();

  const filas = useMemo(() => {
    const porCliente = new Map<string, { facturado: number; cobrado: number; cantidad: number }>();
    for (const f of facturas) {
      const actual = porCliente.get(f.clienteId) ?? { facturado: 0, cobrado: 0, cantidad: 0 };
      actual.facturado += f.monto;
      actual.cobrado += f.montoPagado;
      actual.cantidad += 1;
      porCliente.set(f.clienteId, actual);
    }
    const clientePorId = new Map(clientes.map((c) => [c.id, c]));
    return Array.from(porCliente.entries())
      .map(([id, v]) => ({ id, nombre: clientePorId.get(id)?.nombre ?? '—', ...v }))
      .sort((a, b) => b.facturado - a.facturado)
      .slice(0, 20);
  }, [clientes, facturas]);

  return (
    <div>
      <div className="panel overflow-hidden mb-3">
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-[1.6fr_.8fr_.8fr_.8fr_.6fr] gap-2 px-5 py-2.5 border-b border-line bg-surface-2">
              {['Cliente', 'Facturado', 'Cobrado', 'Pendiente', 'Facturas'].map((h) => (
                <span key={h} className="th-label">{h}</span>
              ))}
            </div>
            {filas.map((f) => (
              <div key={f.id} onClick={() => navigate(`/clientes/${f.id}`)} className="grid grid-cols-[1.6fr_.8fr_.8fr_.8fr_.6fr] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px] cursor-pointer hover:bg-surface-2 transition-colors">
                <span className="font-medium">{f.nombre}</span>
                <span className="num">{formatoMoneda(f.facturado)}</span>
                <span className="num">{formatoMoneda(f.cobrado)}</span>
                <span className={`num ${f.facturado - f.cobrado > 0 ? 'text-danger-dark' : ''}`}>{formatoMoneda(f.facturado - f.cobrado)}</span>
                <span className="text-ink-soft num">{f.cantidad}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="text-ink-faint text-[11.5px]">Top 20 clientes por monto facturado.</div>
    </div>
  );
}

const CATEGORIA_LABEL: Record<CategoriaGasto, string> = {
  mantenimiento: 'Mantenimiento',
  seguro: 'Seguro',
  combustible: 'Combustible',
  neumaticos: 'Neumáticos',
  oficina: 'Oficina',
  software: 'Software',
  nomina: 'Nómina',
  publicidad: 'Publicidad',
  servicios: 'Servicios',
  otro: 'Otro',
};

function GastosPorCategoriaTab() {
  const { gastos, bills } = useDataStore();
  const { tema } = useTheme();
  const cc = CHART_COLORS[tema];

  const filas = useMemo(() => {
    const porCategoria = new Map<string, number>();
    for (const g of gastos) porCategoria.set(g.categoria, (porCategoria.get(g.categoria) ?? 0) + g.monto);
    for (const b of bills) porCategoria.set(b.categoria, (porCategoria.get(b.categoria) ?? 0) + b.monto);
    return Array.from(porCategoria.entries())
      .map(([categoria, total]) => ({ categoria: CATEGORIA_LABEL[categoria as CategoriaGasto] ?? categoria, total }))
      .sort((a, b) => b.total - a.total);
  }, [gastos, bills]);

  const totalGeneral = filas.reduce((a, f) => a + f.total, 0);

  return (
    <div className="panel overflow-hidden">
      <div className="p-5">
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={filas} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: cc.tick, fontFamily: 'IBM Plex Mono' }} axisLine={{ stroke: cc.grid }} tickLine={false} />
              <YAxis type="category" dataKey="categoria" tick={{ fontSize: 11.5, fill: cc.axis }} axisLine={false} tickLine={false} width={110} />
              <Tooltip formatter={(v) => formatoMoneda(Number(v))} contentStyle={{ fontSize: 12, border: `1px solid ${cc.tooltipBorder}`, borderRadius: 6, background: cc.tooltipBg }} />
              <Bar dataKey="total" fill={cc.accent} radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="grid grid-cols-[1.5fr_.8fr] gap-2 px-5 py-2.5 border-b border-t border-line bg-surface-2">
        <span className="th-label">Categoría</span>
        <span className="th-label">Total</span>
      </div>
      {filas.map((f) => (
        <div key={f.categoria} className="grid grid-cols-[1.5fr_.8fr] gap-2 px-5 py-2.5 border-b border-line-soft text-[13px]">
          <span>{f.categoria}</span>
          <b className="num">{formatoMoneda(f.total)}</b>
        </div>
      ))}
      <div className="grid grid-cols-[1.5fr_.8fr] gap-2 px-5 py-2.5 bg-surface-2 font-semibold text-[13px]">
        <span>Total</span>
        <span className="num">{formatoMoneda(totalGeneral)}</span>
      </div>
    </div>
  );
}

function PyGTab() {
  const { facturas, gastos, bills } = useDataStore();

  const ingresos = facturas.reduce((a, f) => a + f.montoPagado, 0);
  const gastosTotal = gastos.reduce((a, g) => a + g.monto, 0);
  const billsTotal = bills.reduce((a, b) => a + b.monto, 0);
  const totalGastos = gastosTotal + billsTotal;
  const utilidad = ingresos - totalGastos;

  const porCategoria = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const g of gastos) mapa.set(g.categoria, (mapa.get(g.categoria) ?? 0) + g.monto);
    for (const b of bills) mapa.set(b.categoria, (mapa.get(b.categoria) ?? 0) + b.monto);
    return Array.from(mapa.entries()).sort((a, b) => b[1] - a[1]);
  }, [gastos, bills]);

  return (
    <div className="panel p-5 max-w-xl">
      <div className="text-ink-faint text-[11.5px] mb-3">Estado de resultados · histórico completo</div>
      <div className="flex justify-between py-2 border-b border-line-soft text-[13px]">
        <span className="font-medium">Ingresos por cobros</span>
        <span className="num">{formatoMoneda(ingresos)}</span>
      </div>
      <div className="pt-2.5 pb-1 th-label">Gastos</div>
      {porCategoria.map(([cat, monto]) => (
        <div key={cat} className="flex justify-between py-1 text-[12.5px] text-ink-soft pl-3">
          <span className="capitalize">{CATEGORIA_LABEL[cat as CategoriaGasto] ?? cat}</span>
          <span className="num">{formatoMoneda(monto)}</span>
        </div>
      ))}
      <div className="flex justify-between py-2 border-b border-line-soft font-medium mt-1 text-[13px]">
        <span>Total de gastos</span>
        <span className="num">{formatoMoneda(totalGastos)}</span>
      </div>
      <div className="flex justify-between py-3 font-semibold text-lg">
        <span>Utilidad neta</span>
        <span className={`num ${utilidad < 0 ? 'text-danger-dark' : ''}`}>{formatoMoneda(utilidad)}</span>
      </div>
    </div>
  );
}

function FlujoDeCajaTab() {
  const { pagos, gastos, billPagos, reembolsos } = useDataStore();
  const { tema } = useTheme();
  const cc = CHART_COLORS[tema];

  const serie = useMemo(() => {
    const porSemana = new Map<string, { entradas: number; salidas: number }>();
    function semanaDe(fecha: string) {
      const d = new Date(fecha);
      const onejan = new Date(d.getFullYear(), 0, 1);
      const semana = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
      return `S${semana}`;
    }
    for (const p of pagos) {
      const k = semanaDe(p.fecha);
      const cur = porSemana.get(k) ?? { entradas: 0, salidas: 0 };
      cur.entradas += p.monto;
      porSemana.set(k, cur);
    }
    for (const g of gastos) {
      const k = semanaDe(g.fecha);
      const cur = porSemana.get(k) ?? { entradas: 0, salidas: 0 };
      cur.salidas += g.monto;
      porSemana.set(k, cur);
    }
    for (const bp of billPagos) {
      const k = semanaDe(bp.fecha);
      const cur = porSemana.get(k) ?? { entradas: 0, salidas: 0 };
      cur.salidas += bp.monto;
      porSemana.set(k, cur);
    }
    for (const r of reembolsos) {
      const k = semanaDe(r.fecha);
      const cur = porSemana.get(k) ?? { entradas: 0, salidas: 0 };
      cur.salidas += r.monto;
      porSemana.set(k, cur);
    }
    return Array.from(porSemana.entries())
      .map(([semana, v]) => ({ semana, ...v, neto: v.entradas - v.salidas }))
      .sort((a, b) => (a.semana > b.semana ? 1 : -1))
      .slice(-12);
  }, [pagos, gastos, billPagos, reembolsos]);

  return (
    <div className="panel p-5">
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>
          <BarChart data={serie}>
            <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
            <XAxis dataKey="semana" tick={{ fontSize: 10, fill: cc.tick, fontFamily: 'IBM Plex Mono' }} axisLine={{ stroke: cc.grid }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: cc.tick, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} width={50} />
            <Tooltip formatter={(v) => formatoMoneda(Number(v))} contentStyle={{ fontSize: 12, border: `1px solid ${cc.tooltipBorder}`, borderRadius: 6, background: cc.tooltipBg }} />
            <Bar dataKey="entradas" fill={cc.accent} radius={[2, 2, 0, 0]} name="Entradas" />
            <Bar dataKey="salidas" fill={cc.danger} radius={[2, 2, 0, 0]} name="Salidas" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-[.8fr_.8fr_.8fr_.8fr] gap-2 px-0 py-2.5 mt-3 border-b border-line">
        {['Semana', 'Entradas', 'Salidas', 'Neto'].map((h) => (
          <span key={h} className="th-label">{h}</span>
        ))}
      </div>
      {serie.map((s) => (
        <div key={s.semana} className="grid grid-cols-[.8fr_.8fr_.8fr_.8fr] gap-2 py-2 border-b border-line-soft text-[13px]">
          <span className="num">{s.semana}</span>
          <span className="num">{formatoMoneda(s.entradas)}</span>
          <span className="num text-danger-dark">{formatoMoneda(s.salidas)}</span>
          <b className={`num ${s.neto < 0 ? 'text-danger-dark' : ''}`}>{formatoMoneda(s.neto)}</b>
        </div>
      ))}
    </div>
  );
}
