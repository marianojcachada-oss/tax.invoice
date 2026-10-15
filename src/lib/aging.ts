import type { Cliente, Factura, Pago, FilaAntiguedad, Cuenta, Gasto, Reembolso, Transferencia, BillPago, Bill, Proveedor } from '../types';

// Antes esto dependía de una fecha fija de datos de ejemplo (HOY_ISO). Ahora
// que la app habla con un servidor real, "hoy" tiene que ser el día de
// verdad — si no, los días de atraso quedarían congelados para siempre en
// la fecha en la que se armó el mock. Cada función igual acepta un "hoy"
// explícito (usado en las pruebas) para que el resultado sea reproducible
// sin depender del reloj de la máquina que corre el test.
function hoyPorDefecto(): string {
  return new Date().toISOString().slice(0, 10);
}

export function diasDeAtraso(fechaVencimiento: string, hoy: string = hoyPorDefecto()): number {
  const venc = new Date(fechaVencimiento).getTime();
  const ahora = new Date(hoy).getTime();
  return Math.max(0, Math.round((ahora - venc) / (1000 * 60 * 60 * 24)));
}

/** Sirve tanto para Factura como para Bill (misma forma: monto/montoPagado).
 * Redondea a centavos para evitar que errores de punto flotante (ej. 49.999999
 * en vez de 50) dejen una factura marcada como "pendiente" por una diferencia
 * invisible de centésimas. */
export function saldoPendiente(doc: { monto: number; montoPagado: number }): number {
  const diferencia = Math.round((doc.monto - doc.montoPagado) * 100) / 100;
  return Math.max(0, diferencia);
}

