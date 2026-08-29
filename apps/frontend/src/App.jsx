import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './stores/AuthContext';
import { ToastProvider } from './stores/ToastContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Services from './pages/Services';
import DockerHosts from './pages/DockerHosts';
import Databases from './pages/Databases';
import Files from './pages/Files';
import Logs from './pages/Logs';
import Monitoring from './pages/Monitoring';
import Settings from './pages/Settings';

/**
 * Enquanto a senha padrão não é trocada (setupDone=false), o painel ainda
 * NÃO libera as rotas de negócio — o backend devolve 403 SETUP_REQUIRED.
 * No front, forçamos o usuário a ir para /settings (onde fica o formulário
 * de troca de senha) e impedimos navegar para outras páginas. Isso elimina
 * a janela de risco do login admin/admin com terminal embutido.
 */
function SetupGate({ children }) {
  const { setupDone } = useAuth();
  if (!setupDone) return <Navigate to="/settings" replace />;
  return children;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <SetupGate>
                    <Layout />
                  </SetupGate>
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} handle={{ title: 'Dashboard' }} />
              <Route path="services" element={<Services />} handle={{ title: 'Serviços' }} />
              <Route path="docker" element={<DockerHosts />} handle={{ title: 'Docker' }} />
              <Route path="databases" element={<Databases />} handle={{ title: 'Bancos de Dados' }} />
              <Route path="files" element={<Files />} handle={{ title: 'Arquivos' }} />
              <Route path="logs" element={<Logs />} handle={{ title: 'Logs' }} />
              <Route path="monitoring" element={<Monitoring />} handle={{ title: 'Monitoramento' }} />
              <Route path="settings" element={<Settings />} handle={{ title: 'Configurações' }} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
