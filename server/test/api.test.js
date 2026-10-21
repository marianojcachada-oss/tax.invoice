import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { db, pool } from '../src/db.js';
import { hashPin } from '../src/auth.js';
import { parsearKotapay } from '../src/kotapayGmail.js';
import { parsearContenido } from '../src/outlookInbox.js';

// Importante: este archivo se corre contra una base de datos Postgres de
// PRUEBA de verdad (ver DATABASE_URL en el script "test" de package.json)
// — Postgres no tiene un ":memory:" tan simple como SQLite. El "before"
// de acá abajo limpia todas las tablas antes de sembrar los datos de
// prueba, así que es seguro correr esto las veces que haga falta sin que
// se acumule basura de corridas anteriores. NUNCA apuntar esto a la base
// de datos real de desarrollo/producción.

let server;
let baseUrl;

before(async () => {
  // Limpia todo antes de sembrar, para que cada corrida arranque de cero.
  await pool.query(`
    TRUNCATE TABLE
      pagos_email, auditoria, documentos, bill_pago_aplicaciones, bill_pagos, bills,
      proveedores, transferencias, cuentas, gastos, reembolsos,
      nota_credito_facturas, notas_credito, pago_aplicaciones, pagos,
      facturas, clientes, configuracion, usuarios,
      cliente_fees_pendientes, catalogo_fees
    RESTART IDENTITY CASCADE
  `);

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${server.address().port}/api`;

  await db.prepare("INSERT INTO usuarios (id, nombre, rol, pin_hash, activo) VALUES ('user-admin', 'Admin Test', 'admin', ?, true)").run(hashPin('1234'));
  await db.prepare("INSERT INTO usuarios (id, nombre, rol, pin_hash, activo) VALUES ('user-op', 'Operador Test', 'operador', ?, true)").run(hashPin('5678'));
  await db
    .prepare(
      `INSERT INTO configuracion (id, cuota_semanal_por_defecto, dia_emision, metodos_habilitados, recordatorios_plantilla)
     VALUES (1, 14500, 'lun', '["zelle"]', 'hola {nombre}')`
    )
    .run();
  await db
    .prepare(
      `INSERT INTO clientes (id, codigo, numero, nombre, telefonos, licencia_info, cuota_semanal, fecha_alta, estado)
     VALUES ('cli-1', 'D0001', '1', 'Cliente Activo', '555-1111', '', 14500, '2025-01-01', 'activo')`
    )
    .run();
  await db
    .prepare(
      `INSERT INTO clientes (id, codigo, numero, nombre, telefonos, licencia_info, cuota_semanal, fecha_alta, estado)
     VALUES ('cli-2', 'D0002', '2', 'Cliente De Baja', '555-2222', '', 14500, '2025-01-01', 'inactivo')`
    )
    .run();
});

after(async () => {
  server.close();
  await pool.end();
});

async function login(usuarioId, pin) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuarioId, pin }),
  });
  const body = await res.json();
  return body.token;
}

function headersDe(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

test('login rechaza un PIN incorrecto (401)', async () => {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuarioId: 'user-admin', pin: '0000' }),
  });
  assert.equal(res.status, 401);
});

test('login funciona con el PIN correcto y devuelve un token', async () => {
  const token = await login('user-admin', '1234');
  assert.ok(token && token.length > 10);
});

test('sin token, las rutas protegidas devuelven 401', async () => {
  const res = await fetch(`${baseUrl}/clientes`);
  assert.equal(res.status, 401);
});

test('pago parcial deja la factura en estado "parcial" con el saldo correcto', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);

  const factura = await fetch(`${baseUrl}/facturas`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Prueba parcial', monto: 100 }),
  }).then((r) => r.json());

  const pagoRes = await fetch(`${baseUrl}/pagos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clienteId: 'cli-1', metodo: 'zelle', aplicaciones: [{ facturaId: factura.id, monto: 60 }] }),
  });
  assert.equal(pagoRes.status, 201);

  const facturas = await fetch(`${baseUrl}/facturas`, { headers }).then((r) => r.json());
  const actualizada = facturas.find((f) => f.id === factura.id);
  assert.equal(actualizada.montoPagado, 60);
  assert.equal(actualizada.estado, 'parcial');
});

test('rechaza aplicar más de lo que debe una factura (400, y no modifica nada)', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);

  const factura = await fetch(`${baseUrl}/facturas`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Prueba límite', monto: 50 }),
  }).then((r) => r.json());

  const res = await fetch(`${baseUrl}/pagos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clienteId: 'cli-1', metodo: 'zelle', aplicaciones: [{ facturaId: factura.id, monto: 9999 }] }),
  });
  assert.equal(res.status, 400);

  const facturas = await fetch(`${baseUrl}/facturas`, { headers }).then((r) => r.json());
  assert.equal(facturas.find((f) => f.id === factura.id).montoPagado, 0);
});

test('editar un pago corrige el monto aplicado a la factura (para arriba y para abajo)', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);

  const factura = await fetch(`${baseUrl}/facturas`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Prueba edición', monto: 145 }),
  }).then((r) => r.json());

  const pago = await fetch(`${baseUrl}/pagos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clienteId: 'cli-1', metodo: 'zelle', aplicaciones: [{ facturaId: factura.id, monto: 100 }] }),
  }).then((r) => r.json());

  // Corrige hacia arriba: la factura debería quedar totalmente pagada.
  await fetch(`${baseUrl}/pagos/${pago.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ aplicaciones: [{ facturaId: factura.id, monto: 145 }] }),
  });
  let facturas = await fetch(`${baseUrl}/facturas`, { headers }).then((r) => r.json());
  assert.equal(facturas.find((f) => f.id === factura.id).estado, 'pagada');

  // Corrige hacia abajo: tiene que volver a quedar con saldo pendiente.
  await fetch(`${baseUrl}/pagos/${pago.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ aplicaciones: [{ facturaId: factura.id, monto: 30 }] }),
  });
  facturas = await fetch(`${baseUrl}/facturas`, { headers }).then((r) => r.json());
  const actualizada = facturas.find((f) => f.id === factura.id);
  assert.equal(actualizada.montoPagado, 30);
  assert.equal(actualizada.estado, 'parcial');
});

