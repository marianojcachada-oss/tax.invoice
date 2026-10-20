import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useDataStore } from '../data/DataContext';
import { formatoMoneda } from '../lib/aging';
import { Pagination } from './Pagination';
import { mapearContacto } from '../lib/qbClientes';

// Nota de seguridad: "xlsx" (SheetJS) tiene dos vulnerabilidades
// conocidas y sin parche en su versión de npm (prototype pollution y
// ReDoS). Se usa igual acá, a propósito, con conocimiento y aprobación
// explícita del dueño de la app: es una herramienta interna donde el
// único que sube archivos es él mismo, con sus propios datos — no hay
// terceros no confiables subiendo archivos. Si esto se expusiera
// públicamente algún día, esta decisión habría que revisarla de nuevo.

interface FilaImportada {
  codigo: string;
  numero: string;
  nombre: string;
  telefonos: string;
  email: string;
  direccion: string;
  licenciaInfo: string;
  cuotaSemanal: number;
  saldoInicial: number;
  estado: 'activo' | 'inactivo';
  motivoEstado?: string; // por qué quedó inactivo (informativo, no afecta si se importa o no)
  seleccionada: boolean;
  motivoSugerido?: string;
  nombreQb?: string; // nombre exacto en QuickBooks (Customer Contact List)
  notas?: string;
}

const COLUMNAS_PLANTILLA_PROPIA = ['codigo', 'numero', 'nombre', 'telefonos', 'email', 'direccion', 'licencia', 'cuota_semanal'];

const PATRON_CODIGO_EN_NOMBRE = /^(D\d{3,6})\s+(\d{5,7})\s+(.+)$/i;
// Los ex-drivers vienen con el nombre empezando en "EX" — a veces con el
// código D de siempre ("EX D0412 101269 Nathaly...") y a veces con el
// número pelado, sin la D ("EX 272 100410 Alexander...") — y el número de
// cliente en el medio es opcional (algunos no lo traen). Se probó contra
// los 1099 casos reales del archivo del usuario y matchea el 100%.
const PATRON_EX_EN_NOMBRE = /^EX\s+(?:(D\d{3,6})|(\d{2,6}))\s+(?:(\d{5,7})\s+)?(.+)$/i;
const PATRON_NO_CLIENTE = /\b(cash|credit|transfer|zelle|reward|counter|deposit|refund)\b/i;

