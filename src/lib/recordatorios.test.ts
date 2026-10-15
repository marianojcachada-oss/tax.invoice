import { describe, it, expect } from 'vitest';
import { clienteElegibleParaRecordatorio, armarMensajeRecordatorio } from './recordatorios';
import type { Cliente, ConfiguracionRecordatorios, Factura } from '../types';

function crearCliente(overrides: Partial<Cliente> = {}): Cliente {
  return {
    id: 'cli-1',
    codigo: 'D0001',
    numero: '100001',
    nombre: 'Andrés Romero',
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

const configBase: ConfiguracionRecordatorios = {
  activo: true,
  semanasActividadReciente: 4,
  soloConSaldoVencido: true,
  plantillaMensaje: 'Hola {nombre}, tenés un saldo pendiente de {monto} ({dias} días de atraso).',
  ringcentral: {},
};

describe('clienteElegibleParaRecordatorio', () => {
  it('no es elegible si los recordatorios están desactivados', () => {
    const cliente = crearCliente();
    const facturas = [crearFactura({ semana: 37 })];
    const elegible = clienteElegibleParaRecordatorio(cliente, facturas, { ...configBase, activo: false }, 37);
    expect(elegible).toBe(false);
  });

  it('no es elegible si el cliente está dado de baja', () => {
    const cliente = crearCliente({ estado: 'inactivo' });
    const facturas = [crearFactura({ semana: 37 })];
    expect(clienteElegibleParaRecordatorio(cliente, facturas, configBase, 37)).toBe(false);
  });

  it('NO es elegible si no facturó en las últimas N semanas (el caso que pidió el dueño del negocio: no contactar a alguien del histórico que ya no trabaja)', () => {
    const cliente = crearCliente();
    // última factura hace 10 semanas, config pide actividad en las últimas 4
    const facturas = [crearFactura({ semana: 27, montoPagado: 0 })];
    expect(clienteElegibleParaRecordatorio(cliente, facturas, configBase, 37)).toBe(false);
  });

  it('es elegible si facturó recientemente y tiene saldo vencido', () => {
    const cliente = crearCliente();
    const facturas = [crearFactura({ semana: 36, montoPagado: 0 })];
    expect(clienteElegibleParaRecordatorio(cliente, facturas, configBase, 37)).toBe(true);
  });

  it('si "soloConSaldoVencido" es false, no hace falta deuda para ser elegible', () => {
    const cliente = crearCliente();
    const facturas = [crearFactura({ semana: 36, montoPagado: 145 })]; // ya pagada
    const config = { ...configBase, soloConSaldoVencido: false };
    expect(clienteElegibleParaRecordatorio(cliente, facturas, config, 37)).toBe(true);
  });

  it('si "soloConSaldoVencido" es true y no debe nada, no es elegible', () => {
    const cliente = crearCliente();
    const facturas = [crearFactura({ semana: 36, montoPagado: 145 })];
    expect(clienteElegibleParaRecordatorio(cliente, facturas, configBase, 37)).toBe(false);
  });
});

describe('armarMensajeRecordatorio', () => {
  it('reemplaza {nombre}, {monto} y {dias} con los datos reales del cliente', () => {
    const cliente = crearCliente({ nombre: 'Andrés Romero' });
    const facturas = [crearFactura({ monto: 145, montoPagado: 0, fechaVencimiento: '2026-09-01' })];
    const mensaje = armarMensajeRecordatorio('Hola {nombre}, debés {monto} ({dias} días)', cliente, facturas);
    expect(mensaje).toContain('Andrés Romero');
    expect(mensaje).toContain('$145');
    expect(mensaje).not.toContain('{nombre}');
    expect(mensaje).not.toContain('{monto}');
    expect(mensaje).not.toContain('{dias}');
  });
});
