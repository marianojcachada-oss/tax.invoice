import { describe, it, expect } from 'vitest';
import {
  saldoPendiente,
  formatoMoneda,
  formatoSaldoConSigno,
  diasDeAtraso,
  calcularAntiguedad,
  totalizarAntiguedad,
  estadoFacturaTexto,
  construirReciboDesdePago,
} from './aging';
import type { Cliente, Factura, Pago } from '../types';

function crearCliente(overrides: Partial<Cliente> = {}): Cliente {
  return {
    id: 'cli-1',
    codigo: 'D0001',
    numero: '100001',
    nombre: 'Cliente de prueba',
    licenciaInfo: 'LIC GA 01/01/2030',
    telefonos: '(404) 555-0100',
    cuotaSemanal: 145,
    fechaAlta: '2025-01-01',
    estado: 'activo',
    ...overrides,
  };
}

function crearFactura(overrides: Partial<Factura> = {}): Factura {
  return {
    id: 'fac-1',
    numero: 1000,
    clienteId: 'cli-1',
    semana: 37,
    fecha: '2026-09-07',
    fechaVencimiento: '2026-09-14',
    concepto: 'Cuota semana 37',
    monto: 145,
    montoPagado: 0,
    estado: 'pendiente',
    ...overrides,
  };
}

describe('saldoPendiente', () => {
  it('devuelve monto - montoPagado cuando hay saldo', () => {
    const f = crearFactura({ monto: 145, montoPagado: 100 });
    expect(saldoPendiente(f)).toBe(45);
  });

  it('nunca es negativo', () => {
    const f = crearFactura({ monto: 145, montoPagado: 200 });
    expect(saldoPendiente(f)).toBe(0);
  });

  it('redondea errores de punto flotante a centavos (no deja "pagada" como pendiente)', () => {
    // 0.1 + 0.2 en JS da 0.30000000000000004 — esto es justo el tipo de bug
    // que hizo que una factura pagada quedara marcada como pendiente antes.
    const f = crearFactura({ monto: 0.3, montoPagado: 0.1 + 0.2 });
    expect(saldoPendiente(f)).toBe(0);
  });
});

describe('formatoMoneda / formatoSaldoConSigno', () => {
  it('formatoMoneda antepone "-" a los negativos y nada a los positivos', () => {
    expect(formatoMoneda(145)).toBe('$145');
    expect(formatoMoneda(-145)).toBe('-$145');
    expect(formatoMoneda(0)).toBe('$0');
  });

  it('formatoSaldoConSigno agrega "+" explícito a los positivos (saldo a favor)', () => {
    expect(formatoSaldoConSigno(145)).toBe('+$145');
    expect(formatoSaldoConSigno(-145)).toBe('-$145');
    expect(formatoSaldoConSigno(0)).toBe('$0');
  });
});

describe('diasDeAtraso', () => {
  it('calcula los días de diferencia entre la fecha de vencimiento y "hoy"', () => {
    expect(diasDeAtraso('2026-09-01', '2026-09-14')).toBe(13);
  });

  it('nunca es negativo (una factura que vence en el futuro da 0)', () => {
    expect(diasDeAtraso('2026-09-20', '2026-09-14')).toBe(0);
  });
});

describe('estadoFacturaTexto', () => {
  it('una factura pagada siempre da tono "ok", sin importar la fecha', () => {
    const f = crearFactura({ monto: 145, montoPagado: 145, fechaVencimiento: '2020-01-01' });
    const { tono, lineas } = estadoFacturaTexto(f, '2026-09-14');
    expect(tono).toBe('ok');
    expect(lineas[0]).toMatch(/pagada/i);
  });

  it('una factura vencida da tono "alerta"', () => {
    const f = crearFactura({ monto: 145, montoPagado: 0, fechaVencimiento: '2026-08-01' });
    const { tono } = estadoFacturaTexto(f, '2026-09-14');
    expect(tono).toBe('alerta');
  });
});

describe('calcularAntiguedad / totalizarAntiguedad', () => {
  it('agrupa la deuda de cada cliente en el tramo correcto según los días vencidos', () => {
    const clientes = [crearCliente({ id: 'cli-1' }), crearCliente({ id: 'cli-2', nombre: 'Otro cliente' })];
    const facturas = [
      crearFactura({ id: 'f1', clienteId: 'cli-1', monto: 100, montoPagado: 0, fechaVencimiento: '2026-09-13' }), // 1 día
      crearFactura({ id: 'f2', clienteId: 'cli-2', monto: 200, montoPagado: 0, fechaVencimiento: '2026-08-01' }), // vencida hace rato
      crearFactura({ id: 'f3', clienteId: 'cli-2', monto: 50, montoPagado: 50, fechaVencimiento: '2026-08-01' }), // ya pagada, no debería sumar
    ];
    const filas = calcularAntiguedad(clientes, facturas, '2026-09-14');
    const filaCli1 = filas.find((f) => f.clienteId === 'cli-1')!;
    const filaCli2 = filas.find((f) => f.clienteId === 'cli-2')!;

    expect(filaCli1.d1a7).toBe(100);
    expect(filaCli1.total).toBe(100);
    expect(filaCli2.masDe30).toBe(200);
    expect(filaCli2.total).toBe(200); // la factura pagada (f3) no debe sumar

    const totales = totalizarAntiguedad(filas);
    expect(totales.total).toBe(300);
  });

  it('un cliente sin deuda no aparece en el resultado', () => {
    const clientes = [crearCliente()];
    const facturas = [crearFactura({ monto: 100, montoPagado: 100 })];
    const filas = calcularAntiguedad(clientes, facturas, '2026-09-14');
    expect(filas.length).toBe(0);
  });
});

describe('construirReciboDesdePago', () => {
  it('usa el monto EXACTO que ese pago aplicó a cada factura, no el saldo total de la factura', () => {
    // Esto es clave para pagos parciales: si una factura de $145 recibió dos
    // pagos distintos de $50 y $95, el recibo del primer pago tiene que
    // mostrar $50, no el monto acumulado.
    const factura = crearFactura({ id: 'f1', numero: 40100, monto: 145, montoPagado: 145 });
    const pago: Pago = {
      id: 'pago-1',
      numero: 1,
      clienteId: 'cli-1',
      fecha: '2026-09-10',
      monto: 50,
      metodo: 'zelle',
      aplicaciones: [{ facturaId: 'f1', monto: 50 }],
    };
    const items = construirReciboDesdePago(pago, [factura]);
    expect(items).toHaveLength(1);
    expect(items[0].pago).toBe(50);
    expect(items[0].numero).toBe(40100);
  });

  it('ignora aplicaciones a facturas que ya no existen (defensivo)', () => {
    const pago: Pago = {
      id: 'pago-1',
      numero: 1,
      clienteId: 'cli-1',
      fecha: '2026-09-10',
      monto: 50,
      metodo: 'zelle',
      aplicaciones: [{ facturaId: 'no-existe', monto: 50 }],
    };
    expect(construirReciboDesdePago(pago, [])).toHaveLength(0);
  });
});
