import { useState } from 'react';
import { useDataStore } from '../data/DataContext';
import type { Cliente } from '../types';
import { AltaFacturaModal } from './AltaFacturaModal';

interface Props {
  cliente?: Cliente; // si viene, es edición; si no, es alta
  onClose: () => void;
}

export function ClientFormModal({ cliente, onClose }: Props) {
  const { agregarCliente, actualizarCliente, configuracion } = useDataStore();
  const esEdicion = Boolean(cliente);

  const [codigo, setCodigo] = useState(cliente?.codigo ?? '');
  const [numero, setNumero] = useState(cliente?.numero ?? '');
  const [nombre, setNombre] = useState(cliente?.nombre ?? '');
  const [telefonos, setTelefonos] = useState(cliente?.telefonos ?? '');
  const [email, setEmail] = useState(cliente?.email ?? '');
  const [direccion, setDireccion] = useState(cliente?.direccion ?? '');
  const [licenciaInfo, setLicenciaInfo] = useState(cliente?.licenciaInfo ?? '');
  const [cuotaSemanal, setCuotaSemanal] = useState(
    String(cliente?.cuotaSemanal ?? configuracion.cuotaSemanalPorDefecto)
  );
  const [notas, setNotas] = useState(cliente?.notas ?? '');
  const [error, setError] = useState<string | null>(null);

  const [altaPara, setAltaPara] = useState<Cliente | null>(null);

  async function handleGuardar() {
    const cuota = Number(cuotaSemanal);
    if (!codigo.trim()) return setError('El código (el ID de TaxiCaller) es obligatorio.');
    if (!nombre.trim()) return setError('El nombre es obligatorio.');
    if (!cuotaSemanal || Number.isNaN(cuota) || cuota < 0) return setError('La cuota semanal tiene que ser un número válido.');
    setError(null);

    if (esEdicion && cliente) {
      actualizarCliente(cliente.id, {
        codigo: codigo.trim(),
        numero: numero.trim(),
        nombre: nombre.trim(),
        telefonos: telefonos.trim(),
        email: email.trim() || undefined,
        direccion: direccion.trim() || undefined,
        licenciaInfo: licenciaInfo.trim(),
        cuotaSemanal: cuota,
        notas: notas.trim() || undefined,
      });
    } else {
      const nuevo = await agregarCliente({
        codigo: codigo.trim(),
        numero: numero.trim() || String(100000 + Math.floor(Math.random() * 9000)),
        nombre: nombre.trim(),
        telefonos: telefonos.trim(),
        email: email.trim() || undefined,
        direccion: direccion.trim() || undefined,
        licenciaInfo: licenciaInfo.trim() || 'Sin especificar',
        cuotaSemanal: cuota,
        fechaAlta: new Date().toISOString().slice(0, 10),
        estado: 'activo',
        notas: notas.trim() || undefined,
      });
      setAltaPara(nuevo); // pop-up para facturar la cuota semanal y la reinscripción
      return;
    }
    onClose();
  }

  if (altaPara) return <AltaFacturaModal cliente={altaPara} sugerido="RI" onClose={onClose} />;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-14 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(480px,94vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">{esEdicion ? 'Editar cliente' : 'Agregar cliente'}</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="th-label mb-1">Código (TaxiCaller)</div>
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ej. D1409"
                className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm num focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <div className="th-label mb-1">N° de cliente (opcional)</div>
              <input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="Se genera solo si lo dejás vacío"
                className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm num focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <div>
            <div className="th-label mb-1">Nombre</div>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="th-label mb-1">Teléfono(s)</div>
              <input value={telefonos} onChange={(e) => setTelefonos(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
            </div>
            <div>
              <div className="th-label mb-1">Email</div>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
            </div>
          </div>
          <div>
            <div className="th-label mb-1">Dirección</div>
            <input value={direccion} onChange={(e) => setDireccion(e.target.value)} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
          </div>
          <div>
            <div className="th-label mb-1">Licencia</div>
            <input value={licenciaInfo} onChange={(e) => setLicenciaInfo(e.target.value)} placeholder="Ej. LIC GA 08/19/2029" className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
          </div>
          <div>
            <div className="th-label mb-1">Cuota semanal</div>
            <input
              type="number"
              value={cuotaSemanal}
              onChange={(e) => setCuotaSemanal(e.target.value)}
              className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent"
            />
            {esEdicion && (
              <div className="text-ink-soft text-[11.5px] mt-1">
                Se puede modificar en cualquier momento (por ejemplo, si se acuerda un descuento). Solo afecta a las próximas facturas, no cambia las ya emitidas.
              </div>
            )}
          </div>
          <div>
            <div className="th-label mb-1">Notas (opcional)</div>
            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent" />
          </div>
          {error && <div className="text-danger text-[12.5px]">{error}</div>}
          <div className="flex gap-2">
            <button className="btn-accent" onClick={handleGuardar}>
              {esEdicion ? 'Guardar cambios' : 'Agregar cliente'}
            </button>
            <button className="btn-outline" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
