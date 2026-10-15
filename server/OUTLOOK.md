# Pagos ingresados por mail (Outlook / Microsoft 365)

La pestaña **Cobros → Pagos ingresados por mail** lee las notificaciones de Zelle
(Bank of America) del buzón de la empresa y te deja asignar cada una a una unidad.
Solo la ve y usa un administrador.

## 1. Registrar la app en Microsoft Entra ID (una sola vez)

1. Entrá a https://entra.microsoft.com con una cuenta administradora del Microsoft 365.
2. **Identidad → Aplicaciones → Registros de aplicaciones → Nuevo registro**. Nombre: `tax.invoice`. Tipo: solo este directorio.
3. En la página de la app copiá **ID de aplicación (cliente)** → `MS_CLIENT_ID` y **ID de directorio (inquilino)** → `MS_TENANT_ID`.
4. **Certificados y secretos → Nuevo secreto de cliente**. Copiá el **Valor** (solo se ve una vez) → `MS_CLIENT_SECRET`.
5. **Permisos de API → Agregar un permiso → Microsoft Graph → Permisos de aplicación → `Mail.Read`**, y después **Conceder consentimiento de administrador**.
6. (Recomendado) Limitá la app a ese único buzón con una *Application Access Policy* de Exchange.

## 2. Completar `server/.env`

```
MS_TENANT_ID=...
MS_CLIENT_ID=...
MS_CLIENT_SECRET=...
MS_MAILBOX=pagos@tudominio.com
MS_CARPETA=Inbox
```

Reiniciá el servidor.

## 2b. Si el correo es un grupo de Microsoft 365 (ej. "Pagos", visibilidad Pública)

Un grupo no es un usuario: hay que darle a la app **otro permiso**. En Permisos de API agregá **Microsoft Graph → Permisos de aplicación → `Group.Read.All`** y volvé a **Conceder consentimiento de administrador**. Después, en `server/.env`, `MS_MAILBOX` es la dirección del grupo (ej. `pagos@taxilaserllc.com`). La app detecta sola que es un grupo; si querés forzarlo, agregá `MS_TIPO=grupo`. En grupos se leen los últimos 50 hilos de conversación.

## 3. (Opcional) Carpeta propia para los Zelle

En Outlook creá una regla que mueva los mails de Bank of America a una carpeta (ej. `Zelle`) y poné ese nombre en `MS_CARPETA`. La app lee los últimos 50 mails de la carpeta.

## 4. Uso

1. **Cobros → Pagos ingresados por mail → Actualizar bandeja**. Trae los pagos nuevos (no duplica los ya cargados).
2. Cada fila muestra remitente, descripción y monto. Si la descripción trae un código tipo `D135`, se sugiere esa unidad.
3. Elegí la unidad activa en el desplegable (se filtra al escribir) y apretá **Aplicar**: se registra el pago por Zelle, se cubren sus facturas más viejas y el excedente queda como nota de crédito.
4. **Descartar** marca el mail como no relevante.

## 5. Enviar facturas pagas por mail (Microsoft Graph)

Usa la misma app. Pasos:
1. En Entra ID, app `tax.invoice` → Permisos de API → Microsoft Graph → **Permisos de aplicación → `Mail.Send`** → Conceder consentimiento de administrador.
2. En tax.invoice, **Configuración → Mail de facturas pagas** → método "Microsoft 365 (Graph)" y completar **Buzón desde el que se envía** (un usuario o buzón compartido real, p. ej. `facturas@taxilaserllc.com`).
3. (Opcional) **Mostrar como** `pagos@taxilaserllc.com`: como `Pagos` es un grupo, el buzón que envía necesita permiso **"Enviar como"** sobre ese grupo. Si no, dejalo vacío y poné `pagos@…` en **Responder a**: las respuestas llegan igual al grupo.
4. Probá con **Guardar y enviar prueba** y activá el switch.

Seguridad: con `Mail.Send` de aplicación la app podría enviar como cualquier buzón de la organización. Se recomienda limitarla a un solo buzón con una *Application Access Policy* de Exchange.
