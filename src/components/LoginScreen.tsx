import { useState } from 'react';
import { useDataStore } from '../data/DataContext';
import { Wordmark } from './Wordmark';
import { LogIn, Eye, EyeOff } from 'lucide-react';

export function LoginScreen() {
  const { usuariosParaLogin, iniciarSesion, errorConexion } = useDataStore();
  const [usuarioId, setUsuarioId] = useState<string>(() => {
    try { const g = localStorage.getItem('ultimoUsuario'); if (g && usuariosParaLogin.some((u) => u.id === g)) return g; } catch { /* sin storage */ }
    return usuariosParaLogin[0]?.id ?? '';
  });
  const [verPin, setVerPin] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function handleEntrar() {
    if (!usuarioId) return setError('Elegí tu usuario.');
    if (!pin) return setError('Ingresá tu PIN.');
    setEntrando(true);
    const ok = await iniciarSesion(usuarioId, pin);
    setEntrando(false);
    if (!ok) {
      setError(errorConexion || 'PIN incorrecto.');
      setPin('');
      return;
    }
    try { localStorage.setItem('ultimoUsuario', usuarioId); } catch { /* sin storage */ }
    setError(null);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="panel w-[min(380px,94vw)] p-6">
        <div className="flex items-center gap-2 mb-1">
          <Wordmark size={28} />
        </div>
        <h1 className="font-bold text-lg mb-4">Iniciar sesión</h1>

        <div className="th-label mb-1.5">Usuario</div>
        <div className="flex flex-col gap-1.5 mb-3">
          {usuariosParaLogin.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                setUsuarioId(u.id);
                setError(null);
              }}
              aria-pressed={usuarioId === u.id}
              className={`flex items-center justify-between px-3 py-2.5 min-h-[40px] rounded-md border text-sm text-left ${
                usuarioId === u.id ? 'border-accent bg-accent/10' : 'border-line hover:bg-line-soft'
              }`}
            >
              <span>{u.nombre}</span>
              <span className="chip capitalize">{u.rol}</span>
            </button>
          ))}
          {usuariosParaLogin.length === 0 && !errorConexion && (
            <div className="text-ink-soft text-sm">Cargando usuarios…</div>
          )}
        </div>

        <label htmlFor="pin" className="th-label mb-1.5 block">PIN (4 dígitos)</label>
        <div className="relative mb-3">
          <input
            id="pin"
            name="pin"
            type={verPin ? 'text' : 'password'}
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && handleEntrar()}
            placeholder="••••"
            aria-describedby={error ? 'login-error' : undefined}
            className="w-full border border-line rounded-[5px] bg-surface pl-2.5 pr-10 py-2 text-sm text-center tracking-[0.5em] num"
          />
          <button type="button" onClick={() => setVerPin((v) => !v)} aria-label={verPin ? 'Ocultar PIN' : 'Mostrar PIN'} className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-ink-soft hover:text-ink">
            {verPin ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {error && <div id="login-error" role="alert" className="text-danger-dark text-[13px] mb-3">{error}</div>}

        <button className="btn-accent w-full flex items-center justify-center gap-2" onClick={handleEntrar} disabled={entrando}>
          <LogIn size={15} /> {entrando ? 'Entrando…' : 'Entrar'}
        </button>

      </div>
    </div>
  );
}
