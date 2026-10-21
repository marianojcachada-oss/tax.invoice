-- Esquema de la base de datos de Taxi Cobros — versión Postgres/Supabase.
-- Mismo modelo que schema.sql (SQLite), adaptado al dialecto de Postgres:
--   - INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
--   - columnas 0/1 -> BOOLEAN de verdad
-- Los montos se guardan en centavos (INTEGER) para evitar problemas de
-- redondeo de punto flotante con plata. Se convierte a dólares (dividir
-- por 100) recién al armar la respuesta HTTP.

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT,
  rol TEXT NOT NULL CHECK (rol IN ('admin', 'operador')),
  pin_hash TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL,
  numero TEXT NOT NULL,
  nombre TEXT NOT NULL,
  email TEXT,
  tipo TEXT,
  licencia_info TEXT,
  telefonos TEXT,
  direccion TEXT,
  notas TEXT,
  cuota_semanal INTEGER NOT NULL,
  fecha_alta TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('activo', 'inactivo'))
);

CREATE TABLE IF NOT EXISTS facturas (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL,
  cliente_id TEXT NOT NULL REFERENCES clientes(id),
  semana INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  fecha_vencimiento TEXT NOT NULL,
  concepto TEXT NOT NULL,
  monto INTEGER NOT NULL,
  monto_pagado INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL
);
-- Código del catálogo de fees usado al crear la factura (1060NL,
-- 1090PB, etc.) — nullable: las facturas viejas o las creadas con
-- "Otro" no tienen uno. Sirve para filtrar de forma confiable (en vez
-- de tener que interpretar el texto de "concepto").
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS codigo TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS creado_por TEXT;
CREATE INDEX IF NOT EXISTS idx_facturas_cliente ON facturas(cliente_id);

-- Catálogo configurable de fees (Configuración -> Catálogo de fees):
-- cada ítem tiene un código, una etiqueta, y un monto por defecto. Se
-- usa como desplegable al crear una factura manual — el precio se
-- autocompleta según el código elegido.
CREATE TABLE IF NOT EXISTS catalogo_fees (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL,
  etiqueta TEXT NOT NULL,
  monto INTEGER NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0
);


