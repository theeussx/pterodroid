import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './stores/AuthContext';
import { ToastProvider } from './stores/ToastContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Services from './pages/Services';
import Databases from './pages/Databases';
import Logs from './pages/Logs';
import Monitoring from './pages/Monitoring';
import Settings from './pages/Settings';

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
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} handle={{ title: 'Dashboard' }} />
              <Route path="services" element={<Services />} handle={{ title: 'Serviços' }} />
              <Route path="databases" element={<Databases />} handle={{ title: 'Bancos de Dados' }} />
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
