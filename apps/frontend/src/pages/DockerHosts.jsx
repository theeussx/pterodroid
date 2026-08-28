import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Wifi, WifiOff, RefreshCw, Container } from 'lucide-react';
import { api } from '../lib/api';
import Card from '../components/Card';
import Button from '../components/Button';
import DockerHostFormModal from '../components/DockerHostFormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../stores/ToastContext';

export default function DockerHosts() {
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [pinging, setPinging] = useState(null);
  const [pingResults, setPingResults] = useState({});
  const [busyId, setBusyId] = useState(null);
  const { notify } = useToast();

  const load = useCallback(async () => {
    try {
      setHosts(await api.listDockerHosts());
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (payload) => {
    await api.createDockerHost(payload);
    notify('Host adicionado', 'success');
    load();
  };

  const handlePing = async (id) => {
    setPinging(id);
    try {
      const result = await api.pingDockerHost(id);
      setPingResults((r) => ({ ...r, [id]: result }));
      if (!result.ok) notify(result.error, 'error');
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setPinging(null);
    }
  };

  const handleDelete = async () => {
    setBusyId(deleteTarget.id);
    try {
      await api.deleteDockerHost(deleteTarget.id);
      notify('Host removido', 'success');
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
        <p className="text-sm text-ink-dim">{hosts.length} host(s) cadastrado(s)</p>
        <Button variant="primary" onClick={() => setFormOpen(true)}>
          <Plus size={16} /> Adicionar host
        </Button>
      </div>

      {!loading && hosts.length === 0 && (
        <Card className="text-center py-12">
          <Container size={28} className="mx-auto text-ink-faint mb-3" />
          <p className="text-ink-dim text-sm mb-1">Nenhum host Docker cadastrado ainda.</p>
          <p className="text-ink-faint text-xs mb-4 max-w-sm mx-auto">
            Um host é qualquer máquina com Docker Engine — pode ser uma VPS, um Raspberry Pi, um Mini PC,
            um NAS, Windows com Docker Desktop, ou este próprio dispositivo, se tiver Docker.
          </p>
          <Button variant="primary" onClick={() => setFormOpen(true)} className="mx-auto">
            <Plus size={16} /> Adicionar primeiro host
          </Button>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {hosts.map((h) => {
          const result = pingResults[h.id];
          const ok = result ? result.ok : (h.last_ping_ok === 1 ? true : h.last_ping_ok === 0 ? false : null);
          return (
            <Card key={h.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink truncate">{h.name}</p>
                  <p className="text-xs text-ink-faint font-mono truncate">{h.connection}</p>
                </div>
                {ok === true && <span title="Conectado" className="text-running shrink-0"><Wifi size={16} /></span>}
                {ok === false && <span title="Sem conexão" className="text-error shrink-0"><WifiOff size={16} /></span>}
              </div>

              {result?.ok && result.info?.Version && (
                <p className="text-xs text-ink-faint">Docker Engine {result.info.Version}</p>
              )}
              {result && !result.ok && (
                <p className="text-xs text-error line-clamp-2">{result.error}</p>
              )}
              {h.last_ping_at && !result && (
                <p className="text-xs text-ink-faint">
                  Último teste: {new Date(h.last_ping_at + 'Z').toLocaleString('pt-BR')}
                </p>
              )}

              <div className="flex items-center justify-between mt-auto pt-2 border-t border-line-soft">
                <Button size="sm" variant="secondary" onClick={() => handlePing(h.id)} loading={pinging === h.id}>
                  <RefreshCw size={13} /> Testar conexão
                </Button>
                <button
                  disabled={busyId === h.id}
                  onClick={() => setDeleteTarget(h)}
                  className="p-1.5 text-ink-faint hover:text-error transition-colors disabled:opacity-40"
                  title="Remover"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      <DockerHostFormModal open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleAdd} />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Remover host Docker"
        message={`Tem certeza que deseja remover "${deleteTarget?.name}"? Serviços em container que apontam pra esse host vão parar de funcionar pelo painel — os containers continuam existindo lá, só a referência é removida.`}
        confirmLabel="Remover"
        loading={busyId === deleteTarget?.id}
      />
    </div>
  );
}