/** Arma la matriz de antigüedad (1-7, 8-14, 15-30, +30) por cliente. */
export function calcularAntiguedad(clientes: Cliente[], facturas: Factura[], hoy: string = hoyPorDefecto()): FilaAntiguedad[] {
  const porCliente = new Map<string, FilaAntiguedad>();

  for (const c of clientes) {
    porCliente.set(c.id, {
      clienteId: c.id,
      nombre: c.nombre,
      alDia: 0,
      d1a7: 0,
      d8a14: 0,
      d15a30: 0,
      masDe30: 0,
      total: 0,
    });
  }

  for (const f of facturas) {
    const pendiente = saldoPendiente(f);
    if (pendiente <= 0) continue;
    const fila = porCliente.get(f.clienteId);
    if (!fila) continue;
    const dias = diasDeAtraso(f.fechaVencimiento, hoy);

    if (dias <= 0) fila.alDia += pendiente;
    else if (dias <= 7) fila.d1a7 += pendiente;
    else if (dias <= 14) fila.d8a14 += pendiente;
    else if (dias <= 30) fila.d15a30 += pendiente;
    else fila.masDe30 += pendiente;

    fila.total += pendiente;
  }

  return Array.from(porCliente.values())
    .filter((f) => f.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** Misma lógica que calcularAntiguedad, pero del lado de cuentas por pagar
 * (proveedores / bills), para la pantalla de Proveedores. */
export function calcularAntiguedadBills(proveedores: Proveedor[], bills: Bill[], hoy: string = hoyPorDefecto()): FilaAntiguedad[] {
  const porProveedor = new Map<string, FilaAntiguedad>();
  for (const p of proveedores) {
    porProveedor.set(p.id, {
      clienteId: p.id,
      nombre: p.nombre,
      alDia: 0,
      d1a7: 0,
      d8a14: 0,
      d15a30: 0,
      masDe30: 0,
      total: 0,
    });
  }
  for (const b of bills) {
    if (b.estado === 'anulada') continue;
    const pendiente = saldoPendiente(b);
    if (pendiente <= 0) continue;
    const fila = porProveedor.get(b.proveedorId);
    if (!fila) continue;
    const dias = diasDeAtraso(b.fechaVencimiento, hoy);
    if (dias <= 0) fila.alDia += pendiente;
    else if (dias <= 7) fila.d1a7 += pendiente;
    else if (dias <= 14) fila.d8a14 += pendiente;
    else if (dias <= 30) fila.d15a30 += pendiente;
    else fila.masDe30 += pendiente;
    fila.total += pendiente;
  }
  return Array.from(porProveedor.values())
    .filter((f) => f.total > 0)
    .sort((a, b) => b.total - a.total);
}

export function totalizarAntiguedad(filas: FilaAntiguedad[]) {
  return filas.reduce(
    (acc, f) => ({
      alDia: acc.alDia + f.alDia,
      d1a7: acc.d1a7 + f.d1a7,
      d8a14: acc.d8a14 + f.d8a14,
      d15a30: acc.d15a30 + f.d15a30,
      masDe30: acc.masDe30 + f.masDe30,
      total: acc.total + f.total,
    }),
    { alDia: 0, d1a7: 0, d8a14: 0, d15a30: 0, masDe30: 0, total: 0 }
  );
}

export function formatoMoneda(valor: number): string {
  const signo = valor < 0 ? '-' : '';
  return `${signo}$${Math.abs(valor).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** Igual que formatoMoneda, pero le agrega un "+" explícito cuando el valor
 * es positivo — pensado para un "saldo neto" donde positivo = a favor del
 * cliente y negativo = el cliente debe, y hace falta que el signo se vea a
 * simple vista sin tener que leer una etiqueta aparte. */
export function formatoSaldoConSigno(valor: number): string {
  if (valor > 0) return `+${formatoMoneda(valor)}`;
  return formatoMoneda(valor);
}

/** Etiqueta de estado de una factura, en el mismo espíritu que "Overdue X days",
 * "Due today", "Partially paid" y "Paid" del sistema real. */
export function estadoFacturaTexto(f: Factura, hoy: string = hoyPorDefecto()): { lineas: string[]; tono: 'ok' | 'alerta' | 'neutro' } {
  const dias = diasDeAtraso(f.fechaVencimiento, hoy);
  const pendiente = saldoPendiente(f);

  if (pendiente <= 0) return { lineas: ['Pagada'], tono: 'ok' };

  const parcial = f.montoPagado > 0;
  if (dias > 0) {
    const linea1 = `Vencida hace ${dias} día${dias !== 1 ? 's' : ''}`;
    return parcial
      ? { lineas: [linea1, `Pago parcial, ${formatoMoneda(pendiente)} pendiente`], tono: 'alerta' }
      : { lineas: [linea1], tono: 'alerta' };
  }
  if (dias === 0) {
    return parcial
      ? { lineas: ['Vence hoy', `Pago parcial, ${formatoMoneda(pendiente)} pendiente`], tono: 'neutro' }
      : { lineas: ['Vence hoy'], tono: 'neutro' };
  }
  return parcial
    ? { lineas: ['Pago parcial', `${formatoMoneda(pendiente)} pendiente`], tono: 'neutro' }
    : { lineas: ['Pendiente'], tono: 'neutro' };
}

/** Reconstruye el detalle de un pago ya guardado (para volver a mostrar el
 * recibo desde el historial), usando el monto EXACTO que ese pago aplicó a
 * cada factura (no el saldo pagado acumulado de la factura, que puede
 * incluir otros pagos posteriores). */
export function construirReciboDesdePago(pago: Pago, facturas: Factura[]) {
  const porId = new Map(facturas.map((f) => [f.id, f]));
  return pago.aplicaciones
    .map((a) => {
      const f = porId.get(a.facturaId);
      if (!f) return null;
      return {
        numero: f.numero,
        fecha: f.fechaVencimiento,
        concepto: f.concepto,
        pago: a.monto,
        saldo: saldoPendiente(f),
        estado: f.estado === 'pagada' ? 'Pagado' : f.estado === 'parcial' ? 'Parcial' : 'Pendiente',
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Saldo actual de una cuenta: saldo inicial + todo lo que entró/salió. */
export function saldoDeCuenta(
  cuenta: Cuenta,
  datos: { pagos: Pago[]; gastos: Gasto[]; reembolsos: Reembolso[]; transferencias: Transferencia[]; billPagos: BillPago[] }
): number {
  let saldo = cuenta.saldoInicial;
  for (const p of datos.pagos) if (p.cuentaId === cuenta.id) saldo += p.monto;
  for (const g of datos.gastos) if (g.cuentaId === cuenta.id) saldo -= g.monto;
  for (const r of datos.reembolsos) if (r.cuentaId === cuenta.id) saldo -= r.monto;
  for (const bp of datos.billPagos) if (bp.cuentaId === cuenta.id) saldo -= bp.monto;
  for (const t of datos.transferencias) {
    if (t.cuentaOrigenId === cuenta.id) saldo -= t.monto;
    if (t.cuentaDestinoId === cuenta.id) saldo += t.monto;
  }
  return saldo;
}

export interface MovimientoCuenta {
  fecha: string;
  tipo: 'Pago recibido' | 'Gasto' | 'Reembolso' | 'Pago a proveedor' | 'Transferencia entrante' | 'Transferencia saliente';
  descripcion: string;
  monto: number; // positivo = entra, negativo = sale
}

export function movimientosDeCuenta(
  cuentaId: string,
  datos: { pagos: Pago[]; gastos: Gasto[]; reembolsos: Reembolso[]; transferencias: Transferencia[]; billPagos: BillPago[] }
): MovimientoCuenta[] {
  const movimientos: MovimientoCuenta[] = [];
  for (const p of datos.pagos) {
    if (p.cuentaId === cuentaId) {
      movimientos.push({ fecha: p.fecha, tipo: 'Pago recibido', descripcion: `Pago #${p.numero}`, monto: p.monto });
    }
  }
  for (const g of datos.gastos) {
    if (g.cuentaId === cuentaId) {
      movimientos.push({ fecha: g.fecha, tipo: 'Gasto', descripcion: g.proveedor, monto: -g.monto });
    }
  }
  for (const r of datos.reembolsos) {
    if (r.cuentaId === cuentaId) {
      movimientos.push({ fecha: r.fecha, tipo: 'Reembolso', descripcion: r.motivo, monto: -r.monto });
    }
  }
  for (const bp of datos.billPagos) {
    if (bp.cuentaId === cuentaId) {
      movimientos.push({ fecha: bp.fecha, tipo: 'Pago a proveedor', descripcion: `Bill pago #${bp.numero}`, monto: -bp.monto });
    }
  }
  for (const t of datos.transferencias) {
    if (t.cuentaOrigenId === cuentaId) {
      movimientos.push({ fecha: t.fecha, tipo: 'Transferencia saliente', descripcion: t.nota ?? 'Transferencia', monto: -t.monto });
    }
    if (t.cuentaDestinoId === cuentaId) {
      movimientos.push({ fecha: t.fecha, tipo: 'Transferencia entrante', descripcion: t.nota ?? 'Transferencia', monto: t.monto });
    }
  }
  return movimientos.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}
