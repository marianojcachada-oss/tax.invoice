import { describe, expect, it } from 'vitest';
import { esNoCliente, limpiarTelefonos, mapearContacto, parsearNombreQB } from './qbClientes';

describe('parsearNombreQB', () => {
  it.each([
    ['D0018 101001 Ninoska Chirinos', 'D0018', '101001', 'Ninoska Chirinos', false],
    ['EX 455 101666 Gabriel Gonzalez', 'D0455', '101666', 'Gabriel Gonzalez', true],
    ['EX104 101552 Francisco Manchado', 'D0104', '101552', 'Francisco Manchado', true],
    ['EX D238 101601 Luis Raul Alvarez Chavez', 'D238', '101601', 'Luis Raul Alvarez Chavez', true],
    ['D035 ANYURI RANGEL', 'D035', '', 'ANYURI RANGEL', false],
    ['D1215 1030 Yender Josuet Sanchez Luna', 'D1215', '1030', 'Yender Josuet Sanchez Luna', false],
    ['EX 051  Anger Alejandro Almenaz', 'D0051', '', 'Anger Alejandro Almenaz', true],
    ['EXD 156 102203 Ronald Simon Gonzalez Simon', 'D156', '102203', 'Ronald Simon Gonzalez Simon', true],
    ['Angel Daniel Mosquera Martinez', '', '', 'Angel Daniel Mosquera Martinez', false],
  ])('%s', (crudo, codigo, numero, nombre, ex) => {
    expect(parsearNombreQB(crudo)).toEqual({ codigo, numero, nombre, ex });
  });
});

describe('contactos', () => {
  it('limpia los teléfonos', () => {
    expect(limpiarTelefonos('Phone:4707961789 / 7708203509 ')).toBe('4707961789 / 7708203509');
    expect(limpiarTelefonos('Mobile:(678) 387-9880')).toBe('(678) 387-9880');
    expect(limpiarTelefonos('')).toBe('');
  });
  it('detecta lo que no es un cliente', () => {
    for (const n of ['Cash', 'Cash App', 'Zelle Transfer', 'Counter Credit', 'Merchant Services', 'Square', 'error']) expect(esNoCliente(n)).toBe(true);
    expect(esNoCliente('Cash Money Perez')).toBe(false);
  });
  it('mapea una fila completa y guarda lo que no tiene campo propio en notas', () => {
    const c = mapearContacto({
      'Customer full name': 'D0446 102446 Jean Carlos Rojas Carrero',
      'Phone numbers': 'Phone:4045550000 ',
      Email: 'a@b.com',
      'Full name': 'D0446 102446 Jean Carlos Rojas Guerrero',
      'Bill address': '1 Main St, Atlanta, GA',
      'Ship address': '2 Other St, Atlanta, GA',
    });
    expect(c).toMatchObject({ nombreQb: 'D0446 102446 Jean Carlos Rojas Carrero', codigo: 'D0446', numero: '102446', telefonos: '4045550000', estado: 'activo', direccion: '1 Main St, Atlanta, GA' });
    expect(c.notas).toContain('Dirección de envío (QuickBooks): 2 Other St, Atlanta, GA');
    expect(c.notas).toContain('Nombre de facturación (QuickBooks): D0446 102446 Jean Carlos Rojas Guerrero');
  });
  it('sin código o ex-driver quedan inactivos', () => {
    expect(mapearContacto({ 'Customer full name': 'Edwin C Salinas Morales' }).estado).toBe('inactivo');
    expect(mapearContacto({ 'Customer full name': 'EX 455 101666 Gabriel Gonzalez' }).estado).toBe('inactivo');
  });
});
