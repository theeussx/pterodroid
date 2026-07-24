import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, Database, FolderOpen, ScrollText, Activity, Settings,
  LogOut, X, ChevronsLeft, ChevronsRight, Cpu, MemoryStick,
} from 'lucide-react';
import { useAuth } from '../stores/AuthContext';
import { useConnectionStatus, useSystemSnapshot } from '../lib/hooks';
import { api } from '../lib/api';

const NAV = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/services', label: 'Serviços', icon: Server },
  { to: '/databases', label: 'Bancos de Dados', icon: Database },
  { to: '/files', label: 'Arquivos', icon: FolderOpen },
  { to: '/logs', label: 'Logs', icon: ScrollText },
  { to: '/monitoring', label: 'Recursos', icon: Activity },
  { to: '/settings', label: 'Configurações', icon: Settings },
];

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const online = useConnectionStatus();
  const { snapshot } = useSystemSnapshot();
  const [collapsed, setCollapsed] = useState(false);
  const [servicesRunning, setServicesRunning] = useState(null);

  useEffect(() => {
    let mounted = true;
    api.listServices().then((s) => { if (mounted) setServicesRunning(s.filter((x) => x.status === 'running').length); }).catch(() => {});
    return () => { mounted = false; };
  }, [open]);

  return (
  <>
    {open && (
      <div className="fixed inset-0 bg-void/70 z-30 lg:hidden" onClick={onClose} />
    )}
    <aside
      className={`fixed lg:sticky top-0 left-0 h-screen bg-surface border-r-2 border-signal/10
        flex flex-col z-40 transition-all duration-200 shrink-0
        ${collapsed ? 'lg:w-[76px]' : 'lg:w-64'} w-64
        ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
    >
      <div className="flex items-center justify-between px-5 h-16 border-b border-line shrink-0">
        <button onClick={() => navigate('/')} className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'lg:mx-auto' : ''}`}>
          <img src="public/images/logo.jpg" alt="Logo Pterodroid" 
            className="w-7 h-7 object-contain shrink-0"
          />
          {!collapsed && <span className="font-display font-semibold text-ink tracking-tight lg:inline">Pterodroid</span>}
        </button>
        <button onClick={onClose} className="lg:hidden text-ink-faint hover:text-ink">
          <X size={18} />
        </button>
      </div>

        {/* Server status card — real connection state + quick jump-off points, doubles as the "quick actions" the sidebar needs */}
        <button
          onClick={() => navigate('/monitoring')}
          className={`mx-3 mt-3 rounded-lg border border-line-soft bg-raised/50 hover:bg-raised transition-colors text-left
            ${collapsed ? 'lg:hidden' : ''} p-3`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-medium flex items-center gap-1.5 ${online ? 'text-running' : 'text-error'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-running animate-pulse-dot' : 'bg-error'}`} />
              {online ? 'Online' : 'Offline'}
            </span>
            {servicesRunning !== null && (
              <span className="text-xs text-ink-faint font-mono">{servicesRunning} serviço(s)</span>
            )}
          </div>
          {snapshot && (
            <div className="flex items-center gap-3 text-xs text-ink-dim font-mono">
              <span className="flex items-center gap-1"><Cpu size={11} /> {snapshot.cpu.toFixed(0)}%</span>
              <span className="flex items-center gap-1"><MemoryStick size={11} /> {snapshot.mem.percent.toFixed(0)}%</span>
            </div>
          )}
        </button>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5 scrollbar-none">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${collapsed ? 'lg:justify-center' : ''}
                ${isActive ? 'bg-signal-soft text-signal' : 'text-ink-dim hover:text-ink hover:bg-raised'}`
              }
            >
              <Icon size={17} strokeWidth={2} className="shrink-0" />
              <span className={collapsed ? 'lg:hidden' : ''}>{label}</span>
            </NavLink>
          ))}
        </nav>

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="hidden lg:flex items-center gap-2 mx-3 mb-2 px-3 py-2 rounded-lg text-xs text-ink-faint hover:text-ink hover:bg-raised transition-colors"
        >
          {collapsed ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} /> Recolher</>}
        </button>

        <div className="p-3 border-t border-line shrink-0">
          <div className={`flex items-center justify-between px-2 py-2 ${collapsed ? 'lg:justify-center' : ''}`}>
            <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
              <div className="w-7 h-7 rounded-full bg-raised border border-line flex items-center justify-center text-xs font-medium text-ink-dim shrink-0">
                {user?.username?.[0]?.toUpperCase() || '?'}
              </div>
              <span className="text-sm text-ink-dim truncate">{user?.username}</span>
            </div>
            <button
              onClick={logout}
              className="text-ink-faint hover:text-error transition-colors p-1.5 shrink-0"
              title="Sair"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
