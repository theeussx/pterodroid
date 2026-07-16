import { useEffect, useState, useCallback } from 'react';
import { Plus, Play, Square, RotateCw, Trash2, Database as DatabaseIcon } from 'lucide-react';
import { api } from '../lib/api';
import { useDbStatusEvents } from '../lib/hooks';
import Card from '../components/Card';
import Button from '../components/Button';
import StatusDot from '../components/StatusDot';
import DatabaseFormModal from '../components/DatabaseFormModal';
import DatabaseDetailModal from '../components/DatabaseDetailModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../stores/ToastContext';

export default function Databases() {
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const { notify } = useToast();

  const load = useCallback(async () => {
    try {
      setInstances(await api.listDatabases());
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);
  useDbStatusEvents(useCallback(() => load(), [load]));

  const handleCreate = async (payload) => {
    const created = await api.createDatabase(payload);
    notify('Instância criada — inicie para provisionar', 'success');
    load();
    return created;
  };

  const handleAction = async (id, fn, label) => {
    setBusyId(id);
    try {
      await fn(id);
      notify(label, 'success');
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    setBusyId(deleteTarget.id);
    try {
      await api.deleteDatabase(deleteTarget.id);
      notify('Instância removida (dados no disco preservados)', 'success');
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-dim">{instances.length} instância(s)</p>
        <Button variant="primary" onClick={() => setFormOpen(true)}>
          <Plus size={16} /> Nova instância
        </Button>
      </div>

      {!loading && instances.length === 0 && (
        <Card className="text-center py-12">
          <DatabaseIcon size={28} className="mx-auto text-ink-faint mb-3" />
          <p className="text-ink-dim text-sm mb-4">Nenhuma instância de banco cadastrada ainda.</p>
          <Button variant="primary" onClick={() => setFormOpen(true)} className="mx-auto">
            <Plus size={16} /> Criar primeira instância
          </Button>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {instances.map((d) => (
          <Card key={d.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => setDetailId(d.id)} className="text-left min-w-0 group">
                <p className="font-medium text-ink truncate group-hover:text-signal transition-colors">{d.name}</p>
                <p className="text-xs text-ink-faint font-mono">{d.type} · porta {d.port}</p>
              </button>
              <StatusDot status={d.status} showLabel={false} />
            </div>

            <div className="flex items-center justify-between mt-auto pt-2 border-t border-line-soft">
              <span className="text-[10px] uppercase tracking-wide text-ink-faint font-mono">
                {d.provisioned ? 'provisionado' : 'não provisionado'}
              </span>
              <div className="flex gap-1">
                {d.status === 'running' ? (
                  <button disabled={busyId === d.id} onClick={() => handleAction(d.id, api.stopDatabase, 'Parada')} className="p-1.5 text-ink-faint hover:text-error transition-colors disabled:opacity-40" title="Parar">
                    <Square size={14} />
                  </button>
                ) : (
                  <button disabled={busyId === d.id} onClick={() => handleAction(d.id, api.startDatabase, 'Iniciada')} className="p-1.5 text-ink-faint hover:text-running transition-colors disabled:opacity-40" title="Iniciar">
                    <Play size={14} />
                  </button>
                )}
                <button disabled={busyId === d.id} onClick={() => handleAction(d.id, api.restartDatabase, 'Reiniciada')} className="p-1.5 text-ink-faint hover:text-signal transition-colors disabled:opacity-40" title="Reiniciar">
                  <RotateCw size={14} />
                </button>
                <button disabled={busyId === d.id} onClick={() => setDeleteTarget(d)} className="p-1.5 text-ink-faint hover:text-error transition-colors disabled:opacity-40" title="Remover">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <DatabaseFormModal open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleCreate} />

      <DatabaseDetailModal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        instanceId={detailId}
        onChanged={load}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Remover instância"
        message={`Remover "${deleteTarget?.name}"? O processo será parado. Os arquivos de dados NÃO são apagados automaticamente.`}
        confirmLabel="Remover"
        loading={busyId === deleteTarget?.id}
      />
    </div>
  );
}
