import { useMemo, useState } from 'react';
import type { Proveedor } from '../types';

export function ProveedorSelect({
  proveedores,
  value,
  onChange,
  placeholder,
}: {
  proveedores: Proveedor[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [abierto, setAbierto] = useState(false);

  const seleccionado = proveedores.find((p) => p.id === value);

  const filtrados = useMemo(() => {
    if (!query) return proveedores;
    const q = query.toLowerCase();
    return proveedores.filter(
      (p) => p.nombre.toLowerCase().includes(q) || (p.empresa ?? '').toLowerCase().includes(q)
    );
  }, [proveedores, query]);

  return (
    <div className="relative">
      <input
        value={abierto ? query : seleccionado ? seleccionado.nombre : ''}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange('');
        }}
        onFocus={() => {
          setAbierto(true);
          setQuery('');
        }}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        placeholder={placeholder ?? 'Buscar proveedor…'}
        className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
      />
      {abierto && (
        <div className="absolute z-20 top-full left-0 right-0 bg-surface border border-line border-t-0 rounded-b-md max-h-52 overflow-y-auto shadow-lg">
          {filtrados.map((p) => (
            <div
              key={p.id}
              onMouseDown={() => {
                onChange(p.id);
                setAbierto(false);
                setQuery('');
              }}
              className="px-2.5 py-1.5 text-sm cursor-pointer hover:bg-line-soft"
            >
              {p.nombre}
              {p.empresa && <span className="text-ink-soft"> · {p.empresa}</span>}
            </div>
          ))}
          {filtrados.length === 0 && (
            <div className="px-2.5 py-1.5 text-sm text-ink-soft">Sin resultados</div>
          )}
        </div>
      )}
    </div>
  );
}
