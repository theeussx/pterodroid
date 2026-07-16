import { useEffect, useState } from 'react';
import { Play, Square, RotateCw } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import StatusDot from './StatusDot';
import LogViewer from './LogViewer';
import { api } from '../lib/api';
import { useLiveLogs } from '../lib/hooks';
import { useToast } from '../stores/ToastContext';

export default function DatabaseDetailModal({ open, onClose, instanceId, onChanged }) {
  const [inst, setInst] = useState(null);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();
  const { lines, seedOnce } = useLiveLogs('db', instanceId);

  useEffect(() => {
    if (!open || !instanceId) return;
    api.getDatabase(instanceId)
      .then((data) => { setInst(data); seedOnce(data.recentLogs || []); })
      .catch((e) => notify(e.message, 'error'));
  }, [open, instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn, label) => {
    setBusy(true);
    try {
      await fn(instanceId);
      notify(label, 'success');
      setInst(await api.getDatabase(instanceId));
      onChanged?.();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!inst) {
    return (
      <Modal open={open} onClose={onClose} title="Carregando..." size="xl">
        <div className="h-40 flex items-center justify-center text-ink-faint text-sm">Carregando...</div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={inst.name} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <StatusDot status={inst.status} />
            {inst.pid && <span className="text-xs font-mono text-ink-faint">pid {inst.pid}</span>}
          </div>
          <div className="flex gap-2">
            {inst.status === 'running' ? (
              <Button size="sm" variant="secondary" onClick={() => act(api.stopDatabase, 'Instância parada')} loading={busy}>
                <Square size={14} /> Parar
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => act(api.startDatabase, 'Instância iniciada')} loading={busy}>
                <Play size={14} /> {inst.provisioned ? 'Iniciar' : 'Provisionar e iniciar'}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => act(api.restartDatabase, 'Instância reiniciada')} loading={busy}>
              <RotateCw size={14} /> Reiniciar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-raised rounded-lg p-3">
            <p className="text-ink-faint mb-1">Motor</p>
            <p className="text-ink font-mono">{inst.type}</p>
          </div>
          <div className="bg-raised rounded-lg p-3">
            <p className="text-ink-faint mb-1">Porta</p>
            <p className="text-ink font-mono">{inst.port}</p>
          </div>
          <div className="bg-raised rounded-lg p-3">
            <p className="text-ink-faint mb-1">Usuário</p>
            <p className="text-ink font-mono">{inst.db_username}</p>
          </div>
          <div className="bg-raised rounded-lg p-3">
            <p className="text-ink-faint mb-1">Provisionado</p>
            <p className="text-ink">{inst.provisioned ? 'Sim' : 'Ainda não'}</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {inst.data_directory && (
            <div className="bg-raised rounded-lg p-3 text-xs">
              <p className="text-ink-faint mb-1">Diretório de dados</p>
              <p className="text-ink font-mono break-all">{inst.data_directory}</p>
            </div>
          )}
        </div>

        <LogViewer lines={lines} />
      </div>
    </Modal>
  );
}
