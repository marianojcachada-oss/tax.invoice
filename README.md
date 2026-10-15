# Sistema de Cobros (sin nombre todavia)

Prototipo funcional (React + TypeScript + Vite + Tailwind v4).

## Cambios de esta vuelta

### El bug real detras de "las facturas pagadas siguen apareciendo como pendientes"

Encontre un problema de fondo en como se aplicaban los pagos: la funcion que
repartia el monto entre las facturas seleccionadas usaba una variable
"restante" compartida y mutable DENTRO del actualizador de estado de React.
La app corre en `<StrictMode>` (configuracion por defecto de Vite/React), que
en desarrollo puede invocar dos veces las funciones que se le pasan a
`setState` para detectar efectos impuros — si eso pasaba, la segunda
invocacion arrancaba con la variable ya "gastada" por la primera, y el pago
terminaba sin aplicarse de verdad a la factura (quedaba pendiente aunque el
`Pago` sí se hubiera guardado, por eso aparecia en Pagos pero no en el filtro
"Pagadas"). 

Se reescribio esta logica en tres lugares (pagos a clientes, aplicacion de
notas de credito, pagos a proveedores) para que el reparto se calcule una
sola vez de forma pura ANTES de tocar el estado, sin ninguna variable
compartida mutable. Esto deberia resolver de raiz el problema, tanto el de
"Pagadas" como el de "las facturas pagadas me siguen saliendo pendientes en
los recibos".

Sobre el metodo de pago "siempre sale como Zelle": revise el codigo del
selector de metodo a fondo y no encontre ningun valor forzado — cada boton
llama correctamente a setMetodo. Es posible que este sintoma fuera en
realidad consecuencia del mismo bug de arriba (si la factura nunca se
marcaba paga de verdad, volvias a abrir el modal de pago para el mismo
cliente una y otra vez, y cada apertura nueva arranca en "Zelle" por
default). Si despues de esta correccion el metodo elegido sigue sin
guardarse bien, contame los pasos exactos (que boton apretaste, en que
pantalla) para poder reproducirlo con precision.

### Registrar pago: ahora es completamente manual

- Se ingresa primero el **monto que pago el cliente** (ya no se calcula
  solo).
- Despues se elige a que factura(s) aplicarlo, con un campo de monto editable
  por cada factura — se puede **cancelar solo una parte** de una factura
  puntual, dejandola en estado "parcial" para el resto.
- Un boton "Autocompletar" reparte el monto entre las facturas mas antiguas
  primero, como punto de partida editable (no obligatorio).
- Se exige que lo asignado a facturas coincida exactamente con el monto
  recibido, para que no se pierda track de la plata.

### Editar un pago ya registrado

- En Cobros -> Pagos, cada fila tiene ahora un boton "Editar" ademas de "Ver
  recibo".
- Se puede corregir metodo, referencia, cuenta, y REASIGNAR el monto entre
  las facturas del cliente (incluyendo las que ese pago ya habia cubierto).
- Internamente, corregir un pago revierte su efecto anterior sobre las
  facturas y aplica el nuevo en un solo paso puro (mismo enfoque que arriba).
- Los pagos corregidos muestran una etiqueta "corregido" en la lista, y la
  correccion queda en Auditoria con el detalle de que cambio.

### Buscar cliente para agregar factura / nota de credito (de la vuelta anterior, reconfirmado)

- Clientes: cada fila tiene "+ Nota de credito" ademas de "Recibir pago" /
  "Crear factura".
- Ficha del cliente: boton "Nota de credito" junto a "Crear factura".

## Como correrlo

```bash
npm install
npm run dev
```

Para el build de produccion:

```bash
npm run build
npm run preview
```

## Pago con excedente = saldo a favor automático

- Si el cliente paga MÁS de lo que debía la factura (ej. factura de $15,
  transferencia de $20), ya no hace falta que el monto asignado calce exacto.
  El sistema aplica lo que corresponde a la(s) factura(s) elegidas y el resto
  se guarda automáticamente como una **nota de crédito** a favor del cliente
  ("Excedente del pago #N"), visible en Cobros -> Notas de crédito, lista para
  aplicarse a una factura futura cuando el administrador quiera.
- Sigue bloqueado el caso contrario: asignar a una factura más de lo que el
  cliente efectivamente pagó, o más de lo que esa factura puntual debe — eso
  sí sigue siendo un error de carga.

## Notas de crédito visibles en la cuenta del cliente

- La ficha del cliente (pestaña "Cuenta corriente") ahora mezcla facturas y
  notas de credito en una sola linea de tiempo, ordenadas por fecha. Cada
  nota de credito se ve con su motivo, el monto, cuanto le queda disponible,
  y un boton "Aplicar" ahi mismo si todavia tiene saldo sin usar.
- La tarjeta "Saldo" de arriba ahora tambien muestra, si corresponde, cuanto
  saldo a favor sin aplicar tiene el cliente (en verde, debajo del monto que
  debe), para que sea facil ver de un vistazo la situacion completa antes de
  decidir aplicar el credito.
