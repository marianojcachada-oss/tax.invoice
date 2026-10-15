import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Tema = 'light' | 'dark';
const STORAGE_KEY = 'taxi-cobros-theme';

interface ThemeStore {
  tema: Tema;
  toggleTema: () => void;
}

const ThemeContext = createContext<ThemeStore | null>(null);

function temaInicial(): Tema {
  if (typeof window === 'undefined') return 'light';
  const guardado = window.localStorage.getItem(STORAGE_KEY);
  if (guardado === 'light' || guardado === 'dark') return guardado;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(temaInicial);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', tema === 'dark');
    window.localStorage.setItem(STORAGE_KEY, tema);
  }, [tema]);

  function toggleTema() {
    setTema((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  return <ThemeContext.Provider value={{ tema, toggleTema }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeStore {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  return ctx;
}
