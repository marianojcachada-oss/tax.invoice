import { useCallback, useEffect, useState } from 'react';
import { api } from '../data/apiClient';
import { useDataStore } from '../data/DataContext';
import type { SolicitudCambio } from '../types';

const ESTADO: Record<SolicitudCambio['estado'], { texto: string; cls: string }> = {
  pendiente: { texto: 'Pendiente', cls: 'chip-accent' },
  aprobada: { texto: 'Aprobada', cls: 'chip' },
  rechazada: { texto: 'Rechazada', cls: 'chip' },
  fallida: { texto: 'No se pudo aplicar', cls: 'chip' },
};

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' });

export function Solicitudes() {
  const { usuarioActual, recargarTodo } = useDataStore();
  const esAdmin = usuarioActual?.rol === 'admin';
  const [lista, setLista] = useState<SolicitudCambio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [verResueltas, setVerResueltas] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setLista(await api.get<SolicitudCambio[]>('/solicitudes'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las solicitudes.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function resolver(s: SolicitudCambio, accion: 'aprobar' | 'rechazar') {
    setTrabajando(s.id);
    setError(null);
    try {
      await api.post(`/solicitudes/${s.id}/${accion}`, { nota: notas[s.id] || undefined });
      if (accion === 'aprobar') await recargarTodo();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo resolver.');
    } finally {
      setTrabajando(null);
      await cargar();
      window.dispatchEvent(new Event('tax:solicitudes-cambiaron'));
    }
  }

  const pendientes = lista.filter((s) => s.estado === 'pendiente');
  const resueltas = lista.filter((s) => s.estado !== 'pendiente');

  return (
    <div className="px-6 md:px-8 py-6 max-w-[900px]">
      <h1 className="text-[22px] font-bold mb-1">{esAdmin ? 'Solicitudes de cambio' : 'Mis solicitudes'}</h1>
      <p className="text-ink-soft text-[13px] mb-5">
        {esAdmin
          ? 'Cambios que pidieron otros usuarios. Al aprobar, el cambio se aplica en el momento.'
          : 'Cambios que pediste y están esperando que el sector contable los apruebe.'}
      </p>
      {error && <div role="alert" className="text-danger-dark text-[12.5px] border border-danger/30 rounded-[6px] px-3 py-2 mb-4">{error}</div>}
      {cargando && <div className="text-ink-soft text-sm">Cargando…</div>}
      {!cargando && pendientes.length === 0 && <div className="panel p-5 text-ink-soft text-sm">No hay solicitudes pendientes.</div>}

      <div className="flex flex-col gap-3">
        {pendientes.map((s) => (
          <div key={s.id} className="panel p-4">
            <div className="flex justify-between gap-3 flex-wrap mb-2">
              <div>
                <div className="font-semibold text-[14px]">{s.resumen}</div>
                <div className="text-ink-faint text-[12px]">Pedido por {s.solicitante} · {fechaHora(s.creada)}{s.motivo ? ` · ${s.motivo}` : ''}</div>
              </div>
              <span className={ESTADO[s.estado].cls}>{ESTADO[s.estado].texto}</span>
            </div>
            <table className="w-full text-[13px] mb-3">
              <thead>
                <tr className="text-left text-ink-faint text-[11px] uppercase tracking-wide">
                  <th className="py-1 pr-3 font-medium">Qué cambia</th>
                  <th className="py-1 pr-3 font-medium">Antes</th>
                  <th className="py-1 font-medium">Después</th>
                </tr>
              </thead>
              <tbody>
                {s.detalle.map((d, i) => (
                  <tr key={i} className="border-t border-line-soft">
                    <td className="py-1.5 pr-3 font-medium">{d.campo}</td>
                    <td className="py-1.5 pr-3 text-ink-soft">{d.anterior}</td>
                    <td className="py-1.5">{d.nuevo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {esAdmin && (
              <div className="flex gap-2 items-center flex-wrap">
                <input
                  value={notas[s.id] ?? ''}
                  onChange={(e) => setNotas((n) => ({ ...n, [s.id]: e.target.value }))}
                  placeholder="Nota (opcional)"
                  className="border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm flex-1 min-w-[160px] focus:outline-none focus:border-accent"
                />
                <button className="btn-accent" disabled={trabajando === s.id} onClick={() => resolver(s, 'aprobar')}>Aprobar y aplicar</button>
                <button className="btn-outline" disabled={trabajando === s.id} onClick={() => resolver(s, 'rechazar')}>Rechazar</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {resueltas.length > 0 && (
        <div className="mt-8">
          <button className="text-[13px] text-accent font-medium hover:underline" onClick={() => setVerResueltas((v) => !v)}>
            {verResueltas ? 'Ocultar' : 'Ver'} resueltas ({resueltas.length})
          </button>
          {verResueltas && (
            <div className="panel divide-y divide-line-soft mt-3">
              {resueltas.map((s) => (
                <div key={s.id} className="px-4 py-2.5 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <span>{s.resumen}</span>
                    <span className={ESTADO[s.estado].cls}>{ESTADO[s.estado].texto}</span>
                  </div>
                  <div className="text-ink-faint text-[12px]">
                    {s.solicitante} · {s.resueltaPor ? `resuelta por ${s.resueltaPor}` : ''}{s.resuelta ? ` el ${fechaHora(s.resuelta)}` : ''}{s.nota ? ` — ${s.nota}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
