import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './stores/AuthContext';
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
import { Home, DocLayout, Download } from './pages/PublicSite';

export default function App() {
  return <ToastProvider><AuthProvider><BrowserRouter><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/docs" element={<DocLayout />} />
    <Route path="/docs/:slug" element={<DocLayout />} />
    <Route path="/download" element={<Download />} />
    <Route path="/login" element={<Login />} />
    <Route path="/panel" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
      <Route index element={<Dashboard />} handle={{ title:'Dashboard' }} />
      <Route path="services" element={<Services />} handle={{ title:'Serviços' }} />
      <Route path="docker" element={<DockerHosts />} handle={{ title:'Docker' }} />
      <Route path="databases" element={<Databases />} handle={{ title:'Bancos de Dados' }} />
      <Route path="files" element={<Files />} handle={{ title:'Arquivos' }} />
      <Route path="logs" element={<Logs />} handle={{ title:'Logs' }} />
      <Route path="monitoring" element={<Monitoring />} handle={{ title:'Monitoramento' }} />
      <Route path="settings" element={<Settings />} handle={{ title:'Configurações' }} />
    </Route>
  </Routes></BrowserRouter></AuthProvider></ToastProvider>;
}
