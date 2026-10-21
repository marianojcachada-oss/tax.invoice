import { NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Home, Users, Receipt, Wallet, BarChart3, Settings, Truck, Landmark, History, X, LogOut, HelpCircle, FileSpreadsheet, ClipboardCheck, Inbox } from 'lucide-react';
import type { ComponentType } from 'react';
import { useDataStore } from '../data/DataContext';
import { api } from '../data/apiClient';
import { Wordmark } from './Wordmark';

// Colores fijos del sidebar (no dependen de --color-* / modo claro-oscuro):
// es parte permanente de la marca, siempre verde oscuro, tal como en el
// diseño de referencia — el resto de la app sí responde al toggle.
const SB = {
  bg: '#0F2E26',
  border: '#0A231D',
  divider: '#1B4038',
  hover: '#164034',
  textPrimary: '#EAF1ED',
  textMuted: '#A9C4B8',
  textFaint: '#7E9C90',
  mint: '#6FBF9C',
  activeBg: '#12362C',
  activeBorder: '#21453A',
};

type Item = { to: string; label: string; end?: boolean; icon: ComponentType<{ size?: number; strokeWidth?: number }>; soloAdmin?: boolean; soloInformes?: boolean };
const GRUPOS: { titulo: string | null; items: Item[] }[] = [
  { titulo: null, items: [{ to: '/', label: 'Inicio', end: true, icon: Home }] },
  {
    titulo: 'Cobranza',
    items: [
      { to: '/clientes', label: 'Clientes', icon: Users },
      { to: '/cobros', label: 'Cobros', icon: Receipt },
    ],
  },
  {
    titulo: 'Dinero',
    items: [
      { to: '/proveedores', label: 'Proveedores', icon: Truck },
      { to: '/gastos', label: 'Gastos', icon: Wallet },
      { to: '/cuentas', label: 'Cuentas', icon: Landmark },
      { to: '/undeposited', label: 'Undeposited', icon: Inbox, soloAdmin: true },
    ],
  },
  {
    titulo: 'Análisis',
    items: [
      { to: '/reportes', label: 'Reportes', icon: BarChart3, soloInformes: true },
      { to: '/informes', label: 'Informes contables', icon: FileSpreadsheet, soloInformes: true },
      { to: '/auditoria', label: 'Auditoría', icon: History, soloAdmin: true },
    ],
  },
  {
    titulo: 'Sistema',
    items: [
      { to: '/solicitudes', label: 'Solicitudes', icon: ClipboardCheck },
      { to: '/configuracion', label: 'Configuración', icon: Settings, soloAdmin: true },
      { to: '/ayuda', label: 'Ayuda', icon: HelpCircle },
    ],
  },
];

