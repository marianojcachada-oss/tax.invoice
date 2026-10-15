const OPCIONES_DEFECTO = [10, 25, 50, 100, 200];

export function Pagination({
  pagina,
  totalPaginas,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  etiqueta = 'resultados',
  opciones = OPCIONES_DEFECTO,
}: {
  pagina: number;
  totalPaginas: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
  etiqueta?: string;
  opciones?: number[];
}) {
  const desde = totalItems === 0 ? 0 : (pagina - 1) * pageSize + 1;
  const hasta = Math.min(pagina * pageSize, totalItems);

  return (
    <div className="flex justify-between items-center px-5 py-2.5 flex-wrap gap-2 border-t border-line-soft bg-surface-2">
      <span className="text-ink-soft text-[12px]">
        {desde}-{hasta} de {totalItems} {etiqueta}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-ink-soft text-[12px]">
          Mostrar
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="border border-line rounded-[5px] px-2 py-1 text-[12px] bg-surface focus:outline-none focus:border-accent"
          >
            {opciones.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          por página
        </label>
        <div className="flex gap-1.5">
          <button className="chip disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => onPageChange(Math.max(1, pagina - 1))} disabled={pagina <= 1}>
            ‹
          </button>
          <span className="chip num">
            {pagina} / {totalPaginas}
          </span>
          <button className="chip disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => onPageChange(Math.min(totalPaginas, pagina + 1))} disabled={pagina >= totalPaginas}>
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
