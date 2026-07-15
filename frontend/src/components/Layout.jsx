import { useState } from 'react';
import { Outlet, useMatches } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import SetupBanner from './SetupBanner';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const matches = useMatches();
  const title = matches.length > 0 ? (matches[matches.length - 1]?.handle?.title || 'TermuxPanel') : 'TermuxPanel';

  return (
    <div className="flex min-h-screen">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar title={title} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          <SetupBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
