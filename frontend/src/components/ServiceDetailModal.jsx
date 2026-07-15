import { useEffect, useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import StatusDot from './StatusDot';
import LogViewer from './LogViewer';
import { api } from '../lib/api';
import { useLiveLogs } from '../lib/hooks';
import { useToast } from '../stores/ToastContext';
import { Play, Square, RotateCw } from 'lucide-react';

export default function ServiceDetailModal({ open, onClose, serviceId, onChanged }) {
  const [service, setService] = useState(null);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();
  const { lines, seedOnce } = useLiveLogs('service', serviceId);

  useEffect(() => {
    if (!open || !serviceId) return;
    api.getService(serviceId)
      .then((data) => { setService(data); seedOnce(data.recentLogs || []); })
      .catch((e) => notify(e.message, 'error'));
  }, [open, serviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn, label) => {
    setBusy(true);
    try {
      await fn(serviceId);
      notify(label, 'success');
      const fresh = await api.getService(serviceId);
      setService(fresh);
      onChanged?.();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendInput = async (text) => {
    try {
      await api.sendServiceInput(serviceId, text);
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  if (!service) {
    return (
      <Modal open={open} onClose={onClose} title="Carregando..." size="xl">
        <div className="h-40 flex items-center justify-center text-ink-faint text-sm">Carregando...</div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={service.name} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <StatusDot status={service.status} />
            {service.runtime?.pid && <span className="text-xs font-mono text-ink-faint">pid {service.runtime.pid}</span>}
            {service.restart_count > 0 && (
              <span className="text-xs text-provisioning">{service.restart_count} reinício(s)</span>
            )}
          </div>
          <div className="flex gap-2">
            {service.status === 'running' ? (
              <Button size="sm" variant="secondary" onClick={() => act(api.stopService, 'Serviço parado')} loading={busy}>
                <Square size={14} /> Parar
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => act(api.startService, 'Serviço iniciado')} loading={busy}>
                <Play size={14} /> Iniciar
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => act(api.restartService, 'Serviço reiniciado')} loading={busy}>
              <RotateCw size={14} /> Reiniciar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-raised rounded-lg p-3">
            <p className="text-ink-faint mb-1">Tipo</p>
            <p className="text-ink font-mono">{service.type}</p>
          </div>
          <div className="bg-raised rounded-lg p-3">
            <p className="text-ink-faint mb-1">Auto-restart</p>
            <p className="text-ink">{service.auto_restart ? 'Ativado' : 'Desativado'}</p>
          </div>
          <div className="bg-raised rounded-lg p-3 col-span-2 sm:col-span-1">
            <p className="text-ink-faint mb-1">Comando</p>
            <p className="text-ink font-mono truncate" title={service.command}>{service.command}</p>
          </div>
          <div className="bg-raised rounded-lg p-3">
            <p className="text-ink-faint mb-1">Última inicialização</p>
            <p className="text-ink">{service.last_started ? new Date(service.last_started + 'Z').toLocaleString('pt-BR') : '—'}</p>
          </div>
          {service.port && (
            <div className="bg-raised rounded-lg p-3">
              <p className="text-ink-faint mb-1">Porta Local</p>
              <p className="text-ink font-mono">{service.port}</p>
            </div>
          )}
          {service.public_url && (
            <div className="bg-signal-soft rounded-lg p-3 col-span-2">
              <p className="text-signal mb-1 font-semibold">URL Pública (Cloudflare)</p>
              <a href={service.public_url} target="_blank" rel="noreferrer" className="text-signal underline break-all font-mono">
                {service.public_url}
              </a>
            </div>
          )}
        </div>

        <LogViewer lines={lines} onSendInput={service.status === 'running' ? sendInput : undefined} />
      </div>
    </Modal>
  );
}
