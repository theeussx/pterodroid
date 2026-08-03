import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, Play, Square, RotateCw, Trash2, Pencil, Terminal, Container } from 'lucide-react';
import { api } from '../lib/api';
import { useServiceStatusEvents } from '../lib/hooks';
import Card from '../components/Card';
import Button from '../components/Button';
import StatusDot from '../components/StatusDot';
import ServiceFormModal from '../components/ServiceFormModal';
import ServiceDetailModal from '../components/ServiceDetailModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../stores/ToastContext';

export default function Services() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const { notify } = useToast();
  const reloadTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listServices();
      setServices(data);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  /**
   * Um serviço que reinicia dispara vários eventos de status em sequência
   * (stopped → running → ...). Recarregar a lista inteira em cada um deles
   * gerava uma rajada de requisições idênticas; agrupar em 250ms mantém a
   * tela igualmente reativa com uma chamada só.
   */
  useEffect(() => () => clearTimeout(reloadTimer.current), []);
  useServiceStatusEvents(useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(load, 250);
  }, [load]));

  const handleSubmit = async (payload) => {
    if (editing) {
      await api.updateService(editing.id, payload);
      notify('Serviço atualizado', 'success');
    } else {
      await api.createService(payload);
      notify('Serviço criado', 'success');
    }
    load();
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

  const openDelete = (service) => {
    setDeleteTarget(service);
    setDeleteFiles(false); // sempre reinicia desmarcado: apagar arquivos é opt-in consciente
  };

  const handleDelete = async () => {
    setBusyId(deleteTarget.id);
    try {
      const result = await api.deleteService(deleteTarget.id, deleteFiles);
      notify(result?.filesRemoved ? 'Serviço e arquivos removidos' : 'Serviço removido', 'success');
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
        <p className="text-sm text-ink-dim">{services.length} serviço(s) cadastrado(s)</p>
        <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus size={16} /> Novo serviço
        </Button>
      </div>

      {!loading && services.length === 0 && (
        <Card className="text-center py-12">
          <Terminal size={28} className="mx-auto text-ink-faint mb-3" />
          <p className="text-ink-dim text-sm mb-4">Nenhum serviço cadastrado ainda.</p>
          <Button variant="primary" onClick={() => setFormOpen(true)} className="mx-auto">
            <Plus size={16} /> Criar primeiro serviço
          </Button>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {services.map((s) => (
          <Card key={s.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => setDetailId(s.id)} className="text-left min-w-0 group">
                <p className="font-medium text-ink truncate group-hover:text-signal transition-colors">{s.name}</p>
                <p className="text-xs text-ink-faint font-mono truncate">{s.runtime_type === 'docker' ? s.image : s.command}</p>
              </button>
              <StatusDot status={s.status} showLabel={false} />
            </div>

            {s.description && <p className="text-xs text-ink-dim line-clamp-2">{s.description}</p>}

            {s.setup_status && s.setup_status !== 'Concluído' && (
              <div className={`text-[10px] px-2 py-1 rounded border truncate font-mono ${
                s.setup_status === 'Falhou' ? 'bg-error-soft text-error border-error/20' : 'bg-running/10 text-running border-running/20'
              }`}>
                Setup: {s.setup_status} {typeof s.setup_progress === 'number' ? `(${s.setup_progress}%)` : ''}
              </div>
            )}

            {s.public_url && (
              <div className="text-[10px] bg-signal-soft text-signal px-2 py-1 rounded border border-signal/20 truncate font-mono">
                {s.public_url}
              </div>
            )}

            <div className="flex items-center justify-between mt-auto pt-2 border-t border-line-soft">
              <div className="flex items-center gap-2">
                {s.runtime_type === 'docker' ? (
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint font-mono flex items-center gap-1">
                    <Container size={10} /> container
                  </span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint font-mono">{s.type}</span>
                )}
                {s.port && <span className="text-[10px] text-ink-faint font-mono">:{s.port}</span>}
              </div>
              <div className="flex gap-1">
                {s.status === 'running' ? (
                  <button disabled={busyId === s.id} onClick={() => handleAction(s.id, api.stopService, 'Parado')} className="p-1.5 text-ink-faint hover:text-error transition-colors disabled:opacity-40" title="Parar">
                    <Square size={14} />
                  </button>
                ) : (
                  <button disabled={busyId === s.id} onClick={() => handleAction(s.id, api.startService, 'Iniciado')} className="p-1.5 text-ink-faint hover:text-running transition-colors disabled:opacity-40" title="Iniciar">
                    <Play size={14} />
                  </button>
                )}
                <button disabled={busyId === s.id} onClick={() => handleAction(s.id, api.restartService, 'Reiniciado')} className="p-1.5 text-ink-faint hover:text-signal transition-colors disabled:opacity-40" title="Reiniciar">
                  <RotateCw size={14} />
                </button>
                <button onClick={() => { setEditing(s); setFormOpen(true); }} className="p-1.5 text-ink-faint hover:text-ink transition-colors" title="Editar">
                  <Pencil size={14} />
                </button>
                <button disabled={busyId === s.id} onClick={() => openDelete(s)} className="p-1.5 text-ink-faint hover:text-error transition-colors disabled:opacity-40" title="Remover">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <ServiceFormModal open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} initial={editing} />

      <ServiceDetailModal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        serviceId={detailId}
        onChanged={load}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Remover serviço"
        message={`Tem certeza que deseja remover "${deleteTarget?.name}"? O ${deleteTarget?.runtime_type === 'docker' ? 'container' : 'processo'} será parado e o histórico de logs apagado.`}
        confirmLabel="Remover"
        loading={busyId === deleteTarget?.id}
      >
        <label className="flex items-start gap-2.5 mt-3 p-3 rounded-lg bg-raised border border-line cursor-pointer">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="mt-0.5 accent-error"
          />
          <span className="text-xs text-ink-dim">
            Apagar também os arquivos do serviço
            {deleteTarget?.working_directory && (
              <span className="block font-mono text-[10px] text-ink-faint truncate mt-0.5">
                {deleteTarget.working_directory}
              </span>
            )}
            <span className="block text-error/80 mt-1">Essa ação não pode ser desfeita.</span>
          </span>
        </label>
      </ConfirmDialog>
    </div>
  );
}
