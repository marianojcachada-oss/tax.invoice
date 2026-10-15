import { useState } from 'react';
import { History } from 'lucide-react';
import { DocumentAuditHistory } from './DocumentAuditHistory';

export function HistoryButton({ entidad, entidadId, titulo }: { entidad: string; entidadId: string; titulo: string }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        className="text-ink-soft hover:text-ink"
        title="Ver historial de cambios"
        onClick={(e) => {
          e.stopPropagation();
          setAbierto(true);
        }}
      >
        <History size={14} />
      </button>

      {abierto && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50 overflow-y-auto pb-10"
          onClick={(e) => {
            e.stopPropagation();
            setAbierto(false);
          }}
        >
          <div className="panel w-[min(440px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <span className="font-semibold text-[15px]">Historial — {titulo}</span>
              <button onClick={() => setAbierto(false)} className="text-lg leading-none hover:text-accent">✕</button>
            </div>
            <div className="p-4">
              <DocumentAuditHistory entidad={entidad} entidadId={entidadId} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
