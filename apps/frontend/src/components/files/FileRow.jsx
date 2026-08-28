import { iconFor, formatBytes, formatDate } from './fileUtils';
import { Check } from 'lucide-react';

export default function FileRow({ entry, selected, selectionMode, onOpen, onToggleSelect, onLongPress }) {
  const Icon = iconFor(entry);
  let pressTimer = null;

  const startPress = () => {
    pressTimer = setTimeout(() => onLongPress(entry), 450);
  };
  const cancelPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
  };

  return (
    <div
      onClick={() => (selectionMode ? onToggleSelect(entry) : onOpen(entry))}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={cancelPress}
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer select-none transition-colors
        ${selected ? 'bg-signal-soft' : 'hover:bg-raised'}`}
    >
      {selectionMode && (
        <div className={`w-5 h-5 rounded-md border shrink-0 flex items-center justify-center transition-colors
          ${selected ? 'bg-signal border-signal' : 'border-line'}`}
        >
          {selected && <Check size={13} className="text-void" strokeWidth={3} />}
        </div>
      )}
      <Icon size={19} className={entry.type === 'dir' ? 'text-signal shrink-0' : 'text-ink-faint shrink-0'} strokeWidth={1.7} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink truncate">{entry.name}</p>
      </div>
      <div className="text-right shrink-0 hidden sm:block">
        <p className="text-xs text-ink-faint font-mono">{entry.type === 'dir' ? '—' : formatBytes(entry.size)}</p>
      </div>
      <div className="text-right shrink-0 w-14">
        <p className="text-xs text-ink-faint font-mono">{formatDate(entry.mtime)}</p>
      </div>
    </div>
  );
}