test('nota de crédito: aplica el disponible contra una factura y actualiza su propio saldo', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);

  const factura = await fetch(`${baseUrl}/facturas`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Con crédito', monto: 145 }),
  }).then((r) => r.json());

  const nota = await fetch(`${baseUrl}/notas-credito`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clienteId: 'cli-1', fecha: '2026-09-13', monto: 50, motivo: 'Prueba' }),
  }).then((r) => r.json());

  const notaActualizada = await fetch(`${baseUrl}/notas-credito/${nota.id}/aplicar`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ facturaIds: [factura.id] }),
  }).then((r) => r.json());

  assert.equal(notaActualizada.montoAplicado, 50);
  assert.equal(notaActualizada.aplicada, true);

  const facturas = await fetch(`${baseUrl}/facturas`, { headers }).then((r) => r.json());
  assert.equal(facturas.find((f) => f.id === factura.id).montoPagado, 50);
});

test('generar-semanal saltea a los clientes dados de baja', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);

  const resultado = await fetch(`${baseUrl}/facturas/generar-semanal`, { method: 'POST', headers }).then((r) => r.json());
  assert.ok(resultado.salteadasInactivos >= 1);

  const facturas = await fetch(`${baseUrl}/facturas`, { headers }).then((r) => r.json());
  assert.equal(facturas.some((f) => f.clienteId === 'cli-2' && f.semana === resultado.semana), false);
});

test('un operador recibe 403 al intentar ver la auditoría completa o editar configuración', async () => {
  const token = await login('user-op', '5678');
  const headers = headersDe(token);

  const resAudit = await fetch(`${baseUrl}/auditoria`, { headers });
  assert.equal(resAudit.status, 403);

  const resConfig = await fetch(`${baseUrl}/configuracion`, { method: 'PATCH', headers, body: JSON.stringify({ cuotaSemanalPorDefecto: 200 }) });
  assert.equal(resConfig.status, 403);
});

test('importar-historial reconstruye pagos con FIFO, arrastrando saldo parcial entre facturas', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);

  // Mismo patrón real encontrado en el archivo de QuickBooks: una semana
  // se paga de menos (quedó un resto de $13), y el pago de la semana
  // siguiente tiene que arrastrar ese resto antes de ir a la factura nueva.
  await db.prepare("UPDATE clientes SET nombre_qb = 'D0001 1 Cliente Activo' WHERE id = 'cli-1'").run();
  const payload = {
    bloques: [
      {
        nombreQb: 'D0001 1 Cliente Activo',
        transacciones: [
          { fecha: '2026-09-08', tipo: 'Invoice', monto: 145, num: '', memo: '', cuenta: '14500 Undeposited Funds' },
          { fecha: '2026-09-08', tipo: 'Payment', monto: 145, num: '', memo: '', cuenta: '14500 Undeposited Funds' },
          { fecha: '2026-09-14', tipo: 'Invoice', monto: 145, num: '', memo: '', cuenta: '14500 Undeposited Funds' },
          { fecha: '2026-09-14', tipo: 'Payment', monto: 132, num: '', memo: '', cuenta: '14500 Undeposited Funds' },
          { fecha: '2026-09-21', tipo: 'Invoice', monto: 145, num: '', memo: '', cuenta: '10201 Bank of America 9859*' },
          { fecha: '2026-09-21', tipo: 'Payment', monto: 145, num: '', memo: '', cuenta: '10201 Bank of America 9859*' },
        ],
      },
    ],
  };

  const resultado = await fetch(`${baseUrl}/facturas/importar-historial`, { method: 'POST', headers, body: JSON.stringify(payload) }).then((r) => r.json());
  assert.equal(resultado.facturas, 3);
  assert.equal(resultado.pagos, 3);
  assert.equal(resultado.sinCliente.length, 0);

  const facturas = await fetch(`${baseUrl}/facturas`, { headers })
    .then((r) => r.json())
    .then((d) => d.filter((f) => f.clienteId === 'cli-1' && f.semana === 0).sort((a, b) => (a.fecha < b.fecha ? -1 : 1)));
  assert.equal(facturas.length, 3);
  assert.equal(facturas[0].estado, 'pagada'); // 08/09: $145 vs $145
  assert.equal(facturas[1].montoPagado, 145); // 14/09: terminó cubierta entre los dos pagos ($132 + $13 del pago siguiente)
  assert.equal(facturas[1].estado, 'pagada');
  assert.equal(facturas[2].montoPagado, 132); // 21/09: el pago de esa semana se repartió, quedó parcial
  assert.equal(facturas[2].estado, 'parcial');

  // El pago del 21/09 tiene que haberse partido en DOS aplicaciones: los
  // $13 que quedaban pendientes de la factura del 14/09, y el resto a la
  // factura nueva del 21/09 — así se prueba el cruce entre facturas, no
  // solo el cruce 1 a 1 del mismo día.
  const pagos = await fetch(`${baseUrl}/pagos`, { headers })
    .then((r) => r.json())
    .then((d) => d.filter((p) => p.clienteId === 'cli-1' && p.fecha === '2026-09-21'));
  assert.equal(pagos.length, 1);
  assert.equal(pagos[0].aplicaciones.length, 2);
  assert.equal(pagos[0].metodo, 'zelle'); // "Bank of America" -> zelle
});