- El monto que debe el cliente (el KPI "Saldo", los reportes de cuentas por
  cobrar, el dashboard) sigue reflejando lo facturado sin aplicar creditos
  automaticamente — eso es a proposito: el credito queda visible y disponible,
  pero es el administrador quien decide cuando aplicarlo a una factura
  puntual, tal como se pidio.

## Protección contra doble clic (super importante, ya resuelto)

Todos los formularios que registran plata (pagos a clientes, edición de un
pago, pagos a proveedores, crear factura, crear bill, crear nota de credito,
transferencias, aplicar nota de credito) ahora usan una traba sincrónica
(`useRef`) que se marca ANTES de cualquier otra cosa dentro de la función de
guardado. Esto es más confiable que solo deshabilitar visualmente el boton,
porque no depende de que React ya haya vuelto a renderizar: un segundo click
disparado a los pocos milisegundos del primero se corta en seco, sin
depender de timing.

## Historial de cambios por documento

Se agrego `src/components/DocumentAuditHistory.tsx`, que reutiliza el mismo
log de Auditoria global pero filtrado a un documento puntual (factura, pago,
cliente). Se ve directamente:
- Dentro de "Ver factura" (que factura se creo, que pagos se le aplicaron).
- Dentro de "Editar pago" y "Ver recibo" (si el pago fue corregido despues,
  que cambio exactamente).
- En la ficha del cliente, pestaña "Notas" (cambios al cliente: ej. cuota
  semanal editada, dado de baja/reactivado).

No hace falta ir a la pantalla global de Auditoria para ver "que paso" con
un documento puntual — ya aparece ahi mismo, en contexto.

## Automatizar la facturación semanal

- Nuevo botón **"Generar facturas de la semana"** en Cobros -> Facturas.
- Antes de tocar nada, muestra una vista previa: a cuántos clientes activos
  se les va a generar (y cuánto suma en total), a cuántos dados de baja se
  va a saltear, y si alguien ya tenía factura de esa semana (para no
  duplicar).
- La lógica de quién recibe factura queda resuelta en
  `generarFacturasSemanales()` (dentro de `DataContext.tsx`): **solo
  clientes con estado `activo`**. Un cliente dado de baja no vuelve a
  recibir facturas automáticas nunca más, sin importar su historial.
- Esto hoy se dispara a mano con el botón. Para que corra solo todos los
  lunes sin que nadie lo apriete, hace falta un backend con una tarea
  programada (cron) — pero la lógica de negocio (a quién facturar, cuánto,
  evitar duplicados) ya está resuelta y lista: el día que haya backend, es
  la misma función la que hay que enganchar al cron, no hay que
  reescribirla.

## Ajustes sobre Clientes y Cobros (a partir de la captura que mandaste)

- **Clientes**: cada fila ahora muestra un chip de estado ("Activo" en verde
  o "Dado de baja") — se ve a simple vista sin tener que filtrar.
- **Cobros -> Facturas**:
  - Filtro por rango de fechas de vencimiento ("Desde" / "Hasta").
  - Los encabezados de Fecha, N°, Cliente y Estado ahora son clickeables:
    ordenan de mayor a menor / menor a mayor (o A-Z / Z-A para Cliente), con
    una flechita que indica la dirección activa. Un segundo clic invierte el
    orden.
  - Se agregó la columna **Saldo** (saldo pendiente de cada factura, no solo
    el monto total).
- **Se corrigió la desalineación real**: cada fila de una tabla armaba su
  propia grilla independiente, así que la columna de acciones (con ancho
  "auto") variaba de fila a fila según si tenía uno o dos botones — eso
  corría a las demás columnas y desalineaba todo cuando, por ejemplo, una
  factura pasaba de "pendiente" (dos botones) a "pagada" (un botón). Se
  cambió esa columna a un ancho fijo en Clientes, Facturas, Pagos, Notas de
  crédito, Proveedores, Bills, Cuentas y la cuenta corriente del cliente —
  ahora el ancho no depende del contenido de cada fila.

## Datos de la empresa en las facturas

- Nueva sección en Configuración: "Datos de la empresa" (nombre, dirección,
  email). Se guardan como el resto de la configuración (localStorage) y se
  usan para autocompletar el encabezado de cada factura generada — ya no
  hace falta cargar ese dato a mano en cada una.

## Saldo con signo (deuda vs. saldo a favor)

- En Clientes, la columna "Saldo" ahora muestra el neto con signo explícito:
  **-$145** si el cliente debe, **+$145** si tiene saldo a favor sin aplicar
  (rojo para deuda, verde para saldo a favor). Antes solo se veía la deuda;
  un cliente con crédito disponible y sin deuda aparecía en $0 y no se
  notaba que tenía algo a favor.
- El cálculo es neto: crédito disponible (notas de crédito sin aplicar)
  menos deuda pendiente. El filtro "Con deuda" sigue mirando solo la deuda
  (no el neto), para no perder de vista a alguien que debe aunque también
  tenga algo de crédito cargado.
- Se aplicó el mismo criterio en la ficha del cliente (tarjeta "Saldo"), y
  si tiene deuda Y crédito al mismo tiempo, se aclara el detalle de ambos
  montos por separado debajo.

