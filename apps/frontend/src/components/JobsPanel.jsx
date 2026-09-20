import { useEffect, useState, useCallback } from 'react';
import { Loader2, XOctagon, RefreshCw, ListChecks } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useToast } from '../stores/ToastContext';

/**
 * Tarefas em segundo plano (fila persistente): mostra o que está rodando/
 * aguardando e o rastro recente. O progresso chega ao vivo pelo socket
 * (job:update); a lista inicial vem da API. Renderiza nada quando não há
 * NENHUM job — o card desaparece de quem nunca enfileirou algo, evitando
 * ruído permanente no dashboard.
 */
export default function JobsPanel() {
  const [data, setData] = useState(null); // {items, total, active}
  const { notify } = useToast();

  const load = useCallback(() => {
    api.jobs.list({ limit: 12 }).then(setData).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onJob = () => load();
    socket.on('job:update', onJob);
    return () => socket.off('job:update', onJob);
  }, [load]);

  const cancel = async (job) => {
    try {
      await api.jobs.cancel(job.id);
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  if (!data || (!data.active && data.items.length === 0)) return null;

  const active = data.items.filter((j) => j.status === 'running' || j.status === 'queued');
  const recent = data.items.filter((j) => j.status !== 'running' && j.status !== 'queued').slice(0, 6);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-ink-faint uppercase tracking-wide flex items-center gap-1.5">
          <ListChecks size={13} /> Tarefas em segundo plano
        </p>
        <button type="button" onClick={load} className="text-ink-faint hover:text-ink" title="Atualizar">
          <RefreshCw size={12} />
        </button>
      </div>

      {active.map((j) => (
        <div key={j.id} className="bg-raised border border-line rounded-lg p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-sm text-ink truncate">
              {label(j.type)} <span className="text-ink-faint">{j.subject}</span>
            </p>
            {j.status === 'queued' ? (
              <button type="button" onClick={() => cancel(j)} className="text-[11px] text-error hover:underline shrink-0">
                cancelar
              </button>
            ) : (
              <span className="text-[11px] text-signal flex items-center gap-1 shrink-0">
                <Loader2 size={11} className="animate-spin" /> executando
              </span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-overlay overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${j.status === 'queued' ? 'bg-ink-faint/40' : 'bg-signal'}`}
              style={{ width: `${j.progress || 0}%` }}
            />
          </div>
        </div>
      ))}

      {recent.map((j) => (
        <div key={j.id} className="flex items-center gap-2 px-1 py-1">
          <XOctagon
            size={12}
            className={`shrink-0 ${j.status === 'done' ? 'text-running' : j.status === 'failed' ? 'text-error' : 'text-ink-faint'}`}
          />
          <p className="text-xs text-ink-dim truncate">
            {label(j.type)} <span className="text-ink-faint">{j.subject}</span>
            {j.status === 'failed' && j.result ? ` — ${j.result}` : ''}
            {j.status === 'cancelled' ? ' — cancelado antes de começar' : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

function label(type) {
  switch (type) {
    case 'backup.create': return 'Backup —';
    case 'backup.restore': return 'Restauração —';
    case 'docker.image_pull': return 'Pull de imagem —';
    default: return `${type} —`;
  }
}
