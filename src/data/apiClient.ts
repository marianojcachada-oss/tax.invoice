const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const TOKEN_KEY = 'taxi-cobros:token';

export function setToken(token: string | null) {
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function getToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(mensaje: string, status: number) {
    super(mensaje);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor. ¿Está corriendo (npm run dev en la carpeta server)?', 0);
  }

  if (!res.ok) {
    const cuerpo = await res.json().catch(() => ({}));
    throw new ApiError(cuerpo.error || `Error ${res.status}`, res.status);
  }
  if (res.status === 204) return null as T;
  const cuerpo = await res.json();
  // 202 = el cambio quedó como solicitud para el sector contable (no se aplicó todavía).
  if (res.status === 202 && cuerpo && cuerpo.solicitud) {
    window.dispatchEvent(new CustomEvent('tax:solicitud', { detail: { mensaje: cuerpo.mensaje as string } }));
  }
  return cuerpo as T;
}

/** ¿La respuesta es una solicitud pendiente en vez del dato actualizado? */
export const esSolicitud = (x: unknown): boolean => !!x && typeof x === 'object' && 'solicitud' in (x as object);

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T,>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T,>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Para endpoints que devuelven un archivo binario (ej. el PDF de una
 * factura) en vez de JSON — necesita el mismo header de sesión que el
 * resto, así que no alcanza con un <a href> directo. */
export async function descargarArchivo(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => ({}));
    throw new ApiError(cuerpo.error || `Error ${res.status}`, res.status);
  }
  return res.blob();
}
