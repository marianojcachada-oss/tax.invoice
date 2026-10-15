import type { Cliente, ConfiguracionRecordatorios, Factura } from '../types';
import { diasDeAtraso, formatoMoneda, saldoPendiente } from './aging';

/**
 * Un cliente es elegible para recordatorio si:
 *  1) los recordatorios están activos en la configuración,
 *  2) facturó en las últimas N semanas (evita mandarle mensajes a alguien
 *     que ya no trabaja y quedó como registro histórico), y
 *  3) si se pidió "solo con saldo vencido", tiene algo pendiente.
 */
export function clienteElegibleParaRecordatorio(
  cliente: Cliente,
  facturasDelCliente: Factura[],
  config: ConfiguracionRecordatorios,
  semanaActual: number
): boolean {
  if (!config.activo) return false;
  if (cliente.estado === 'inactivo') return false;

  const facturoRecientemente = facturasDelCliente.some(
    (f) => f.semana > semanaActual - config.semanasActividadReciente
  );
  if (!facturoRecientemente) return false;

  if (config.soloConSaldoVencido) {
    return facturasDelCliente.some((f) => saldoPendiente(f) > 0);
  }
  return true;
}

export function armarMensajeRecordatorio(
  plantilla: string,
  cliente: Cliente,
  facturasDelCliente: Factura[]
): string {
  const saldo = facturasDelCliente.reduce((a, f) => a + saldoPendiente(f), 0);
  const facturaMasVieja = facturasDelCliente
    .filter((f) => saldoPendiente(f) > 0)
    .sort((a, b) => (a.fechaVencimiento < b.fechaVencimiento ? -1 : 1))[0];
  const dias = facturaMasVieja ? diasDeAtraso(facturaMasVieja.fechaVencimiento) : 0;

  return plantilla
    .replaceAll('{nombre}', cliente.nombre)
    .replaceAll('{monto}', formatoMoneda(saldo))
    .replaceAll('{dias}', String(dias));
}
