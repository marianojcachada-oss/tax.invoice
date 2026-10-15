import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../theme/ThemeContext';

export function ThemeToggle() {
  const { tema, toggleTema } = useTheme();
  return (
    <button
      onClick={toggleTema}
      className="w-8 h-8 rounded-md border border-line flex items-center justify-center text-ink-soft hover:text-ink hover:bg-line-soft transition-colors"
      title={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
    >
      {tema === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
