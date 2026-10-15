import { ChevronUp, ChevronDown } from 'lucide-react';

export function SortableHeader<T extends string>({
  campo,
  activo,
  direccion,
  onClick,
  children,
  align = 'left',
}: {
  campo: T;
  activo: boolean;
  direccion: 'asc' | 'desc';
  onClick: (campo: T) => void;
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(campo)}
      className={`th-label flex items-center gap-0.5 hover:text-ink ${align === 'right' ? 'justify-end w-full' : ''} ${activo ? 'text-ink' : ''}`}
    >
      {children}
      {activo && (direccion === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
    </button>
  );
}
