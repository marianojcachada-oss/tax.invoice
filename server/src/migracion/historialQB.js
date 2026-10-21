import crypto from 'node:crypto';

// Importador del reporte "Transaction List by Customer" de QuickBooks.
//
// El reporte NO dice qué pago corresponde a qué factura. Se reconstruye con
// la regla FIFO (cada pago o crédito se aplica a la factura abierta más vieja
// del cliente). El saldo neto de cada cliente (facturas - pagos - créditos) es
// el mismo que el de QuickBooks sin importar cómo se reparta.
//
// Tipos de movimiento:
//   Invoice       -> factura
//   Payment       -> pago (FIFO); lo que sobra queda como nota de crédito "Excedente"
//   Deposit       -> depósito bancario (aunque figure a nombre de un cliente): no cambia la deuda, se ignora
//   Credit Memo   -> nota de crédito (se aplica FIFO; lo que sobra queda a favor)
//   Refund / Expense / Check (monto negativo) -> reembolso (sale plata, no cambia la deuda)

export const nuevoId = (prefijo) => `${prefijo}-${crypto.randomUUID()}`;

export function metodoDesdeCuenta(cuenta) {
  const c = String(cuenta ?? '');
  if (/Undeposited/i.test(c)) return 'kotapay';
  if (/Bank of America|Chase/i.test(c)) return 'zelle';
  return 'efectivo';
}

const COBRO = new Set(['Payment']);
const SALIDA = new Set(['Refund', 'Expense', 'Check']);

const efectoEnDeuda = (e) => {
  if (e.tipo === 'Invoice') return e.cent;
  if (COBRO.has(e.tipo)) return -e.cent;
  if (e.tipo === 'Credit Memo') return e.cent; // negativo en el sistema anterior
  return 0;
};

const rotulo = (tipo, num, memo) => `Migración · ${tipo}${num ? ` #${num}` : ''}${memo ? ` · ${memo}` : ''}`;

/**
 * Arma, sin tocar la base, todo lo que hay que insertar para un cliente.
 * eventos: [{ fecha:'YYYY-MM-DD', tipo, num, memo, cuenta, monto }] en el orden del reporte.
 * desde: si se indica, lo anterior se resume en un solo saldo inicial (para no cargar años de historial).
 * hasta: si se indica, lo posterior a esa fecha no se importa.
 */
