import { Home, ChevronRight } from 'lucide-react';

export default function Breadcrumbs({ path, onNavigate }) {
  const parts = path && path !== '.' ? path.split('/').filter(Boolean) : [];

  return (
    <div className="flex items-center gap-1 text-sm overflow-x-auto scrollbar-none whitespace-nowrap py-1">
      <button
        onClick={() => onNavigate('')}
        className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors shrink-0 ${
          parts.length === 0 ? 'text-signal' : 'text-ink-dim hover:text-ink hover:bg-raised'
        }`}
      >
        <Home size={14} />
        <span className="hidden sm:inline">início</span>
      </button>
      {parts.map((part, i) => {
        const target = parts.slice(0, i + 1).join('/');
        const isLast = i === parts.length - 1;
        return (
          <div key={target} className="flex items-center gap-1 shrink-0">
            <ChevronRight size={13} className="text-ink-faint" />
            <button
              onClick={() => onNavigate(target)}
              className={`px-2 py-1 rounded-md transition-colors ${isLast ? 'text-signal font-medium' : 'text-ink-dim hover:text-ink hover:bg-raised'}`}
            >
              {part}
            </button>
          </div>
        );
      })}
    </div>
  );
}