## Botones decorativos: ya funcionan todos

- **Buscador global** (barra superior): busca en tiempo real clientes,
  facturas, pagos, proveedores y bills. Al elegir un resultado, navega
  directo a la ficha del cliente correspondiente (o a Proveedores, para
  proveedores/bills, ya que no tienen ficha propia todavia).
- **Exportar** (Reportes -> Cuentas por cobrar): descarga un CSV real con
  todas las filas de la matriz de antiguedad (no solo la pagina visible),
  con BOM para que Excel abra bien los acentos.
- **Plan de pago** (ficha del cliente): genera facturas nuevas espaciadas en
  cuotas (monto, cantidad de cuotas y frecuencia configurables) para
  ordenar una deuda. No modifica las facturas existentes -- queda como un
  acuerdo aparte, facil de identificar por su concepto ("Plan de pago —
  cuota X/N").
- **Documentos** (ficha del cliente): subida real de archivos (licencia,
  contrato, seguro), con limite de 3 MB por archivo. Se guardan en este
  navegador junto con el resto de los datos (localStorage), se pueden
  descargar y eliminar.

## Nuevo en el modelo de datos

- `DocumentoCliente` (adjuntos por cliente) se agrego a la persistencia
  completa (copia de seguridad, restaurar, restablecer).

## Bug crítico resuelto: Configuración ya no se rompe

Se encontró la causa raiz: datos guardados en localStorage de versiones
anteriores (sin los campos `recordatorios`/`empresa` en Configuracion, o con
`facturasAplicadas` en vez de `aplicaciones` en Pago) hacian crashear la
pantalla al leer un campo inexistente. Se reescribio `persistence.ts` para
**normalizar** cualquier dato viejo al cargar: completa los campos
faltantes con valores por defecto en vez de romper, y reconstruye los pagos
viejos lo mejor posible. Probado simulando el escenario exacto del bug.

## Historial de cambios: ahora en todos lados

Ademas de Factura, Pago y Cliente, ahora tambien se puede ver el historial
de auditoria de: Notas de credito, Reembolsos, Proveedores, Bills y
Cuentas, con un boton compacto nuevo (icono de reloj) en cada fila.

## Orden (columnas ordenables): extendido

Ademas de Facturas, ahora tambien se puede ordenar por columna en:
Clientes (por Cliente, Saldo o Estado) y Pagos (por N°, Fecha, Cliente o
Monto). Bills, Proveedores, Cuentas y Reportes quedan pendientes para una
proxima vuelta.

## Responsive: base solida, trabajo en progreso

- Menu lateral como cajon deslizable en celular, con boton hamburguesa.
- Modales ya no se cortan en pantallas chicas (los 17 modales de la app).
- Scroll horizontal agregado en: Clientes, Facturas, Pagos, Notas de
  credito, Reembolsos, Proveedores, Bills, Cuentas.
- Pendiente: Reportes y la ficha del cliente (cuenta corriente/historial).

## Orden y responsive: completado

- **Orden (columnas clickeables)**: ya cubre TODAS las tablas: Clientes,
  Facturas, Pagos, Proveedores, Bills, Cuentas y Cuentas por cobrar
  (Reportes). Cada encabezado ordenable tiene una flechita que indica la
  direccion activa; un segundo clic la invierte.
- **Responsive (scroll horizontal)**: agregado tambien a Reportes (las 3
  pestanas con tablas) y a la ficha del cliente (cuenta corriente e
  historial de pagos). Con esto, todas las tablas de la app ya tienen el
  mismo tratamiento.

## Permisos por usuario (login + roles)

- Pantalla de login real: hay que elegir usuario e ingresar un PIN de 4
  dígitos para entrar. Usuarios de ejemplo: **Luis** (admin, PIN 1234) y
  **Ana** (operador, PIN 5678).
- Roles: **admin** ve todo. **operador** no ve Configuración ni Auditoría
  (ni por el menu ni entrando por URL directa), no puede eliminar cuentas
  ni proveedores, y no puede editar un pago ya registrado.
- La Auditoría ahora registra quién hizo cada cosa de verdad (el usuario
  logueado), no un nombre fijo. También audita inicio y cierre de sesión.
- Nueva sección "Usuarios" dentro de Configuración (admin-only): agregar
  gente, cambiarle el rol, activar/desactivar.
- **Importante, dicho sin vueltas**: esto NO es seguridad real. La app
  corre entera en el navegador sin servidor detrás, así que alguien con
  las herramientas de desarrollador podría saltarse estos controles. Sirve
  para llevar un registro honesto de quién hizo qué y evitar errores por
  descuido — no para proteger datos sensibles de gente con malas
  intenciones. Eso requiere el backend real (pendiente, como charlamos).

## Pruebas automatizadas

- Se agregó Vitest + Testing Library. Correr `npm test` (una vez) o
  `npm run test:watch` (mientras se programa).
- 36 pruebas repartidas en 4 archivos, cubriendo específicamente los
  lugares donde ya hubo bugs reales:
  - `src/lib/aging.test.ts`: redondeo de saldos (el bug de "factura pagada
    que sigue apareciendo pendiente"), formato con signo, antigüedad de
    deuda, armado de recibos con montos exactos por pago.
  - `src/lib/recordatorios.test.ts`: la regla de "no contactar a alguien
    del histórico que ya no trabaja".
  - `src/data/persistence.test.ts`: reproduce el bug real de Configuración
    (datos viejos sin `recordatorios`/`empresa`) y confirma que ya no
    rompe.
  - `src/data/DataContext.test.tsx`: registrar pago (total, parcial, y
    repartido entre varias facturas), editar pago (corrección hacia
    arriba y hacia abajo), aplicar nota de crédito, y el flujo de sesión
    (login con PIN correcto/incorrecto, logout).

## Bug real encontrado de paso: ids que podían chocar

Mientras escribía las pruebas, una de ellas encontró un bug de verdad (no
del test): varias funciones generaban el id de un registro nuevo usando
solo `Date.now()`. Si dos se creaban en el mismo milisegundo — como pasa en
"Plan de pago", que genera varias facturas en un loop — podían terminar con
el mismo id y una pisar a la otra. Se corrigió en los 13 lugares que tenían
el mismo patrón, agregando un componente aleatorio al id (mismo criterio
que ya se usaba en Auditoría).

## Backend real (server/)

Se agregó un backend de verdad en la carpeta `server/`: Node + Express +
SQLite. Cubre el 100% de lo que ya hacía el frontend (autenticación con
hash real y JWT, pagos parciales, edición de pagos, notas de crédito,
facturación semanal que respeta activo/inactivo, roles admin/operador,
proveedores/bills/cuentas/gastos/reembolsos/documentos) más validaciones
del lado del servidor que antes solo vivían en el navegador.

Ya se probó de punta a punta con `curl`: login, pago parcial, corrección
de pago, exceso de aplicación rechazado, generación semanal saltando
inactivos, restricción de rol (operador no puede tocar Configuración ni
ver Auditoría completa). Ver `server/README.md` para instalarlo y correrlo.

**RingCentral ya está conectado de verdad** del lado del servidor (con el
SDK oficial), con modo simulado automático mientras no se carguen las
credenciales reales en `server/.env` — así se puede seguir probando todo
sin tener la cuenta de RingCentral lista todavía.

**Importante — lo que falta**: el frontend (`src/`) todavía sigue
guardando todo en localStorage del navegador, no en este servidor nuevo.
Conectar uno con el otro (que `DataContext.tsx` llame a esta API en vez de
usar `useState` + localStorage) es el próximo paso grande, pendiente.

## Migración completa al backend real

El frontend ya no usa localStorage para los datos del negocio — habla con
el servidor real (`server/`) a través de una API. Cambios principales:

- **`DataContext.tsx` reescrito**: de 1009 a ~480 líneas. Ya no tiene la
  lógica de negocio (eso vive en el servidor); ahora es un cliente delgado
  que pide/refleja lo que el servidor responde. Todas las funciones son
  `async`.
- **`src/data/apiClient.ts`** (nuevo): maneja el token de sesión y los
  errores de conexión de forma centralizada.
- **Pantallas de carga y error de conexión** en `App.tsx`: si el backend
  no está corriendo, se avisa claramente en vez de mostrar una pantalla
  rota.
- Se sacaron `persistence.ts` y el viejo stub de RingCentral del
  frontend (`src/integrations/`) — ya no hacen falta, esa lógica vive del
  lado del servidor.
- **Bug de fechas corregido de paso**: varias partes (`Dashboard.tsx`,
  `Expenses.tsx`, `Reports.tsx`, y las funciones de `lib/aging.ts`)
  todavía usaban una fecha fija de los datos de ejemplo ("2026-09-14")
  como si fuera "hoy". Ahora que es un sistema real y en vivo, eso ya
  usa la fecha real del día — si no, los días de atraso se hubieran
  quedado congelados para siempre en esa fecha.

## Pruebas automatizadas: ahora en los dos lados

- **Servidor** (`server/test/api.test.js`, con `node:test` — sin
  dependencias extra): 9 pruebas cubriendo pago parcial, rechazo de
  aplicar de más, edición de pago (hacia arriba y abajo), notas de
  crédito, generación semanal respetando bajas, y restricción de rol.
  Corren contra una base de datos en memoria (`DB_PATH=:memory:`), nunca
  tocan la base de datos real. `cd server && npm test`.
- **Frontend** (20 pruebas): las de lógica de negocio que vivían acá se
  sacaron (esa lógica ya no existe en el frontend); quedan las de
  funciones puras (`lib/aging.ts`, `lib/recordatorios.ts`), que siguen
  siendo válidas y ahora corren con fechas explícitas (no dependen del
  reloj real de la máquina). `npm test`.

## Cómo correr todo junto

```bash
# Terminal 1
cd server
npm install
npm run seed   # una sola vez
npm run dev

# Terminal 2
npm install
npm run dev
```

Entrar con Luis (admin, PIN 1234) o Ana (operador, PIN 5678).

## Base de datos migrada a Postgres (lista para Supabase)

El servidor ya no usa SQLite — usa Postgres de verdad, compatible directo
con Supabase (que es Postgres alojado + extras). Ver `server/SUPABASE.md`
para el paso a paso de cómo crear tu proyecto y conectarlo.

**Decisión de arquitectura, explicada:** Supabase se está usando
únicamente como base de datos alojada — no se usa Supabase Auth, ni Row
Level Security, ni Storage. El servidor Express (con toda su lógica de
negocio ya escrita y probada) sigue siendo el que habla con la base de
datos, ahora vía una conexión Postgres normal en vez de un archivo SQLite
local. Fue la opción más segura dado el tiempo disponible: reescribir
toda esa lógica como funciones de Postgres para aprovechar Supabase al
100% hubiera sido un trabajo mucho más grande, con más superficie para
introducir bugs nuevos, para el mismo resultado práctico que pediste (que
la base de datos viva en un servicio alojado, no en tu disco).

**Por ahora, el servidor Express sigue corriendo en tu computadora** — tal
como elegiste. El día que quieras el sitio completo accesible desde
cualquier lado, ese es el próximo paso (subir el servidor a Railway,
Render o Fly.io, y el frontend a Vercel o Netlify).

### Bugs reales encontrados durante la migración (y corregidos)

1. Al convertir todas las rutas de llamadas síncronas (`better-sqlite3`) a
   asíncronas (`pg`), un error sin capturar en un handler async dejaba la
   respuesta colgada para siempre en vez de devolver un error — Express 4
   no atrapa esto solo. Se agregó `express-async-errors` para que
   cualquier error se convierta en una respuesta 500 prolija.
2. El middleware de sesión (`src/auth.js`) se me había pasado en la
   conversión: seguía llamando a la base sin `await`, así que en cada
   pedido `req.usuario` quedaba como una Promesa sin resolver en vez del
   usuario real. Esto rompía todo el sistema de permisos silenciosamente
   — se encontró recién al correr las pruebas automatizadas contra
   Postgres real, no se hubiera notado revisando el código a simple
   vista. Ya corregido.
3. `COUNT(*)` en Postgres devuelve `bigint`, que la librería `pg` entrega
   como texto (no número) para no perder precisión en números muy
   grandes. Sumar dos de esos sin convertir con `Number(...)` concatena
   en vez de sumar. Corregido en los tres lugares que lo hacían.

Las 9 pruebas automatizadas del servidor corren ahora contra Postgres real
(antes contra SQLite en memoria), y las corrí a mano varias veces contra
una base de datos Postgres real en este entorno antes de darlo por
terminado — no fue un cambio hecho "a ciegas".

## Identidad de marca aplicada: tax.invoice

Se leyó el manual de marca (`manual_taxinvoice.pdf`) y se aplicó a toda
la app:

- **Nombre real**: "tax.invoice" — ya viene precargado en el seed del
  servidor (Configuración -> Datos de la empresa), y aparece en el
  logotipo del menú lateral, la pantalla de login, y el encabezado de las
  facturas impresas (en su variante monocroma, tal como pide el manual
  para "documentos fiscales").
- **Tipografía**: se reemplazó Space Grotesk + JetBrains Mono por
  **Inter** en toda la app (un solo tipo de letra, como indica el
  manual), con cifras tabulares para que los importes de los reportes
  alineen en columna.
- **Logotipo** (`src/components/Wordmark.tsx`): respeta las reglas
  exactas del manual — "tax" en SemiBold 600, el punto en Regular 400 y
  color de acento, "invoice" en Light 300, siempre en minúsculas,
  tracking fijo en -0.035em. Tiene una variante monocroma para los
  documentos fiscales (facturas, recibos), tal como especifica el
  manual.
- **Paleta de colores**: se reemplazó el azul anterior por el violeta de
  acento del manual (#9184d9), y los neutros de fondo/texto/bordes por
  los tonos "Ledger/Superficie/Papel/Claro" del manual, en modo claro y
  oscuro. El rojo (vencido) y el verde (pagado) se dejaron como estaban
  a propósito — son señales funcionales del sistema, no parte de la
  identidad de marca, y el manual no las menciona.

## Registrar pago, código de cliente editable, importar CSV, filtros rápidos, PDF real

- **Registrar pago**: ahora se puede abrir sin tener un cliente ya elegido
  (botón nuevo en Cobros -> Pagos) — aparece el mismo combobox buscable
  que ya usaban Crear factura y Nota de crédito.
- **Código de cliente**: ya no se auto-genera. Es un campo de texto libre
  tanto al crear como al editar, para cargar el mismo código que ya usan
  en TaxiCaller/QuickBooks.
- **Importar clientes desde CSV**: nuevo botón en Clientes. Baja una
  plantilla, la completás (mezclando lo exportado de QuickBooks con tus
  columnas propias de código y cuota semanal), la subís, revisás la vista
  previa fila por fila, e importa solo las válidas.
- **Filtros rápidos de fecha**: Hoy / Ayer / Esta semana / Este mes en
  Cobros -> Facturas, al lado del rango de fechas que ya existía.
- **PDF real de factura**: se genera en el servidor (`pdfkit`), con el
  logotipo de la marca. Botón "Descargar PDF" (queda guardado en tu
  computadora) y "Enviar por mail" (usa `nodemailer` — simulado hasta que
  cargues SMTP_HOST/SMTP_USER/SMTP_PASS en `server/.env`, mismo patrón que
  RingCentral). Probado de punta a punta contra Postgres real.

## Importador de clientes: probado contra tu archivo real de QuickBooks

Se rediseñó completamente el importador después de revisar el archivo real
que pasaste (`Customers.csv`):

- **Detecta solo si es un export de QuickBooks** o nuestra plantilla propia,
  mirando los encabezados de las columnas.
- **Extrae el código de TaxiCaller** cuando ya viene embebido en el campo
  "Name" (ej. "D0108 100829 Jose Luis...") y lo separa en código, número y
  nombre.
- **Detecta y desmarca por defecto** las filas que en realidad son formas
  de pago de QuickBooks, no clientes reales (Cash, Zelle Transfer, Cash
  App, etc.) — quedan visibles y tildables por si alguna es un caso real.
- **El "Open balance" de QuickBooks se migra como una factura de apertura**
  ("Saldo inicial — migración desde QuickBooks"), para que la cuenta
  corriente arranque reflejando la deuda real desde el día uno.
- **Import masivo real** (`POST /api/clientes/importar-lote`): todo en una
  sola transacción del lado del servidor, en vez de miles de pedidos uno
  por uno. Probado con tu archivo completo (3328 filas): importó 3323
  clientes válidos (5 formas de pago quedaron afuera) con 665 facturas de
  apertura, en menos de 1 segundo.

**Nota de seguridad**: se evaluó usar la librería `xlsx` (SheetJS) para
poder leer el formato Excel binario que a veces exporta QuickBooks bajo
la extensión ".csv", pero tiene dos vulnerabilidades conocidas sin parche
en su versión de npm — se descartó. El importador pide re-guardar como
CSV real desde Excel si hace falta (paso de 30 segundos), y así se pudo
seguir usando `papaparse`, que no tiene vulnerabilidades reportadas.

## Importador: ahora lee Excel/XLS directo (decisión tuya, con riesgo aceptado)

Se volvió a instalar `xlsx` (SheetJS) y el importador de clientes ya lee
CSV, XLS y XLSX tal cual los exporta QuickBooks, sin necesidad de
convertir nada a mano. **Nota de seguridad, para que quede documentado**:
esta librería tiene dos vulnerabilidades conocidas y sin parche en su
versión de npm (prototype pollution y ReDoS) — se decidió usarla igual,
a pedido explícito, dado que es una herramienta interna donde el único
que sube archivos es el propio dueño de la app, con sus propios datos
(no hay terceros no confiables involucrados). Si esta app se expusiera
públicamente algún día, esta decisión habría que revisarla.

## Botón de borrado total (para migraciones limpias)

Nueva sección "Zona de peligro" en Configuración (solo admin): borra
clientes, facturas, pagos, notas de crédito, reembolsos, gastos, cuentas,
transferencias, proveedores, bills, documentos y el historial de
auditoría — pensado para limpiar datos de prueba antes de la migración
final desde QuickBooks. Requiere escribir "BORRAR TODO" para habilitar el
botón, más una confirmación del navegador. No borra usuarios ni la
configuración de la empresa. Probado de punta a punta: rechaza sin la
confirmación exacta, rechaza a un operador (403), y borra todo
correctamente cuando un admin confirma bien.

## Rediseño visual (en curso): paleta verde bosque + crema

Se está aplicando un rediseño puramente estético, siguiendo el archivo de
diseño que trajo el usuario (`design-reference/tax.invoice.dc.html` —
queda guardado ahí de referencia para las próximas pantallas). Nada de
esto tocó estructura de datos ni moneda, solo estilos.

**Ya migrado en esta vuelta:**
- `src/index.css`: nueva paleta (verde bosque #10402F de acento, fondo
  crema #F4F4F0, superficies blancas) y nueva tipografía — Instrument
  Sans para texto de interfaz, IBM Plex Mono para números/códigos/labels
  en mayúscula (reemplaza a Inter). Radios de borde ajustados a los de
  la referencia (6px tarjetas, 5px botones/inputs, 4px chips).
- Logotipo (`Wordmark.tsx`): ahora en IBM Plex Mono, "invoice" en peso
  Regular en vez de Light — actualiza lo que se había definido en el
  manual de marca original (Inter). Es una decisión consciente: el
  usuario trajo una referencia de diseño más nueva y pidió seguirla.
- `Sidebar.tsx`: reescrito para quedar SIEMPRE verde oscuro (no cambia
  con el modo claro/oscuro, es parte fija de la marca, tal como en la
  referencia) con la información del usuario logueado abajo.
- `Layout.tsx` / `GlobalSearch.tsx`: header y buscador restyleados.
- `Dashboard.tsx`: reconstruido completo con el lenguaje visual nuevo
  (tarjetas KPI, gráficos, panel de "Requiere atención") — mismos datos
  y métricas de siempre, solo cambió la presentación.
- Colores de los gráficos (`chartColors.ts`) actualizados a la nueva
  paleta.

Se verificó visualmente con capturas reales (claro y oscuro) antes de
darlo por terminado — quedaron guardadas en `design-reference/` también,
para comparar cuando seguamos con el resto de las pantallas.

**Todavía falta** (mismo criterio, pantalla por pantalla): Clientes,
ficha de cliente, Cobros (las 4 pestañas: facturas, pagos, notas de
crédito, reembolsos), Proveedores, Cuentas, Gastos, Reportes, Auditoría,
Configuración, y todos los modales (formularios, factura imprimible,
recibo de pago).

## Rediseño visual: completo

Se terminó de aplicar el rediseño a toda la app (antes había quedado solo
el Dashboard). Alcance final:

- **Las 9 pantallas completas**: Dashboard, Clientes, Ficha de cliente,
  Cobros (4 pestañas), Proveedores, Cuentas, Gastos, Reportes (5
  pestañas), Auditoría, Configuración.
- **Los ~15 modales** (formularios de pago, factura, cliente, proveedor,
  bill, importador, etc.): se corrigieron de forma consistente en un
  barrido — radios de borde, foco en verde de marca en vez de negro, y
  un bug real que se encontró en el camino (ver abajo).
- **El PDF de factura** (generado en el servidor): el punto del logotipo
  pasó del violeta viejo al verde de marca, para que coincida con la
  pantalla.

**Bug real encontrado y corregido**: el fondo semitransparente detrás de
todos los modales usaba `bg-ink/30` — pero "ink" se invierte en modo
oscuro (pasa a ser un color claro), así que en modo oscuro el fondo
quedaba casi invisible en vez de oscurecer la pantalla. Se cambió a
`bg-black/30` en los 14 archivos que lo tenían. Se verificó con capturas
reales en modo oscuro que quedó bien.

Todo se verificó con capturas de pantalla reales (Playwright + Chromium),
en modo claro y oscuro, antes de darlo por terminado — quedaron guardadas
en `design-reference/` junto con el archivo de diseño original.

## Importador de historial (facturas y pagos) desde QuickBooks

Nuevo: botón "Importar historial" en Cobros → Facturas. Lee el reporte
**"Transaction List by Customer"** de QuickBooks (CSV, XLS o XLSX) y
reconstruye facturas + pagos históricos.

**El problema real que resuelve**: ese reporte de QuickBooks no dice
explícitamente qué pago corresponde a qué factura — es un librito
cronológico por cliente. Se reconstruye con la regla contable estándar:
cada pago se aplica primero a la factura más vieja sin cobrar (FIFO), en
el mismo orden en que aparecen los movimientos. Probado con el archivo
real completo del usuario (Sept 2026): **480 clientes, 1879 facturas y
1801 pagos importados, 0 sin coincidencia**, en poco más de 2 segundos.
Se verificó a mano un caso con pago parcial entre semanas — el FIFO
arrastra correctamente el saldo pendiente de una factura a la siguiente,
partiendo un mismo pago entre dos facturas distintas cuando corresponde.

Decisiones tomadas con el usuario:
- Método de pago inferido de la cuenta destino: "Bank of America" →
  Zelle, "Undeposited Funds" → Kotapay (aproximación, corregible a mano).
- Las notas de crédito del reporte NO se importan en esta pasada (fue
  decisión explícita del usuario) — solo facturas y pagos. Si un pago
  sobra después de cubrir todo lo abierto, se genera una nota de crédito
  nueva por el excedente (mismo criterio que ya usa el resto de la app).
- Filas que no son Invoice/Payment/Credit Memo (Deposit, Expense) se
  ignoran y se cuentan aparte — no corresponden a este flujo.

**Bug real encontrado y corregido en el camino**: `xlsx` (SheetJS)
reinterpreta fechas de texto como números de serie de Excel al leer CSV,
salvo que se le pase `raw: false` — sin eso, todas las fechas se leían
mal (y hasta un texto como "September 1-22, 2026" se convertía en una
fecha random). Ya corregido y con una prueba automatizada dedicada
(`server/test/api.test.js`) que protege esta lógica de reconciliación
contra regresiones futuras.

## Importador de clientes: ex-drivers y sin código marcados como inactivos

Dos reglas nuevas en el importador de Clientes:

1. **Ex-drivers**: se detectó que QuickBooks marca a los ex-drivers con el
   nombre empezando en "EX" (dos formas reales encontradas: `EX D0412
   101269 Nathaly...` con el código D de siempre, y `EX 272 100410
   Alexander...` con el número pelado, sin la D). Se probó contra los
   1099 casos reales del archivo del usuario y matchea el 100%. Se
   importan igual que cualquier cliente, pero con `estado: inactivo` —
   quedan dados de baja hasta que alguien los reactive a mano desde la
   ficha del cliente.
2. **Sin código**: cualquier fila donde no se pudo extraer un código (ni
   con el patrón normal ni con el de ex-driver) también se importa como
   `inactivo`.

La vista previa del importador ahora tiene una columna "Estado" para
revisar esto antes de confirmar, y el resumen de arriba muestra cuántas
activas/inactivas hay entre las seleccionadas.

Probado con el archivo real completo: de 3343 filas, 1733 quedaron
activas (código D normal) y 1610 inactivas (1099 ex-drivers + 511 sin
código tras descartar formas de pago) — verificado contra la base de
datos real tras importar, incluyendo un caso puntual (ex-driver D0272)
con el nombre limpio y el código bien extraído.

## Catálogo de fees + fees "tildados" por cliente

Nuevo sistema completo para los fees administrativos (1060NL, 1060RI,
etc.) y para que la cuota semanal se llame "1090PB Semana N":

- **Catálogo configurable** (Configuración → Catálogo de fees, admin):
  código + etiqueta + monto por defecto, editable inline.
- **"Crear factura"**: si hay ítems cargados, aparece un desplegable con
  el catálogo (autocompleta motivo y monto, editable) + un "Otro" al
  final para cargar a mano cuando no está en la lista.
- **Fees tildados por cliente**: en la ficha de cada cliente, checkboxes
  con todos los ítems del catálogo — al tildar uno, queda "pendiente de
  facturar". La próxima vez que corrés "Generar facturas de la semana",
  cada fee tildado se factura junto con la cuota semanal de ese cliente,
  y se destilda solo (no se vuelve a facturar la semana siguiente a
  menos que lo tildes de nuevo).
- **1090PB**: la cuota semanal automática ahora se genera como
  "1090PB Semana N" (antes "Cuota semana N"), con el código guardado
  aparte en la factura para poder filtrar de forma confiable.

Probado de punta a punta contra el servidor real (crear ítem, tildar en
un cliente, generar la corrida semanal, confirmar que se facturó y se
destildó solo) + prueba automatizada dedicada.

**Importante — todavía sin resolver**: los 5 códigos que mencionaste
(1060NL, 1060DM, 1060RI, 1060RP, 1060RA) y el borrado automático de los
martes de facturas impagas de cuota semanal NO se automatizaron todavía
más allá de este sistema de tildado manual — quedan pendientes de
definir bien las condiciones (¿qué son NL/DM/RP? ¿la lógica de RA está
invertida?) y las reglas del borrado (pagos parciales, borrado real vs
anulación, confiabilidad del cron) antes de tocar más código ahí.

## Fees automáticos, catálogo completo, y facturas editables

Bloque grande de cambios sobre el sistema de fees:

- **Los fees tildados ya no se auto-destildan** — quedan marcados hasta
  que alguien los saca a mano en la ficha del cliente. Si se dejan
  tildados, la corrida semanal siguiente los vuelve a facturar (a
  propósito, así lo pidió el usuario).
- **Reactivación/Reinscripción automática**: al reactivar un cliente
  (pasar de inactivo a activo), el sistema calcula automáticamente si
  pasaron más o menos de 28 días desde su última factura — contados
  hasta las 5 PM hora Atlanta de verdad (conversión de zona horaria
  real, no la hora del servidor) — y factura solo $10 (1060RA
  Reactivación) o $20 (1060RI Reinscripción) según corresponda.
- **Precio de la cuota semanal (1090PB) según el día**: configurable en
  Configuración (Lunes a Viernes). Solo afecta a los clientes en la
  cuota estándar; el que tiene un valor propio distinto mantiene el suyo
  sin importar el día.
- **Catálogo completo cargado**: los 26 conceptos de penalidades que
  pasó el usuario, con sus valores fijos ya seteados, y los dos de rango
  de precio (1060RC, 1060MUA) marcados para cargar a mano — se
  auto-completa solo la primera vez que se abre Configuración →
  Catálogo de fees.
- **Facturas y notas de crédito editables** (solo admin): motivo, monto
  y vencimiento, con recálculo automático del estado si cambia el
  monto.
- **Se guarda qué usuario creó cada factura**, en los seis lugares donde
  se generan (manual, semanal, fees tildados, reactivación automática,
  importación de historial, saldo inicial de migración) — visible en
  cada factura, aparte del registro de auditoría.

**Bug real encontrado durante las pruebas (y corregido)**: la función que
calcula el plazo de 28 días no validaba el formato de la fecha de
entrada — si alguna vez llegara una fecha con un formato inesperado,
antes podía fallar en silencio y terminar cobrando la opción más barata
por error. Ahora corta con un error claro en vez de arriesgar el cálculo.
También se encontró que la tabla del catálogo de fees no se limpiaba
entre corridas de las pruebas automatizadas, lo que generaba códigos
duplicados y resultados falsos — ya corregido.

Todo probado de punta a punta contra el servidor real (reactivación
dentro y fuera de plazo, precio por día, persistencia de fees tildados,
edición de facturas/notas con restricción de rol) más 4 pruebas
automatizadas nuevas — 14 en total en el servidor, todas verdes.

## Pagos ingresados por mail (Outlook)
Pestaña **Cobros → Pagos ingresados por mail** (solo admin): lee las notificaciones de Zelle del buzón de Outlook, las lista con remitente, descripción y monto, y permite asignarlas a una unidad activa (desplegable con búsqueda). Configuración en `server/OUTLOOK.md`.
