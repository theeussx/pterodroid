import { useState, useEffect, useRef, useCallback } from 'react';
import { TerminalSquare, Square, Trash2, CornerDownLeft, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import Button from './Button';
import { useToast } from '../stores/ToastContext';

/** Cores por tipo de linha — o eco do comando precisa se destacar da saída. */
const STREAM_STYLE = {
  input: 'text-signal font-medium',
  stdout: 'text-ink-dim',
  stderr: 'text-error',
  system: 'text-provisioning italic',
};

const HISTORY_KEY = 'pterodroid_term_history';
const MAX_LINES = 500;

/**
 * Terminal do serviço.
 *
 * Os comandos vão por HTTP e a saída volta por socket, então um
 * `npm install` vai imprimindo enquanto roda em vez de a tela ficar parada
 * até o fim. O backend mantém o diretório atual e as variáveis exportadas
 * entre um comando e outro (ver terminalManager.js).
 */
export default function ServiceTerminal({ serviceId, serviceName }) {
  const [session, setSession] = useState(null);
  const [lines, setLines] = useState([]);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  });
  const [historyIndex, setHistoryIndex] = useState(-1);

  const outputRef = useRef(null);
  const inputRef = useRef(null);
  const sessionRef = useRef(null);
  const { notify } = useToast();

  const append = useCallback((chunk) => {
    setLines((prev) => {
      const next = [...prev, chunk];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  // Abre a sessão ao montar e fecha ao desmontar — sem isso, trocar de aba
  // deixaria sessões penduradas no backend (o reaper limparia depois, mas
  // fechar na hora é o certo).
  useEffect(() => {
    let cancelled = false;
    setStarting(true);
    setError('');
    setLines([]);

    api.terminal.open(serviceId)
      .then((created) => {
        if (cancelled) { api.terminal.close(serviceId, created.id).catch(() => {}); return; }
        sessionRef.current = created;
        setSession(created);
        append({ stream: 'system', text: `Sessão aberta em ${created.cwd}\n`, ts: Date.now() });
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setStarting(false); });

    return () => {
      cancelled = true;
      const open = sessionRef.current;
      sessionRef.current = null;
      if (open) api.terminal.close(serviceId, open.id).catch(() => {});
    };
  }, [serviceId, append]);

  // Saída ao vivo. Filtra por sessão: o socket é global e outra aba pode
  // ter um terminal aberto ao mesmo tempo.
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !session) return undefined;

    const onData = (payload) => {
      if (payload.sessionId !== session.id) return;
      if (payload.stream === 'exit') {
        setBusy(false);
        if (payload.cwd) setSession((s) => (s ? { ...s, cwd: payload.cwd } : s));
        if (payload.code !== 0 && payload.code != null) {
          append({ stream: 'system', text: `[saiu com código ${payload.code}]\n`, ts: Date.now() });
        }
        return;
      }
      append(payload);
    };

    socket.on('terminal:data', onData);
    return () => socket.off('terminal:data', onData);
  }, [session, append]);

  // Rola para o fim quando chega saída nova, a menos que o usuário tenha
  // subido para ler algo.
  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const rememberCommand = (cmd) => {
    setHistory((prev) => {
      const next = [cmd, ...prev.filter((c) => c !== cmd)].slice(0, 50);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* cota cheia */ }
      return next;
    });
  };

  const submit = async (e) => {
    e?.preventDefault();
    const cmd = command.trim();
    if (!cmd || !session || busy) return;

    setBusy(true);
    setCommand('');
    setHistoryIndex(-1);
    rememberCommand(cmd);

    try {
      await api.terminal.exec(serviceId, session.id, cmd);
    } catch (err) {
      setBusy(false);
      append({ stream: 'stderr', text: `${err.message}\n`, ts: Date.now() });
    }
  };

  const interrupt = async () => {
    if (!session) return;
    try {
      const res = await api.terminal.interrupt(serviceId, session.id);
      if (!res.ok) notify('Nada para interromper', 'info');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  // Setas ↑/↓ percorrem o histórico, como num shell de verdade.
  const onKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      if (next >= 0) { setHistoryIndex(next); setCommand(history[next]); }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setCommand(next >= 0 ? history[next] : '');
    } else if (e.key === 'c' && e.ctrlKey) {
      // Só intercepta se não houver texto selecionado, senão quebra o copiar.
      if (!window.getSelection()?.toString()) { e.preventDefault(); interrupt(); }
    }
  };

  if (error) {
    return (
      <div className="text-center py-10">
        <TerminalSquare size={24} className="mx-auto text-ink-faint mb-2" />
        <p className="text-sm text-error mb-3">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()} className="mx-auto">
          <RefreshCw size={14} /> Tentar de novo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
        <span className="font-mono text-ink-faint truncate" title={session?.cwd}>
          {starting ? 'abrindo sessão...' : session?.cwd}
        </span>
        <div className="flex items-center gap-1">
          {busy && (
            <button onClick={interrupt} className="flex items-center gap-1 px-2 py-1 text-error hover:bg-error/10 rounded" title="Interromper (Ctrl+C)">
              <Square size={12} /> parar
            </button>
          )}
          <button
            onClick={() => setLines([])}
            className="flex items-center gap-1 px-2 py-1 text-ink-faint hover:text-ink rounded"
            title="Limpar a tela"
          >
            <Trash2 size={12} /> limpar
          </button>
        </div>
      </div>

      <div
        ref={outputRef}
        onClick={() => inputRef.current?.focus()}
        className="h-[45vh] overflow-y-auto bg-void border border-line rounded-lg p-3 font-mono text-xs leading-relaxed cursor-text"
      >
        {lines.length === 0 && !starting && (
          <p className="text-ink-faint italic">
            Digite um comando abaixo. Programas de tela cheia (vim, htop) não funcionam aqui.
          </p>
        )}
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap break-all ${STREAM_STYLE[line.stream] || 'text-ink-dim'}`}>
            {line.text.replace(/\n$/, '')}
          </div>
        ))}
        {busy && <div className="text-ink-faint animate-pulse">executando...</div>}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 bg-raised border border-line rounded-lg px-3 py-2">
        <span className="text-signal font-mono text-xs shrink-0">$</span>
        <input
          ref={inputRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={starting || !session}
          placeholder={busy ? 'comando em execução — Ctrl+C para interromper' : 'ls -la'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          className="flex-1 bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none font-mono disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!command.trim() || busy || !session}
          className="text-ink-faint hover:text-signal disabled:opacity-30 shrink-0"
          title="Executar"
        >
          <CornerDownLeft size={14} />
        </button>
      </form>

      <p className="text-[10px] text-ink-faint">
        Terminal orientado a comando: cada linha roda no diretório acima, e o
        <code className="mx-1 text-ink-dim">cd</code>
        vale para os próximos comandos. Use ↑/↓ para repetir comandos.
      </p>
    </div>
  );
}
