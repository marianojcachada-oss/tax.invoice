import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  Cliente,
  Factura,
  Pago,
  Gasto,
  NotaCredito,
  Reembolso,
  ConfiguracionCobro,
  Cuenta,
  Transferencia,
  Proveedor,
  Bill,
  BillPago,
  DocumentoCliente,
  Usuario,
  RolUsuario,
  ItemCatalogoFee,
  PagoEmail,
} from '../types';
import { api, setToken, getToken, ApiError, descargarArchivo } from './apiClient';

// ─────────────────────────────────────────────────────────────────────
// Esta capa habla con el backend real (ver carpeta server/). Ya NO guarda
// nada en localStorage del navegador — todo vive en la base de datos del
// servidor. La lógica de negocio (pagos parciales, edición de pagos,
// notas de crédito, facturación semanal, roles) también vive del lado
// del servidor; acá el frontend solo pide y refleja lo que el servidor
// responde.
// ─────────────────────────────────────────────────────────────────────

export type TipoMovimientoQB = 'Invoice' | 'Payment' | 'Deposit' | 'Credit Memo' | 'Refund' | 'Expense' | 'Check';
export interface MovimientoQB {
  fecha: string; // ISO
  tipo: TipoMovimientoQB;
  num: string;
  memo: string;
  cuenta: string;
  monto: number; // con el signo de QuickBooks
}
export interface BloqueHistorial {
  nombreQb: string;
  transacciones: MovimientoQB[];
}
export interface ResultadoLoteHistorial {
  clientes: number;
  facturas: number;
  pagos: number;
  notasCredito: number;
  reembolsos: number;
  excedentes: number;
  yaImportados: string[];
  sinCliente: string[];
  omitidos: { sinMonto: number; raros: number; resumidos: number; depositos: number };
}

interface DataStore {
  cargando: boolean;
  errorConexion: string | null;

  clientes: Cliente[];
  facturas: Factura[];
  pagos: Pago[];
  gastos: Gasto[];
  notasCredito: NotaCredito[];
  reembolsos: Reembolso[];
  configuracion: ConfiguracionCobro;
  cuentas: Cuenta[];
  transferencias: Transferencia[];
  proveedores: Proveedor[];
  bills: Bill[];
  billPagos: BillPago[];
  catalogoFees: ItemCatalogoFee[];
  usuarios: Usuario[];
  usuarioActual: Usuario | null;
  usuariosParaLogin: { id: string; nombre: string; rol: RolUsuario }[];

  getCliente: (id: string) => Cliente | undefined;
  getFacturasDeCliente: (id: string) => Factura[];
  getPagosDeCliente: (id: string) => Pago[];
  getProveedor: (id: string) => Proveedor | undefined;
  getBillsDeProveedor: (id: string) => Bill[];
  getDocumentosDeCliente: (id: string) => Promise<DocumentoCliente[]>;

  iniciarSesion: (usuarioId: string, pin: string) => Promise<boolean>;
  cerrarSesion: () => void;

  agregarCliente: (input: Omit<Cliente, 'id'>) => Promise<Cliente>;
  importarClientesLote: (
    filas: (Omit<Cliente, 'id' | 'fechaAlta'> & { saldoInicial?: number })[]
  ) => Promise<{ importados: number; conSaldoInicial: number; omitidos: number }>;
  actualizarCliente: (
    id: string,
    cambios: Partial<Omit<Cliente, 'id'>>
  ) => Promise<{ codigo: string; etiqueta: string; monto: number; facturaId: string } | null>;
  agregarFactura: (input: { clienteId: string; concepto: string; monto: number; fechaVencimiento?: string; codigo?: string; beneficiarioId?: string }) => Promise<Factura>;
  editarFactura: (facturaId: string, cambios: { concepto?: string; monto?: number; fechaVencimiento?: string }) => Promise<void>;
  generarFacturasSemanales: () => Promise<{ semana: number; generadas: number; salteadasInactivos: number; yaExistian: number; feesAplicados: number }>;

