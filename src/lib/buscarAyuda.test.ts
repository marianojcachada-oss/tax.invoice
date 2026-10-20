import { describe, it, expect } from 'vitest';
import { buscarAyuda, normalizar, resaltar, tokenizar } from './buscarAyuda';
import { TEMAS } from '../data/ayuda';

const admin = { esAdmin: true };
const operador = { esAdmin: false };
const ids = (q: string, o = admin) => buscarAyuda(q, o).map((r) => r.tema.id);

describe('contenido de la ayuda', () => {
  it('los ids son únicos', () => {
    expect(new Set(TEMAS.map((t) => t.id)).size).toBe(TEMAS.length);
  });
  it('cada tema trae al menos un ejemplo y palabras clave', () => {
    for (const t of TEMAS) {
      expect(t.ejemplos.length, t.id).toBeGreaterThan(0);
      expect(t.palabras.length, t.id).toBeGreaterThan(0);
      expect(t.resumen.length, t.id).toBeGreaterThan(10);
    }
  });
  it('las rutas de pantalla existen en la app', () => {
    const validas = ['/clientes', '/cobros', '/proveedores', '/gastos', '/cuentas', '/reportes', '/informes', '/auditoria', '/configuracion'];
    for (const t of TEMAS) if (t.ruta) expect(validas, t.id).toContain(t.ruta);
  });
});

describe('normalizar / tokenizar', () => {
  it('quita tildes y pasa a minúsculas sin cambiar el largo', () => {
    expect(normalizar('Cómo Está ÑANDÚ')).toBe('como esta nandu');
    expect('Reembolsó 💸'.length).toBe(normalizar('Reembolsó 💸').length);
  });
  it('separa en palabras', () => {
    expect(tokenizar('  Plan de-pago, 1060DR ')).toEqual(['plan', 'de', 'pago', '1060dr']);
  });
});

describe('buscarAyuda', () => {
  it('sin consulta devuelve todos los temas permitidos', () => {
    expect(buscarAyuda('', admin).length).toBe(TEMAS.length);
    expect(buscarAyuda('', operador).length).toBe(TEMAS.filter((t) => !t.soloAdmin).length);
  });
  it('encuentra con o sin tildes y sin importar mayúsculas', () => {
    expect(ids('devolución')).toContain('reembolsos');
    expect(ids('DEVOLUCION')).toContain('reembolsos');
  });
  it('encuentra por sinónimos de palabras clave', () => {
    expect(ids('refund')[0]).toBe('reembolsos');
    expect(ids('refound')).toContain('reembolsos');
  });
  it('exige todas las palabras escritas', () => {
    expect(ids('plan cuotas')).toContain('plan-pago');
    expect(ids('reembolso zzzzqq')).toEqual([]);
  });
  it('el título pesa más que el cuerpo', () => {
    expect(ids('reembolsos')[0]).toBe('reembolsos');
    expect(ids('zelle')).toContain('pagos-mail');
  });
  it('un operador no ve los temas de administrador', () => {
    expect(ids('zelle', operador)).not.toContain('pagos-mail');
    expect(ids('importar historial', operador)).not.toContain('migracion-quickbooks');
    expect(ids('importar historial')).toContain('migracion-quickbooks');
  });
  it('filtra por sección', () => {
    const r = buscarAyuda('', { esAdmin: true, seccion: 'Dinero' });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.tema.seccion === 'Dinero')).toBe(true);
  });
  it('encuentra códigos de fee', () => {
    expect(ids('1060DR')).toContain('deuda-recuperada');
    expect(ids('1060saf')).toContain('deuda-recuperada');
  });
});

describe('resaltar', () => {
  it('marca las palabras buscadas ignorando tildes', () => {
    const t = resaltar('Cómo registrar un pago', ['como', 'pago']);
    expect(t.filter((x) => x.resaltado).map((x) => x.texto)).toEqual(['Cómo', 'pago']);
    expect(t.map((x) => x.texto).join('')).toBe('Cómo registrar un pago');
  });
  it('sin palabras devuelve el texto entero', () => {
    expect(resaltar('hola', [])).toEqual([{ texto: 'hola', resaltado: false }]);
  });
});
