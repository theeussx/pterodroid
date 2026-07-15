import { useEffect, useRef, useState } from 'react';

export default function LogViewer({ lines, height = 'h-80', onSendInput, emptyLabel = 'Sem logs ainda.' }) {
  const containerRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const visible = filter
    ? lines.filter((l) => l.message.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  const submitInput = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendInput?.(input);
    setInput('');
  };

  return (
    <div className="flex flex-col border border-line rounded-lg overflow-hidden bg-void">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-raised">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar logs..."
          className="flex-1 bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none font-mono"
        />
        <span className="text-[10px] text-ink-faint font-mono">{visible.length} linhas</span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`${height} overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed scrollbar-none`}
      >
        {visible.length === 0 && <p className="text-ink-faint italic">{emptyLabel}</p>}
        {visible.map((l, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap break-all ${l.level === 'error' ? 'text-error' : 'text-ink-dim'}`}
          >
            {l.message.replace(/\n$/, '')}
          </div>
        ))}
      </div>
      {onSendInput && (
        <form onSubmit={submitInput} className="flex items-center gap-2 px-3 py-2 border-t border-line bg-raised">
          <span className="text-signal font-mono text-xs">$</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enviar comando para o processo (stdin)..."
            className="flex-1 bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none font-mono"
          />
        </form>
      )}
    </div>
  );
}
