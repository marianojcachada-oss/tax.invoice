import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, X } from 'lucide-react';

/** Cartel que aparece cuando un cambio quedó como solicitud para el sector contable. */
export function AvisoSolicitud() {
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const alPedir = (e: Event) => {
      setMensaje((e as CustomEvent<{ mensaje: string }>).detail.mensaje);
      window.dispatchEvent(new Event('tax:solicitudes-cambiaron'));
      if (t) clearTimeout(t);
      t = setTimeout(() => setMensaje(null), 9000);
    };
    window.addEventListener('tax:solicitud', alPedir);
    return () => {
      window.removeEventListener('tax:solicitud', alPedir);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!mensaje) return null;
  return (
    <div role="status" className="fixed bottom-5 right-5 z-[60] max-w-[360px] panel p-4 shadow-lg flex gap-3 items-start border-accent">
      <Clock size={18} className="text-accent shrink-0 mt-0.5" />
      <div className="text-[13px]">
        <div className="font-semibold mb-0.5">Cambio solicitado</div>
        <div className="text-ink-soft">El cambio se solicitó al sector contable. Se va a aplicar cuando lo aprueben.</div>
        <Link to="/solicitudes" onClick={() => setMensaje(null)} className="text-accent font-medium hover:underline text-[12.5px] mt-1 inline-block">Ver mis solicitudes</Link>
      </div>
      <button aria-label="Cerrar aviso" className="text-ink-faint hover:text-ink" onClick={() => setMensaje(null)}><X size={14} /></button>
    </div>
  );
}
