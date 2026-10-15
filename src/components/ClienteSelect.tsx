import { useMemo, useState } from 'react';
import type { Cliente } from '../types';

export function ClienteSelect({
  clientes,
  value,
  onChange,
  placeholder,
}: {
  clientes: Cliente[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [abierto, setAbierto] = useState(false);

  const seleccionado = clientes.find((c) => c.id === value);

  const filtrados = useMemo(() => {
    if (!query) return clientes.slice(0, 40);
    const q = query.toLowerCase();
    return clientes
      .filter(
        (c) =>
          c.nombre.toLowerCase().includes(q) ||
          c.codigo.toLowerCase().includes(q) ||
          c.numero.includes(q)
      )
      .slice(0, 40);
  }, [clientes, query]);

  return (
    <div className="relative">
      <input
        value={abierto ? query : seleccionado ? `${seleccionado.codigo} · ${seleccionado.nombre}` : ''}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange('');
        }}
        onFocus={() => {
          setAbierto(true);
          setQuery('');
        }}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        placeholder={placeholder ?? 'Buscar cliente por nombre o código…'}
        className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
      />
      {abierto && (
        <div className="absolute z-20 top-full left-0 right-0 bg-surface border border-line border-t-0 rounded-b-md max-h-52 overflow-y-auto shadow-lg">
          {filtrados.map((c) => (
            <div
              key={c.id}
              // onMouseDown en vez de onClick: dispara antes que el onBlur del input
              onMouseDown={() => {
                onChange(c.id);
                setAbierto(false);
                setQuery('');
              }}
              className="px-2.5 py-1.5 text-sm cursor-pointer hover:bg-line-soft"
            >
              <span className="text-ink-soft">{c.codigo}</span> {c.nombre}
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
