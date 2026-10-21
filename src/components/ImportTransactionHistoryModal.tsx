import { useMemo, useRef, useState } from 'react';
import { api } from '../data/apiClient';
import * as XLSX from 'xlsx';
import { useDataStore } from '../data/DataContext';
import type { BloqueHistorial, MovimientoQB, ResultadoLoteHistorial, TipoMovimientoQB } from '../data/DataContext';
import { esNoCliente, normalizarEspacios } from '../lib/qbClientes';

const TIPOS: TipoMovimientoQB[] = ['Invoice', 'Payment', 'Credit Memo', 'Refund', 'Expense', 'Check', 'Deposit'];
const ETIQUETA_TIPO: Record<TipoMovimientoQB, string> = {
  Invoice: 'facturas',
  Payment: 'pagos',
  'Credit Memo': 'notas de crédito',
  Refund: 'reembolsos (Refund)',
  Expense: 'gastos a clientes (Expense)',
  Check: 'cheques a clientes (Check)',
  Deposit: 'depósitos bancarios (no se importan)',
};

/** "01/29/2026" -> "2026-01-29" */
function aFechaISO(fecha: string): string {
  const partes = fecha.split('/');
  if (partes.length !== 3) return '';
  const [m, d, y0] = partes;
  const y = y0.length === 2 ? `20${y0}` : y0;
  if (!m || !d || !y) return '';
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Lee el reporte "Transaction List by Customer" de QuickBooks tal cual viene: un bloque por cliente
 * (la fila con el nombre completo) y debajo sus movimientos con Date, Transaction type, Num,
 * Posting (Y/N), Memo, Account full name y Amount. Las columnas se buscan por su título.
 */
export function parsearReporte(filas: unknown[][]): { bloques: BloqueHistorial[]; ignoradas: number } {
  const iEnc = filas.findIndex((f) => f.some((c) => String(c ?? '').trim() === 'Transaction type'));
  if (iEnc < 0) return { bloques: [], ignoradas: 0 };
  const col = (titulo: string, porDefecto: number) => {
    const i = filas[iEnc].findIndex((c) => String(c ?? '').trim().startsWith(titulo));
    return i >= 0 ? i : porDefecto;
  };
  const cFecha = col('Date', 1);
  const cTipo = col('Transaction type', 2);
  const cNum = col('Num', 3);
  const cPosting = col('Posting', 4);
  const cMemo = col('Memo', 5);
  const cCuenta = col('Account', 6);
  const cMonto = col('Amount', 7);

  const bloques: BloqueHistorial[] = [];
  let actual: BloqueHistorial | null = null;
  let ignoradas = 0;
  for (let i = iEnc + 1; i < filas.length; i++) {
    const f = filas[i];
    const c0 = String(f[0] ?? '');
    const fecha = String(f[cFecha] ?? '').trim();
    if (!c0.trim() && !fecha) continue;
    if (c0.startsWith('Total for') || c0 === 'TOTAL' || c0.startsWith(' ')) continue;
    if (c0.trim() && !fecha) {
      actual = { nombreQb: c0.trim(), transacciones: [] };
      bloques.push(actual);
      continue;
    }
    const tipo = String(f[cTipo] ?? '').trim() as TipoMovimientoQB;
    if (!actual || !TIPOS.includes(tipo) || String(f[cPosting] ?? 'Yes').trim().toLowerCase() === 'no') {
      ignoradas += 1;
      continue;
    }
    const iso = aFechaISO(fecha);
    const monto = typeof f[cMonto] === 'number' ? (f[cMonto] as number) : Number(String(f[cMonto] ?? '0').replace(/[^0-9.-]/g, ''));
    if (!iso || !Number.isFinite(monto)) {
      ignoradas += 1;
      continue;
    }
    actual.transacciones.push({ fecha: iso, tipo, num: String(f[cNum] ?? '').trim(), memo: String(f[cMemo] ?? '').trim(), cuenta: String(f[cCuenta] ?? '').trim(), monto });
  }
  return { bloques: bloques.filter((b) => b.transacciones.length > 0), ignoradas };
}

const MAX_MOVIMIENTOS_POR_LOTE = 2500;

export function ImportTransactionHistoryModal({ onClose }: { onClose: () => void }) {
  const { clientes, importarHistorial, recargarMovimientos } = useDataStore();
  const [bloques, setBloques] = useState<BloqueHistorial[] | null>(null);
  const [ignoradas, setIgnoradas] = useState(0);
  const [leyendo, setLeyendo] = useState(false);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [borrando, setBorrando] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState('');
  const [msgBorrado, setMsgBorrado] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const [errorImport, setErrorImport] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoLoteHistorial | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  type Verificacion = { rango: { concepto: string; cantArchivo: number; montoArchivo: number; cantApp: number | null; montoApp: number; dif: number }[] | null; revisados: number; coinciden: number; cantidadDiferencias: number; diferencias: { nombreQb: string; archivo: number; app: number; dif: number }[]; totalArchivo: number; totalApp: number; sinHistorial: string[]; sinCliente: string[]; facturasApp: number; pagosApp: number };
  const [verif, setVerif] = useState<Verificacion | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [errorVerif, setErrorVerif] = useState<string | null>(null);

  async function handleVerificar() {
    if (!bloques) return;
    setVerificando(true); setErrorVerif(null);
    try {
      const hastaOk = /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? hasta : null;
      const desdeOk = /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : null;
      const totales = { facturas: { n: 0, monto: 0 }, pagos: { n: 0, monto: 0 }, creditos: { n: 0, monto: 0 } };
      const clientesArchivo = bloques
        .filter((b) => !esNoCliente(b.nombreQb) && nombresConocidos.has(b.nombreQb))
        .map((b) => {
          for (const t of b.transacciones) {
            if ((desdeOk && t.fecha < desdeOk) || (hastaOk && t.fecha > hastaOk)) continue;
            if (t.tipo === 'Invoice' && t.monto > 0) { totales.facturas.n += 1; totales.facturas.monto += t.monto; }
            else if (t.tipo === 'Payment' && t.monto > 0) { totales.pagos.n += 1; totales.pagos.monto += t.monto; }
            else if (t.tipo === 'Credit Memo' && t.monto < 0) { totales.creditos.n += 1; totales.creditos.monto -= t.monto; }
          }
          return {
          nombreQb: b.nombreQb,
          neto: b.transacciones.filter((t) => !hastaOk || t.fecha <= hastaOk).reduce((a, t) => (t.tipo === 'Invoice' || t.tipo === 'Credit Memo' ? a + t.monto : t.tipo === 'Payment' ? a - t.monto : a), 0), // en el archivo: factura +, pago +, nota de crédito −
          };
        });
      setVerif(await api.post<Verificacion>('/facturas/verificar', { clientes: clientesArchivo, desde: desdeOk, hasta: hastaOk, totales }));
    } catch (e) {
      setErrorVerif((e as Error).message);
    } finally {
      setVerificando(false);
    }
  }

  const nombresConocidos = useMemo(() => new Set(clientes.map((c) => c.nombreQb).filter(Boolean) as string[]), [clientes]);

  function handleArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setErrorArchivo(null);
    setLeyendo(true);
    const reader = new FileReader();
    reader.onload = () => {
      // Se deja respirar a la pantalla antes de procesar: el archivo real tiene ~200.000 filas.
      setTimeout(() => {
        try {
          const wb = XLSX.read(reader.result, { type: 'array' });
          const hoja = wb.Sheets[wb.SheetNames[0]];
          const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: '', raw: true });
          const { bloques: b, ignoradas: ig } = parsearReporte(filas);
          if (b.length === 0) setErrorArchivo('No se encontró ningún cliente con movimientos. ¿Es el reporte "Transaction List by Customer" exportado a Excel?');
          else {
            setBloques(b);
            setIgnoradas(ig);
          }
        } catch {
          setErrorArchivo('No se pudo leer el archivo.');
        } finally {
          setLeyendo(false);
        }
      }, 50);
    };
    reader.onerror = () => { setErrorArchivo('No se pudo leer el archivo.'); setLeyendo(false); };
    reader.readAsArrayBuffer(archivo);
  }

  const resumen = useMemo(() => {
    if (!bloques) return null;
    const porTipo = new Map<TipoMovimientoQB, number>();
    const conCliente: BloqueHistorial[] = [];
    const sinCliente: BloqueHistorial[] = [];
    const noClientes: BloqueHistorial[] = [];
    for (const b of bloques) {
      for (const t of b.transacciones) porTipo.set(t.tipo, (porTipo.get(t.tipo) ?? 0) + 1);
      if (nombresConocidos.has(b.nombreQb)) conCliente.push(b);
      else if (esNoCliente(b.nombreQb) || b.transacciones.every((t) => t.tipo === 'Deposit')) noClientes.push(b);
      else sinCliente.push(b);
    }
    const desdeValida = /^\d{4}-\d{2}-\d{2}$/.test(desde);
    const hastaValida = /^\d{4}-\d{2}-\d{2}$/.test(hasta);
    const aImportar = conCliente.reduce(
      (a, b) => {
        const dentro = b.transacciones.filter((t) => (!desdeValida || t.fecha >= desde) && (!hastaValida || t.fecha <= hasta));
        return { facturas: a.facturas + dentro.filter((t) => t.tipo === 'Invoice' && t.monto > 0).length, pagos: a.pagos + dentro.filter((t) => t.tipo === 'Payment' && t.monto > 0).length };
      },
      { facturas: 0, pagos: 0 }
    );
    return { porTipo, conCliente, sinCliente, noClientes, aImportar, desdeValida, hastaValida };
  }, [bloques, nombresConocidos, desde, hasta]);

  async function handleBorrar() {
    setBorrando(true); setMsgBorrado(null);
    try {
      const r = await api.post<{ facturas: number; pagos: number; notasCredito: number; reembolsos: number; clientes: number }>('/facturas/borrar-historial-importado', { confirmacion: 'BORRAR' });
      await recargarMovimientos();
      setConfirmarBorrar(''); setVerif(null);
      setMsgBorrado(`Listo: se borraron ${r.facturas.toLocaleString('en-US')} facturas, ${r.pagos.toLocaleString('en-US')} pagos, ${r.notasCredito.toLocaleString('en-US')} notas de crédito y ${r.reembolsos} reembolsos. ${r.clientes} clientes quedaron listos para importar de nuevo.`);
    } catch (e) {
      setMsgBorrado((e as Error).message);
    } finally {
      setBorrando(false);
    }
  }

  async function handleImportar() {
    if (!resumen) return;
    setErrorImport(null);
    const lotes: BloqueHistorial[][] = [];
    let actual: BloqueHistorial[] = [];
    let n = 0;
    for (const b of resumen.conCliente) {
      actual.push(b);
      n += b.transacciones.length;
      if (n >= MAX_MOVIMIENTOS_POR_LOTE) { lotes.push(actual); actual = []; n = 0; }
    }
    if (actual.length) lotes.push(actual);

    const total = resumen.conCliente.length;
    const acumulado: ResultadoLoteHistorial = { clientes: 0, facturas: 0, pagos: 0, notasCredito: 0, reembolsos: 0, excedentes: 0, yaImportados: [], sinCliente: [], omitidos: { sinMonto: 0, raros: 0, resumidos: 0, depositos: 0 } };
    let hecho = 0;
    setProgreso({ hecho: 0, total });
    try {
      for (const lote of lotes) {
        const r = await importarHistorial(lote, { desde: resumen.desdeValida ? desde : null, hasta: resumen.hastaValida ? hasta : null, refrescar: false });
        acumulado.clientes += r.clientes; acumulado.facturas += r.facturas; acumulado.pagos += r.pagos;
        acumulado.notasCredito += r.notasCredito; acumulado.reembolsos += r.reembolsos; acumulado.excedentes += r.excedentes;
        acumulado.yaImportados.push(...r.yaImportados); acumulado.sinCliente.push(...r.sinCliente);
        for (const k of Object.keys(acumulado.omitidos) as (keyof typeof acumulado.omitidos)[]) acumulado.omitidos[k] += r.omitidos[k];
        hecho += lote.length;
        setProgreso({ hecho, total });
      }
      await recargarMovimientos();
      setResultado(acumulado);
    } catch (e) {
      // Lo que ya se cargó queda guardado; al volver a subir el archivo, esos clientes se omiten solos.
      setErrorImport(`${(e as Error).message} — Se alcanzaron a cargar ${hecho} de ${total} clientes. Podés volver a intentar: los ya cargados se omiten.`);
      await recargarMovimientos().catch(() => {});
    } finally {
      setProgreso(null);
    }
  }

  const importando = progreso !== null;
  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-8 z-50 overflow-y-auto pb-10" onClick={importando ? undefined : onClose}>
      <div className="panel w-[min(660px,96vw)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-semibold text-[15px]">Importar historial del sistema anterior</span>
          <button onClick={onClose} disabled={importando} className="text-lg leading-none hover:text-accent" aria-label="Cerrar">✕</button>
        </div>

        {resultado ? (
          <div className="p-6 text-sm">
            <div className="text-lg font-semibold mb-2 text-center">Listo ✓</div>
            <ul className="list-disc pl-5 text-ink-soft flex flex-col gap-0.5">
              <li><b>{resultado.clientes}</b> clientes con movimientos cargados</li>
              <li><b>{resultado.facturas}</b> facturas y <b>{resultado.pagos}</b> pagos</li>
              <li><b>{resultado.notasCredito}</b> notas de crédito ({resultado.excedentes} son excedentes de pago) y <b>{resultado.reembolsos}</b> reembolsos</li>
              {resultado.omitidos.resumidos > 0 && <li>{resultado.omitidos.resumidos} movimientos anteriores a la fecha elegida se resumieron en un saldo inicial por cliente</li>}
              {resultado.omitidos.depositos > 0 && <li>{resultado.omitidos.depositos} depósitos bancarios a nombre de clientes no se importaron (no cambian la deuda)</li>}
              {resultado.omitidos.sinMonto > 0 && <li>{resultado.omitidos.sinMonto} movimientos en $0 se saltearon</li>}
              {resultado.omitidos.raros > 0 && <li className="text-danger-dark">{resultado.omitidos.raros} movimientos con signo inesperado se saltearon — avisame para revisarlos</li>}
              {resultado.yaImportados.length > 0 && <li>{resultado.yaImportados.length} clientes ya tenían su historial cargado y se omitieron</li>}
            </ul>
            {resultado.sinCliente.length > 0 && (
              <div className="text-danger-dark text-[12.5px] mt-3 border border-danger/30 rounded-[6px] p-2.5 max-h-[120px] overflow-y-auto">
                <b>{resultado.sinCliente.length} sin cliente</b>: {resultado.sinCliente.join(' · ')}
              </div>
            )}
            <div className="text-ink-faint text-[12px] mt-3">Siguiente paso: en Informes contables → Ajustes, “Verificar que cuadra” compara el A/R del libro con el A/R Aging.</div>
            <div className="text-center"><button className="btn-accent mt-4" onClick={onClose}>Cerrar</button></div>
          </div>
        ) : !bloques || !resumen ? (
          <div className="p-4">
            <div className="text-sm text-ink-soft mb-3">
              Subí el reporte <b>"Transaction List by Customer"</b> del sistema anterior en Excel (con Date, Transaction type, Num, Posting, Memo, Account y Amount).
              <b> Importá primero los clientes</b> (Customer Contact List): cada movimiento se asigna al cliente por su nombre completo del sistema anterior.
            </div>
            <div className="text-ink-faint text-[11.5px] mb-3 bg-line-soft rounded-[6px] p-2.5 flex flex-col gap-1">
              <span>el sistema anterior no dice qué pago corresponde a qué factura: cada pago y cada nota de crédito se aplican a la factura abierta más vieja (FIFO). La deuda neta de cada cliente es exactamente la del sistema anterior.</span>
              <span>El método de pago se infiere de la cuenta: Cash on Hand → efectivo · Bank of America → Zelle · Undeposited Funds → Kotapay.</span>
              <span>El número de cada factura y nota de crédito del sistema anterior queda guardado en su descripción.</span>
            </div>
            <div className="border-t border-line pt-4">
              <div className="th-label mb-1.5">Subir archivo (XLSX)</div>
              <input ref={fileInputRef} type="file" accept=".xls,.xlsx" onChange={handleArchivo} className="text-sm" disabled={leyendo} />
              {leyendo && <div className="text-ink-soft text-[12.5px] mt-2">Leyendo el archivo… con cientos de miles de filas puede tardar un minuto.</div>}
              {errorArchivo && <div className="text-danger-dark text-[12.5px] mt-2">{errorArchivo}</div>}
            </div>
          </div>
        ) : (
          <div className="p-4 text-sm">
            <div className="mb-3">
              <b>{bloques.length}</b> bloques de cliente en el archivo:{' '}
              <span className="text-success">{resumen.conCliente.length} coinciden con clientes cargados</span>
              {resumen.noClientes.length > 0 && <>, {resumen.noClientes.length} son formas de pago o cuentas del banco (se ignoran)</>}
              {resumen.sinCliente.length > 0 && <>, <span className="text-danger-dark">{resumen.sinCliente.length} sin coincidencia</span></>}.
            </div>
            <ul className="list-disc pl-5 text-ink-soft text-[12.5px] mb-3">
              {TIPOS.filter((t) => resumen.porTipo.get(t)).map((t) => (
                <li key={t}><b>{resumen.porTipo.get(t)}</b> {ETIQUETA_TIPO[t]}</li>
              ))}
              {ignoradas > 0 && <li>{ignoradas} filas no reconocidas</li>}
            </ul>

            <div className="border border-line rounded-[6px] p-3 mb-3 text-[12.5px]">
              <label className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Cargar el detalle desde</span>
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-8 px-2 border border-line rounded-[5px] bg-surface" />
                <span className="font-medium">hasta</span>
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="h-8 px-2 border border-line rounded-[5px] bg-surface" />
                <button className="chip hover:border-accent" onClick={() => { setDesde('2026-01-01'); setHasta('2026-12-31'); }}>Año 2026</button>
                <button className="chip hover:border-accent" onClick={() => { setDesde('2025-01-01'); setHasta('2025-12-31'); }}>Año 2025</button>
                <button className="chip hover:border-accent" onClick={() => { setDesde(''); setHasta(''); }}>Todo</button>
              </label>
              <div className="text-ink-faint mt-1.5">
                Lo anterior a «desde» se resume en un saldo inicial por cliente (la deuda sigue siendo exacta) y lo posterior a «hasta» no se carga. Cargar los {(resumen.porTipo.get('Invoice') ?? 0).toLocaleString('en-US')} facturas
                completas funciona, pero la app carga todo en memoria y se vuelve más lenta; para el día a día alcanza con el año en curso.
              </div>
              <div className="mt-1.5">Se van a cargar unas <b>{resumen.aImportar.facturas.toLocaleString('en-US')}</b> facturas y <b>{resumen.aImportar.pagos.toLocaleString('en-US')}</b> pagos.</div>
            </div>

            {resumen.sinCliente.length > 0 && (
              <div className="text-danger-dark text-[12px] mb-3 border border-danger/30 rounded-[6px] p-2.5 max-h-[110px] overflow-y-auto">
                <b>Sin coincidencia</b> (el nombre no está en Clientes; van a quedar afuera):
                <ul className="list-disc pl-4 mt-1">
                  {resumen.sinCliente.slice(0, 30).map((b) => <li key={b.nombreQb}>{normalizarEspacios(b.nombreQb)}</li>)}
                  {resumen.sinCliente.length > 30 && <li>… y {resumen.sinCliente.length - 30} más</li>}
                </ul>
              </div>
            )}

            <div className="border border-line rounded-[6px] p-3 mb-3 text-[12.5px]">
              <div className="flex items-center gap-2 flex-wrap">
                <button className="btn-outline" onClick={handleVerificar} disabled={verificando || importando}>{verificando ? 'Verificando…' : 'Verificar contra lo ya cargado'}</button>
                <span className="text-ink-faint">Compara, cliente por cliente, la deuda del archivo con la que quedó en la app.</span>
              </div>
              {errorVerif && <div className="text-danger-dark mt-2">{errorVerif}</div>}
              {verif && (
                <div className="mt-2 flex flex-col gap-1">
                  <div className={verif.cantidadDiferencias === 0 ? 'text-success font-medium' : 'text-danger-dark font-medium'}>
                    {verif.coinciden.toLocaleString('en-US')} de {verif.revisados.toLocaleString('en-US')} clientes coinciden
                    {verif.cantidadDiferencias > 0 && ` · ${verif.cantidadDiferencias} con diferencia`}
                  </div>
                  <div className="text-ink-soft">Deuda total del archivo: <b>${verif.totalArchivo.toLocaleString('en-US', { minimumFractionDigits: 2 })}</b> · en la app: <b>${verif.totalApp.toLocaleString('en-US', { minimumFractionDigits: 2 })}</b> · cargado: {verif.facturasApp.toLocaleString('en-US')} facturas y {verif.pagosApp.toLocaleString('en-US')} pagos</div>
                  {verif.rango && (
                    <table className="w-full text-[12px] mt-1 border-t border-line-soft">
                      <thead><tr className="text-ink-faint text-left"><th className="py-1 font-normal">En el rango elegido</th><th className="font-normal text-right">el sistema anterior</th><th className="font-normal text-right">App</th><th className="font-normal text-right">Dif.</th></tr></thead>
                      <tbody>
                        {verif.rango.map((r) => (
                          <tr key={r.concepto} className="border-t border-line-soft">
                            <td className="py-1">{r.concepto}</td>
                            <td className="text-right num">{r.cantArchivo.toLocaleString('en-US')} · ${r.montoArchivo.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                            <td className="text-right num">{r.cantApp !== null ? `${r.cantApp.toLocaleString('en-US')} · ` : ''}${r.montoApp.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                            <td className={`text-right num ${Math.abs(r.dif) < 0.005 ? 'text-success' : 'text-danger-dark'}`}>{Math.abs(r.dif) < 0.005 ? 'OK' : `$${r.dif.toFixed(2)}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {verif.sinHistorial.length > 0 && <div className="text-danger-dark">{verif.sinHistorial.length} clientes todavía sin historial cargado (falta importar).</div>}
                  {verif.sinCliente.length > 0 && <div className="text-danger-dark">{verif.sinCliente.length} clientes del archivo no existen en la app.</div>}
                  {verif.diferencias.length > 0 && (
                    <ul className="list-disc pl-4 max-h-[110px] overflow-y-auto">
                      {verif.diferencias.map((d) => <li key={d.nombreQb}>{normalizarEspacios(d.nombreQb)}: archivo ${d.archivo.toFixed(2)} · app ${d.app.toFixed(2)} (dif. ${d.dif.toFixed(2)})</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="border border-danger/30 rounded-[6px] p-3 mb-3 text-[12.5px]">
              <div className="font-medium text-danger-dark">Borrar el historial importado</div>
              <div className="text-ink-faint mt-0.5">Elimina todas las facturas, pagos, notas de crédito y reembolsos que vinieron del sistema anterior (no toca lo generado en la app) y deja a los clientes listos para importar de nuevo, por ejemplo con otro rango de fechas.</div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <input value={confirmarBorrar} onChange={(e) => setConfirmarBorrar(e.target.value)} placeholder='Escribí BORRAR para confirmar' className="h-8 px-2 border border-line rounded-[5px] bg-surface w-56" />
                <button className="btn-outline" disabled={confirmarBorrar !== 'BORRAR' || borrando || importando} onClick={handleBorrar}>{borrando ? 'Borrando…' : 'Borrar historial importado'}</button>
              </div>
              {msgBorrado && <div className="mt-2 text-ink-soft">{msgBorrado}</div>}
            </div>

            {progreso && (
              <div className="mb-3" role="status" aria-live="polite">
                <div className="h-2 rounded bg-line-soft overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round((progreso.hecho / Math.max(1, progreso.total)) * 100)}%` }} /></div>
                <div className="text-[12px] text-ink-soft mt-1">Importando… {progreso.hecho} de {progreso.total} clientes. No cierres esta ventana.</div>
              </div>
            )}
            {errorImport && <div role="alert" className="text-danger-dark text-[12.5px] mb-3">{errorImport}</div>}

            <div className="flex gap-2">
              <button className="btn-accent" onClick={handleImportar} disabled={importando || resumen.conCliente.length === 0}>
                {importando ? 'Importando…' : `Importar ${resumen.conCliente.length} cliente${resumen.conCliente.length !== 1 ? 's' : ''}`}
              </button>
              <button className="btn-outline" onClick={() => { setBloques(null); setErrorImport(null); }} disabled={importando}>Elegir otro archivo</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export type { MovimientoQB };
