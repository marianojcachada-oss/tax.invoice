import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDataStore } from '../data/DataContext';
import { calcularAntiguedad, calcularAntiguedadBills, formatoMoneda, saldoDeCuenta } from '../lib/aging';
import { PaymentModal } from '../components/PaymentModal';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useTheme } from '../theme/ThemeContext';
import { CHART_COLORS } from '../theme/chartColors';
import { AlertTriangle } from 'lucide-react';

export function Dashboard() {
  const { tema } = useTheme();
  const cc = CHART_COLORS[tema];
  const { clientes, facturas, cuentas, pagos, gastos, reembolsos, transferencias, billPagos, proveedores, bills, usuarioActual, enviarRecordatoriosMasivo } = useDataStore();
  const navigate = useNavigate();
  const [modalClienteId, setModalClienteId] = useState<string | null>(null);
  const [enviandoRecordatorios, setEnviandoRecordatorios] = useState(false);
  const [resultadoRecordatorios, setResultadoRecordatorios] = useState<string | null>(null);

  const antiguedad = useMemo(() => calcularAntiguedad(clientes, facturas), [clientes, facturas]);
  const antiguedadBills = useMemo(() => calcularAntiguedadBills(proveedores, bills), [proveedores, bills]);

  const activos = clientes.filter((c) => c.estado === 'activo');
  const idsActivos = new Set(activos.map((c) => c.id));
  // Solo clientes activos: los choferes dados de baja con saldo viejo no cuentan como "atrasados"
  const conMora = antiguedad.filter((f) => f.total > 0 && idsActivos.has(f.clienteId));
  const alDia = Math.max(0, activos.length - conMora.length);
  const bajasConSaldo = antiguedad.filter((f) => f.total > 0 && !idsActivos.has(f.clienteId));
  const totalBajas = bajasConSaldo.reduce((a, f) => a + f.total, 0);
  const [confirmarRecordatorios, setConfirmarRecordatorios] = useState(false);
  const totalAR = antiguedad.reduce((a, f) => a + f.total, 0);
  const totalMora = conMora.reduce((a, f) => a + f.total, 0);
  const totalAP = antiguedadBills.reduce((a, f) => a + f.total, 0);

  const datosCuentas = { pagos, gastos, reembolsos, transferencias, billPagos };
  const totalCash = useMemo(
    () => cuentas.reduce((a, c) => a + saldoDeCuenta(c, datosCuentas), 0),
    [cuentas, pagos, gastos, reembolsos, transferencias, billPagos]
  );

  const semanaActual = useMemo(() => Math.max(0, ...facturas.map((f) => f.semana)), [facturas]);
  const facturasSemana = facturas.filter((f) => f.semana === semanaActual);
  const cobradoSemana = facturasSemana.reduce((a, f) => a + f.montoPagado, 0);
  const facturasPagadasSemana = facturasSemana.filter((f) => f.montoPagado >= f.monto).length;

  const hace30 = (fecha: string) => {
    const d = new Date(fecha).getTime();
    const hoy = Date.now();
    return (hoy - d) / (1000 * 60 * 60 * 24) <= 30;
  };
  const ingresosMes = pagos.filter((p) => hace30(p.fecha)).reduce((a, p) => a + p.monto, 0);
  const gastosMes =
    gastos.filter((g) => hace30(g.fecha)).reduce((a, g) => a + g.monto, 0) +
    billPagos.filter((b) => hace30(b.fecha)).reduce((a, b) => a + b.monto, 0);
  const netProfit = ingresosMes - gastosMes;

  const serieSemanal = useMemo(() => {
    const semanas = Array.from({ length: 8 }, (_, i) => semanaActual - 7 + i);
    return semanas.map((s) => {
      const cobrado = facturas.filter((f) => f.semana === s).reduce((a, f) => a + f.montoPagado, 0);
      return { semana: `S${s}`, ingresos: cobrado };
    });
  }, [facturas, semanaActual]);

  const top6 = conMora.slice(0, 6);

  async function handleEnviarRecordatoriosMasivo() {
    setEnviandoRecordatorios(true);
    const resultado = await enviarRecordatoriosMasivo();
    setEnviandoRecordatorios(false);
    setResultadoRecordatorios(
      `Enviados ${resultado.enviados}${resultado.salteados > 0 ? ` · Se salteó a ${resultado.salteados} por no tener actividad reciente o estar de baja` : ''}`
    );
    setTimeout(() => setResultadoRecordatorios(null), 6000);
  }

  return (
    <div className="px-6 md:px-8 py-6 max-w-[1400px]">
      <div className="flex justify-between items-end flex-wrap gap-3 mb-6">
        <div>
          <div className="font-semibold text-xl">Hola, {usuarioActual?.nombre}</div>
          <div className="text-ink-soft text-[13px]">
            {new Date().toLocaleDateString('es-US', { weekday: 'long', day: 'numeric', month: 'long' })} · semana {semanaActual}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => navigate('/clientes')}>
            Agregar cliente
          </button>
          <button className="btn-accent" onClick={() => setModalClienteId(conMora[0]?.clienteId ?? clientes[0]?.id ?? null)}>
            Registrar pago
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-3.5">
        <Kpi label="Cash disponible" value={formatoMoneda(totalCash)} sub={`${cuentas.length} cuentas`} onClick={() => navigate('/cuentas')} />
        <Kpi label="Cuentas por cobrar" value={formatoMoneda(totalAR)} sub={`${conMora.length} activos con saldo${bajasConSaldo.length ? ` · ${bajasConSaldo.length} de baja (${formatoMoneda(totalBajas)})` : ''}`} accent={totalAR > 0} onClick={() => navigate('/reportes')} />
        <Kpi label="Cuentas por pagar" value={formatoMoneda(totalAP)} sub={`${antiguedadBills.length} proveedores`} accent={totalAP > 0} onClick={() => navigate('/proveedores')} />
        <Kpi label="Ganancia (30 días)" value={formatoMoneda(netProfit)} sub={gastosMes === 0 ? `Ingresos ${formatoMoneda(ingresosMes)} · sin gastos cargados` : `Ingresos ${formatoMoneda(ingresosMes)} · Gastos ${formatoMoneda(gastosMes)}`} accent={netProfit < 0} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-3.5">
        <Kpi label="Cobrado esta semana" value={formatoMoneda(cobradoSemana)} sub={`${facturasPagadasSemana} de ${facturasSemana.length} facturas`} />
        <Kpi label="Al día" value={String(alDia)} sub={`${Math.round((alDia / Math.max(activos.length, 1)) * 100)}% de la cartera`} />
        <Kpi label="Atrasados" value={String(conMora.length)} sub={`${formatoMoneda(totalMora)} en mora`} accent={conMora.length > 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mb-3.5">
        <div className="panel p-[18px_20px_14px]">
          <div className="flex justify-between items-baseline mb-4">
            <span className="font-semibold text-[13px]">Ingresos por semana</span>
            <span className="chip">últimas 8 semanas</span>
          </div>
          <div style={{ width: '100%', height: 168 }}>
            <ResponsiveContainer>
              <BarChart data={serieSemanal}>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
                <XAxis dataKey="semana" tick={{ fontSize: 10, fill: cc.tick, fontFamily: 'IBM Plex Mono' }} axisLine={{ stroke: cc.grid }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: cc.tick, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} width={45} />
                <Tooltip formatter={(v) => formatoMoneda(Number(v))} contentStyle={{ fontSize: 12, border: `1px solid ${cc.tooltipBorder}`, borderRadius: 6, background: cc.tooltipBg }} />
                <Bar dataKey="ingresos" fill={cc.accent} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel p-[18px_20px_14px]">
          <div className="flex justify-between items-baseline mb-4">
            <span className="font-semibold text-[13px]">Tendencia de cobros</span>
          </div>
          <div style={{ width: '100%', height: 168 }}>
            <ResponsiveContainer>
              <LineChart data={serieSemanal}>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
                <XAxis dataKey="semana" tick={{ fontSize: 10, fill: cc.tick, fontFamily: 'IBM Plex Mono' }} axisLine={{ stroke: cc.grid }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: cc.tick, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} width={45} />
                <Tooltip formatter={(v) => formatoMoneda(Number(v))} contentStyle={{ fontSize: 12, border: `1px solid ${cc.tooltipBorder}`, borderRadius: 6, background: cc.tooltipBg }} />
                <Line type="monotone" dataKey="ingresos" stroke={cc.accent} strokeWidth={2} dot={{ r: 3, fill: cc.accent }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-line">
          <span className="font-semibold text-[13px]">Requiere atención</span>
          {conMora.length > 0 && <span className="chip-danger">{conMora.length}</span>}
        </div>
        {top6.length === 0 ? (
          <div className="px-5 py-8 text-center text-ink-soft text-sm">Ningún cliente en mora ahora mismo.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {top6.map((f) => (
              <button
                key={f.clienteId}
                className="flex items-center gap-3 px-5 py-2.5 border-b border-line-soft text-left hover:bg-surface-2 transition-colors"
                onClick={() => setModalClienteId(f.clienteId)}
              >
                <span className="w-[22px] h-[22px] rounded-[4px] bg-danger/10 text-danger-dark flex items-center justify-center shrink-0">
                  <AlertTriangle size={12} />
                </span>
                <span className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="text-[12.5px] font-medium truncate">{f.nombre}</span>
                  <span className="text-ink-faint text-[11px]">Debe · saldo vencido</span>
                </span>
                <span className="text-danger-dark text-[12px] font-medium num">{formatoMoneda(f.total)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="px-5 py-3 flex gap-2 items-center flex-wrap border-t border-line-soft">
          <button className="btn-accent text-[12.5px] !py-1.5" onClick={() => setConfirmarRecordatorios(true)} disabled={enviandoRecordatorios || conMora.length === 0}>
            {enviandoRecordatorios ? 'Enviando…' : `Recordatorio a ${conMora.length}`}
          </button>
          <button className="btn-outline text-[12.5px] !py-1.5" onClick={() => navigate('/reportes')}>
            Ver todos
          </button>
          {resultadoRecordatorios && <span role="status" className="text-ink-soft text-[12px]">{resultadoRecordatorios}</span>}
        </div>
      </div>

      {confirmarRecordatorios && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center pt-20 z-50" onClick={() => setConfirmarRecordatorios(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="conf-rec" className="panel w-[min(460px,94vw)] shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div id="conf-rec" className="font-semibold text-[15px] mb-1">¿Enviar recordatorio a {conMora.length} cliente{conMora.length === 1 ? '' : 's'}?</div>
            <p className="text-ink-soft text-[13px] mb-3">Se enviará un mail a cada cliente activo con saldo vencido. No se puede deshacer.</p>
            <ul className="max-h-48 overflow-y-auto border border-line rounded-[5px] divide-y divide-line-soft mb-4">
              {conMora.map((f) => (
                <li key={f.clienteId} className="flex justify-between gap-3 px-3 py-1.5 text-[12.5px]">
                  <span className="truncate">{f.nombre}</span>
                  <span className="num text-danger-dark">{formatoMoneda(f.total)}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setConfirmarRecordatorios(false)}>Cancelar</button>
              <button className="btn-accent" autoFocus onClick={() => { setConfirmarRecordatorios(false); handleEnviarRecordatoriosMasivo(); }}>Enviar {conMora.length}</button>
            </div>
          </div>
        </div>
      )}

      {modalClienteId && <PaymentModal clienteId={modalClienteId} onClose={() => setModalClienteId(null)} />}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className={`panel p-4 flex flex-col gap-2.5 ${onClick ? 'cursor-pointer hover:border-accent/50 transition-colors' : ''}`} onClick={onClick}>
      <div className="th-label">{label}</div>
      <div className={`num font-medium text-[22px] leading-none tracking-tight ${accent ? 'text-danger-dark' : ''}`}>{value}</div>
      <div className="text-[11px] text-ink-faint">{sub}</div>
    </div>
  );
}
