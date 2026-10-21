import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DataProvider, useDataStore } from './data/DataContext';
import { ThemeProvider } from './theme/ThemeContext';
import { Layout } from './components/Layout';
import { LoginScreen } from './components/LoginScreen';
import { Dashboard } from './pages/Dashboard';
import { Clients } from './pages/Clients';
import { ClientDetail } from './pages/ClientDetail';
import { Sales } from './pages/Sales';
import { Vendors } from './pages/Vendors';
import { Accounts } from './pages/Accounts';
import { Expenses } from './pages/Expenses';
import { Reports } from './pages/Reports';
import { Audit } from './pages/Audit';
import { Settings } from './pages/Settings';
import { Informes } from './pages/Informes';
import { Help } from './pages/Help';

export default function App() {
  return (
    <ThemeProvider>
      <DataProvider>
        <AuthGate />
      </DataProvider>
    </ThemeProvider>
  );
}

// Muestra la pantalla de login si nadie inició sesión todavía; si ya hay
// alguien logueado, muestra la app entera con su navegación normal.
function AuthGate() {
  const { usuarioActual, cargando, errorConexion } = useDataStore();

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink-soft text-sm">
        Cargando…
      </div>
    );
  }

  if (errorConexion && !usuarioActual) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper px-4">
        <div className="panel w-[min(420px,94vw)] p-6 text-center">
          <div className="font-bold text-lg mb-2">No se pudo conectar</div>
          <p className="text-ink-soft text-sm mb-4">{errorConexion}</p>
          <button className="btn-accent" onClick={() => window.location.reload()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!usuarioActual) {
    return <LoginScreen />;
  }

  return (
    <BrowserRouter>
      <Layout>
        {errorConexion && usuarioActual && (
          <div role="alert" className="mx-6 md:mx-8 mt-4 text-[12.5px] text-danger-dark border border-danger/30 rounded-[6px] px-3 py-2">{errorConexion}</div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clientes" element={<Clients />} />
          <Route path="/clientes/:id" element={<ClientDetail />} />
          <Route path="/cobros" element={<Sales />} />
          <Route path="/proveedores" element={<Vendors />} />
          <Route path="/cuentas" element={<Accounts />} />
          <Route path="/gastos" element={<Expenses />} />
          <Route path="/reportes" element={<Reports />} />
          <Route path="/auditoria" element={<Audit />} />
          <Route path="/configuracion" element={<Settings />} />
          <Route path="/informes" element={<Informes />} />
          <Route path="/ayuda" element={<Help />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