test('un fee tildado en un cliente se factura en la próxima corrida semanal (y queda tildado, no se auto-destilda)', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);

  const fee = await fetch(`${baseUrl}/catalogo-fees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ codigo: 'TESTFEE-A', etiqueta: 'Fee de prueba A', monto: 25 }),
  }).then((r) => r.json());

  await fetch(`${baseUrl}/clientes/cli-1/fees-pendientes/${fee.id}`, { method: 'POST', headers });
  let pendientes = await fetch(`${baseUrl}/clientes/cli-1/fees-pendientes`, { headers }).then((r) => r.json());
  assert.deepEqual(pendientes, [fee.id]);

  const resultado = await fetch(`${baseUrl}/facturas/generar-semanal`, { method: 'POST', headers }).then((r) => r.json());
  assert.equal(resultado.feesAplicados, 1);

  // A propósito NO se destilda solo — el usuario pidió que quede tildado
  // hasta que alguien lo saque a mano (ver test de más abajo).
  pendientes = await fetch(`${baseUrl}/clientes/cli-1/fees-pendientes`, { headers }).then((r) => r.json());
  assert.deepEqual(pendientes, [fee.id]);

  const facturas = await fetch(`${baseUrl}/facturas`, { headers })
    .then((r) => r.json())
    .then((d) => d.filter((f) => f.clienteId === 'cli-1' && f.codigo === 'TESTFEE-A'));
  assert.equal(facturas.length, 1);
  assert.equal(facturas[0].monto, 25);
  assert.equal(facturas[0].concepto, 'Fee de prueba A');

  await fetch(`${baseUrl}/clientes/cli-1/fees-pendientes/${fee.id}`, { method: 'DELETE', headers });
});

test('el fee de reactivación es $10 si la última factura fue hace 10 días, y $20 si fue hace 40', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);

  async function probarReactivacion(codigoCliente, diasAtras) {
    const cliente = await fetch(`${baseUrl}/clientes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ codigo: codigoCliente, numero: '900000', nombre: 'Cliente reactivación', telefonos: '555', licenciaInfo: 'x', cuotaSemanal: 145, fechaAlta: '2026-01-01', estado: 'activo' }),
    }).then((r) => r.json());

    const fecha = new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db
      .prepare(`INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado) VALUES (?, ?, ?, 1, ?, ?, 'vieja', 14500, 14500, 'pagada')`)
      .run(`fac-reac-${codigoCliente}`, Math.floor(Math.random() * 100000) + 900000, cliente.id, fecha, fecha);

    await fetch(`${baseUrl}/clientes/${cliente.id}`, { method: 'PATCH', headers, body: JSON.stringify({ estado: 'inactivo' }) });
    return fetch(`${baseUrl}/clientes/${cliente.id}`, { method: 'PATCH', headers, body: JSON.stringify({ estado: 'activo' }) }).then((r) => r.json());
  }

  const dentro = await probarReactivacion('DREAC10', 10);
  assert.equal(dentro.feeAutomatico.codigo, '1090RA');
  assert.equal(dentro.feeAutomatico.monto, 10);

  const fuera = await probarReactivacion('DREAC40', 40);
  assert.equal(fuera.feeAutomatico.codigo, '1090RI');
  assert.equal(fuera.feeAutomatico.monto, 20);
});

test('un fee tildado en un cliente NO se destilda solo — sigue facturándose en cada corrida hasta que alguien lo saca', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);

  const fee = await fetch(`${baseUrl}/catalogo-fees`, { method: 'POST', headers, body: JSON.stringify({ codigo: 'TESTFEE-B', etiqueta: 'Fee de prueba B', monto: 10 }) }).then((r) => r.json());
  await fetch(`${baseUrl}/clientes/cli-1/fees-pendientes/${fee.id}`, { method: 'POST', headers });

  await fetch(`${baseUrl}/facturas/generar-semanal`, { method: 'POST', headers });
  let pendientes = await fetch(`${baseUrl}/clientes/cli-1/fees-pendientes`, { headers }).then((r) => r.json());
  assert.ok(pendientes.includes(fee.id)); // sigue tildado

  const resultado2 = await fetch(`${baseUrl}/facturas/generar-semanal`, { method: 'POST', headers }).then((r) => r.json());
  assert.equal(resultado2.feesAplicados, 1); // se volvió a facturar

  await fetch(`${baseUrl}/clientes/cli-1/fees-pendientes/${fee.id}`, { method: 'DELETE', headers });
  pendientes = await fetch(`${baseUrl}/clientes/cli-1/fees-pendientes`, { headers }).then((r) => r.json());
  assert.ok(!pendientes.includes(fee.id)); // ahora sí, se sacó a mano
});