function descargarPlantilla() {
  const encabezado = COLUMNAS_PLANTILLA_PROPIA.join(',');
  const ejemplo = 'D1409,102345,Juan Pérez,(404) 555-0123,juan@example.com,"123 Main St, Atlanta, GA",LIC GA 01/01/2030,145';
  const blob = new Blob([`${encabezado}\n${ejemplo}\n`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla-clientes.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function num(valor: unknown): number {
  const n = Number(String(valor ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function mapearFilaContacto(fila: Record<string, string>): FilaImportada {
  const c = mapearContacto(fila);
  return {
    codigo: c.codigo,
    numero: c.numero,
    nombre: c.nombre,
    telefonos: c.telefonos,
    email: c.email,
    direccion: c.direccion,
    licenciaInfo: '',
    cuotaSemanal: 0,
    saldoInicial: 0,
    estado: c.estado,
    motivoEstado: c.motivoEstado,
    seleccionada: Boolean(c.nombreQb) && !c.esNoCliente,
    motivoSugerido: c.esNoCliente ? 'Forma de pago o cuenta del banco, no un cliente' : !c.nombreQb ? 'Falta el nombre' : undefined,
    nombreQb: c.nombreQb,
    notas: c.notas,
  };
}

function mapearFila(fila: Record<string, string>, esQuickBooks: boolean): FilaImportada {
  if (!esQuickBooks) {
    const codigo = (fila.codigo ?? '').trim();
    const numero = (fila.numero ?? '').trim();
    const nombre = (fila.nombre ?? '').trim();
    return {
      codigo,
      numero,
      nombre,
      telefonos: (fila.telefonos ?? '').trim(),
      email: (fila.email ?? '').trim(),
      direccion: (fila.direccion ?? '').trim(),
      licenciaInfo: (fila.licencia ?? '').trim(),
      cuotaSemanal: num(fila.cuota_semanal),
      saldoInicial: 0,
      estado: codigo ? 'activo' : 'inactivo',
      motivoEstado: !codigo ? 'Sin código' : undefined,
      seleccionada: Boolean(nombre) && Boolean(codigo),
      motivoSugerido: !nombre ? 'Falta el nombre' : !codigo ? 'Falta el código' : undefined,
    };
  }

  const nombreCrudo = (fila['Name'] ?? '').trim();

  // Primero se prueba el patrón de ex-driver (empieza con "EX"), y recién
  // si no matchea, el patrón normal de código activo ("D####").
  const mEx = nombreCrudo.match(PATRON_EX_EN_NOMBRE);
  const m = !mEx ? nombreCrudo.match(PATRON_CODIGO_EN_NOMBRE) : null;

  let codigo = '';
  let numero = '';
  let nombre = nombreCrudo;
  let estado: 'activo' | 'inactivo' = 'activo';
  let motivoEstado: string | undefined;

  if (mEx) {
    const [, codigoD, codigoNum, numeroCliente, resto] = mEx;
    codigo = codigoD ? codigoD.toUpperCase() : codigoNum ? `D${codigoNum.padStart(4, '0')}` : '';
    numero = numeroCliente ?? '';
    nombre = resto.trim();
    estado = 'inactivo';
    motivoEstado = 'Ex-driver (nombre empieza con "EX")';
  } else if (m) {
    codigo = m[1].toUpperCase();
    numero = m[2];
    nombre = m[3].trim();
  } else {
    estado = 'inactivo';
    motivoEstado = 'Sin código';
  }

  const direccionPartes = [fila['Street Address'], fila['City'], fila['State'], fila['Zip']].filter(Boolean).join(', ');
  const compania = (fila['Company name'] ?? '').trim();
  const esProbableNoCliente = PATRON_NO_CLIENTE.test(nombre);

  return {
    codigo,
    numero,
    nombre,
    telefonos: (fila['Phone'] ?? '').trim(),
    email: (fila['Email'] ?? '').trim(),
    direccion: direccionPartes,
    licenciaInfo: compania,
    cuotaSemanal: 0,
    saldoInicial: num(fila['Open balance']),
    estado,
    motivoEstado,
    seleccionada: Boolean(nombre) && !esProbableNoCliente,
    motivoSugerido: esProbableNoCliente ? 'Parece una forma de pago, no un cliente — revisar' : !nombre ? 'Falta el nombre' : undefined,
  };
}

export function ImportClientsModal({ onClose }: { onClose: () => void }) {
  const { configuracion, importarClientesLote } = useDataStore();
  const [filas, setFilas] = useState<FilaImportada[] | null>(null);
  const [esQuickBooks, setEsQuickBooks] = useState(false);
  const [esContactos, setEsContactos] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const [pageSize] = useState(50);
  const [importando, setImportando] = useState(false);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ importados: number; conSaldoInicial: number; omitidos: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setErrorArchivo(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: 'binary' });
        const hoja = wb.Sheets[wb.SheetNames[0]];
        // El Customer Contact List trae 3 filas de título antes del encabezado: se busca la fila "Customer full name".
        const crudas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: '' });
        const filaEnc = crudas.findIndex((f) => f.some((c) => String(c).trim() === 'Customer full name'));
        const datos = XLSX.utils
          .sheet_to_json<Record<string, string>>(hoja, { defval: '', range: filaEnc > 0 ? filaEnc : 0 })
          .filter((f) => !String(Object.values(f)[0] ?? '').startsWith(' ')); // pie con la fecha de exportación
        if (datos.length === 0) {
          setErrorArchivo('El archivo no tiene filas de datos.');
          return;
        }
        const encabezados = Object.keys(datos[0]);
        const pareceContactos = encabezados.includes('Customer full name');
        const pareceQuickBooks = !pareceContactos && encabezados.includes('Name') && (encabezados.includes('Open balance') || encabezados.includes('Phone'));
        setEsContactos(pareceContactos);
        setEsQuickBooks(pareceQuickBooks);
        setFilas(datos.map((f) => (pareceContactos ? mapearFilaContacto(f) : mapearFila(f, pareceQuickBooks))));
      } catch {
        setErrorArchivo('No se pudo leer el archivo. Probá exportarlo de nuevo desde QuickBooks.');
      }
    };
    reader.onerror = () => setErrorArchivo('No se pudo leer el archivo.');
    reader.readAsBinaryString(archivo);
  }

  function toggleFila(i: number) {
    setFilas((prev) => prev!.map((f, idx) => (idx === i ? { ...f, seleccionada: !f.seleccionada } : f)));
  }

  const filtradas = useMemo(() => {
    if (!filas) return [];
    if (!busqueda) return filas;
    const q = busqueda.toLowerCase();
    return filas.filter((f) => f.nombre.toLowerCase().includes(q) || f.codigo.toLowerCase().includes(q));
  }, [filas, busqueda]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / pageSize));
  const visibles = filtradas.slice((pagina - 1) * pageSize, pagina * pageSize);
  const seleccionadas = filas?.filter((f) => f.seleccionada) ?? [];
  const [crearApertura, setCrearApertura] = useState(true);
  const conSaldo = seleccionadas.filter((f) => f.saldoInicial > 0).length;

  async function handleImportar() {
    if (!filas) return;
    setImportando(true);
    const paraEnviar = seleccionadas.map((f, i) => ({
      nombreQb: f.nombreQb,
      notas: f.notas || undefined,
      codigo: f.nombreQb ? f.codigo : f.codigo || `SINCODIGO-${i + 1}`,
      numero: f.numero,
      nombre: f.nombre,
      telefonos: f.telefonos,
      email: f.email || undefined,
      direccion: f.direccion || undefined,
      licenciaInfo: f.licenciaInfo || 'Sin especificar',
      cuotaSemanal: f.cuotaSemanal || configuracion.cuotaSemanalPorDefecto,
      saldoInicial: crearApertura ? f.saldoInicial || undefined : undefined,
      estado: f.estado,
    }));
    const r = await importarClientesLote(paraEnviar);
    setImportando(false);
    setResultado(r);
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-8 z-50 overflow-y-auto pb-10" onClick={onClose}>
      <div className="panel w-[min(760px,96vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Importar clientes</span>
          <button onClick={onClose} className="text-lg leading-none hover:text-accent">✕</button>
        </div>

        {resultado ? (
          <div className="p-6 text-center">
            <div className="text-lg font-semibold mb-1">Listo ✓</div>
            <div className="text-ink-soft text-sm">
              Se importaron <b>{resultado.importados}</b> clientes.
              {resultado.omitidos > 0 && <> Se omitieron {resultado.omitidos} que ya estaban cargados (mismo nombre de QuickBooks).</>}
              {resultado.conSaldoInicial > 0 && (
                <> A {resultado.conSaldoInicial} se les generó una factura de apertura con el saldo que ya tenían en QuickBooks.</>
              )}
            </div>
            <button className="btn-accent mt-4" onClick={onClose}>Cerrar</button>
          </div>
        ) : !filas ? (
          <div className="p-4">
            <div className="text-sm text-ink-soft mb-3">
              Lo ideal es el reporte <b>Customer Contact List</b> de QuickBooks (Informes → Customer Contact List → Excel): trae
              nombre, teléfonos, email y direcciones, y se carga tal cual (el nombre completo de QuickBooks queda guardado para
              después cruzar el historial de movimientos). Los clientes ya cargados se omiten, así que no se duplican si lo subís dos veces.
              También se puede subir directo el archivo que exporta QuickBooks (Ventas → Clientes → Exportar),
              sea CSV o Excel (.xls/.xlsx) — se lee tal cual, sin tener que convertir nada a mano.
              Se detecta solo y se mapea automáticamente (nombre, teléfono, email, dirección, saldo
              pendiente, e incluso el código de TaxiCaller si ya está cargado como parte del nombre).
              También podés usar nuestra plantilla propia si preferís prepararlo vos mismo.
            </div>
            <button className="btn-outline mb-4" onClick={descargarPlantilla}>
              Descargar plantilla propia (opcional)
            </button>
            <div className="border-t border-line pt-4">
              <div className="th-label mb-1.5">Subir archivo (CSV, XLS o XLSX)</div>
              <input ref={fileInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={handleArchivo} className="text-sm" />
              {errorArchivo && <div className="text-danger text-[12.5px] mt-2">{errorArchivo}</div>}
            </div>
          </div>
        ) : (
          <div>
            <div className="px-4 py-3 border-b border-line text-sm">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span>
                  {esContactos ? 'Detectado como Customer Contact List de QuickBooks.' : esQuickBooks ? 'Detectado como export de QuickBooks.' : 'Detectado como plantilla propia.'}{' '}
                  <b>{filas.length}</b> filas · <span className="text-success">{seleccionadas.length} seleccionadas para importar</span>
                  {conSaldo > 0 && crearApertura && <> · {conSaldo} con saldo inicial (se les crea una factura de apertura)</>}
                  <br />
                  De las seleccionadas: <b className="text-success">{seleccionadas.filter((f) => f.estado === 'activo').length} activas</b>
                  {' · '}
                  <b className="text-ink-soft">{seleccionadas.filter((f) => f.estado === 'inactivo').length} inactivas</b>
                  {' '}(ex-drivers o sin código — se importan igual, pero dadas de baja hasta que alguien las reactive a mano)
                </span>
                <button className="text-[12.5px] text-ink-soft hover:underline" onClick={() => setFilas(null)}>
                  Elegir otro archivo
                </button>
              </div>
              {conSaldo > 0 && (
                <label className="flex items-start gap-2 mt-2 text-[12.5px] cursor-pointer">
                  <input type="checkbox" checked={crearApertura} onChange={(e) => setCrearApertura(e.target.checked)} className="accent-[var(--color-accent)] mt-0.5" />
                  <span>
                    Crear una factura de apertura con el saldo de QuickBooks ({conSaldo} clientes).
                    <span className="text-ink-faint"> Destildalo si después vas a importar el historial completo de transacciones: la deuda sale de ahí y, si no, se contaría dos veces.</span>
                  </span>
                </label>
              )}
              <input
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value);
                  setPagina(1);
                }}
                placeholder="Buscar por nombre o código para revisar una fila puntual…"
                className="w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm mt-2 focus:outline-none focus:border-accent"
              />
            </div>

            <div className="max-h-[380px] overflow-y-auto">
              <div className="grid grid-cols-[30px_.7fr_1.2fr_.9fr_.6fr_.6fr_1fr] px-4 py-1.5 border-b border-line bg-line-soft text-[11px] th-label sticky top-0">
                <span></span>
                <span>Código</span>
                <span>Nombre</span>
                <span>Teléfono</span>
                <span>Saldo</span>
                <span>Estado</span>
                <span>Nota</span>
              </div>
              {visibles.map((f) => {
                const indiceReal = filas.indexOf(f);
                return (
                  <div
                    key={indiceReal}
                    className={`grid grid-cols-[30px_.7fr_1.2fr_.9fr_.6fr_.6fr_1fr] px-4 py-1.5 text-[12.5px] border-b border-line-soft items-center ${f.motivoSugerido ? 'bg-danger/5' : ''}`}
                  >
                    <input type="checkbox" checked={f.seleccionada} onChange={() => toggleFila(indiceReal)} className="accent-[var(--color-accent)]" />
                    <span className="truncate text-ink-soft">{f.codigo || '—'}</span>
                    <span className="truncate">{f.nombre || '—'}</span>
                    <span className="truncate text-ink-soft">{f.telefonos || '—'}</span>
                    <span>{f.saldoInicial > 0 ? formatoMoneda(f.saldoInicial) : '—'}</span>
                    <span>
                      {f.estado === 'activo' ? (
                        <span className="chip-success">Activo</span>
                      ) : (
                        <span className="chip" title={f.motivoEstado}>Inactivo</span>
                      )}
                    </span>
                    <span className="text-danger truncate">{f.motivoSugerido ?? ''}</span>
                  </div>
                );
              })}
            </div>
            <Pagination
              pagina={pagina}
              totalPaginas={totalPaginas}
              totalItems={filtradas.length}
              pageSize={pageSize}
              onPageChange={setPagina}
              onPageSizeChange={() => {}}
              etiqueta="filas"
            />
            <div className="px-4 py-3 border-t border-line flex gap-2 items-center">
              <button className="btn-accent" onClick={handleImportar} disabled={importando || seleccionadas.length === 0}>
                {importando ? 'Importando…' : `Importar ${seleccionadas.length} cliente${seleccionadas.length !== 1 ? 's' : ''}`}
              </button>
              <button className="btn-outline" onClick={onClose} disabled={importando}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
