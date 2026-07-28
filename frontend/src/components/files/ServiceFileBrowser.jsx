import { useState, useEffect, useCallback, useMemo } from 'react';
import { FolderPlus, FilePlus, Upload, Trash2, Download, RefreshCw, ListChecks, X } from 'lucide-react';
import { api } from '../../lib/api';
import Card from '../Card';
import Button from '../Button';
import ConfirmDialog from '../ConfirmDialog';
import Breadcrumbs from './Breadcrumbs';
import FileRow from './FileRow';
import FileEditor from './FileEditor';
import NewItemModal from './NewItemModal';
import UploadZone from './UploadZone';
import { isEditable, joinPath } from './fileUtils';
import { useToast } from '../../stores/ToastContext';

const SORTERS = {
  name: (a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1),
};

/**
 * Mesma ideia do Files.jsx global, só que escopado a UM serviço (processo
 * local: dentro do working_directory; container: dentro do filesystem
 * dele) e mais compacto — cabe numa aba do modal de detalhe. Sem
 * mover/copiar/buscar nessa primeira versão (o container não suporta
 * ainda; fica pra depois, igual pros dois tipos por consistência).
 */
export default function ServiceFileBrowser({ serviceId, initialPath = '/' }) {
  const [path, setPath] = useState(initialPath);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [editingPath, setEditingPath] = useState(null);
  const [newItemKind, setNewItemKind] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const { notify } = useToast();

  const readFn = useCallback((p) => api.readServiceFile(serviceId, p), [serviceId]);
  const writeFn = useCallback((p, content) => api.writeServiceFile(serviceId, p, content), [serviceId]);
  const uploadFn = useCallback((dir, files, onProgress) => api.uploadServiceFiles(serviceId, dir, files, onProgress), [serviceId]);

  const load = useCallback((p = path) => {
    setLoading(true);
    setError('');
    api.listServiceFiles(serviceId, p)
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [serviceId, path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(path); setSelected(new Set()); setSelectionMode(false); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedEntries = useMemo(() => [...entries].sort(SORTERS.name), [entries]);

  const openEntry = (entry) => {
    const full = joinPath(path, entry.name);
    if (entry.type === 'dir') { setPath(full); return; }
    if (isEditable(entry.ext)) { setEditingPath(full); return; }
    api.downloadServiceFile(serviceId, full, entry.name).catch((e) => notify(e.message, 'error'));
  };

  const toggleSelect = (entry) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(entry.name) ? next.delete(entry.name) : next.add(entry.name);
      return next;
    });
  };

  const startSelection = (entry) => { setSelectionMode(true); setSelected(new Set([entry.name])); };
  const clearSelection = () => { setSelected(new Set()); setSelectionMode(false); };
  const selectedPaths = () => [...selected].map((name) => joinPath(path, name));

  const handleCreate = async (kind, name) => {
    try {
      if (kind === 'dir') await api.mkdirService(serviceId, path, name);
      else await api.touchServiceFile(serviceId, path, name);
      load();
    } catch (e) {
      notify(e.message, 'error');
      throw e;
    }
  };

  const handleDelete = async () => {
    try {
      const res = await api.deleteServiceFiles(serviceId, selectedPaths());
      notify(`${res.deleted} item(ns) removido(s)`, res.errors.length ? 'error' : 'success');
      clearSelection();
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setDeleteConfirm(false);
    }
  };

  const handleDownloadSelected = async () => {
    for (const name of selected) {
      const entry = entries.find((e) => e.name === name);
      if (entry && entry.type === 'file') {
        await api.downloadServiceFile(serviceId, joinPath(path, name), name).catch((e) => notify(e.message, 'error'));
      }
    }
  };

  if (error) {
    return (
      <Card className="text-center py-8">
        <p className="text-sm text-error mb-1">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => load()} className="mx-auto mt-2">
          <RefreshCw size={14} /> Tentar de novo
        </Button>
      </Card>
    );
  }

  return (
    <UploadZone path={path} onUploaded={load} uploadFn={uploadFn}>
      {({ openPicker }) => (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Breadcrumbs path={path === '/' ? '' : path} onNavigate={(p) => setPath(p === '' ? '/' : p)} />
            <button onClick={() => load()} className="p-2 text-ink-faint hover:text-ink transition-colors shrink-0" title="Atualizar">
              <RefreshCw size={16} />
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={() => setNewItemKind('dir')}>
              <FolderPlus size={14} /> Pasta
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setNewItemKind('file')}>
              <FilePlus size={14} /> Arquivo
            </Button>
            <Button variant="primary" size="sm" onClick={openPicker}>
              <Upload size={14} /> Enviar
            </Button>
          </div>

          {selectionMode && (
            <div className="flex items-center justify-between gap-2 bg-signal-soft border border-signal/30 rounded-lg px-3 py-2">
              <span className="text-xs text-signal font-medium">{selected.size} selecionado(s)</span>
              <div className="flex items-center gap-1">
                <button onClick={handleDownloadSelected} className="p-1.5 text-ink-dim hover:text-ink" title="Baixar"><Download size={15} /></button>
                <button onClick={() => setDeleteConfirm(true)} className="p-1.5 text-error hover:text-error/80" title="Excluir"><Trash2 size={15} /></button>
                <button onClick={clearSelection} className="p-1.5 text-ink-faint hover:text-ink ml-1" title="Cancelar"><X size={15} /></button>
              </div>
            </div>
          )}

          <Card padded={false}>
            {!selectionMode && entries.length > 0 && (
              <button
                onClick={() => setSelectionMode(true)}
                className="flex items-center gap-2 px-3 pt-3 text-xs text-ink-faint hover:text-ink transition-colors"
              >
                <ListChecks size={13} /> selecionar
              </button>
            )}
            <div className="p-2 max-h-[50vh] overflow-y-auto">
              {loading && <p className="text-sm text-ink-faint text-center py-8">Carregando...</p>}
              {!loading && sortedEntries.length === 0 && (
                <p className="text-sm text-ink-faint text-center py-8">Pasta vazia.</p>
              )}
              {!loading && sortedEntries.map((entry) => (
                <FileRow
                  key={entry.name}
                  entry={entry}
                  selected={selected.has(entry.name)}
                  selectionMode={selectionMode}
                  onOpen={openEntry}
                  onToggleSelect={toggleSelect}
                  onLongPress={startSelection}
                />
              ))}
            </div>
          </Card>

          {newItemKind && (
            <NewItemModal
              open={!!newItemKind}
              kind={newItemKind}
              onClose={() => setNewItemKind(null)}
              onCreate={(name) => handleCreate(newItemKind, name)}
            />
          )}

          {editingPath && (
            <FileEditor path={editingPath} onClose={() => setEditingPath(null)} onSaved={load} readFn={readFn} writeFn={writeFn} />
          )}

          <ConfirmDialog
            open={deleteConfirm}
            onClose={() => setDeleteConfirm(false)}
            onConfirm={handleDelete}
            title="Excluir itens"
            message={`Excluir ${selected.size} item(ns) selecionado(s)? Pastas são removidas com todo o conteúdo. Essa ação não pode ser desfeita.`}
            confirmLabel="Excluir"
          />
        </div>
      )}
    </UploadZone>
  );
}
