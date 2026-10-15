import type { Cuenta } from '../types';

export function CuentaSelect({
  cuentas,
  value,
  onChange,
  incluirVacio = true,
}: {
  cuentas: Cuenta[];
  value: string;
  onChange: (id: string) => void;
  incluirVacio?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-surface"
    >
      {incluirVacio && <option value="">Sin especificar</option>}
      {cuentas.map((c) => (
        <option key={c.id} value={c.id}>
          {c.nombre}
        </option>
      ))}
    </select>
  );
}