test('facturas y notas de crédito se pueden editar (solo admin) y queda el usuario que las creó', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);
  const tokenOp = await login('user-op', '5678');
  const headersOp = headersDe(tokenOp);

  const factura = await fetch(`${baseUrl}/facturas`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Original', monto: 50 }) }).then((r) => r.json());
  assert.equal(factura.creadoPor, 'Admin Test');

  const editada = await fetch(`${baseUrl}/facturas/${factura.id}`, { method: 'PATCH', headers, body: JSON.stringify({ concepto: 'Corregida', monto: 75 }) }).then((r) => r.json());
  assert.equal(editada.concepto, 'Corregida');
  assert.equal(editada.monto, 75);

  const rechazo = await fetch(`${baseUrl}/facturas/${factura.id}`, { method: 'PATCH', headers: headersOp, body: JSON.stringify({ monto: 1 }) });
  assert.equal(rechazo.status, 202);

  const nota = await fetch(`${baseUrl}/notas-credito`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', fecha: '2026-09-01', monto: 30, motivo: 'Original' }) }).then((r) => r.json());
  const notaEditada = await fetch(`${baseUrl}/notas-credito/${nota.id}`, { method: 'PATCH', headers, body: JSON.stringify({ motivo: 'Corregida', monto: 40 }) }).then((r) => r.json());
  assert.equal(notaEditada.motivo, 'Corregida');
  assert.equal(notaEditada.monto, 40);
});

test('parser de mails de Zelle (BofA en español) saca remitente, monto y descripción', async () => {
  const p = parsearContenido('Alfredo Salgado Morales le envió $1,165.50', 'Alfredo Salgado Morales le envió $1,165.50 D135 pago de base y reconexion Consultar su saldo');
  assert.equal(p.remitente, 'Alfredo Salgado Morales');
  assert.equal(p.monto, 1165.5);
  assert.equal(p.descripcion, 'D135 pago de base y reconexion');
  assert.equal(parsearContenido('Promoción de Bank of America', 'ofertas'), null);
});

test('bandeja de mails: aplicar es solo admin, cubre facturas viejas primero y el excedente queda como nota de crédito', async () => {
  const headers = headersDe(await login('user-admin', '1234'));
  const headersOp = headersDe(await login('user-op', '5678'));
  await db.prepare("INSERT INTO clientes (id, codigo, numero, nombre, telefonos, licencia_info, cuota_semanal, fecha_alta, estado) VALUES ('cli-3','D0003','3','Cliente Mail','', '', 14500, '2025-01-01','activo')").run();
  const mkFactura = (id, num, fv) =>
    db.prepare("INSERT INTO facturas (id, numero, cliente_id, concepto, semana, monto, monto_pagado, fecha, fecha_vencimiento, estado) VALUES (?, ?, 'cli-3', 'x', 1, 10000, 0, '2026-01-01', ?, 'pendiente')").run(id, num, fv);
  await mkFactura('f-mail-b', 9002, '2026-02-01');
  await mkFactura('f-mail-a', 9001, '2026-01-01');
  await db.prepare("INSERT INTO pagos_email (id, message_id, fecha, remitente, descripcion, monto) VALUES ('pem-1','m1','2026-03-01','Juan Pérez','D3',25000)").run();

  const lista = await fetch(`${baseUrl}/pagos-email`, { headers: headersOp });
  assert.equal(lista.status, 403);
  const sinOutlook = await fetch(`${baseUrl}/pagos-email/actualizar`, { method: 'POST', headers });
  assert.equal(sinOutlook.status, 400);

  const r = await fetch(`${baseUrl}/pagos-email/pem-1/aplicar`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-3' }) });
  assert.equal(r.status, 200);
  const a = await db.prepare("SELECT estado, monto_pagado FROM facturas WHERE id IN ('f-mail-a','f-mail-b') ORDER BY id").all();
  assert.deepEqual(a.map((x) => [x.estado, x.monto_pagado]), [['pagada', 10000], ['pagada', 10000]]);
  const nc = await db.prepare("SELECT monto FROM notas_credito WHERE cliente_id = 'cli-3'").get();
  assert.equal(nc.monto, 5000);
  const otra = await fetch(`${baseUrl}/pagos-email/pem-1/aplicar`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-3' }) });
  assert.equal(otra.status, 400);
});

test('mail automático: configuración se guarda (clave enmascarada) y al quedar paga la factura queda registrado en auditoría', async () => {
  const headers = headersDe(await login('user-admin', '1234'));
  const cfg = await fetch(`${baseUrl}/configuracion`, { headers }).then((r) => r.json());
  assert.equal(cfg.mail.envioAutomatico, false);

  const guardada = await fetch(`${baseUrl}/configuracion`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ ...cfg, mail: { ...cfg.mail, envioAutomatico: true, remitenteNombre: 'Taxi Laser', smtp: { host: '', puerto: 587, usuario: 'x@y.com', clave: 'secreta' } } }),
  }).then((r) => r.json());
  assert.equal(guardada.mail.envioAutomatico, true);
  assert.equal(guardada.mail.smtp.clave, '••••••••');

  await db.prepare("INSERT INTO clientes (id, codigo, numero, nombre, telefonos, licencia_info, cuota_semanal, fecha_alta, estado, email) VALUES ('cli-4','D0004','4','Cliente Con Mail','', '', 14500, '2025-01-01','activo','a@b.com')").run();
  const fac = await fetch(`${baseUrl}/facturas`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-4', concepto: 'Prueba', monto: 20 }) }).then((r) => r.json());
  await fetch(`${baseUrl}/pagos`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-4', metodo: 'zelle', aplicaciones: [{ facturaId: fac.id, monto: 20 }] }) });
  await new Promise((r) => setTimeout(r, 800)); // el envío corre en segundo plano
  const aud = await db.prepare("SELECT resumen FROM auditoria WHERE accion = 'Mail automático de factura paga' AND entidad_id = ?").get(fac.id);
  assert.ok(aud, 'debe quedar registro del mail automático');
  const f = await db.prepare('SELECT mail_enviado FROM facturas WHERE id = ?').get(fac.id);
  assert.equal(f.mail_enviado, null); // sin SMTP real configurado queda simulado, no se marca como enviado

  await fetch(`${baseUrl}/configuracion`, { method: 'PATCH', headers, body: JSON.stringify({ ...guardada, mail: { ...guardada.mail, envioAutomatico: false } }) });
});

test('envío por Microsoft Graph arma el sendMail con adjunto, responder-a y "from" distinto al buzón', async () => {
  const { enviarMail } = await import('../src/email.js');
  const headers = headersDe(await login('user-admin', '1234'));
  const cfg = await fetch(`${baseUrl}/configuracion`, { headers }).then((r) => r.json());
  await fetch(`${baseUrl}/configuracion`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ ...cfg, mail: { ...cfg.mail, metodo: 'graph', buzonEnvio: 'facturas@x.com', remitenteDireccion: 'pagos@x.com', remitenteNombre: 'Taxi Laser', responderA: 'pagos@x.com' } }),
  });
  Object.assign(process.env, { MS_TENANT_ID: 't', MS_CLIENT_ID: 'c', MS_CLIENT_SECRET: 's' });
  const realFetch = globalThis.fetch;
  let enviado;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    if (String(url).includes('/users/facturas%40x.com/sendMail')) { enviado = JSON.parse(opts.body); return new Response(null, { status: 202 }); }
    return realFetch(url, opts);
  };
  try {
    const r = await enviarMail({ para: 'driver@x.com', asunto: 'Hola', texto: 'Texto', nombreArchivo: 'f.pdf', contenido: Buffer.from('PDF') });
    assert.equal(r.ok, true);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.MS_TENANT_ID; delete process.env.MS_CLIENT_ID; delete process.env.MS_CLIENT_SECRET;
  }
  assert.equal(enviado.message.toRecipients[0].emailAddress.address, 'driver@x.com');
  assert.equal(enviado.message.from.emailAddress.address, 'pagos@x.com');
  assert.equal(enviado.message.replyTo[0].emailAddress.address, 'pagos@x.com');
  assert.equal(enviado.message.attachments[0].contentBytes, Buffer.from('PDF').toString('base64'));
});