  registrarPago: (input: {
    clienteId: string;
    metodo: string;
    referencia?: string;
    cuentaId?: string;
    aplicaciones: { facturaId: string; monto: number }[];
  }) => Promise<Pago>;
  editarPago: (
    pagoId: string,
    cambios: { metodo?: string; referencia?: string; cuentaId?: string; aplicaciones?: { facturaId: string; monto: number }[] }
  ) => Promise<void>;

  agregarNotaCredito: (input: Omit<NotaCredito, 'id' | 'numero' | 'montoAplicado' | 'facturasAplicadas'>) => Promise<NotaCredito>;
  editarNotaCredito: (notaId: string, cambios: { motivo?: string; monto?: number }) => Promise<void>;
  aplicarNotaCredito: (notaId: string, facturaIds: string[]) => Promise<void>;
  agregarReembolso: (input: Omit<Reembolso, 'id' | 'numero'>) => Promise<Reembolso>;
  agregarGasto: (input: Omit<Gasto, 'id'>) => Promise<Gasto>;

  actualizarConfiguracion: (config: ConfiguracionCobro) => Promise<void>;

  agregarCuenta: (input: Omit<Cuenta, 'id'>) => Promise<Cuenta>;
  eliminarCuenta: (id: string) => Promise<{ ok: boolean; motivo?: string }>;
  registrarTransferencia: (input: Omit<Transferencia, 'id'>) => Promise<Transferencia>;

  agregarProveedor: (input: Omit<Proveedor, 'id'>) => Promise<Proveedor>;
  eliminarProveedor: (id: string) => Promise<{ ok: boolean; motivo?: string }>;
  agregarBill: (input: { proveedorId: string; concepto: string; monto: number; fecha: string; fechaVencimiento: string }) => Promise<Bill>;
  registrarPagoBill: (input: {
    proveedorId: string;
    metodo: string;
    cuentaId?: string;
    monto: number;
    billIds: string[];
  }) => Promise<BillPago>;

  agregarDocumento: (input: Omit<DocumentoCliente, 'id'>) => Promise<DocumentoCliente>;
  eliminarDocumento: (id: string) => Promise<void>;

  agregarUsuario: (input: { nombre: string; email?: string; rol: RolUsuario; pin: string; activo: boolean }) => Promise<Usuario>;
  actualizarUsuario: (id: string, cambios: Partial<{ rol: RolUsuario; activo: boolean; pin: string }>) => Promise<void>;

  enviarRecordatorioCliente: (clienteId: string) => Promise<{ enviado: boolean; motivo: string }>;
  enviarRecordatoriosMasivo: () => Promise<{ enviados: number; salteados: number }>;
  descargarFacturaPdf: (facturaId: string, numeroFactura: number) => Promise<void>;
  enviarFacturaPorMail: (facturaId: string, email?: string) => Promise<{ enviado: boolean; motivo: string }>;
  borrarTodo: (confirmacion: string) => Promise<void>;
  getPagosEmail: () => Promise<PagoEmail[]>;
  actualizarBandejaPagosEmail: () => Promise<{ encontrados: number; nuevos: number }>;
  aplicarPagoEmail: (id: string, clienteId: string, confirmarSinDinero?: boolean) => Promise<PagoEmail>;
  descartarPagoEmail: (id: string) => Promise<void>;
  estadoOutlookConfigurado: () => Promise<{ configurado: boolean }>;
  importarHistorial: (bloques: BloqueHistorial[], opciones?: { desde?: string | null; refrescar?: boolean }) => Promise<ResultadoLoteHistorial>;
  recargarMovimientos: () => Promise<void>;
  agregarItemCatalogoFee: (input: { codigo: string; etiqueta: string; monto: number }) => Promise<ItemCatalogoFee>;
  actualizarItemCatalogoFee: (id: string, cambios: Partial<{ codigo: string; etiqueta: string; monto: number }>) => Promise<void>;
  eliminarItemCatalogoFee: (id: string) => Promise<void>;
  getFeesPendientesDeCliente: (clienteId: string) => Promise<string[]>;
  marcarFeePendiente: (clienteId: string, feeId: string) => Promise<void>;
  desmarcarFeePendiente: (clienteId: string, feeId: string) => Promise<void>;
}

