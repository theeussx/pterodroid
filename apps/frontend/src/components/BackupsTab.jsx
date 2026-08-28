import { useEffect, useState, useCallback } from 'react';
import { Save, Download, RotateCcw, Trash2, Archive, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../stores/ToastContext';
import Button from './Button';
import { Input } from './Field';
import ConfirmDialog from './ConfirmDialog';
import { formatBytes, formatDate } from './files/fileUtils';

const STATUS_LABEL = {
  ready: { label: 'Pronto', className: 'text-running bg-running/10' },
  creating: { label: 'Criando...', className: 'text-signal bg-signal/10' },
  restoring: { label: 'Restaurando...', className: 'text-signal bg-signal/10' },
  failed: { label: 'Falhou', className: 'text-error bg-error/10' },
};

export default function BackupsTab({ serviceId }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { notify } = useToast();

  const load = useCallback(async () => {
    try {
      setList(await api.backups.list(serviceId));
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [serviceId, notify]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await api.backups.create(serviceId, name.trim() || undefined);
      setName('');
      notify('Backup criado', 'success');
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (b) => {
    setBusyId(b.id);
    try {
      await api.backups.download(serviceId, b.id, b.filename);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRestore = async () => {
    const b = restoreTarget;
    setBusyId(b.id);
    try {
      const result = await api.backups.restore(serviceId, b.id);
      notify(`Backup restaurado — ${result.extracted} arquivo(s) recuperado(s)`, 'success');
      setRestoreTarget(null);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    const b = deleteTarget;
    setBusyId(b.id);
    try {
      await api.backups.remove(serviceId, b.id);
      notify('Backup apagado', 'success');
      setDeleteTarget(null);
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do backup (opcional)"
          className="flex-1"
        />
        <Button variant="primary" onClick={handleCreate} loading={creating}>
          <Save size={15} /> Criar backup
        </Button>
      </div>

      {!loading && list.length === 0 && (
        <div className="text-center py-10">
          <Archive size={24} className="mx-auto text-ink-faint mb-2" />
          <p className="text-sm text-ink-dim">Nenhum backup ainda. Crie um antes de mexer em algo arriscado.</p>
        </div>
      )}

      <div className="space-y-2">
        {list.map((b) => {
          const status = STATUS_LABEL[b.status] || STATUS_LABEL.ready;
          const ready = b.status === 'ready';
          return (
            <div key={b.id} className="bg-raised rounded-lg p-3 flex items-center gap-3">
              <Archive size={16} className="text-ink-faint shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink truncate">{b.name}</p>
                <p className="text-xs text-ink-faint">
                  {formatDate(new Date(`${b.created_at}Z`).getTime())} · {formatBytes(b.size_bytes)}
                </p>
                {b.status === 'failed' && b.error && (
                  <p className="text-xs text-error mt-1">{b.error}</p>
                )}
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${status.className}`}>
                {status.label}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  disabled={!ready || busyId === b.id}
                  onClick={() => handleDownload(b)}
                  className="p-1.5 text-ink-faint hover:text-signal transition-colors disabled:opacity-30"
                  title="Baixar"
                >
                  <Download size={14} />
                </button>
                <button
                  disabled={!ready || busyId === b.id}
                  onClick={() => setRestoreTarget(b)}
                  className="p-1.5 text-ink-faint hover:text-signal transition-colors disabled:opacity-30"
                  title="Restaurar"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  disabled={busyId === b.id}
                  onClick={() => setDeleteTarget(b)}
                  className="p-1.5 text-ink-faint hover:text-error transition-colors disabled:opacity-30"
                  title="Apagar"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={handleRestore}
        title="Restaurar backup"
        confirmLabel="Restaurar"
        danger={false}
        loading={busyId === restoreTarget?.id}
        message={`Isso vai sobrescrever, com o conteúdo de "${restoreTarget?.name}", os arquivos que também existem no backup. Arquivos criados depois do backup e que não estão nele não serão apagados.`}
      >
        <div className="flex items-start gap-2 bg-signal/10 text-signal text-xs rounded-lg p-2.5 mt-3">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Considere criar um backup do estado atual antes de restaurar, caso precise voltar atrás.</span>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Apagar backup"
        confirmLabel="Apagar"
        loading={busyId === deleteTarget?.id}
        message={`Tem certeza que quer apagar o backup "${deleteTarget?.name}"? Essa ação não pode ser desfeita.`}
      />
    </div>
  );
}
