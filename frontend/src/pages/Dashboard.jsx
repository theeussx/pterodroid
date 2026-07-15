import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Server, Database, Cpu, HardDrive, MemoryStick, Clock, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { useSystemSnapshot, useServiceStatusEvents, useDbStatusEvents } from '../lib/hooks';
import Card from '../components/Card';
import StatusDot from '../components/StatusDot';
import { useToast } from '../stores/ToastContext';

function formatBytes(bytes) {
  if (!bytes) return '0 GB';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatCard({ icon: Icon, label, value, sub, accent = 'text-ink' }) {
  return (
    <Card className="flex items-center gap-4">
      <div className="w-11 h-11 rounded-lg bg-raised flex items-center justify-center shrink-0">
        <Icon size={20} className={accent} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-ink-faint">{label}</p>
        <p className="font-display font-semibold text-xl text-ink truncate">{value}</p>
        {sub && <p className="text-xs text-ink-dim truncate">{sub}</p>}
      </div>
    </Card>
  );
}

function UsageBar({ label, percent, detail }) {
  const color = percent > 85 ? 'bg-error' : percent > 65 ? 'bg-provisioning' : 'bg-running';
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-xs text-ink-dim">{label}</span>
        <span className="text-xs font-mono text-ink-dim">{detail}</span>
      </div>
      <div className="h-2 rounded-full bg-raised overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [overview, setOverview] = useState(null);
  const { snapshot } = useSystemSnapshot();
  const { notify } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await api.overview();
      setOverview(data);
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);
  useServiceStatusEvents(useCallback(() => load(), [load]));
  useDbStatusEvents(useCallback(() => load(), [load]));

  const live = snapshot || overview?.snapshot;

  if (!overview) {
    return <div className="text-ink-faint text-sm">Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Server}
          label="Serviços ativos"
          value={`${overview.services.running}/${overview.services.total}`}
          sub={overview.services.error > 0 ? `${overview.services.error} com erro` : 'tudo certo'}
          accent={overview.services.error > 0 ? 'text-error' : 'text-running'}
        />
        <StatCard
          icon={Database}
          label="Bancos ativos"
          value={`${overview.databases.running}/${overview.databases.total}`}
          accent="text-signal"
        />
        <StatCard
          icon={Cpu}
          label="CPU"
          value={live ? `${live.cpu.toFixed(0)}%` : '--'}
          accent="text-running"
        />
        <StatCard
          icon={Clock}
          label="Uptime do sistema"
          value={live ? formatUptime(live.uptime) : '--'}
          accent="text-ink-dim"
        />
      </div>

      <Card>
        <h2 className="font-display font-semibold text-sm text-ink mb-4">Recursos do dispositivo</h2>
        <div className="space-y-4">
          {live && (
            <>
              <UsageBar label="CPU" percent={live.cpu} detail={`${live.cpu.toFixed(1)}%`} />
              <UsageBar
                label="Memória"
                percent={live.mem.percent}
                detail={`${formatBytes(live.mem.used)} / ${formatBytes(live.mem.total)}`}
              />
              <UsageBar
                label="Armazenamento"
                percent={live.disk.percent}
                detail={`${formatBytes(live.disk.used)} / ${formatBytes(live.disk.total)}`}
              />
            </>
          )}
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card padded={false}>
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="font-display font-semibold text-sm text-ink">Serviços</h2>
            <Link to="/services" className="text-xs text-signal hover:underline flex items-center gap-1">
              ver todos <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-line-soft">
            {overview.services.list.length === 0 && (
              <p className="px-5 py-4 text-sm text-ink-faint">Nenhum serviço cadastrado ainda.</p>
            )}
            {overview.services.list.slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-ink truncate">{s.name}</span>
                <StatusDot status={s.status} />
              </div>
            ))}
          </div>
        </Card>

        <Card padded={false}>
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="font-display font-semibold text-sm text-ink">Bancos de dados</h2>
            <Link to="/databases" className="text-xs text-signal hover:underline flex items-center gap-1">
              ver todos <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-line-soft">
            {overview.databases.list.length === 0 && (
              <p className="px-5 py-4 text-sm text-ink-faint">Nenhuma instância cadastrada ainda.</p>
            )}
            {overview.databases.list.slice(0, 6).map((d) => (
              <div key={d.id} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-ink truncate">{d.name} <span className="text-ink-faint font-mono text-xs">({d.type})</span></span>
                <StatusDot status={d.status} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