export function planificarCliente(eventos, { desde = null, hasta = null, compensarAlFinal = true } = {}) {
  const ev = eventos.filter((e) => !hasta || e.fecha <= hasta)
    .map((e, i) => ({ ...e, i, cent: Math.round(Number(e.monto) * 100) }))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.i - b.i));

  const plan = { facturas: [], pagos: [], aplicaciones: [], ncs: [], ncFacturas: [], reembolsos: [], omitidos: { sinMonto: 0, raros: 0, resumidos: 0, depositos: 0 } };
  const abiertas = [];

  const crearFactura = (e, concepto, monto) => {
    const f = { id: nuevoId('fac-h'), fecha: e.fecha, concepto, monto, pagado: 0, numeroQb: e.num || null };
    plan.facturas.push(f);
    abiertas.push({ f, resto: monto });
    return f;
  };
  /** Consume facturas abiertas en orden; devuelve [{f, monto}] y lo que no alcanzó a aplicarse. */
  const aplicarFifo = (monto) => {
    const hechas = [];
    let resto = monto;
    while (resto > 0 && abiertas.length > 0) {
      const a = abiertas[0];
      const x = Math.min(a.resto, resto);
      a.resto -= x;
      a.f.pagado += x;
      resto -= x;
      hechas.push({ f: a.f, monto: x });
      if (a.resto <= 0) abiertas.shift();
    }
    return { hechas, resto };
  };

  let previo = 0;
  const dentro = [];
  for (const e of ev) {
    if (desde && e.fecha < desde) {
      previo += efectoEnDeuda(e);
      plan.omitidos.resumidos += 1;
    } else dentro.push(e);
  }
  if (previo > 0) crearFactura({ fecha: desde, num: null }, `Saldo inicial al ${desde} (resumen del historial anterior)`, previo);
  if (previo < 0) plan.ncs.push({ id: nuevoId('nc-h'), fecha: desde, monto: -previo, aplicado: 0, motivo: `Saldo a favor al ${desde} (resumen del historial anterior)`, numeroQb: null });

  for (const e of dentro) {
    if (e.tipo === 'Invoice') {
      if (e.cent > 0) crearFactura(e, rotulo('Invoice', e.num, e.memo), e.cent);
      else if (e.cent === 0) plan.omitidos.sinMonto += 1;
      else plan.omitidos.raros += 1;
    } else if (COBRO.has(e.tipo)) {
      if (e.cent < 0) { plan.omitidos.raros += 1; continue; }
      if (e.cent === 0) { plan.omitidos.sinMonto += 1; continue; }
      const { hechas, resto } = aplicarFifo(e.cent);
      const aplicado = e.cent - resto;
      if (aplicado > 0) {
        const pago = {
          id: nuevoId('pago-h'),
          fecha: e.fecha,
          monto: aplicado,
          metodo: metodoDesdeCuenta(e.cuenta),
          referencia: ['Migración', e.num, e.cuenta, e.memo].filter(Boolean).join(' · '),
        };
        plan.pagos.push(pago);
        for (const h of hechas) plan.aplicaciones.push({ pagoId: pago.id, factura: h.f, monto: h.monto });
      }
      if (resto > 0) {
        plan.ncs.push({ id: nuevoId('nc-h'), fecha: e.fecha, monto: resto, aplicado: 0, motivo: 'Excedente — migración histórica', numeroQb: e.num || null });
      }
    } else if (e.tipo === 'Credit Memo') {
      if (e.cent === 0) { plan.omitidos.sinMonto += 1; continue; }
      if (e.cent > 0) { plan.omitidos.raros += 1; continue; }
      const { hechas, resto } = aplicarFifo(-e.cent);
      const nc = { id: nuevoId('nc-h'), fecha: e.fecha, monto: -e.cent, aplicado: -e.cent - resto, motivo: rotulo('Credit Memo', e.num, e.memo), numeroQb: e.num || null };
      plan.ncs.push(nc);
      for (const h of hechas) plan.ncFacturas.push({ ncId: nc.id, factura: h.f });
    } else if (e.tipo === 'Deposit') {
      plan.omitidos.depositos += 1;
    } else if (SALIDA.has(e.tipo)) {
      if (e.cent < 0) {
        plan.reembolsos.push({ id: nuevoId('re-h'), fecha: e.fecha, monto: -e.cent, metodo: metodoDesdeCuenta(e.cuenta), motivo: rotulo(e.tipo, e.num, e.memo) });
      } else plan.omitidos.raros += 1;
    } else {
      plan.omitidos.raros += 1;
    }
  }

  // Al final, el saldo a favor que quedó suelto se descuenta de las facturas que siguen abiertas
  // (la deuda neta del cliente no cambia; evita mostrar facturas "vencidas" que en realidad
  // ya están cubiertas por un crédito).
  if (compensarAlFinal) {
    for (const nc of plan.ncs) {
      while (nc.aplicado < nc.monto && abiertas.length > 0) {
        const a = abiertas[0];
        const x = Math.min(a.resto, nc.monto - nc.aplicado);
        a.resto -= x;
        a.f.pagado += x;
        nc.aplicado += x;
        if (!plan.ncFacturas.some((n) => n.ncId === nc.id && n.factura === a.f)) plan.ncFacturas.push({ ncId: nc.id, factura: a.f });
        if (a.resto <= 0) abiertas.shift();
      }
      if (abiertas.length === 0) break;
    }
  }
  return plan;
}

const estadoDe = (f) => (f.pagado >= f.monto ? 'pagada' : f.pagado > 0 ? 'parcial' : 'pendiente');

/** INSERT de muchas filas por consulta (de a `tanda`), con placeholders "?". */
export async function insertarFilas(tx, tabla, columnas, filas, tanda = 800) {
  for (let i = 0; i < filas.length; i += tanda) {
    const trozo = filas.slice(i, i + tanda);
    const marcas = `(${columnas.map(() => '?').join(',')})`;
    await tx.prepare(`INSERT INTO ${tabla} (${columnas.join(',')}) VALUES ${trozo.map(() => marcas).join(',')}`).run(...trozo.flat());
  }
}

/**
 * Importa un lote de clientes. Cada bloque: { nombreQb, codigo?, transacciones:[{fecha,tipo,num,memo,cuenta,monto}] }.
 * Un cliente se busca por su nombre completo de QuickBooks (nombre_qb). Si el cliente ya tiene su historial
 * importado se omite (así no se duplica si se vuelve a subir el archivo).
 */
