import { useEffect, useState } from 'react';
import { api } from '../data/apiClient';
import type { RegistroAuditoria } from '../types';

/** Historial de cambios de UN documento puntual (factura, pago, etc.),
 * pidiéndolo directo al endpoint de auditoría filtrado por entidad + id
 * — cualquier usuario logueado puede ver esto (no hace falta ser admin
 * para ver el historial de un documento puntual). */
export function DocumentAuditHistory({ entidad, entidadId }: { entidad: string; entidadId: string }) {
  const [registros, setRegistros] = useState<RegistroAuditoria[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    api
      .get<RegistroAuditoria[]>(`/auditoria?entidad=${encodeURIComponent(entidad)}&entidadId=${encodeURIComponent(entidadId)}`)
      .then((r) => {
        if (!cancelado) setRegistros(r);
      })
      .catch(() => {
        if (!cancelado) setRegistros([]);
      });
    return () => {
      cancelado = true;
    };
  }, [entidad, entidadId]);

  if (registros === null) {
    return <div className="text-ink-soft text-[11.5px] mt-2">Cargando historial…</div>;
  }

  if (registros.length === 0) {
    return <div className="text-ink-soft text-[11.5px] mt-2">Sin cambios registrados todavía.</div>;
  }

  return (
    <div className="mt-2">
      <div className="th-label mb-1">Historial de cambios</div>
      <div className="border border-line rounded-md divide-y divide-line max-h-[160px] overflow-y-auto">
        {registros.map((r) => (
          <div key={r.id} className="px-2.5 py-2 text-[12px]">
            <div className="flex justify-between items-baseline">
              <span className="font-medium">{r.accion}</span>
              <span className="text-ink-soft text-[10.5px]">
                {new Date(r.fecha).toLocaleString('es-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="text-ink-soft">{r.resumen}</div>
            <div className="text-ink-soft text-[10.5px] mt-0.5">por {r.usuario}</div>
            {r.cambios && r.cambios.length > 0 && (
              <div className="mt-1 border-l-2 border-line pl-2">
                {r.cambios.map((c, i) => (
                  <div key={i}>
                    <span className="text-ink-soft">{c.campo}:</span> {c.anterior} → <b>{c.nuevo}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