test('reembolso parcial sobre un pago: muestra la factura, no deja devolver más de lo pagado', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);
  const factura = await fetch(`${baseUrl}/facturas`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Inscripción', monto: 165 }) }).then((r) => r.json());
  const pago = await fetch(`${baseUrl}/pagos`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', metodo: 'zelle', aplicaciones: [{ facturaId: factura.id, monto: 165 }] }) }).then((r) => r.json());

  const r1 = await fetch(`${baseUrl}/reembolsos`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', fecha: '2026-10-15', monto: 100, metodo: 'zelle', pagoId: pago.id, motivo: 'Se dio de baja' }) });
  assert.equal(r1.status, 201);
  const re = await r1.json();
  assert.equal(re.monto, 100);
  assert.equal(re.pagoNumero, pago.numero);
  assert.deepEqual(re.facturas.map((f) => f.id), [factura.id]);

  // quedan 65 por devolver: 70 es demasiado
  const r2 = await fetch(`${baseUrl}/reembolsos`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', fecha: '2026-10-15', monto: 70, metodo: 'zelle', pagoId: pago.id }) });
  assert.equal(r2.status, 400);
  const r3 = await fetch(`${baseUrl}/reembolsos`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', fecha: '2026-10-15', monto: 65, metodo: 'zelle', pagoId: pago.id }) });
  assert.equal(r3.status, 201);
});

test('factura 1090DR paga genera un saldo a favor 1090SAF en la unidad beneficiaria (una sola vez)', async () => {
  const token = await login('user-admin', '1234');
  const headers = headersDe(token);
  const clientes = await fetch(`${baseUrl}/clientes`, { headers }).then((r) => r.json());
  const otro = clientes.find((c) => c.id !== 'cli-1');

  // sin beneficiario: rechaza
  const mala = await fetch(`${baseUrl}/facturas`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Deuda recuperada', monto: 300, codigo: '1090DR' }) });
  assert.equal(mala.status, 400);

  const dr = await fetch(`${baseUrl}/facturas`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Deuda recuperada', monto: 300, codigo: '1090DR', beneficiarioId: otro.id }) }).then((r) => r.json());
  assert.equal(dr.beneficiarioId, otro.id);

  // pago parcial: todavía no hay saldo a favor
  await fetch(`${baseUrl}/pagos`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', metodo: 'zelle', aplicaciones: [{ facturaId: dr.id, monto: 100 }] }) });
  let ncs = await fetch(`${baseUrl}/notas-credito`, { headers }).then((r) => r.json());
  assert.equal(ncs.filter((n) => n.origenFacturaId === dr.id).length, 0);

  // pago del resto: se genera la NC en la unidad beneficiaria
  await fetch(`${baseUrl}/pagos`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', metodo: 'zelle', aplicaciones: [{ facturaId: dr.id, monto: 200 }] }) });
  ncs = await fetch(`${baseUrl}/notas-credito`, { headers }).then((r) => r.json());
  const saf = ncs.filter((n) => n.origenFacturaId === dr.id);
  assert.equal(saf.length, 1);
  assert.equal(saf[0].clienteId, otro.id);
  assert.equal(saf[0].monto, 300);
  assert.match(saf[0].motivo, /1090SAF/);
});

test('parser de Kotapay saca monto, titular, vehículo, tarjeta y transacción', () => {
  const asunto = 'Receipt for Vehicle Number: 521-cc (Jesny Ocampo)';
  const cuerpo = 'Receipt for Vehicle Number: 521-cc Your payment was successful. Thank you for your payment! Date Submitted: 10/14/2026 Name: Jesny ocampo Email: jesny0721@gmail.com Address: 5386 Redmont ct Norcross, Ga 30093 Amount: $ 3.00 Cardholder: Jesny Ocampo Card type: VisaCard Card number: ************8531 Expiration: 06/31 Approval code: 135282 Transaction ID: db815bv0i476isdkmbfg First Payment Date: 10/14/2026 Vehicle Number: 521';
  const p = parsearKotapay(asunto, cuerpo);
  assert.equal(p.monto, 3);
  assert.equal(p.remitente, 'Jesny Ocampo');
  assert.equal(p.vehiculo, '521');
  assert.equal(p.referencia, 'db815bv0i476isdkmbfg');
  assert.match(p.descripcion, /Vehículo 521/);
  assert.match(p.descripcion, /8531/);
  assert.equal(parsearKotapay('Hola', 'nada que ver'), null);
});

test('parser de Kotapay detecta el pago rechazado (200-Decline) y no lo confunde con uno exitoso', () => {
  const asunto = 'Credit Card transaction declined (Edwin Morales)';
  const cuerpo = 'Credit Card transaction declined (Edwin Morales) 200-Decline Date Submitted: 09/06/2026 Name: Edwin Morales Email: x@gmail.com Address: 3230 Oaktree park dr nw Lawrenceville, Ga 30044 Amount: $ 100.00 Cardholder: Dulce hernandez Card type: MasterCard Card number: ************9317 Expiration: 08/30 First Payment Date: 09/06/2026 Vehicle Number: 1886';
  const p = parsearKotapay(asunto, cuerpo);
  assert.equal(p.resultado, 'rechazado');
  assert.equal(p.monto, 100);
  assert.equal(p.vehiculo, '1886');
  assert.equal(p.remitente, 'Edwin Morales');
  assert.match(p.descripcion, /RECHAZADO/);
  assert.match(p.descripcion, /Titular: Dulce hernandez/);
  assert.equal(p.motivoRechazo, '200-Decline');
});

test('parser de Zelle detecta cuando la unidad PIDE dinero en vez de enviarlo (solicitud)', () => {
  const p = parsearContenido('Juan Cardenas ha solicitado $155.00', 'Juan Cardenas ha solicitado $155.00 juan cardenas 1904 Enviar dinero Después de que envíe el dinero, estará disponible para Juan Cardenas');
  assert.equal(p.resultado, 'solicitud');
  assert.equal(p.remitente, 'Juan Cardenas');
  assert.equal(p.monto, 155);
  assert.match(p.descripcion, /1904/);
  // y un envío normal sigue siendo envío (sin resultado de alerta)
  const e = parsearContenido('Juan le envió $155.00', 'Juan le envió $155.00 D135 Consultar su saldo');
  assert.equal(e.resultado, undefined);
});

// ─── Roles, solicitudes y cierre contable ────────────────────────────
test('roles: operador pide cambio de monto → solicitud; admin aprueba y se aplica', async () => {
  await db.prepare("INSERT INTO usuarios (id, nombre, rol, pin_hash, activo) VALUES ('user-sup', 'Super Test', 'supervisor', ?, true) ON CONFLICT DO NOTHING").run(hashPin('4321'));
  const admin = headersDe(await login('user-admin', '1234'));
  const op = headersDe(await login('user-op', '5678'));
  const sup = headersDe(await login('user-sup', '4321'));

  const f = await fetch(`${baseUrl}/facturas`, { method: 'POST', headers: op, body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Rol A', monto: 50 }) }).then((r) => r.json());

  // Concepto: lo puede cambiar directo
  const c = await fetch(`${baseUrl}/facturas/${f.id}`, { method: 'PATCH', headers: op, body: JSON.stringify({ concepto: 'Rol A2' }) });
  assert.equal(c.status, 200);
  assert.equal((await c.json()).concepto, 'Rol A2');

  // Monto: queda pendiente
  const m = await fetch(`${baseUrl}/facturas/${f.id}`, { method: 'PATCH', headers: op, body: JSON.stringify({ monto: 70 }) });
  assert.equal(m.status, 202);
  const { solicitud, mensaje } = await m.json();
  assert.match(mensaje, /sector contable/);
  assert.equal(solicitud.detalle[0].campo, 'Monto');
  const sin = await fetch(`${baseUrl}/facturas`, { headers: admin }).then((r) => r.json());
  assert.equal(sin.find((x) => x.id === f.id).monto, 50);

  // El operador no aprueba
  assert.equal((await fetch(`${baseUrl}/solicitudes/${solicitud.id}/aprobar`, { method: 'POST', headers: op, body: '{}' })).status, 403);
  const ap = await fetch(`${baseUrl}/solicitudes/${solicitud.id}/aprobar`, { method: 'POST', headers: admin, body: '{}' });
  assert.equal(ap.status, 200);
  const despues = await fetch(`${baseUrl}/facturas`, { headers: admin }).then((r) => r.json());
  assert.equal(despues.find((x) => x.id === f.id).monto, 70);

  // Supervisor edita monto directo
  assert.equal((await fetch(`${baseUrl}/facturas/${f.id}`, { method: 'PATCH', headers: sup, body: JSON.stringify({ monto: 75 }) })).status, 200);
});

test('roles: borrar factura — admin directo, supervisor y operador por solicitud; rechazar no cambia nada', async () => {
  const admin = headersDe(await login('user-admin', '1234'));
  const op = headersDe(await login('user-op', '5678'));
  const sup = headersDe(await login('user-sup', '4321'));
  const crear = () => fetch(`${baseUrl}/facturas`, { method: 'POST', headers: admin, body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Borrar', monto: 10 }) }).then((r) => r.json());
  const f1 = await crear();
  const f2 = await crear();

  assert.equal((await fetch(`${baseUrl}/facturas/${f1.id}`, { method: 'DELETE', headers: op })).status, 202);
  const r2 = await fetch(`${baseUrl}/facturas/${f1.id}`, { method: 'DELETE', headers: sup });
  assert.equal(r2.status, 202);
  const sol = (await r2.json()).solicitud;
  const rech = await fetch(`${baseUrl}/solicitudes/${sol.id}/rechazar`, { method: 'POST', headers: admin, body: JSON.stringify({ nota: 'no' }) });
  assert.equal(rech.status, 200);
  assert.ok(await db.prepare('SELECT 1 FROM facturas WHERE id = ?').get(f1.id));

  assert.equal((await fetch(`${baseUrl}/facturas/${f2.id}`, { method: 'DELETE', headers: admin })).status, 200);
  assert.equal(await db.prepare('SELECT 1 FROM facturas WHERE id = ?').get(f2.id), undefined);
});

test('roles: informes (operador 403, supervisor lee) y operador de solo lectura en gastos', async () => {
  const op = headersDe(await login('user-op', '5678'));
  const sup = headersDe(await login('user-sup', '4321'));
  assert.equal((await fetch(`${baseUrl}/contabilidad/plan`, { headers: op })).status, 403);
  assert.equal((await fetch(`${baseUrl}/contabilidad/plan`, { headers: sup })).status, 200);
  assert.equal((await fetch(`${baseUrl}/contabilidad/asientos`, { method: 'POST', headers: sup, body: '{}' })).status, 403);
  assert.equal((await fetch(`${baseUrl}/gastos`, { method: 'POST', headers: op, body: '{}' })).status, 403);
});

test('cierre contable: admin bloquea el período; edición directa 423, operador queda en solicitud', async () => {
  const admin = headersDe(await login('user-admin', '1234'));
  const op = headersDe(await login('user-op', '5678'));
  const f = await fetch(`${baseUrl}/facturas`, { method: 'POST', headers: admin, body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Cierre', monto: 20 }) }).then((r) => r.json());

  assert.equal((await fetch(`${baseUrl}/solicitudes/cierre/actual`, { method: 'PUT', headers: op, body: JSON.stringify({ cierreHasta: '2999-12-31' }) })).status, 403);
  assert.equal((await fetch(`${baseUrl}/solicitudes/cierre/actual`, { method: 'PUT', headers: admin, body: JSON.stringify({ cierreHasta: '2999-12-31' }) })).status, 200);

  assert.equal((await fetch(`${baseUrl}/facturas/${f.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ concepto: 'x' }) })).status, 423);
  const o = await fetch(`${baseUrl}/facturas/${f.id}`, { method: 'PATCH', headers: op, body: JSON.stringify({ concepto: 'x' }) });
  assert.equal(o.status, 202);

  await fetch(`${baseUrl}/solicitudes/cierre/actual`, { method: 'PUT', headers: admin, body: JSON.stringify({ cierreHasta: null }) });
  assert.equal((await fetch(`${baseUrl}/facturas/${f.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ concepto: 'x' }) })).status, 200);
});

// ─── Cobros indebidos, traspasos, baja automática y Undeposited ──────
async function crearYPagar(headers, clienteId, concepto, monto, codigo, metodo = 'zelle') {
  const f = await fetch(`${baseUrl}/facturas`, { method: 'POST', headers, body: JSON.stringify({ clienteId, concepto, monto, codigo }) }).then((r) => r.json());
  const p = await fetch(`${baseUrl}/pagos`, { method: 'POST', headers, body: JSON.stringify({ clienteId, metodo, aplicaciones: [{ facturaId: f.id, monto }] }) }).then((r) => r.json());
  return { f, p };
}

test('1090CI pagada: se reparte en varios saldos a favor (1090SAF) sin pasarse del total', async () => {
  const headers = headersDe(await login('user-admin', '1234'));
  const op = headersDe(await login('user-op', '5678'));
  const { f } = await crearYPagar(headers, 'cli-1', 'Cobro indebido', 20, '1090CI');
  const lineas = (a) => fetch(`${baseUrl}/facturas/${f.id}/asignar-saf`, { method: 'POST', headers: a, body: JSON.stringify({ asignaciones: [{ clienteId: 'cli-2', monto: 6 }] }) });
  assert.equal((await lineas(op)).status, 403);
  assert.equal((await lineas(headers)).status, 201);
  assert.equal((await lineas(headers)).status, 201);
  const r3 = await fetch(`${baseUrl}/facturas/${f.id}/asignar-saf`, { method: 'POST', headers, body: JSON.stringify({ asignaciones: [{ clienteId: 'cli-2', monto: 9 }] }) });
  assert.equal(r3.status, 409); // quedan $8
  const ok = await fetch(`${baseUrl}/facturas/${f.id}/asignar-saf`, { method: 'POST', headers, body: JSON.stringify({ asignaciones: [{ clienteId: 'cli-2', monto: 8 }] }) }).then((r) => r.json());
  assert.equal(ok.restante, 0);
  const nc = await fetch(`${baseUrl}/notas-credito`, { headers }).then((r) => r.json());
  assert.equal(nc.filter((n) => n.origenFacturaId === f.id).length, 3);
  assert.match(nc.find((n) => n.origenFacturaId === f.id).motivo, /1090SAF/);
});

test('una nota de crédito se puede pasar a otra unidad y el concepto lo deja asentado; una factura sin pagos también', async () => {
  const headers = headersDe(await login('user-admin', '1234'));
  const nc = await fetch(`${baseUrl}/notas-credito`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', fecha: '2026-10-01', monto: 25, motivo: '1090SAF · prueba' }) }).then((r) => r.json());
  const mov = await fetch(`${baseUrl}/notas-credito/${nc.id}`, { method: 'PATCH', headers, body: JSON.stringify({ clienteId: 'cli-2', fecha: '2026-10-02' }) }).then((r) => r.json());
  assert.equal(mov.clienteId, 'cli-2');
  assert.equal(mov.fecha, '2026-10-02');
  assert.match(mov.motivo, /pasada de D0001 a D0002/);

  const f = await fetch(`${baseUrl}/facturas`, { method: 'POST', headers, body: JSON.stringify({ clienteId: 'cli-1', concepto: 'Mover', monto: 30 }) }).then((r) => r.json());
  const mf = await fetch(`${baseUrl}/facturas/${f.id}`, { method: 'PATCH', headers, body: JSON.stringify({ clienteId: 'cli-2', fecha: '2026-09-30', codigo: '1090W' }) }).then((r) => r.json());
  assert.equal(mf.clienteId, 'cli-2');
  assert.equal(mf.codigo, '1090W');
  const { f: pagada } = await crearYPagar(headers, 'cli-1', 'Pagada', 10);
  const bad = await fetch(`${baseUrl}/facturas/${pagada.id}`, { method: 'PATCH', headers, body: JSON.stringify({ clienteId: 'cli-2' }) });
  assert.equal(bad.status, 409);
});

test('baja automática: pasa a inactivo a quien no pagó la cuota semanal vencida; solo admin', async () => {
  const headers = headersDe(await login('user-admin', '1234'));
  const op = headersDe(await login('user-op', '5678'));
  await db.prepare(`INSERT INTO clientes (id, codigo, numero, nombre, telefonos, licencia_info, cuota_semanal, fecha_alta, estado) VALUES ('cli-baja', 'D0777', '777', 'Moroso', '', '', 14500, '2025-01-01', 'activo')`).run();
  const ayer = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO facturas (id, numero, cliente_id, semana, fecha, fecha_vencimiento, concepto, monto, monto_pagado, estado, codigo) VALUES ('fac-baja', 987654, 'cli-baja', 1, ?, ?, '1090PB Semana 1', 14500, 0, 'pendiente', '1090PB')`).run(ayer, ayer);
  assert.equal((await fetch(`${baseUrl}/baja-automatica/ejecutar`, { method: 'POST', headers: op })).status, 403);
  const r = await fetch(`${baseUrl}/baja-automatica/ejecutar`, { method: 'POST', headers }).then((x) => x.json());
  assert.ok(r.clientes.some((c) => c.codigo === 'D0777'));
  assert.equal((await db.prepare("SELECT estado FROM clientes WHERE id = 'cli-baja'").get()).estado, 'inactivo');
  const cfg = await fetch(`${baseUrl}/baja-automatica`, { method: 'PUT', headers, body: JSON.stringify({ activa: true, dia: 'mie', hora: '00:00' }) }).then((x) => x.json());
  assert.equal(cfg.activa, true);
});

test('Undeposited: Kotapay y efectivo esperan; la administración los deposita en 10200/10201 y se puede deshacer', async () => {
  const headers = headersDe(await login('user-admin', '1234'));
  const op = headersDe(await login('user-op', '5678'));
  const { p: pk } = await crearYPagar(headers, 'cli-1', 'Kota', 40, undefined, 'kotapay');
  const { p: pz } = await crearYPagar(headers, 'cli-1', 'Zelle', 15, undefined, 'zelle');
  assert.equal((await fetch(`${baseUrl}/undeposited`, { headers: op })).status, 403);
  const antes = await fetch(`${baseUrl}/undeposited`, { headers }).then((r) => r.json());
  assert.ok(antes.pendientes.some((x) => x.pagoId === pk.id));
  assert.ok(!antes.pendientes.some((x) => x.pagoId === pz.id)); // Zelle entra directo al banco
  const dep = await fetch(`${baseUrl}/undeposited/depositar`, { method: 'POST', headers, body: JSON.stringify({ pagoIds: [pk.id], destino: '10200', fecha: '2026-10-21' }) });
  assert.equal(dep.status, 201);
  const despues = await fetch(`${baseUrl}/undeposited`, { headers }).then((r) => r.json());
  assert.ok(!despues.pendientes.some((x) => x.pagoId === pk.id));
  assert.equal(despues.depositos[0].destino, '10200');
  assert.equal((await fetch(`${baseUrl}/undeposited/depositar`, { method: 'POST', headers, body: JSON.stringify({ pagoIds: [pk.id], destino: '10200', fecha: '2026-10-21' }) })).status, 409);
  const lineas = await db.prepare('SELECT cuenta, debe, haber FROM asiento_lineas l JOIN asientos a ON a.id = l.asiento_id WHERE a.id = (SELECT asiento_id FROM depositos_undeposited LIMIT 1)').all();
  assert.deepEqual(lineas.map((l) => [l.cuenta, l.debe, l.haber]).sort(), [['10200', 4000, 0], ['14500', 0, 4000]].sort());
  assert.equal((await fetch(`${baseUrl}/undeposited/depositos/${despues.depositos[0].id}`, { method: 'DELETE', headers })).status, 200);
  const vuelve = await fetch(`${baseUrl}/undeposited`, { headers }).then((r) => r.json());
  assert.ok(vuelve.pendientes.some((x) => x.pagoId === pk.id));
});
