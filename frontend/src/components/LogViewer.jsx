import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Pause, Play, Trash2, Copy, Check, AlertTriangle } from 'lucide-react';

const LEVELS = ['info', 'warn', 'error', 'debug'];
const LEVEL_STYLE = {
  info: 'text-ink-dim',
  warn: 'text-provisioning',
  error: 'text-error',
  debug: 'text-ink-faint',
};

function detectLevel(line) {
  if (line.level === 'error') return 'error'; // authoritative: this came from stderr
  if (/\b(WARN|WARNING)\b/.test(line.message)) return 'warn';
  if (/\b(DEBUG|TRACE)\b/.test(line.message)) return 'debug';
  return 'info';
}

function dayKey(ts) {
  return new Date(ts).toDateString();
}

export default function LogViewer({ lines, height = 'h-80', onSendInput, emptyLabel = 'Sem logs ainda.' }) {
  const containerRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState('');
  const [activeLevels, setActiveLevels] = useState(new Set(LEVELS));
  const [paused, setPaused] = useState(false);
  const [frozenAt, setFrozenAt] = useState(null); // line count snapshot when paused
  const [copied, setCopied] = useState(false);
  const [clearedBefore, setClearedBefore] = useState(0); // index — lines before this are hidden

  const togglePause = () => {
    if (!paused) setFrozenAt(lines.length);
    setPaused((p) => !p);
  };

  const effectiveLines = paused ? lines.slice(0, frozenAt) : lines;
  const workingLines = effectiveLines.slice(clearedBefore);

  const tagged = useMemo(() => workingLines.map((l) => ({ ...l, _level: detectLevel(l) })), [workingLines]);

  const visible = useMemo(() => {
    return tagged.filter((l) => {
      if (!activeLevels.has(l._level)) return false;
      if (filter && !l.message.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    });
  }, [tagged, activeLevels, filter]);

  const errorCount = useMemo(() => tagged.filter((l) => l._level === 'error').length, [tagged]);

  useEffect(() => {
    if (autoScroll && !paused && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll, paused]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const toggleLevel = (level) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      next.has(level) ? next.delete(level) : next.add(level);
      return next.size === 0 ? new Set(LEVELS) : next; // never allow zero levels selected
    });
  };

  const clear = () => setClearedBefore(effectiveLines.length);

  const copyAll = useCallback(() => {
    const text = visible.map((l) => l.message.replace(/\n$/, '')).join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [visible]);

  const submitInput = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendInput?.(input);
    setInput('');
  };

  let lastDay = null;

  return (
    <div className="flex flex-col border border-line rounded-lg overflow-hidden bg-void">
      <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-line bg-raised flex-wrap">
        {LEVELS.map((level) => (
          <button
            key={level}
            onClick={() => toggleLevel(level)}
            className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded transition-colors
              ${activeLevels.has(level) ? LEVEL_STYLE[level] + ' bg-void/60' : 'text-ink-faint/50'}`}
          >
            {level}
          </button>
        ))}
        <div className="flex-1 min-w-[80px]">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar..."
            className="w-full bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none font-mono"
          />
        </div>
        {errorCount > 0 && (
          <span className="text-[10px] text-error flex items-center gap-1 font-mono shrink-0">
            <AlertTriangle size={11} /> {errorCount}
          </span>
        )}
        <button onClick={togglePause} className="text-ink-faint hover:text-ink p-1 shrink-0" title={paused ? 'Retomar' : 'Pausar'}>
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
        <button onClick={copyAll} className="text-ink-faint hover:text-ink p-1 shrink-0" title="Copiar">
          {copied ? <Check size={13} className="text-running" /> : <Copy size={13} />}
        </button>
        <button onClick={clear} className="text-ink-faint hover:text-error p-1 shrink-0" title="Limpar">
          <Trash2 size={13} />
        </button>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`${height} overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed scrollbar-none`}
      >
        {visible.length === 0 && <p className="text-ink-faint italic">{emptyLabel}</p>}
        {visible.map((l, i) => {
          const day = dayKey(l.ts);
          const showSeparator = day !== lastDay;
          lastDay = day;
          return (
            <div key={i}>
              {showSeparator && (
                <div className="flex items-center gap-2 my-1.5 text-[10px] text-ink-faint">
                  <div className="flex-1 h-px bg-line-soft" />
                  {new Date(l.ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                  <div className="flex-1 h-px bg-line-soft" />
                </div>
              )}
              <div
                className={`whitespace-pre-wrap break-all pl-1.5 ${LEVEL_STYLE[l._level]}
                  ${l._level === 'error' ? 'border-l-2 border-error/50' : ''}`}
              >
                {l.message.replace(/\n$/, '')}
              </div>
            </div>
          );
        })}
        {paused && (
          <div className="sticky bottom-0 text-center py-1 text-[10px] text-provisioning bg-void/90 -mx-3 px-3">
            pausado — {lines.length - frozenAt} nova(s) linha(s) chegando
          </div>
        )}
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
