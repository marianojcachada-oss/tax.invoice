import { useEffect, useMemo, useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { api } from '../data/apiClient';
import { Pagination } from '../components/Pagination';
import type { RegistroAuditoria } from '../types';

const ENTIDADES = ['Todas', 'Cliente', 'Factura', 'Pago', 'NotaCredito', 'Reembolso', 'Gasto', 'Cuenta', 'Transferencia', 'Proveedor', 'Bill', 'BillPago', 'Configuracion'];

export function Audit() {
  const { usuarioActual } = useDataStore();
  const [auditLog, setAuditLog] = useState<RegistroAuditoria[] | null>(null);
  const [entidad, setEntidad] = useState('Todas');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    if (usuarioActual?.rol !== 'admin') return;
    api.get<RegistroAuditoria[]>('/auditoria').then(setAuditLog).catch(() => setAuditLog([]));
  }, [usuarioActual]);

  if (usuarioActual?.rol !== 'admin') {
    return (
      <div className="px-6 md:px-8 py-6">
        <div className="font-semibold text-lg mb-1">No tenés permiso para ver esta pantalla</div>
        <p className="text-ink-soft text-sm">Auditoría es solo para usuarios con rol de administrador.</p>
      </div>
    );
  }

  const filtrado = useMemo(() => {
    return (auditLog ?? []).filter((r) => {
      if (entidad !== 'Todas' && r.entidad !== entidad) return false;
      if (busqueda) {
        const q = busqueda.toLowerCase();
        if (!r.resumen.toLowerCase().includes(q) && !r.accion.toLowerCase().includes(q) && !r.usuario.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [auditLog, entidad, busqueda]);

  const totalPaginas = Math.max(1, Math.ceil(filtrado.length / pageSize));
  const visibles = filtrado.slice((pagina - 1) * pageSize, pagina * pageSize);

  if (auditLog === null) {
    return <div className="px-6 md:px-8 py-6 text-ink-soft text-sm">Cargando auditoría…</div>;
  }

  return (
    <div className="px-6 md:px-8 py-6 max-w-[1400px]">
      <div className="mb-5">
        <div className="font-semibold text-xl">Auditoría</div>
        <div className="text-ink-soft text-[13px]">{auditLog.length} acciones registradas</div>
      </div>

      <div className="flex gap-2 items-center mb-3.5">
        <input
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setPagina(1);
          }}
          placeholder="Buscar por acción, usuario o descripción…"
          className="flex-1 border border-line rounded-[5px] bg-surface px-3 py-1.5 text-[13px] focus:outline-none focus:border-accent"
        />
        <select
          value={entidad}
          onChange={(e) => {
            setEntidad(e.target.value);
            setPagina(1);
          }}
          className="border border-line rounded-[5px] px-2.5 py-1.5 text-[13px] bg-surface focus:outline-none focus:border-accent"
        >
          {ENTIDADES.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
      </div>

      <div className="panel overflow-hidden">
        {visibles.length === 0 && (
          <div className="px-5 py-8 text-center text-ink-soft text-sm">
            {auditLog.length === 0
              ? 'Todavía no hay acciones registradas. Cada factura, pago, gasto, etc. que crees va a aparecer acá.'
              : 'Nada coincide con ese filtro.'}
          </div>
        )}

        {visibles.map((r) => (
          <div key={r.id} className="px-5 py-3 border-b border-line-soft text-[13px] last:border-0">
            <div className="flex justify-between items-baseline">
              <span className="font-medium">{r.accion}</span>
              <span className="text-ink-faint text-[11px] num">
                {new Date(r.fecha).toLocaleString('es-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="text-ink-soft text-[12.5px] mt-0.5">{r.resumen}</div>
            <div className="text-ink-faint text-[11px] mt-1.5">
              <span className="chip">{r.usuario}</span> <span className="ml-1.5">{r.entidad}</span>
            </div>
            {r.cambios && r.cambios.length > 0 && (
              <div className="mt-2 border-l-2 border-line pl-2.5">
                {r.cambios.map((c, i) => (
                  <div key={i} className="text-[12px]">
                    <span className="text-ink-soft">{c.campo}:</span> {c.anterior} → <b>{c.nuevo}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {filtrado.length > 0 && (
          <Pagination
            pagina={pagina}
            totalPaginas={totalPaginas}
            totalItems={filtrado.length}
            pageSize={pageSize}
            onPageChange={setPagina}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPagina(1);
            }}
            etiqueta="registros"
          />
        )}
      </div>
    </div>
  );
}
