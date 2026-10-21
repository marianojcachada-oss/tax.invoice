import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { GlobalSearch } from './GlobalSearch';
import { AvisoSolicitud } from './AvisoSolicitud';

export function Layout({ children }: { children: ReactNode }) {
  const [menuAbierto, setMenuAbierto] = useState(false);

  return (
    <div className="min-h-screen flex bg-paper">
      <Sidebar abierto={menuAbierto} onClose={() => setMenuAbierto(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-[60px] shrink-0 border-b border-line bg-paper/90 backdrop-blur-sm sticky top-0 z-20 flex items-center gap-2 justify-between px-3 sm:px-6">
          <button
            className="md:hidden text-ink-soft shrink-0 p-1.5 -ml-1.5"
            onClick={() => setMenuAbierto(true)}
            aria-label="Abrir menú"
          >
            <Menu size={20} />
          </button>
          <GlobalSearch />
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <ThemeToggle />
            <Link to="/ayuda" aria-label="Ayuda" title="Ayuda" className="text-ink-faint hover:text-accent hidden sm:flex p-1.5"><HelpCircle size={17} /></Link>
          </div>
        </header>
        <main className="flex-1 min-w-0 bg-paper overflow-x-hidden">{children}</main>
        <AvisoSolicitud />
      </div>
    </div>
  );
}
