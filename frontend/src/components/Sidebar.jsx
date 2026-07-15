import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Server, Database, ScrollText, Activity, Settings, LogOut, X } from 'lucide-react';
import { useAuth } from '../stores/AuthContext';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/services', label: 'Serviços', icon: Server },
  { to: '/databases', label: 'Bancos de Dados', icon: Database },
  { to: '/logs', label: 'Logs', icon: ScrollText },
  { to: '/monitoring', label: 'Monitoramento', icon: Activity },
  { to: '/settings', label: 'Configurações', icon: Settings },
];

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-void/70 z-30 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-64 bg-surface border-r border-line
          flex flex-col z-40 transition-transform duration-200 shrink-0
          ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="flex items-center justify-between px-5 h-16 border-b border-line shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-signal-soft border border-signal/30 flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-signal animate-pulse-dot" />
            </div>
            <span className="font-display font-semibold text-ink tracking-tight">Pterodroid</span>
          </div>
          <button onClick={onClose} className="lg:hidden text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5 scrollbar-none">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${isActive ? 'bg-signal-soft text-signal' : 'text-ink-dim hover:text-ink hover:bg-raised'}`
              }
            >
              <Icon size={17} strokeWidth={2} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-line shrink-0">
          <div className="flex items-center justify-between px-2 py-2">
            <div className="flex items-center gap-2.5 min-w-0">
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