const DataContext = createContext<DataStore | null>(null);

const CONFIG_VACIA: ConfiguracionCobro = {
  cuotaSemanalPorDefecto: 145,
  diaEmision: 'lun',
  metodosHabilitados: ['zelle', 'efectivo', 'kotapay'],
  precioPorDia: {},
  recordatorios: {
    activo: false,
    semanasActividadReciente: 4,
    soloConSaldoVencido: true,
    plantillaMensaje: '',
    ringcentral: {},
  },
  mail: { envioAutomatico: false, metodo: 'graph', buzonEnvio: '', remitenteNombre: '', remitenteDireccion: '', responderA: '', asunto: '', mensaje: '', smtp: { host: '', puerto: 587, usuario: '', clave: '' } },
  empresa: {},
};

export function DataProvider({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const [errorConexion, setErrorConexion] = useState<string | null>(null);
  const [usuarioActual, setUsuarioActual] = useState<Usuario | null>(null);
  const [usuariosParaLogin, setUsuariosParaLogin] = useState<{ id: string; nombre: string; rol: RolUsuario }[]>([]);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [notasCredito, setNotasCredito] = useState<NotaCredito[]>([]);
  const [reembolsos, setReembolsos] = useState<Reembolso[]>([]);
  const [configuracion, setConfiguracion] = useState<ConfiguracionCobro>(CONFIG_VACIA);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [transferencias, setTransferencias] = useState<Transferencia[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [billPagos, setBillPagos] = useState<BillPago[]>([]);
  const [catalogoFees, setCatalogoFees] = useState<ItemCatalogoFee[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);

  // Trae la lista pública de usuarios (para la pantalla de login) sin
  // necesitar sesión — se hace apenas arranca la app.
  useEffect(() => {
    api
      .get<{ id: string; nombre: string; rol: RolUsuario }[]>('/auth/usuarios-para-login')
      .then(setUsuariosParaLogin)
      .catch(() => {
        setErrorConexion('No se pudo conectar con el servidor. ¿Está corriendo (npm run dev en la carpeta server)?');
      });
  }, []);

  const cargarTodo = useCallback(async () => {
    const [
      cli, fac, pag, gas, nc, reemb, cfg, cue, trans, prov, bil, bilPag, us, catFees,
    ] = await Promise.all([
      api.get<Cliente[]>('/clientes'),
      api.get<Factura[]>('/facturas'),
      api.get<Pago[]>('/pagos'),
      api.get<Gasto[]>('/gastos'),
      api.get<NotaCredito[]>('/notas-credito'),
      api.get<Reembolso[]>('/reembolsos'),
      api.get<ConfiguracionCobro>('/configuracion'),
      api.get<Cuenta[]>('/cuentas'),
      api.get<Transferencia[]>('/cuentas/transferencias'),
      api.get<Proveedor[]>('/proveedores'),
      api.get<Bill[]>('/bills'),
      api.get<BillPago[]>('/bills/pagos'),
      api.get<Usuario[]>('/auth/usuarios'),
      api.get<ItemCatalogoFee[]>('/catalogo-fees'),
    ]);
    setClientes(cli);
    setFacturas(fac);
    setPagos(pag);
    setGastos(gas);
    setNotasCredito(nc);
    setReembolsos(reemb);
    setConfiguracion(cfg);
    setCuentas(cue);
    setTransferencias(trans);
    setProveedores(prov);
    setBills(bil);
    setBillPagos(bilPag);
    setUsuarios(us);
    setCatalogoFees(catFees);
  }, []);

  // Al montar: si hay un token guardado de una sesión anterior, se intenta
  // recuperar y traer todos los datos. Si el token ya venció o el
  // servidor no responde, se vuelve a la pantalla de login.
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setCargando(false);
      return;
    }
    (async () => {
      try {
        const yo = await api.get<Usuario>('/auth/yo');
        setUsuarioActual(yo);
        await cargarTodo();
      } catch (e) {
        setToken(null);
        if (e instanceof ApiError && e.status === 0) setErrorConexion(e.message);
      } finally {
        setCargando(false);
      }
    })();
  }, [cargarTodo]);

  async function iniciarSesion(usuarioId: string, pin: string): Promise<boolean> {
    try {
      const { token, usuario } = await api.post<{ token: string; usuario: Usuario }>('/auth/login', { usuarioId, pin });
      setToken(token);
      setUsuarioActual(usuario);
      setErrorConexion(null);
      await cargarTodo();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setErrorConexion(e.message);
      return false;
    }
  }

  function cerrarSesion() {
    api.post('/auth/logout').catch(() => {});
    setToken(null);
    setUsuarioActual(null);
    setClientes([]);
    setFacturas([]);
    setPagos([]);
    setGastos([]);
    setNotasCredito([]);
    setReembolsos([]);
    setCuentas([]);
    setTransferencias([]);
    setProveedores([]);
    setBills([]);
    setBillPagos([]);
    setUsuarios([]);
    setCatalogoFees([]);
  }

  const value = useMemo<DataStore>(() => {
    const getCliente = (id: string) => clientes.find((c) => c.id === id);
    const getFacturasDeCliente = (id: string) => facturas.filter((f) => f.clienteId === id).sort((a, b) => b.semana - a.semana);
    const getPagosDeCliente = (id: string) => pagos.filter((p) => p.clienteId === id).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    const getProveedor = (id: string) => proveedores.find((p) => p.id === id);
    const getBillsDeProveedor = (id: string) => bills.filter((b) => b.proveedorId === id);
    const getDocumentosDeCliente = (id: string) => api.get<DocumentoCliente[]>(`/documentos/cliente/${id}`);

    async function agregarCliente(input: Omit<Cliente, 'id'>): Promise<Cliente> {
      const nuevo = await api.post<Cliente>('/clientes', input);
      setClientes((prev) => [nuevo, ...prev]);
      return nuevo;
    }

    async function importarClientesLote(
      filas: (Omit<Cliente, 'id' | 'fechaAlta'> & { saldoInicial?: number })[]
    ) {
      const resultado = await api.post<{ importados: number; conSaldoInicial: number; omitidos: number }>('/clientes/importar-lote', {
        clientes: filas,
      });
      setClientes(await api.get<Cliente[]>('/clientes'));
      setFacturas(await api.get<Factura[]>('/facturas'));
      return resultado;
    }

    async function actualizarCliente(id: string, cambios: Partial<Omit<Cliente, 'id'>>) {
      const respuesta = await api.patch<Cliente & { feeAutomatico: { codigo: string; etiqueta: string; monto: number; facturaId: string } | null }>(
        `/clientes/${id}`,
        cambios
      );
      const { feeAutomatico, ...actualizado } = respuesta;
      setClientes((prev) => prev.map((c) => (c.id === id ? actualizado : c)));
      if (feeAutomatico) setFacturas(await api.get<Factura[]>('/facturas'));
      return feeAutomatico ?? null;
    }

    async function agregarFactura(input: { clienteId: string; concepto: string; monto: number; fechaVencimiento?: string; codigo?: string; beneficiarioId?: string }) {
      const nueva = await api.post<Factura>('/facturas', input);
      setFacturas((prev) => [nueva, ...prev]);
      return nueva;
    }

    async function editarFactura(facturaId: string, cambios: { concepto?: string; monto?: number; fechaVencimiento?: string }) {
      const actualizada = await api.patch<Factura>(`/facturas/${facturaId}`, cambios);
      setFacturas((prev) => prev.map((f) => (f.id === facturaId ? actualizada : f)));
    }

    async function generarFacturasSemanales() {
      const resultado = await api.post<{ semana: number; generadas: number; salteadasInactivos: number; yaExistian: number; feesAplicados: number }>(
        '/facturas/generar-semanal'
      );
      setFacturas(await api.get<Factura[]>('/facturas'));
      return resultado;
    }

    async function registrarPago(input: Parameters<DataStore['registrarPago']>[0]) {
      const pago = await api.post<Pago>('/pagos', input);
      setPagos((prev) => [pago, ...prev]);
      setFacturas(await api.get<Factura[]>('/facturas'));
      setNotasCredito(await api.get<NotaCredito[]>('/notas-credito')); // por si una factura 1060DR generó saldo a favor
      return pago;
    }

    async function editarPago(pagoId: string, cambios: Parameters<DataStore['editarPago']>[1]) {
      const actualizado = await api.patch<Pago>(`/pagos/${pagoId}`, cambios);
      setPagos((prev) => prev.map((p) => (p.id === pagoId ? actualizado : p)));
      setFacturas(await api.get<Factura[]>('/facturas'));
      setNotasCredito(await api.get<NotaCredito[]>('/notas-credito'));
    }

    async function agregarNotaCredito(input: Omit<NotaCredito, 'id' | 'numero' | 'montoAplicado' | 'facturasAplicadas'>) {
      const nueva = await api.post<NotaCredito>('/notas-credito', input);
      setNotasCredito((prev) => [nueva, ...prev]);
      return nueva;
    }

    async function editarNotaCredito(notaId: string, cambios: { motivo?: string; monto?: number }) {
      const actualizada = await api.patch<NotaCredito>(`/notas-credito/${notaId}`, cambios);
      setNotasCredito((prev) => prev.map((n) => (n.id === notaId ? actualizada : n)));
    }

    async function aplicarNotaCredito(notaId: string, facturaIds: string[]) {
      const actualizada = await api.post<NotaCredito>(`/notas-credito/${notaId}/aplicar`, { facturaIds });
      setNotasCredito((prev) => prev.map((n) => (n.id === notaId ? actualizada : n)));
      setFacturas(await api.get<Factura[]>('/facturas'));
    }

    async function agregarReembolso(input: Omit<Reembolso, 'id' | 'numero'>) {
      const nuevo = await api.post<Reembolso>('/reembolsos', input);
      setReembolsos((prev) => [nuevo, ...prev]);
      return nuevo;
    }

    async function agregarGasto(input: Omit<Gasto, 'id'>) {
      const nuevo = await api.post<Gasto>('/gastos', input);
      setGastos((prev) => [nuevo, ...prev]);
      return nuevo;
    }

    async function actualizarConfiguracion(config: ConfiguracionCobro) {
      const actualizada = await api.patch<ConfiguracionCobro>('/configuracion', config);
      setConfiguracion(actualizada);
    }

    async function agregarCuenta(input: Omit<Cuenta, 'id'>) {
      const nueva = await api.post<Cuenta>('/cuentas', input);
      setCuentas((prev) => [nueva, ...prev]);
      return nueva;
    }

    async function eliminarCuenta(id: string): Promise<{ ok: boolean; motivo?: string }> {
      try {
        await api.delete(`/cuentas/${id}`);
        setCuentas((prev) => prev.filter((c) => c.id !== id));
        return { ok: true };
      } catch (e) {
        return { ok: false, motivo: e instanceof ApiError ? e.message : 'No se pudo eliminar.' };
      }
    }

    async function registrarTransferencia(input: Omit<Transferencia, 'id'>) {
      const nueva = await api.post<Transferencia>('/cuentas/transferencias', input);
      setTransferencias((prev) => [nueva, ...prev]);
      return nueva;
    }

    async function agregarProveedor(input: Omit<Proveedor, 'id'>) {
      const nuevo = await api.post<Proveedor>('/proveedores', input);
      setProveedores((prev) => [nuevo, ...prev]);
      return nuevo;
    }

    async function eliminarProveedor(id: string): Promise<{ ok: boolean; motivo?: string }> {
      try {
        await api.delete(`/proveedores/${id}`);
        setProveedores((prev) => prev.filter((p) => p.id !== id));
        return { ok: true };
      } catch (e) {
        return { ok: false, motivo: e instanceof ApiError ? e.message : 'No se pudo eliminar.' };
      }
    }

    async function agregarBill(input: { proveedorId: string; concepto: string; monto: number; fecha: string; fechaVencimiento: string }) {
      const nueva = await api.post<Bill>('/bills', input);
      setBills((prev) => [nueva, ...prev]);
      return nueva;
    }

    async function registrarPagoBill(input: Parameters<DataStore['registrarPagoBill']>[0]) {
      const aplicaciones = input.billIds.map((billId) => {
        const bill = bills.find((b) => b.id === billId)!;
        const debe = Math.max(0, bill.monto - bill.montoPagado);
        return { billId, monto: Math.min(debe, input.monto) };
      });
      const nuevo = await api.post<BillPago>('/bills/pagos', { ...input, aplicaciones });
      setBillPagos((prev) => [nuevo, ...prev]);
      setBills(await api.get<Bill[]>('/bills'));
      return nuevo;
    }

    async function agregarDocumento(input: Omit<DocumentoCliente, 'id'>) {
      return api.post<DocumentoCliente>('/documentos', input);
    }

    async function eliminarDocumento(id: string) {
      await api.delete(`/documentos/${id}`);
    }

    async function agregarUsuario(input: { nombre: string; email?: string; rol: RolUsuario; pin: string; activo: boolean }) {
      const nuevo = await api.post<Usuario>('/auth/usuarios', input);
      setUsuarios((prev) => [...prev, nuevo]);
      return nuevo;
    }

    async function actualizarUsuario(id: string, cambios: Partial<{ rol: RolUsuario; activo: boolean; pin: string }>) {
      const actualizado = await api.patch<Usuario>(`/auth/usuarios/${id}`, cambios);
      setUsuarios((prev) => prev.map((u) => (u.id === id ? actualizado : u)));
    }

    async function enviarRecordatorioCliente(clienteId: string) {
      return api.post<{ enviado: boolean; motivo: string }>(`/recordatorios/cliente/${clienteId}`);
    }

    async function enviarRecordatoriosMasivo() {
      return api.post<{ enviados: number; salteados: number }>('/recordatorios/masivo');
    }

    async function descargarFacturaPdf(facturaId: string, numeroFactura: number) {
      const blob = await descargarArchivo(`/facturas/${facturaId}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factura-${numeroFactura}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    }

    async function enviarFacturaPorMail(facturaId: string, email?: string) {
      return api.post<{ enviado: boolean; motivo: string }>(`/facturas/${facturaId}/enviar`, email ? { email } : undefined);
    }

    function getPagosEmail() {
      return api.get<PagoEmail[]>('/pagos-email');
    }

    function actualizarBandejaPagosEmail() {
      return api.post<{ encontrados: number; nuevos: number }>('/pagos-email/actualizar');
    }

    async function aplicarPagoEmail(id: string, clienteId: string, confirmarSinDinero = false) {
      const r = await api.post<PagoEmail>(`/pagos-email/${id}/aplicar`, { clienteId, confirmarSinDinero });
      const [fac, pag, nc] = await Promise.all([
        api.get<Factura[]>('/facturas'),
        api.get<Pago[]>('/pagos'),
        api.get<NotaCredito[]>('/notas-credito'),
      ]);
      setFacturas(fac);
      setPagos(pag);
      setNotasCredito(nc);
      return r;
    }

    async function descartarPagoEmail(id: string) {
      await api.post(`/pagos-email/${id}/descartar`);
    }

    function estadoOutlookConfigurado() {
      return api.get<{ configurado: boolean }>('/pagos-email/estado-outlook');
    }

    async function borrarTodo(confirmacion: string) {
      await api.post('/admin/borrar-todo', { confirmacion });
      // Se recarga todo desde cero (ahora vacío) en vez de tratar de
      // limpiar cada array local a mano.
      setClientes([]);
      setFacturas([]);
      setPagos([]);
      setGastos([]);
      setNotasCredito([]);
      setReembolsos([]);
      setCuentas([]);
      setTransferencias([]);
      setProveedores([]);
      setBills([]);
      setBillPagos([]);
    }

    async function recargarMovimientos() {
      setClientes(await api.get<Cliente[]>('/clientes'));
      setFacturas(await api.get<Factura[]>('/facturas'));
      setPagos(await api.get<Pago[]>('/pagos'));
      setNotasCredito(await api.get<NotaCredito[]>('/notas-credito'));
      setReembolsos(await api.get<Reembolso[]>('/reembolsos'));
    }

    async function importarHistorial(bloques: BloqueHistorial[], opciones: { desde?: string | null; refrescar?: boolean } = {}) {
      const resultado = await api.post<ResultadoLoteHistorial>('/facturas/importar-historial', { bloques, desde: opciones.desde ?? null });
      if (opciones.refrescar !== false) await recargarMovimientos();
      return resultado;
    }

    async function agregarItemCatalogoFee(input: { codigo: string; etiqueta: string; monto: number }) {
      const nuevo = await api.post<ItemCatalogoFee>('/catalogo-fees', input);
      setCatalogoFees((prev) => [...prev, nuevo]);
      return nuevo;
    }

    async function actualizarItemCatalogoFee(id: string, cambios: Partial<{ codigo: string; etiqueta: string; monto: number }>) {
      const actualizado = await api.patch<ItemCatalogoFee>(`/catalogo-fees/${id}`, cambios);
      setCatalogoFees((prev) => prev.map((f) => (f.id === id ? actualizado : f)));
    }

    async function eliminarItemCatalogoFee(id: string) {
      await api.delete(`/catalogo-fees/${id}`);
      setCatalogoFees((prev) => prev.filter((f) => f.id !== id));
    }

    function getFeesPendientesDeCliente(clienteId: string) {
      return api.get<string[]>(`/clientes/${clienteId}/fees-pendientes`);
    }

    async function marcarFeePendiente(clienteId: string, feeId: string) {
      await api.post(`/clientes/${clienteId}/fees-pendientes/${feeId}`);
    }

    async function desmarcarFeePendiente(clienteId: string, feeId: string) {
      await api.delete(`/clientes/${clienteId}/fees-pendientes/${feeId}`);
    }

    return {
      cargando,
      errorConexion,
      clientes,
      facturas,
      pagos,
      gastos,
      notasCredito,
      reembolsos,
      configuracion,
      cuentas,
      transferencias,
      proveedores,
      bills,
      billPagos,
      usuarios,
      usuarioActual,
      usuariosParaLogin,
      catalogoFees,
      getCliente,
      getFacturasDeCliente,
      getPagosDeCliente,
      getProveedor,
      getBillsDeProveedor,
      getDocumentosDeCliente,
      iniciarSesion,
      cerrarSesion,
      agregarCliente,
      importarClientesLote,
      actualizarCliente,
      agregarFactura,
      editarFactura,
      generarFacturasSemanales,
      registrarPago,
      editarPago,
      agregarNotaCredito,
      editarNotaCredito,
      aplicarNotaCredito,
      agregarReembolso,
      agregarGasto,
      actualizarConfiguracion,
      agregarCuenta,
      eliminarCuenta,
      registrarTransferencia,
      agregarProveedor,
      eliminarProveedor,
      agregarBill,
      registrarPagoBill,
      agregarDocumento,
      eliminarDocumento,
      agregarUsuario,
      actualizarUsuario,
      enviarRecordatorioCliente,
      enviarRecordatoriosMasivo,
      descargarFacturaPdf,
      enviarFacturaPorMail,
      borrarTodo,
      getPagosEmail,
      actualizarBandejaPagosEmail,
      aplicarPagoEmail,
      descartarPagoEmail,
      estadoOutlookConfigurado,
      importarHistorial,
      recargarMovimientos,
      agregarItemCatalogoFee,
      actualizarItemCatalogoFee,
      eliminarItemCatalogoFee,
      getFeesPendientesDeCliente,
      marcarFeePendiente,
      desmarcarFeePendiente,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cargando,
    errorConexion,
    clientes,
    facturas,
    pagos,
    gastos,
    notasCredito,
    reembolsos,
    configuracion,
    cuentas,
    transferencias,
    proveedores,
    bills,
    billPagos,
    usuarios,
    usuarioActual,
    usuariosParaLogin,
    catalogoFees,
  ]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useDataStore(): DataStore {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useDataStore debe usarse dentro de <DataProvider>');
  return ctx;
}
