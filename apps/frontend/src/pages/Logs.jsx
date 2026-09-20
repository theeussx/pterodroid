import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { api } from '../lib/api';
import { useLiveLogs } from '../lib/hooks';
import Card from '../components/Card';
import StatusDot from '../components/StatusDot';
import LogViewer from '../components/LogViewer';
import AuditView from '../components/AuditView';
import { useToast } from '../stores/ToastContext';

export default function Logs() {
  const [services, setServices] = useState([]);
  const [instances, setInstances] = useState([]);
  // kind: 'service' | 'db' | 'audit' — auditoria não tem live tail, por
  // isso recebe kind/id nulos no hook abaixo (não pode abrir socket).
  const [selected, setSelected] = useState(null); // { kind, id, name, status }
  const { notify } = useToast();
  const liveKind = selected?.kind === 'audit' ? null : selected?.kind;
  const { lines, seedOnce } = useLiveLogs(liveKind, liveKind ? selected.id : null);

  useEffect(() => {
    Promise.all([api.listServices(), api.listDatabases()])
      .then(([svcs, dbs]) => {
        setServices(svcs);
        setInstances(dbs);
        if (svcs.length > 0) select('service', svcs[0]);
        else if (dbs.length > 0) select('db', dbs[0]);
      })
      .catch((e) => notify(e.message, 'error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const select = async (kind, entity) => {
    setSelected({ kind, id: entity.id, name: entity.name, status: entity.status });
    try {
      const detail = kind === 'service' ? await api.getService(entity.id) : await api.getDatabase(entity.id);
      const historical = detail.recentLogs?.length
        ? detail.recentLogs
        : [...(detail.persistedLogs || [])].reverse();
      seedOnce(historical);
    } catch {
      // no historical backlog available — live tail still works from here
    }
  };

  return (
    <div className="grid lg:grid-cols-[240px_1fr] gap-4">
      <Card padded={false} className="h-fit lg:sticky lg:top-20">
        <div className="p-4 pb-2">
          <p className="text-xs font-medium text-ink-faint uppercase tracking-wide">Serviços</p>
        </div>
        <div className="pb-2">
          {services.length === 0 && <p className="px-4 py-2 text-xs text-ink-faint">Nenhum serviço</p>}
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => select('service', s)}
              className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm transition-colors
                ${selected?.kind === 'service' && selected.id === s.id ? 'bg-signal-soft text-signal' : 'text-ink-dim hover:bg-raised hover:text-ink'}`}
            >
              <span className="truncate">{s.name}</span>
              <StatusDot status={s.status} showLabel={false} />
            </button>
          ))}
        </div>
        <div className="p-4 pb-2 border-t border-line-soft">
          <p className="text-xs font-medium text-ink-faint uppercase tracking-wide">Bancos de dados</p>
        </div>
        <div className="pb-3">
          {instances.length === 0 && <p className="px-4 py-2 text-xs text-ink-faint">Nenhuma instância</p>}
          {instances.map((d) => (
            <button
              key={d.id}
              onClick={() => select('db', d)}
              className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm transition-colors
                ${selected?.kind === 'db' && selected.id === d.id ? 'bg-signal-soft text-signal' : 'text-ink-dim hover:bg-raised hover:text-ink'}`}
            >
              <span className="truncate">{d.name}</span>
              <StatusDot status={d.status} showLabel={false} />
            </button>
          ))}
        </div>
        <div className="p-4 pb-2 border-t border-line-soft">
          <p className="text-xs font-medium text-ink-faint uppercase tracking-wide">Painel</p>
        </div>
        <div className="pb-3">
          <button
            onClick={() => setSelected({ kind: 'audit', id: 0, name: 'Auditoria', status: null })}
            className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors
              ${selected?.kind === 'audit' ? 'bg-signal-soft text-signal' : 'text-ink-dim hover:bg-raised hover:text-ink'}`}
          >
            <Shield size={14} className="shrink-0" />
            <span>Auditoria</span>
          </button>
        </div>
      </Card>

      <div>
        {selected?.kind === 'audit' ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-display font-semibold text-ink">Trilha de auditoria</h2>
            </div>
            <AuditView />
          </>
        ) : selected ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-display font-semibold text-ink">{selected.name}</h2>
              <StatusDot status={selected.status} />
            </div>
            <LogViewer lines={lines} height="h-[calc(100vh-14rem)]" />
          </>
        ) : (
          <Card className="text-center py-16 text-ink-faint text-sm">
            Nenhum serviço ou banco de dados cadastrado ainda.
          </Card>
        )}
      </div>
    </div>
  );
}