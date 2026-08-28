import { useEffect, useState } from 'react';
import { Thermometer, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useSystemSnapshot } from '../lib/hooks';
import { api } from '../lib/api';
import Card from '../components/Card';
import HistoryChart from '../components/HistoryChart';
import { useToast } from '../stores/ToastContext';

function formatBytes(bytes) {
  if (!bytes) return '0 GB';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function formatRate(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec < 1024) return `${(bytesPerSec || 0).toFixed(0)} B/s`;
  const kb = bytesPerSec / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB/s` : `${kb.toFixed(0)} KB/s`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

export default function Monitoring() {
  const { snapshot, history } = useSystemSnapshot();
  const [processes, setProcesses] = useState([]);
  const { notify } = useToast();

  useEffect(() => {
    const load = () => api.processes().then(setProcesses).catch((e) => notify(e.message, 'error'));
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs text-ink-faint mb-1">Uptime do sistema</p>
          <p className="font-display font-semibold text-xl text-ink font-mono">
            {snapshot ? formatUptime(snapshot.uptime) : '--'}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-ink-faint mb-1">Memória</p>
          <p className="font-display font-semibold text-xl text-ink font-mono">
            {snapshot ? `${formatBytes(snapshot.mem.used)} / ${formatBytes(snapshot.mem.total)}` : '--'}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-ink-faint mb-1">Armazenamento</p>
          <p className="font-display font-semibold text-xl text-ink font-mono">
            {snapshot ? `${formatBytes(snapshot.disk.used)} / ${formatBytes(snapshot.disk.total)}` : '--'}
          </p>
        </Card>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="flex items-center gap-3">
          <ArrowDownToLine size={18} className="text-signal shrink-0" />
          <div>
            <p className="text-xs text-ink-faint">Download</p>
            <p className="font-mono text-sm text-ink">{snapshot ? formatRate(snapshot.net.rxBytesPerSec) : '--'}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3">
          <ArrowUpFromLine size={18} className="text-signal shrink-0" />
          <div>
            <p className="text-xs text-ink-faint">Upload</p>
            <p className="font-mono text-sm text-ink">{snapshot ? formatRate(snapshot.net.txBytesPerSec) : '--'}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3">
          <Thermometer size={18} className={snapshot?.temp != null ? 'text-provisioning shrink-0' : 'text-ink-faint shrink-0'} />
          <div>
            <p className="text-xs text-ink-faint">Temperatura</p>
            <p className="font-mono text-sm text-ink">{snapshot?.temp != null ? `${snapshot.temp.toFixed(0)}°C` : 'indisponível'}</p>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <HistoryChart data={history} accessor={(d) => d.cpu} color="#3DDC84" label="CPU" />
        </Card>
        <Card>
          <HistoryChart data={history} accessor={(d) => d.mem.percent} color="#7C8CFF" label="Memória" />
        </Card>
        <Card>
          <HistoryChart data={history} accessor={(d) => d.net.rxBytesPerSec / 1024} color="#3DDC84" label="Download" unit=" KB/s" max={100} />
        </Card>
        <Card>
          <HistoryChart data={history} accessor={(d) => d.net.txBytesPerSec / 1024} color="#7C8CFF" label="Upload" unit=" KB/s" max={100} />
        </Card>
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5 pb-3">
          <h2 className="font-display font-semibold text-sm text-ink">Processos ativos (top 20 por CPU)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-faint border-y border-line-soft">
                <th className="px-5 py-2 font-medium">PID</th>
                <th className="px-5 py-2 font-medium">Processo</th>
                <th className="px-5 py-2 font-medium text-right">CPU %</th>
                <th className="px-5 py-2 font-medium text-right">MEM %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {processes.map((p) => (
                <tr key={p.pid}>
                  <td className="px-5 py-2 font-mono text-ink-faint">{p.pid}</td>
                  <td className="px-5 py-2 text-ink truncate max-w-xs font-mono">{p.name}</td>
                  <td className="px-5 py-2 text-right font-mono text-ink-dim tabular-nums">{p.cpu.toFixed(1)}</td>
                  <td className="px-5 py-2 text-right font-mono text-ink-dim tabular-nums">{p.mem.toFixed(1)}</td>
                </tr>
              ))}
              {processes.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-6 text-center text-ink-faint">Sem dados de processos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
