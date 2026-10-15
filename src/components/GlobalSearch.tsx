import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDataStore } from '../data/DataContext';
import { Search } from 'lucide-react';

export function GlobalSearch() {
  const navigate = useNavigate();
  const { clientes, facturas, pagos, proveedores, bills } = useDataStore();
  const [query, setQuery] = useState('');
  const [abierto, setAbierto] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const proveedorPorId = useMemo(() => new Map(proveedores.map((p) => [p.id, p])), [proveedores]);

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;

    return {
      clientes: clientes
        .filter(
          (c) =>
            c.nombre.toLowerCase().includes(q) ||
            c.codigo.toLowerCase().includes(q) ||
            c.numero.includes(q) ||
            c.telefonos.toLowerCase().includes(q)
        )
        .slice(0, 5),
      facturas: facturas
        .filter((f) => String(f.numero).includes(q) || f.concepto.toLowerCase().includes(q))
        .slice(0, 5),
      pagos: pagos
        .filter((p) => String(p.numero).includes(q) || (p.referencia ?? '').toLowerCase().includes(q))
        .slice(0, 5),
      proveedores: proveedores.filter((p) => p.nombre.toLowerCase().includes(q)).slice(0, 5),
      bills: bills
        .filter((b) => String(b.numero).includes(q) || b.concepto.toLowerCase().includes(q))
        .slice(0, 5),
    };
  }, [query, clientes, facturas, pagos, proveedores, bills]);

  const hayResultados =
    !!resultados &&
    resultados.clientes.length +
      resultados.facturas.length +
      resultados.pagos.length +
      resultados.proveedores.length +
      resultados.bills.length >
      0;

  function cerrar() {
    setAbierto(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function irACliente(id: string) {
    navigate(`/clientes/${id}`);
    cerrar();
  }

  function irAProveedores() {
    navigate('/proveedores');
    cerrar();
  }

  return (
    <div className="relative flex-1 max-w-md">
      <div className="text-ink-soft text-sm border border-line rounded-[5px] bg-surface px-3 py-1.5 flex items-center gap-2 focus-within:border-accent">
        <Search size={14} className="text-ink-faint shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          placeholder="Buscar clientes, facturas, pagos, proveedores…"
          className="bg-transparent outline-none w-full text-ink placeholder:text-ink-faint text-[12.5px]"
        />
      </div>

      {abierto && resultados && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-surface border border-line rounded-md shadow-lg max-h-[420px] overflow-y-auto">
          {!hayResultados && (
            <div className="px-3 py-3 text-sm text-ink-soft">Sin resultados para "{query}"</div>
          )}

          {resultados.clientes.length > 0 && (
            <div>
              <div className="px-3 py-1.5 th-label bg-line-soft">Clientes</div>
              {resultados.clientes.map((c) => (
                <div
                  key={c.id}
                  onMouseDown={() => irACliente(c.id)}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-line-soft"
                >
                  <span className="text-ink-soft">{c.codigo}</span> {c.nombre}
                </div>
              ))}
            </div>
          )}

          {resultados.facturas.length > 0 && (
            <div>
              <div className="px-3 py-1.5 th-label bg-line-soft">Facturas</div>
              {resultados.facturas.map((f) => {
                const cliente = clientePorId.get(f.clienteId);
                return (
                  <div
                    key={f.id}
                    onMouseDown={() => cliente && irACliente(cliente.id)}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-line-soft"
                  >
                    #{f.numero} · {f.concepto} {cliente && <span className="text-ink-soft">· {cliente.nombre}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {resultados.pagos.length > 0 && (
            <div>
              <div className="px-3 py-1.5 th-label bg-line-soft">Pagos</div>
              {resultados.pagos.map((p) => {
                const cliente = clientePorId.get(p.clienteId);
                return (
                  <div
                    key={p.id}
                    onMouseDown={() => cliente && irACliente(cliente.id)}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-line-soft"
                  >
                    Pago #{p.numero} {cliente && <span className="text-ink-soft">· {cliente.nombre}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {resultados.proveedores.length > 0 && (
            <div>
              <div className="px-3 py-1.5 th-label bg-line-soft">Proveedores</div>
              {resultados.proveedores.map((p) => (
                <div
                  key={p.id}
                  onMouseDown={irAProveedores}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-line-soft"
                >
                  {p.nombre}
                </div>
              ))}
            </div>
          )}

          {resultados.bills.length > 0 && (
            <div>
              <div className="px-3 py-1.5 th-label bg-line-soft">Bills</div>
              {resultados.bills.map((b) => {
                const proveedor = proveedorPorId.get(b.proveedorId);
                return (
                  <div
                    key={b.id}
                    onMouseDown={irAProveedores}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-line-soft"
                  >
                    Bill #{b.numero} · {b.concepto} {proveedor && <span className="text-ink-soft">· {proveedor.nombre}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
