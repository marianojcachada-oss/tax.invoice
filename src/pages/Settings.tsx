import { ImportTransactionHistoryModal } from '../components/ImportTransactionHistoryModal';
import { useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { api } from '../data/apiClient';
import type { MetodoPago } from '../types';

const DIAS: { valor: ConfigDia; etiqueta: string }[] = [
  { valor: 'lun', etiqueta: 'Lun' },
  { valor: 'mar', etiqueta: 'Mar' },
  { valor: 'mie', etiqueta: 'Mié' },
  { valor: 'jue', etiqueta: 'Jue' },
  { valor: 'vie', etiqueta: 'Vie' },
  { valor: 'sab', etiqueta: 'Sáb' },
  { valor: 'dom', etiqueta: 'Dom' },
];
type ConfigDia = 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom';

const METODOS_LABEL: Record<MetodoPago, string> = {
  zelle: 'Zelle — requiere N° de referencia',
  efectivo: 'Efectivo en oficina — recibo obligatorio',
  kotapay: 'Kotapay (tarjeta) — conciliación diaria',
  ach: 'ACH — transferencia bancaria',
  tarjeta: 'Tarjeta de crédito/débito',
  stripe: 'Stripe — cobro online',
};

const inputCls = 'w-full border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent';
const fieldLabelCls = 'text-ink-faint text-[10.5px] uppercase tracking-wide font-medium mb-1';

export function Settings() {
  const [importarHistorialAbierto, setImportarHistorialAbierto] = useState(false);
  const { configuracion, actualizarConfiguracion, usuarioActual, usuarios, agregarUsuario, actualizarUsuario, borrarTodo } = useDataStore();
  const [cuota, setCuota] = useState(configuracion.cuotaSemanalPorDefecto);
  const [dia, setDia] = useState<ConfigDia>(configuracion.diaEmision);
  const [precioPorDia, setPrecioPorDia] = useState(configuracion.precioPorDia);
  const [recordActivo, setRecordActivo] = useState(configuracion.recordatorios.activo);
  const [semanasActividad, setSemanasActividad] = useState(configuracion.recordatorios.semanasActividadReciente);
  const [soloVencido, setSoloVencido] = useState(configuracion.recordatorios.soloConSaldoVencido);
  const [plantilla, setPlantilla] = useState(configuracion.recordatorios.plantillaMensaje);
  const [rcClientId, setRcClientId] = useState(configuracion.recordatorios.ringcentral.clientId ?? '');
  const [rcClientSecret, setRcClientSecret] = useState(configuracion.recordatorios.ringcentral.clientSecret ?? '');
  const [rcNumero, setRcNumero] = useState(configuracion.recordatorios.ringcentral.numeroDesde ?? '');
  const [empresaNombre, setEmpresaNombre] = useState(configuracion.empresa.nombre ?? '');
  const [empresaDireccion, setEmpresaDireccion] = useState(configuracion.empresa.direccion ?? '');
  const [empresaEmail, setEmpresaEmail] = useState(configuracion.empresa.email ?? '');
  const [mail, setMail] = useState(configuracion.mail);
  const [mailPara, setMailPara] = useState('');
  const [mailPrueba, setMailPrueba] = useState<{ ok: boolean; texto: string } | null>(null);
  const [probandoMail, setProbandoMail] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoRol, setNuevoRol] = useState<'admin' | 'operador'>('operador');
  const [nuevoPin, setNuevoPin] = useState('');
  const [textoConfirmacion, setTextoConfirmacion] = useState('');
  const [borrando, setBorrando] = useState(false);
  const [errorBorrado, setErrorBorrado] = useState<string | null>(null);
  const [borradoOk, setBorradoOk] = useState(false);

  if (usuarioActual?.rol !== 'admin') {
    return (
      <div className="px-6 md:px-8 py-6">
        <div className="font-semibold text-lg mb-1">No tenés permiso para ver esta pantalla</div>
        <p className="text-ink-soft text-sm">Configuración es solo para usuarios con rol de administrador.</p>
      </div>
    );
  }

  function handleAgregarUsuario() {
    if (!nuevoNombre.trim() || nuevoPin.length !== 4) return;
    agregarUsuario({ nombre: nuevoNombre.trim(), rol: nuevoRol, pin: nuevoPin, activo: true });
    setNuevoNombre('');
    setNuevoPin('');
    setNuevoRol('operador');
  }

  async function handleBorrarTodo() {
    if (textoConfirmacion !== 'BORRAR TODO') return;
    if (!window.confirm('Última confirmación: esto borra clientes, facturas, pagos, notas de crédito, gastos, cuentas, proveedores y todo lo demás. No se puede deshacer. ¿Seguro?')) {
      return;
    }
    setBorrando(true);
    setErrorBorrado(null);
    try {
      await borrarTodo(textoConfirmacion);
      setBorradoOk(true);
      setTextoConfirmacion('');
    } catch {
      setErrorBorrado('No se pudo borrar. Intentá de nuevo.');
    } finally {
      setBorrando(false);
    }
  }

  async function handleProbarMail(conFactura = false) {
    setProbandoMail(true);
    setMailPrueba(null);
    try {
      // se guarda primero para que la prueba use los datos que están en pantalla
      await actualizarConfiguracion({ ...configuracion, mail });
      await api.post('/configuracion/mail-prueba', { para: mailPara, conFactura });
      setMailPrueba({ ok: true, texto: `${conFactura ? 'Factura de ejemplo' : 'Mail de prueba'} enviado a ${mailPara}.` });
    } catch (e) {
      setMailPrueba({ ok: false, texto: (e as Error).message });
    } finally {
      setProbandoMail(false);
    }
  }

  function handleGuardar() {
    actualizarConfiguracion({
      ...configuracion,
      cuotaSemanalPorDefecto: cuota,
      diaEmision: dia,
      precioPorDia,
      recordatorios: {
        activo: recordActivo,
        semanasActividadReciente: semanasActividad,
        soloConSaldoVencido: soloVencido,
        plantillaMensaje: plantilla,
        ringcentral: { clientId: rcClientId || undefined, clientSecret: rcClientSecret || undefined, numeroDesde: rcNumero || undefined },
      },
      mail,
      empresa: {
        nombre: empresaNombre || undefined,
        direccion: empresaDireccion || undefined,
        email: empresaEmail || undefined,
      },
    });
    setGuardado(true);
    setTimeout(() => setGuardado(false), 1500);
  }

  return (
    <div className="px-6 md:px-8 py-6 max-w-[900px] flex flex-col gap-4">
      <div className="font-semibold text-xl">Configuración</div>

      <div className="panel p-5">
        <div className="th-label mb-1.5">Cuota semanal por defecto</div>
        <div className="flex gap-2.5 items-center">
          <input
            type="number"
            value={cuota}
            onChange={(e) => setCuota(Number(e.target.value))}
            className="border border-line rounded-[5px] bg-surface px-3 py-1.5 text-base w-32 num focus:outline-none focus:border-accent"
          />
          <span className="text-ink-faint text-[11.5px]">se puede sobreescribir por conductor</span>
        </div>
      </div>

      <div className="panel p-5">
        <div className="th-label mb-1.5">Día de emisión y vencimiento</div>
        <div className="flex gap-1.5">
          {DIAS.map((d) => (
            <button key={d.valor} onClick={() => setDia(d.valor)} aria-pressed={dia === d.valor} className={dia === d.valor ? 'chip-accent' : 'chip'}>
              {d.etiqueta}
            </button>
          ))}
        </div>
        <div className="text-ink-faint text-[11px] mt-2">
          emite {DIAS.find((d) => d.valor === dia)?.etiqueta.toLowerCase()} 6:00 · vence el mismo
          día 23:59 · pasado ese día, el saldo queda directamente vencido (sin tramos intermedios)
        </div>
      </div>

      <div className="panel p-5">
        <div className="th-label mb-1.5">Precio de la cuota semanal (1090PB) según el día</div>
        <div className="text-ink-faint text-[11px] mb-3">
          Normativa: $145 los lunes, con descuento si se corre la generación después. Si un día
          se deja vacío, se usa la cuota por defecto (${cuota}). Solo afecta a los clientes que
          están en la cuota estándar — el que tenga un valor propio distinto mantiene el suyo,
          sin importar el día.
        </div>
        <div className="grid grid-cols-5 gap-2.5">
          {(
            [
              ['lunes', 'Lunes'],
              ['martes', 'Martes'],
              ['miercoles', 'Miércoles'],
              ['jueves', 'Jueves'],
              ['viernes', 'Viernes'],
            ] as [keyof typeof precioPorDia, string][]
          ).map(([clave, etiqueta]) => (
            <div key={clave}>
              <div className={fieldLabelCls}>{etiqueta}</div>
              <input
                type="number"
                value={precioPorDia[clave] ?? ''}
                placeholder={String(cuota)}
                onChange={(e) =>
                  setPrecioPorDia((prev) => ({ ...prev, [clave]: e.target.value === '' ? undefined : Number(e.target.value) }))
                }
                className={`${inputCls} num`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="panel p-5">
        <div className="th-label mb-1.5">Métodos de pago habilitados</div>
        <div className="grid gap-1.5 mt-1">
          {configuracion.metodosHabilitados.map((m) => (
            <span key={m} className="chip-success w-fit">✓ {METODOS_LABEL[m]}</span>
          ))}
        </div>
      </div>

      <div className="panel p-5">
        <div className="th-label mb-1.5">Datos de la empresa</div>
        <div className="text-ink-faint text-[11px] mb-3">
          Se usan para autocompletar el encabezado de cada factura (nombre, dirección y correo).
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className={fieldLabelCls}>Nombre del negocio (opcional)</div>
            <input value={empresaNombre} onChange={(e) => setEmpresaNombre(e.target.value)} placeholder="Sin nombre todavía" className={inputCls} />
          </div>
          <div>
            <div className={fieldLabelCls}>Email</div>
            <input value={empresaEmail} onChange={(e) => setEmpresaEmail(e.target.value)} placeholder="contacto@tunegocio.com" className={inputCls} />
          </div>
        </div>
        <div>
          <div className={fieldLabelCls}>Dirección</div>
          <input value={empresaDireccion} onChange={(e) => setEmpresaDireccion(e.target.value)} placeholder="Calle, ciudad, estado, ZIP" className={inputCls} />
        </div>
      </div>

      <div className="panel p-5">
        <div className="flex items-center justify-between mb-1.5">
          <div className="th-label">Mail de facturas pagas</div>
          <button
            role="switch"
            aria-checked={mail.envioAutomatico}
            onClick={() => setMail({ ...mail, envioAutomatico: !mail.envioAutomatico })}
            className={`relative w-11 h-6 rounded-full transition-colors ${mail.envioAutomatico ? 'bg-accent' : 'bg-line'}`}
            title={mail.envioAutomatico ? 'Envío automático activado' : 'Envío automático desactivado'}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${mail.envioAutomatico ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        <div className="text-ink-faint text-[11px] mb-3">
          {mail.envioAutomatico ? 'Activado: ' : 'Desactivado: '}
          cuando una factura queda totalmente paga se le manda el PDF a la unidad (si tiene email cargado). Se manda una sola vez por factura y
          no se manda al importar historial.
        </div>

        <div className="th-label mb-1.5">Cómo se envía</div>
        <div className="flex gap-2 mb-3">
          <button onClick={() => setMail({ ...mail, metodo: 'graph' })} className={mail.metodo === 'graph' ? 'chip-accent' : 'chip'}>Microsoft 365 (Graph) — recomendado</button>
          <button onClick={() => setMail({ ...mail, metodo: 'smtp' })} className={mail.metodo === 'smtp' ? 'chip-accent' : 'chip'}>SMTP</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          {mail.metodo === 'graph' && (
            <div className="col-span-2">
              <div className={fieldLabelCls}>Buzón desde el que se envía</div>
              <input value={mail.buzonEnvio} onChange={(e) => setMail({ ...mail, buzonEnvio: e.target.value })} placeholder="facturas@taxilaserllc.com" className={inputCls} />
              <div className="text-ink-faint text-[11px] mt-1">
                Tiene que ser un buzón real (usuario o buzón compartido), no un grupo. Usa las mismas credenciales de Microsoft del archivo <span className="font-mono">server/.env</span> y
                necesita el permiso <span className="font-mono">Mail.Send</span> en la app.
              </div>
            </div>
          )}
          <div>
            <div className={fieldLabelCls}>Nombre que ve el cliente</div>
            <input value={mail.remitenteNombre} onChange={(e) => setMail({ ...mail, remitenteNombre: e.target.value })} placeholder="Taxi Laser LLC" className={inputCls} />
          </div>
          <div>
            <div className={fieldLabelCls}>{mail.metodo === 'graph' ? 'Mostrar como (dirección visible)' : 'Mail que envía'}</div>
            <input value={mail.remitenteDireccion} onChange={(e) => setMail({ ...mail, remitenteDireccion: e.target.value })} placeholder="pagos@taxilaserllc.com" className={inputCls} />
            {mail.metodo === 'graph' && (
              <div className="text-ink-faint text-[11px] mt-1">Si es distinta al buzón, ese buzón necesita permiso "Enviar como" sobre ella. Si la dejás vacía se muestra el buzón.</div>
            )}
          </div>
          <div>
            <div className={fieldLabelCls}>Responder a (opcional)</div>
            <input value={mail.responderA} onChange={(e) => setMail({ ...mail, responderA: e.target.value })} placeholder="pagos@taxilaserllc.com" className={inputCls} />
          </div>
        </div>

        {mail.metodo === 'smtp' && (
          <>
        <div className="th-label mb-1.5 mt-4">Servidor de correo (SMTP)</div>
        <div className="text-ink-faint text-[11px] mb-2">
          Microsoft 365: servidor <span className="font-mono">smtp.office365.com</span>, puerto <span className="font-mono">587</span>, usuario y contraseña de la cuenta que envía
          (tiene que tener habilitado el "SMTP autenticado"). Gmail: <span className="font-mono">smtp.gmail.com</span> con una contraseña de aplicación.
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className={fieldLabelCls}>Servidor</div>
            <input value={mail.smtp.host} onChange={(e) => setMail({ ...mail, smtp: { ...mail.smtp, host: e.target.value } })} placeholder="smtp.office365.com" className={inputCls} />
          </div>
          <div>
            <div className={fieldLabelCls}>Puerto</div>
            <input type="number" value={mail.smtp.puerto} onChange={(e) => setMail({ ...mail, smtp: { ...mail.smtp, puerto: Number(e.target.value) } })} className={inputCls} />
          </div>
          <div>
            <div className={fieldLabelCls}>Usuario</div>
            <input value={mail.smtp.usuario} onChange={(e) => setMail({ ...mail, smtp: { ...mail.smtp, usuario: e.target.value } })} placeholder="facturas@taxilaserllc.com" className={inputCls} />
          </div>
          <div>
            <div className={fieldLabelCls}>Contraseña</div>
            <input type="password" value={mail.smtp.clave} onChange={(e) => setMail({ ...mail, smtp: { ...mail.smtp, clave: e.target.value } })} placeholder="••••••••" className={inputCls} />
          </div>
        </div>

          </>
        )}

        <div className="th-label mb-1.5 mt-4">Texto del mail</div>
        <div className="text-ink-faint text-[11px] mb-2">
          Variables: <span className="font-mono">{'{nombre} {numero} {concepto} {monto} {empresa}'}</span>. Si lo dejás vacío se usa el texto estándar.
        </div>
        <div className="mb-3">
          <div className={fieldLabelCls}>Asunto</div>
          <input value={mail.asunto} onChange={(e) => setMail({ ...mail, asunto: e.target.value })} placeholder="Factura #{numero} pagada — {empresa}" className={inputCls} />
        </div>
        <div className="mb-4">
          <div className={fieldLabelCls}>Mensaje</div>
          <textarea value={mail.mensaje} onChange={(e) => setMail({ ...mail, mensaje: e.target.value })} rows={4} placeholder="Hola {nombre}, recibimos tu pago. Te adjuntamos la factura #{numero}…" className={inputCls} />
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <input value={mailPara} onChange={(e) => setMailPara(e.target.value)} placeholder="Tu mail para probar" className={`${inputCls} !w-64`} />
          <button className="btn-outline" onClick={() => handleProbarMail(false)} disabled={!mailPara || probandoMail}>
            {probandoMail ? 'Enviando…' : 'Guardar y enviar prueba'}
          </button>
          <button className="btn-outline" onClick={() => handleProbarMail(true)} disabled={!mailPara || probandoMail}>
            Enviar factura de ejemplo
          </button>
          {mailPrueba && <span className={`text-[12px] ${mailPrueba.ok ? 'text-success' : 'text-danger-dark'}`}>{mailPrueba.texto}</span>}
        </div>
      </div>

      <div className="panel p-5">
        <div className="th-label mb-1">Migración desde QuickBooks</div>
        <p className="text-ink-soft text-[12.5px] mb-3">Cargá el historial de transacciones exportado de QuickBooks (facturas y pagos). Se usa durante la migración, no en el día a día.</p>
        <button className="btn-outline" onClick={() => setImportarHistorialAbierto(true)}>Importar historial</button>
      </div>
      {importarHistorialAbierto && <ImportTransactionHistoryModal onClose={() => setImportarHistorialAbierto(false)} />}

      <div className="panel p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="th-label">Recordatorios</div>
          <button onClick={() => setRecordActivo((v) => !v)} className={recordActivo ? 'chip-accent' : 'chip'}>
            {recordActivo ? 'Activos' : 'Desactivados'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className={fieldLabelCls}>Solo a quien facturó en las últimas</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={semanasActividad}
                onChange={(e) => setSemanasActividad(Number(e.target.value))}
                className="border border-line rounded-[5px] bg-surface px-2.5 py-1.5 text-sm w-20 num focus:outline-none focus:border-accent"
              />
              <span className="text-sm">semanas</span>
            </div>
            <div className="text-ink-faint text-[10.5px] mt-1">
              Así no se le manda mensaje a un taxista del histórico que ya no trabaja.
            </div>
          </div>
          <div>
            <div className={fieldLabelCls}>Condición</div>
            <button onClick={() => setSoloVencido((v) => !v)} className={soloVencido ? 'chip-accent' : 'chip'}>
              {soloVencido ? 'Solo con saldo vencido' : 'A todos los activos'}
            </button>
          </div>
        </div>

        <div className="mt-3.5">
          <div className={fieldLabelCls}>Mensaje (variables: {'{nombre}'}, {'{monto}'}, {'{dias}'})</div>
          <textarea value={plantilla} onChange={(e) => setPlantilla(e.target.value)} rows={3} className={inputCls} />
        </div>

        <div className="mt-4 border-t border-line-soft pt-4">
          <div className="th-label mb-1.5">Integración con RingCentral</div>
          <div className="text-ink-faint text-[11px] mb-2.5">
            Mientras estas credenciales estén vacías, el envío queda simulado (no manda mensajes
            reales, pero no rompe nada) — ver server/src/ringcentral.js.
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className={fieldLabelCls}>Client ID</div>
              <input value={rcClientId} onChange={(e) => setRcClientId(e.target.value)} className={inputCls} />
            </div>
            <div>
              <div className={fieldLabelCls}>Client Secret</div>
              <input type="password" value={rcClientSecret} onChange={(e) => setRcClientSecret(e.target.value)} className={inputCls} />
            </div>
            <div>
              <div className={fieldLabelCls}>Número de origen</div>
              <input value={rcNumero} onChange={(e) => setRcNumero(e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <button className="btn-accent" onClick={handleGuardar}>Guardar</button>
        <button className="btn-outline">Cancelar</button>
        {guardado && <span className="text-sm text-success">Guardado ✓</span>}
      </div>

      <div className="panel p-5">
        <div className="th-label mb-1.5">Usuarios</div>
        <div className="text-ink-faint text-[11px] mb-3">
          Quién puede entrar a la app y qué puede hacer. Los operadores no ven
          Configuración ni Auditoría, y no pueden borrar cuentas/proveedores
          ni corregir un pago ya registrado.
        </div>
        <div className="border border-line rounded-[6px] divide-y divide-line-soft mb-4">
          {usuarios.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-3.5 py-2.5 text-[13px]">
              <div>
                <span className="font-medium">{u.nombre}</span>{' '}
                <span className="chip capitalize ml-1">{u.rol}</span>
                {!u.activo && <span className="chip ml-1">Inactivo</span>}
              </div>
              <div className="flex items-center gap-3">
                <button className="text-[12px] font-medium text-accent hover:underline" onClick={() => actualizarUsuario(u.id, { rol: u.rol === 'admin' ? 'operador' : 'admin' })}>
                  Hacer {u.rol === 'admin' ? 'operador' : 'admin'}
                </button>
                <button className="text-[12px] hover:underline text-ink-soft" onClick={() => actualizarUsuario(u.id, { activo: !u.activo })}>
                  {u.activo ? 'Desactivar' : 'Reactivar'}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[1.2fr_1fr_.8fr_auto] gap-2.5 items-end">
          <div>
            <div className={fieldLabelCls}>Nombre</div>
            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} className={inputCls} />
          </div>
          <div>
            <div className={fieldLabelCls}>Rol</div>
            <div className="flex gap-1.5">
              {(['operador', 'admin'] as const).map((r) => (
                <button key={r} onClick={() => setNuevoRol(r)} aria-pressed={nuevoRol === r} className={nuevoRol === r ? 'chip-accent capitalize' : 'chip capitalize'}>{r}</button>
              ))}
            </div>
          </div>
          <div>
            <div className={fieldLabelCls}>PIN (4 dígitos)</div>
            <input
              value={nuevoPin}
              onChange={(e) => setNuevoPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              maxLength={4}
              className={`${inputCls} num`}
            />
          </div>
          <button className="btn-outline" onClick={handleAgregarUsuario} disabled={!nuevoNombre.trim() || nuevoPin.length !== 4}>
            Agregar
          </button>
        </div>
      </div>

      <div className="panel p-5">
        <div className="th-label mb-1.5">Datos y respaldo</div>
        <div className="text-ink-faint text-[11px]">
          Los datos ya no viven en este navegador — están en el servidor
          (base de datos real, Postgres). El respaldo se maneja del lado
          del servidor: ver <code>server/BASE_DE_DATOS.md</code>.
        </div>
      </div>

      <CatalogoFeesPanel />

      <div className="panel p-5 border-danger/30">
        <div className="th-label mb-1.5 !text-danger-dark">Zona de peligro</div>
        <div className="text-ink-soft text-[11.5px] mb-3">
          Borra <b>clientes, facturas, pagos, notas de crédito, reembolsos, gastos,
          cuentas, transferencias, proveedores, bills, documentos y el historial de
          auditoría</b>. Pensado para limpiar los datos de prueba antes de hacer la
          migración final desde QuickBooks. <b>No se puede deshacer.</b> No se
          borran los usuarios ni la configuración de la empresa.
        </div>
        {borradoOk ? (
          <div className="text-success text-sm">Listo — todos los datos se borraron. Ya podés empezar a importar de cero.</div>
        ) : (
          <div className="flex gap-2 items-center flex-wrap">
            <input
              value={textoConfirmacion}
              onChange={(e) => setTextoConfirmacion(e.target.value)}
              placeholder='Escribí "BORRAR TODO" para confirmar'
              className="border border-danger/40 rounded-[5px] bg-surface px-2.5 py-1.5 text-sm w-64 focus:outline-none focus:border-danger"
            />
            <button
              className="btn-outline !text-danger-dark hover:!bg-danger/10 !border-danger/40"
              onClick={handleBorrarTodo}
              disabled={textoConfirmacion !== 'BORRAR TODO' || borrando}
            >
              {borrando ? 'Borrando…' : 'Borrar todos los datos'}
            </button>
          </div>
        )}
        {errorBorrado && <div className="text-danger-dark text-[12.5px] mt-2">{errorBorrado}</div>}
      </div>
    </div>
  );
}

function CatalogoFeesPanel() {
  const { catalogoFees, agregarItemCatalogoFee, actualizarItemCatalogoFee, eliminarItemCatalogoFee } = useDataStore();
  const [codigo, setCodigo] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [monto, setMonto] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleAgregar() {
    if (!codigo.trim() || !etiqueta.trim()) return setError('Código y etiqueta son obligatorios.');
    setError(null);
    agregarItemCatalogoFee({ codigo: codigo.trim(), etiqueta: etiqueta.trim(), monto: Number(monto) || 0 });
    setCodigo('');
    setEtiqueta('');
    setMonto('');
  }

  async function handleEliminar(id: string, etiquetaItem: string) {
    if (!window.confirm(`¿Eliminar "${etiquetaItem}" del catálogo? Esto no afecta las facturas que ya se hicieron con este ítem.`)) return;
    await eliminarItemCatalogoFee(id);
  }

  return (
    <div className="panel p-5">
      <div className="th-label mb-1.5">Catálogo de fees</div>
      <div className="text-ink-faint text-[11px] mb-3">
        Los ítems que agregues acá aparecen como desplegable al crear una factura manual —
        el precio se autocompleta solo (editable), y queda un "Otro" al final para cargar
        motivo y monto a mano cuando no está en la lista. Ej: código <code>1060RI</code>,
        etiqueta "Reinscripción", monto 25.
      </div>

      <div className="border border-line rounded-[6px] divide-y divide-line-soft mb-4">
        {catalogoFees.length === 0 && (
          <div className="px-3.5 py-3 text-ink-soft text-sm">Todavía no cargaste ningún ítem.</div>
        )}
        {catalogoFees.map((f) => (
          <div key={f.id} className="flex items-center justify-between px-3.5 py-2 text-[13px]">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="chip num shrink-0">{f.codigo}</span>
              <input
                defaultValue={f.etiqueta}
                onBlur={(e) => e.target.value.trim() && e.target.value !== f.etiqueta && actualizarItemCatalogoFee(f.id, { etiqueta: e.target.value.trim() })}
                className="border-0 bg-transparent focus:outline-none focus:underline min-w-0"
              />
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <input
                type="number"
                defaultValue={f.monto}
                onBlur={(e) => Number(e.target.value) !== f.monto && actualizarItemCatalogoFee(f.id, { monto: Number(e.target.value) || 0 })}
                className="border border-line rounded-[5px] bg-surface px-2 py-1 text-[12.5px] w-20 num text-right focus:outline-none focus:border-accent"
              />
              <button className="text-ink-faint hover:text-danger-dark text-[11px]" onClick={() => handleEliminar(f.id, f.etiqueta)}>
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_1.6fr_.7fr_auto] gap-2.5 items-end">
        <div>
          <div className={fieldLabelCls}>Código</div>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="1060RI" className={`${inputCls} num`} />
        </div>
        <div>
          <div className={fieldLabelCls}>Etiqueta</div>
          <input value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Reinscripción" className={inputCls} />
        </div>
        <div>
          <div className={fieldLabelCls}>Monto</div>
          <input type="number" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className={`${inputCls} num`} />
        </div>
        <button className="btn-outline" onClick={handleAgregar} disabled={!codigo.trim() || !etiqueta.trim()}>
          Agregar
        </button>
      </div>
      {error && <div className="text-danger-dark text-[12.5px] mt-2">{error}</div>}
    </div>
  );
}
