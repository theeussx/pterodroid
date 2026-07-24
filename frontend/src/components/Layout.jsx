import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import SetupBanner from './SetupBanner';

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/services': 'Serviços',
  '/databases': 'Bancos de Dados',
  '/logs': 'Logs',
  '/monitoring': 'Monitoramento',
  '/settings': 'Configurações',
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'Pterodroid';

  return (
    <div className="flex min-h-screen">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar title={title} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          <SetupBanner />
          <Outlet />
        </main>
     <footer className="w-full pb-6 pt-2 flex justify-center items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-xs font-medium text-zinc-500 dark:text-zinc-400 shadow-sm">
            <span className="text-sm">©</span>
            <span>2026 Pterodroid. Desenvolvido por Mateus. Todos os direitos reservados.</span>
          </div>
        </footer>
      </div>
    </div>
  );