CREATE TABLE IF NOT EXISTS pagos (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL,
  cliente_id TEXT NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL,
  monto INTEGER NOT NULL,
  metodo TEXT NOT NULL,
  referencia TEXT,
  cuenta_id TEXT,
  editado BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_pagos_cliente ON pagos(cliente_id);

CREATE TABLE IF NOT EXISTS pago_aplicaciones (
  id SERIAL PRIMARY KEY,
  pago_id TEXT NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
  factura_id TEXT NOT NULL REFERENCES facturas(id),
  monto INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aplicaciones_pago ON pago_aplicaciones(pago_id);

CREATE TABLE IF NOT EXISTS notas_credito (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL,
  cliente_id TEXT NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL,
  monto INTEGER NOT NULL,
  monto_aplicado INTEGER NOT NULL DEFAULT 0,
  motivo TEXT NOT NULL,
  aplicada BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS nota_credito_facturas (
  id SERIAL PRIMARY KEY,
  nota_id TEXT NOT NULL REFERENCES notas_credito(id) ON DELETE CASCADE,
  factura_id TEXT NOT NULL REFERENCES facturas(id)
);

CREATE TABLE IF NOT EXISTS reembolsos (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL,
  cliente_id TEXT NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL,
  monto INTEGER NOT NULL,
  metodo TEXT NOT NULL,
  motivo TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gastos (
  id TEXT PRIMARY KEY,
  fecha TEXT NOT NULL,
  proveedor TEXT NOT NULL,
  categoria TEXT NOT NULL,
  cuenta_id TEXT,
  metodo TEXT,
  monto INTEGER NOT NULL,
  nota TEXT
);

CREATE TABLE IF NOT EXISTS cuentas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  saldo_inicial INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transferencias (
  id TEXT PRIMARY KEY,
  fecha TEXT NOT NULL,
  cuenta_origen_id TEXT NOT NULL REFERENCES cuentas(id),
  cuenta_destino_id TEXT NOT NULL REFERENCES cuentas(id),
  monto INTEGER NOT NULL,
  nota TEXT
);

CREATE TABLE IF NOT EXISTS proveedores (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  empresa TEXT,
  telefono TEXT,
  email TEXT,
  condiciones_pago TEXT,
  estado TEXT NOT NULL DEFAULT 'activo'
);

CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL,
  proveedor_id TEXT NOT NULL REFERENCES proveedores(id),
  fecha TEXT NOT NULL,
  fecha_vencimiento TEXT NOT NULL,
  concepto TEXT NOT NULL,
  monto INTEGER NOT NULL,
  monto_pagado INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bill_pagos (
  id TEXT PRIMARY KEY,
  proveedor_id TEXT NOT NULL REFERENCES proveedores(id),
  fecha TEXT NOT NULL,
  monto INTEGER NOT NULL,
  metodo TEXT NOT NULL,
  cuenta_id TEXT
);

CREATE TABLE IF NOT EXISTS bill_pago_aplicaciones (
  id SERIAL PRIMARY KEY,
  bill_pago_id TEXT NOT NULL REFERENCES bill_pagos(id) ON DELETE CASCADE,
  bill_id TEXT NOT NULL REFERENCES bills(id),
  monto INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documentos (
  id TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL REFERENCES clientes(id),
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  tamano INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  data_url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS configuracion (
  id INTEGER PRIMARY KEY CHECK (id = 1), -- fila única
  cuota_semanal_por_defecto INTEGER NOT NULL,
  dia_emision TEXT NOT NULL,
  metodos_habilitados TEXT NOT NULL, -- JSON array (como texto)
  recordatorios_activo BOOLEAN NOT NULL DEFAULT true,
  recordatorios_semanas INTEGER NOT NULL DEFAULT 4,
  recordatorios_solo_vencido BOOLEAN NOT NULL DEFAULT true,
  recordatorios_plantilla TEXT NOT NULL,
  ringcentral_client_id TEXT,
  ringcentral_client_secret TEXT,
  ringcentral_numero_desde TEXT,
  empresa_nombre TEXT,
  empresa_direccion TEXT,
  empresa_email TEXT
);
-- Precio de la cuota semanal (1090PB) según el día en que se corre la
-- generación — normativa: $145 los lunes, con descuento si se corre
-- después. Nullable: si un día no tiene precio propio cargado, se usa
-- cuota_semanal_por_defecto. Solo se aplica a los clientes que están en
-- la cuota "estándar" (igual a cuota_semanal_por_defecto) — el que tenga
-- un valor propio distinto mantiene su cuota particular, sin importar el día.
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS precio_lunes INTEGER;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS precio_martes INTEGER;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS precio_miercoles INTEGER;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS precio_jueves INTEGER;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS precio_viernes INTEGER;

CREATE TABLE IF NOT EXISTS auditoria (
  id TEXT PRIMARY KEY,
  fecha TEXT NOT NULL,
  usuario TEXT NOT NULL,
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id TEXT NOT NULL,
  resumen TEXT NOT NULL,
  cambios TEXT -- JSON array (como texto), opcional
);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidad ON auditoria(entidad, entidad_id);

-- Fees "tildados" en la ficha de un cliente, pendientes de facturarse en
-- la próxima corrida semanal. Se borran solos de acá en cuanto se
-- facturan (quedan como factura real, no hace falta guardar el
-- historial en esta tabla aparte).
CREATE TABLE IF NOT EXISTS cliente_fees_pendientes (
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  fee_id TEXT NOT NULL REFERENCES catalogo_fees(id) ON DELETE CASCADE,
  PRIMARY KEY (cliente_id, fee_id)
);

-- Pagos detectados en el buzón de Outlook (notificaciones de Zelle),
-- pendientes de asignar a un cliente.
CREATE TABLE IF NOT EXISTS pagos_email (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  fecha TEXT NOT NULL,
  remitente TEXT NOT NULL,
  descripcion TEXT,
  monto INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aplicado','descartado')),
  cliente_id TEXT REFERENCES clientes(id),
  pago_id TEXT REFERENCES pagos(id)
);

ALTER TABLE pagos_email ADD COLUMN IF NOT EXISTS hora TEXT; -- HH:MM hora de Atlanta en que llegó el mail

-- Envío automático de la factura paga por mail (config + marca de enviada)
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS mail_auto BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS mail_remitente_nombre TEXT;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS mail_remitente_direccion TEXT;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS mail_responder_a TEXT;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS mail_asunto TEXT;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS mail_mensaje TEXT;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS smtp_host TEXT;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS smtp_puerto INTEGER;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS smtp_usuario TEXT;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS smtp_clave TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mail_enviado TEXT; -- fecha/hora en que se mandó la factura paga
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS mail_metodo TEXT; -- 'graph' | 'smtp'
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS mail_buzon_envio TEXT; -- buzón real desde el que se envía por Graph

-- Reembolsos ligados a un pago concreto (parciales permitidos) y a la cuenta de la que salió el dinero
ALTER TABLE reembolsos ADD COLUMN IF NOT EXISTS pago_id TEXT;
ALTER TABLE reembolsos ADD COLUMN IF NOT EXISTS cuenta_id TEXT;

-- Deuda Recuperada (1060DR): la unidad que recupera el dinero paga la factura DR,
-- y al quedar paga se genera un saldo a favor (1060SAF) para la unidad beneficiaria.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS beneficiario_id TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS recupero_nc_id TEXT;
ALTER TABLE notas_credito ADD COLUMN IF NOT EXISTS origen_factura_id TEXT;

-- Origen del pago detectado por mail: 'zelle' (Outlook) o 'kotapay' (Gmail)
ALTER TABLE pagos_email ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'zelle';
ALTER TABLE pagos_email ADD COLUMN IF NOT EXISTS referencia TEXT;

-- Pagos con tarjeta rechazados (Kotapay "declined"): se guardan para verlos, pero no se pueden aplicar
ALTER TABLE pagos_email ADD COLUMN IF NOT EXISTS resultado TEXT NOT NULL DEFAULT 'aprobado';
ALTER TABLE pagos_email ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;

-- ─── Contabilidad (informes estilo QuickBooks) ───────────────────────
-- Plan de cuentas (el que envió el estudio contable). "mostrar_en_cero":
-- el Balance Sheet de QuickBooks lista algunas cuentas aunque estén en 0.
CREATE TABLE IF NOT EXISTS plan_cuentas (
  numero TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  detalle TEXT,
  padre TEXT,
  activa BOOLEAN NOT NULL DEFAULT true,
  mostrar_en_cero BOOLEAN NOT NULL DEFAULT false,
  cero_con_signo BOOLEAN NOT NULL DEFAULT false -- en 0 y sin movimientos QuickBooks lo muestra como $0.00
);

ALTER TABLE plan_cuentas ADD COLUMN IF NOT EXISTS cero_con_signo BOOLEAN NOT NULL DEFAULT false;

-- Saldos de arranque (cargados desde el Balance Sheet y el Profit and Loss
-- de QuickBooks a la fecha de corte). Siempre en el signo en que se muestran
-- en el informe (activos +, pasivos +, ingresos +, gastos +).
CREATE TABLE IF NOT EXISTS saldos_iniciales (
  cuenta TEXT PRIMARY KEY REFERENCES plan_cuentas(numero),
  monto INTEGER NOT NULL
);

-- Asientos manuales (nómina, depreciación, retiros del socio, ajustes...).
CREATE TABLE IF NOT EXISTS asientos (
  id TEXT PRIMARY KEY,
  fecha TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  creado_por TEXT
);
CREATE TABLE IF NOT EXISTS asiento_lineas (
  id SERIAL PRIMARY KEY,
  asiento_id TEXT NOT NULL REFERENCES asientos(id) ON DELETE CASCADE,
  cuenta TEXT NOT NULL REFERENCES plan_cuentas(numero),
  debe INTEGER NOT NULL DEFAULT 0,
  haber INTEGER NOT NULL DEFAULT 0
);

-- A qué cuenta contable va cada cosa de la app.
ALTER TABLE catalogo_fees ADD COLUMN IF NOT EXISTS cuenta_ingreso TEXT;
ALTER TABLE cuentas ADD COLUMN IF NOT EXISTS cuenta_contable TEXT;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS cuenta_contable TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS cuenta_contable TEXT;
-- Ajustes de contabilidad (JSON): fecha de corte, cuentas por método de pago, etc.
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS contab_config TEXT;

-- ─── Migración desde QuickBooks ──────────────────────────────────────
-- Nombre completo EXACTO del cliente en QuickBooks ("D0018 101001 Ninoska Chirinos"):
-- es la única clave que no se repite (el código de unidad D0101 lo usaron varias personas).
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS nombre_qb TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_nombre_qb ON clientes(nombre_qb) WHERE nombre_qb IS NOT NULL;
-- Para no importar dos veces el historial de un mismo cliente.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS historial_importado BOOLEAN NOT NULL DEFAULT false;
-- Número de documento de QuickBooks (no es único: QuickBooks repite números).
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS numero_qb TEXT;
ALTER TABLE notas_credito ADD COLUMN IF NOT EXISTS numero_qb TEXT;

-- Seguridad en Supabase: sus tablas quedan expuestas por una API REST pública
-- (con la clave "anon") salvo que tengan Row Level Security activado. El servidor
-- se conecta como dueño de la base y no se ve afectado; con RLS activo y SIN
-- políticas, la API pública no puede leer ni escribir nada.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- La fila única de configuración tiene que existir siempre: si la base es nueva
-- (sin seed), sin ella /api/configuracion daba error 500 y la app echaba al usuario.
INSERT INTO configuracion (
  id, cuota_semanal_por_defecto, dia_emision, metodos_habilitados,
  recordatorios_activo, recordatorios_semanas, recordatorios_solo_vencido, recordatorios_plantilla,
  empresa_nombre, empresa_direccion, empresa_email
) VALUES (
  1, 14500, 'lun', '["zelle","efectivo","kotapay","ach","tarjeta"]',
  true, 4, true, 'Hola {nombre}, tenés un saldo pendiente de {monto} ({dias} días de atraso). Por favor ponete al día cuando puedas. ¡Gracias!',
  'tax.invoice', '', ''
) ON CONFLICT (id) DO NOTHING;