export async function importarLote(db, { bloques, desde = null, hasta = null, usuario, compensarAlFinal = true }) {
  const nombres = bloques.map((b) => b.nombreQb);
  const clientes = await db.prepare('SELECT id, nombre_qb, historial_importado FROM clientes WHERE nombre_qb = ANY(?)').all(nombres);
  const porNombre = new Map(clientes.map((c) => [c.nombre_qb, c]));

  const resumen = { clientes: 0, facturas: 0, pagos: 0, notasCredito: 0, reembolsos: 0, excedentes: 0, yaImportados: [], sinCliente: [], omitidos: { sinMonto: 0, raros: 0, resumidos: 0, depositos: 0 } };
  const planes = [];
  for (const b of bloques) {
    const c = porNombre.get(b.nombreQb);
    if (!c) { resumen.sinCliente.push(b.nombreQb); continue; }
    if (c.historial_importado) { resumen.yaImportados.push(b.nombreQb); continue; }
    planes.push({ cliente: c, plan: planificarCliente(b.transacciones, { desde, hasta, compensarAlFinal }) });
  }

  await db.transaction(async (tx) => {
    let nf = (await tx.prepare('SELECT MAX(numero) AS n FROM facturas').get()).n ?? 40000;
    let np = (await tx.prepare('SELECT MAX(numero) AS n FROM pagos').get()).n ?? 0;
    let nn = (await tx.prepare('SELECT MAX(numero) AS n FROM notas_credito').get()).n ?? 5000;
    let nr = (await tx.prepare('SELECT MAX(numero) AS n FROM reembolsos').get()).n ?? 0;

    const filas = { facturas: [], pagos: [], aplic: [], ncs: [], ncf: [], reem: [] };
    for (const { cliente, plan } of planes) {
      for (const f of plan.facturas) {
        f.numero = ++nf;
        filas.facturas.push([f.id, f.numero, cliente.id, 0, f.fecha, f.fecha, f.concepto, f.monto, f.pagado, estadoDe(f), usuario, f.numeroQb]);
      }
      for (const p of plan.pagos) filas.pagos.push([p.id, ++np, cliente.id, p.fecha, p.monto, p.metodo, p.referencia, null, false]);
      for (const a of plan.aplicaciones) filas.aplic.push([a.pagoId, a.factura.id, a.monto]);
      for (const n of plan.ncs) {
        if (n.motivo.startsWith('Excedente')) resumen.excedentes += 1;
        filas.ncs.push([n.id, ++nn, cliente.id, n.fecha, n.monto, n.aplicado, n.motivo, n.aplicado >= n.monto, n.numeroQb]);
      }
      for (const x of plan.ncFacturas) filas.ncf.push([x.ncId, x.factura.id]);
      for (const r of plan.reembolsos) filas.reem.push([r.id, ++nr, cliente.id, r.fecha, r.monto, r.metodo, r.motivo, null, null]);
      resumen.clientes += 1;
      resumen.facturas += plan.facturas.length;
      resumen.pagos += plan.pagos.length;
      resumen.notasCredito += plan.ncs.length;
      resumen.reembolsos += plan.reembolsos.length;
      for (const k of Object.keys(resumen.omitidos)) resumen.omitidos[k] += plan.omitidos[k];
    }
    await insertarFilas(tx, 'facturas', ['id', 'numero', 'cliente_id', 'semana', 'fecha', 'fecha_vencimiento', 'concepto', 'monto', 'monto_pagado', 'estado', 'creado_por', 'numero_qb'], filas.facturas);
    await insertarFilas(tx, 'pagos', ['id', 'numero', 'cliente_id', 'fecha', 'monto', 'metodo', 'referencia', 'cuenta_id', 'editado'], filas.pagos);
    await insertarFilas(tx, 'pago_aplicaciones', ['pago_id', 'factura_id', 'monto'], filas.aplic);
    await insertarFilas(tx, 'notas_credito', ['id', 'numero', 'cliente_id', 'fecha', 'monto', 'monto_aplicado', 'motivo', 'aplicada', 'numero_qb'], filas.ncs);
    await insertarFilas(tx, 'nota_credito_facturas', ['nota_id', 'factura_id'], filas.ncf);
    await insertarFilas(tx, 'reembolsos', ['id', 'numero', 'cliente_id', 'fecha', 'monto', 'metodo', 'motivo', 'pago_id', 'cuenta_id'], filas.reem);
    if (planes.length) await tx.prepare('UPDATE clientes SET historial_importado = true WHERE id = ANY(?)').run(planes.map((p) => p.cliente.id));
  });
  return resumen;
}
