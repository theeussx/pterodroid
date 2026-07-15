import { Menu } from 'lucide-react';
import PulseStrip from './PulseStrip';
import { useSystemSnapshot } from '../lib/hooks';

export default function TopBar({ title, onMenuClick, actions }) {
  const { snapshot, history } = useSystemSnapshot();

  return (
    <header className="sticky top-0 z-20 h-16 bg-void/90 backdrop-blur border-b border-line flex items-center justify-between px-4 sm:px-6 gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={onMenuClick} className="lg:hidden text-ink-dim hover:text-ink shrink-0">
          <Menu size={20} />
        </button>
        <h1 className="font-display font-semibold text-lg text-ink truncate">{title}</h1>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {actions}
        <div className="hidden sm:block">
          <PulseStrip history={history} current={snapshot} />
        </div>
      </div>
    </header>
  );
}
