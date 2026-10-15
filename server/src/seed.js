import { db, pool } from './db.js';
import { generarId, aCentavos } from './utils.js';
import { hashPin } from './auth.js';

const yaHayUsuarios = Number((await db.prepare('SELECT COUNT(*) as n FROM usuarios').get()).n) > 0;

if (yaHayUsuarios) {
  console.log('Ya hay datos cargados — no se vuelve a sembrar. Para empezar de cero, borrá las tablas en Supabase (o corré el SQL de reset) y volvé a correr este script.');
  await pool.end();
  process.exit(0);
}

await db.prepare('INSERT INTO usuarios (id, nombre, email, rol, pin_hash, activo) VALUES (?, ?, ?, ?, ?, true)').run(
  'user-luis',
  'Luis',
  'luis@taxi.com',
  'admin',
  hashPin('1234')
);
await db.prepare('INSERT INTO usuarios (id, nombre, email, rol, pin_hash, activo) VALUES (?, ?, ?, ?, ?, true)').run(
  'user-ana',
  'Ana',
  'ana@taxi.com',
  'operador',
  hashPin('5678')
);

await db
  .prepare(
    `INSERT INTO configuracion (
      id, cuota_semanal_por_defecto, dia_emision, metodos_habilitados,
      recordatorios_activo, recordatorios_semanas, recordatorios_solo_vencido, recordatorios_plantilla,
      empresa_nombre, empresa_direccion, empresa_email
    ) VALUES (1, ?, 'lun', ?, true, 4, true, ?, ?, '', '')`
  )
  .run(
    aCentavos(145),
    JSON.stringify(['zelle', 'efectivo', 'kotapay', 'ach', 'tarjeta']),
    'Hola {nombre}, tenés un saldo pendiente de {monto} ({dias} días de atraso). Por favor ponete al día cuando puedas. ¡Gracias!',
    'tax.invoice'
  );

// Un puñado de clientes de ejemplo (no los 400 del frontend — esto es
// solo para poder probar el servidor de punta a punta; los datos reales
// se van a ir cargando desde la app).
const nombres = ['Liseth Vargas', 'Gustavo Molina', 'Margarita Herrera', 'Anny Herrera', 'Dervin Delgado'];
let numeroFactura = 40100;
for (let i = 0; i < nombres.length; i++) {
  const clienteId = generarId('cli');
  await db
    .prepare(
      `INSERT INTO clientes (id, codigo, numero, nombre, telefonos, licencia_info, cuota_semanal, fecha_alta, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activo')`
    )
    .run(clienteId, `D0${699 - i}`, `10${2013 - i}`, nombres[i], '(404) 555-0100', 'LIC GA 01/01/2030', aCentavos(145), '2025-01-01');
  numeroFactura += 1;
  await db
    .prepare(
      `INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pendiente')`
    )
    .run(generarId('fac'), numeroFactura, clienteId, 37, '2026-09-07', '2026-09-14', 'Cuota semana 37', aCentavos(145));
}

console.log('Datos iniciales creados: 2 usuarios (Luis=admin PIN 1234, Ana=operador PIN 5678) y 5 clientes de ejemplo.');
await pool.end();