export function Sidebar({ abierto, onClose }: { abierto: boolean; onClose: () => void }) {
  const { usuarioActual, cerrarSesion, getPagosEmail } = useDataStore();
  const esAdmin = usuarioActual?.rol === 'admin';
  const veInformes = esAdmin || usuarioActual?.rol === 'supervisor';
  const [solPendientes, setSolPendientes] = useState(0);
  const [mailsPendientes, setMailsPendientes] = useState(0);
  const [mailsRojos, setMailsRojos] = useState(0);

  // Contador de pagos por mail sin aplicar (solo admin), se refresca cada minuto
  useEffect(() => {
    if (!esAdmin) return;
    let vivo = true;
    const cargar = () => getPagosEmail().then((l) => { if (!vivo) return; const pend = l.filter((p) => p.estado === 'pendiente'); setMailsPendientes(pend.length); setMailsRojos(pend.filter((p) => p.resultado && p.resultado !== 'aprobado').length); }).catch(() => {});
    cargar();
    const t = setInterval(cargar, 60000);
    return () => { vivo = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esAdmin]);

  // Contador de solicitudes pendientes (todas si sos admin, las tuyas si no)
  useEffect(() => {
    let vivo = true;
    const cargar = () => api.get<{ cantidad: number }>('/solicitudes/pendientes').then((r) => { if (vivo) setSolPendientes(r.cantidad); }).catch(() => {});
    cargar();
    const t = setInterval(cargar, 60000);
    window.addEventListener('tax:solicitudes-cambiaron', cargar);
    return () => { vivo = false; clearInterval(t); window.removeEventListener('tax:solicitudes-cambiaron', cargar); };
  }, []);

  return (
    <>
      {abierto && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={onClose} />}
      <aside
        style={{ background: SB.bg, borderRight: `1px solid ${SB.border}` }}
        className={`w-[236px] shrink-0 flex flex-col fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:static md:translate-x-0 ${
          abierto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 pt-5 pb-4 flex items-center justify-between gap-2">
          <span style={{ color: '#EAF1ED' }}><Wordmark size={18} colorPunto={SB.mint} /></span>
          <button aria-label="Cerrar menú" style={{ color: SB.textMuted }} className="md:hidden shrink-0" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <nav aria-label="Principal" className="flex flex-col gap-[2px] px-2.5 overflow-y-auto">
          {GRUPOS.map((g) => {
            const items = g.items.filter((item) => (!item.soloAdmin || esAdmin) && (!item.soloInformes || veInformes));
            if (items.length === 0) return null;
            return (
              <div key={g.titulo ?? 'top'} className="flex flex-col gap-[2px]">
                {g.titulo && (
                  <div style={{ color: SB.textFaint }} className="px-2.5 pt-4 pb-1 text-[10px] font-medium uppercase tracking-[0.1em]">
                    {g.titulo}
                  </div>
                )}
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={onClose}
                      className="sb-link flex items-center gap-2.5 px-2.5 py-2 min-h-[36px] rounded-[5px] text-[13px] font-medium transition-colors"
                      style={({ isActive }) => ({
                        color: isActive ? SB.textPrimary : SB.textMuted,
                        background: isActive ? SB.activeBg : 'transparent',
                        boxShadow: isActive ? `inset 3px 0 0 ${SB.mint}` : 'none',
                      })}
                    >
                      <Icon size={15} strokeWidth={2} />
                      <span className="flex-1">{item.label}</span>
                      {item.to === '/solicitudes' && solPendientes > 0 && (
                        <span role="status" aria-label={`${solPendientes} solicitudes pendientes`} style={{ background: SB.mint, color: '#0c1f17' }} className="min-w-[20px] h-[18px] px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center num">{solPendientes}</span>
                      )}
                      {item.to === '/cobros' && mailsPendientes > 0 && (
                        <span role="status" aria-label={`${mailsPendientes} pagos por mail pendientes${mailsRojos > 0 ? `, ${mailsRojos} rechazados o solicitudes` : ''}`} style={mailsRojos > 0 ? { background: '#E2685A', color: '#1a0805' } : { background: SB.mint, color: '#0c1f17' }} className="min-w-[20px] h-[18px] px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center num">
                          {mailsPendientes}{mailsRojos > 0 ? '!' : ''}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div style={{ borderTop: `1px solid ${SB.divider}` }} className="mt-auto p-3.5 flex items-center gap-2">
          <span
            style={{ background: SB.activeBg, color: '#CFE4D8' }}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium shrink-0"
          >
            {usuarioActual?.nombre.charAt(0).toUpperCase() ?? '?'}
          </span>
          <span className="flex flex-col gap-0.5 min-w-0">
            <span style={{ color: SB.textPrimary }} className="text-[11px] leading-none truncate">
              {usuarioActual?.nombre}
            </span>
            <span style={{ color: SB.textFaint }} className="text-[10px] leading-none capitalize">
              {usuarioActual?.rol}
            </span>
          </span>
          <button style={{ color: SB.textFaint }} className="ml-auto shrink-0 hover:!text-[#EAF1ED]" onClick={cerrarSesion} title="Cerrar sesión" aria-label="Cerrar sesión">
            <LogOut size={14} />
          </button>
        </div>
      </aside>
    </>
  );
}
