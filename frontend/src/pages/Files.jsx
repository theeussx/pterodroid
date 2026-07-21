import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FolderPlus, FilePlus, Upload, Search, X, Trash2, Copy, Move,
  Download, RefreshCw, ListChecks, History,
} from 'lucide-react';
import { api } from '../lib/api';
import Card from '../components/Card';
import Button from '../components/Button';
import ConfirmDialog from '../components/ConfirmDialog';
import Breadcrumbs from '../components/files/Breadcrumbs';
import FileRow from '../components/files/FileRow';
import FileEditor from '../components/files/FileEditor';
import NewItemModal from '../components/files/NewItemModal';
import MoveCopyModal from '../components/files/MoveCopyModal';
import UploadZone from '../components/files/UploadZone';
import { isEditable, joinPath, parentPath } from '../components/files/fileUtils';
import { useToast } from '../stores/ToastContext';

const SORTERS = {
  name: (a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1),
  size: (a, b) => (a.type === b.type ? b.size - a.size : a.type === 'dir' ? -1 : 1),
  date: (a, b) => (a.type === b.type ? b.mtime - a.mtime : a.type === 'dir' ? -1 : 1),
  type: (a, b) => (a.type === b.type ? (a.ext || '').localeCompare(b.ext || '') : a.type === 'dir' ? -1 : 1),
};

export default function Files() {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('name');
  const [selected, setSelected] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [editingPath, setEditingPath] = useState(null);
  const [newItemKind, setNewItemKind] = useState(null); // 'file' | 'dir' | null
  const [moveMode, setMoveMode] = useState(null); // 'move' | 'copy' | null
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [showAudit, setShowAudit] = useState(false);
  const [audit, setAudit] = useState([]);
  const { notify } = useToast();

  const load = useCallback((p = path) => {
    setLoading(true);
    api.listFiles(p)
      .then((r) => setEntries(r.entries))
      .catch((e) => notify(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(path); setSelected(new Set()); setSelectionMode(false); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedEntries = useMemo(() => [...entries].sort(SORTERS[sortBy]), [entries, sortBy]);

  const openEntry = (entry) => {
    const full = joinPath(path, entry.name);
    if (entry.type === 'dir') { setPath(full); return; }
    if (isEditable(entry.ext)) { setEditingPath(full); return; }
    api.downloadFile(full, entry.name).catch((e) => notify(e.message, 'error'));
  };

  const toggleSelect = (entry) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(entry.name) ? next.delete(entry.name) : next.add(entry.name);
      return next;
    });
  };

  const startSelection = (entry) => {
    setSelectionMode(true);
    setSelected(new Set([entry.name]));
  };

  const clearSelection = () => { setSelected(new Set()); setSelectionMode(false); };

  const selectedPaths = () => [...selected].map((name) => joinPath(path, name));

  const handleCreate = async (kind, name) => {
    try {
      if (kind === 'dir') await api.mkdir(path, name);
      else await api.touchFile(path, name);
      load();
    } catch (e) {
      notify(e.message, 'error');
      throw e;
    }
  };

  const handleDelete = async () => {
    try {
      const res = await api.deleteFiles(selectedPaths());
      notify(`${res.deleted} item(ns) removido(s)`, res.errors.length ? 'error' : 'success');
      clearSelection();
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setDeleteConfirm(false);
    }
  };

  const handleMoveOrCopy = async (destDir) => {
    const fn = moveMode === 'move' ? api.moveFile : api.copyFile;
    try {
      for (const source of selectedPaths()) {
        await fn(source, destDir);
      }
      notify(moveMode === 'move' ? 'Movido' : 'Copiado', 'success');
      clearSelection();
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const handleDownloadSelected = async () => {
    for (const name of selected) {
      const entry = entries.find((e) => e.name === name);
      if (entry && entry.type === 'file') {
        await api.downloadFile(joinPath(path, name), name).catch((e) => notify(e.message, 'error'));
      }
    }
  };

  const runSearch = async (q) => {
    setSearchQuery(q);
    if (q.trim().length < 2) { setSearchResults(null); return; }
    try {
      const r = await api.searchFiles(path, q.trim());
      setSearchResults(r.results);
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const openAudit = () => {
    setShowAudit(true);
    api.filesAudit(30).then(setAudit).catch(() => {});
  };

  const displayEntries = searchResults !== null ? searchResults : sortedEntries;

  return (
    <UploadZone path={path} onUploaded={load}>
      {({ openPicker }) => (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Breadcrumbs path={path} onNavigate={(p) => { setPath(p); setSearchResults(null); setSearchQuery(''); }} />
            <div className="flex items-center gap-1.5">
              <button onClick={openAudit} className="p-2 text-ink-faint hover:text-ink transition-colors" title="Atividade recente">
                <History size={17} />
              </button>
              <button onClick={() => load()} className="p-2 text-ink-faint hover:text-ink transition-colors" title="Atualizar">
                <RefreshCw size={17} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[140px]">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                value={searchQuery}
                onChange={(e) => runSearch(e.target.value)}
                placeholder="Buscar arquivos..."
                className="w-full bg-raised border border-line rounded-lg pl-8 pr-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-signal focus:outline-none"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchResults(null); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">
                  <X size={14} />
                </button>
              )}
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-raised border border-line rounded-lg px-2.5 py-2 text-xs text-ink-dim focus:outline-none focus:border-signal"
            >
              <option value="name">Nome</option>
              <option value="size">Tamanho</option>
              <option value="date">Data</option>
              <option value="type">Tipo</option>
            </select>
            <Button variant="secondary" size="sm" onClick={() => setNewItemKind('dir')}>
              <FolderPlus size={15} /> <span className="hidden sm:inline">Pasta</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setNewItemKind('file')}>
              <FilePlus size={15} /> <span className="hidden sm:inline">Arquivo</span>
            </Button>
            <Button variant="primary" size="sm" onClick={openPicker}>
              <Upload size={15} /> <span className="hidden sm:inline">Enviar</span>
            </Button>
          </div>

          {selectionMode && (
            <div className="flex items-center justify-between gap-2 bg-signal-soft border border-signal/30 rounded-lg px-3 py-2">
              <span className="text-xs text-signal font-medium">{selected.size} selecionado(s)</span>
              <div className="flex items-center gap-1">
                <button onClick={handleDownloadSelected} className="p-1.5 text-ink-dim hover:text-ink" title="Baixar"><Download size={15} /></button>
                <button onClick={() => setMoveMode('copy')} className="p-1.5 text-ink-dim hover:text-ink" title="Copiar"><Copy size={15} /></button>
                <button onClick={() => setMoveMode('move')} className="p-1.5 text-ink-dim hover:text-ink" title="Mover"><Move size={15} /></button>
                <button onClick={() => setDeleteConfirm(true)} className="p-1.5 text-error hover:text-error/80" title="Excluir"><Trash2 size={15} /></button>
                <button onClick={clearSelection} className="p-1.5 text-ink-faint hover:text-ink ml-1" title="Cancelar"><X size={15} /></button>
              </div>
            </div>
          )}

          <Card padded={false}>
            {!selectionMode && entries.length > 0 && !searchResults && (
              <button
                onClick={() => setSelectionMode(true)}
                className="flex items-center gap-2 px-3 pt-3 text-xs text-ink-faint hover:text-ink transition-colors"
              >
                <ListChecks size={13} /> selecionar
              </button>
            )}
            <div className="p-2">
              {loading && <p className="text-sm text-ink-faint text-center py-8">Carregando...</p>}
              {!loading && displayEntries.length === 0 && (
                <p className="text-sm text-ink-faint text-center py-8">
                  {searchResults !== null ? 'Nenhum resultado.' : 'Pasta vazia.'}
                </p>
              )}
              {!loading && displayEntries.map((entry) => (
                <FileRow
                  key={entry.path || entry.name}
                  entry={entry}
                  selected={selected.has(entry.name)}
                  selectionMode={selectionMode}
                  onOpen={searchResults !== null
                    ? () => { setPath(parentPath(entry.path)); setSearchResults(null); setSearchQuery(''); }
                    : openEntry}
                  onToggleSelect={toggleSelect}
                  onLongPress={startSelection}
                />
              ))}
            </div>
          </Card>
        </div>
      )}

      {newItemKind && (
        <NewItemModal
          open={!!newItemKind}
          kind={newItemKind}
          onClose={() => setNewItemKind(null)}
          onCreate={(name) => handleCreate(newItemKind, name)}
        />
      )}

      {editingPath && (
        <FileEditor path={editingPath} onClose={() => setEditingPath(null)} onSaved={load} />
      )}

      <MoveCopyModal
        open={!!moveMode}
        mode={moveMode}
        itemCount={selected.size}
        onClose={() => setMoveMode(null)}
        onConfirm={handleMoveOrCopy}
      />

      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Excluir itens"
        message={`Excluir ${selected.size} item(ns) selecionado(s)? Pastas são removidas com todo o conteúdo. Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir"
      />

      {showAudit && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-void/80" onClick={() => setShowAudit(false)} />
          <div className="relative w-full sm:max-w-lg bg-surface border border-line rounded-t-2xl sm:rounded-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <h2 className="font-display font-semibold text-ink">Atividade recente</h2>
              <button onClick={() => setShowAudit(false)} className="text-ink-faint hover:text-ink"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto divide-y divide-line-soft">
              {audit.length === 0 && <p className="text-sm text-ink-faint p-4">Nada ainda.</p>}
              {audit.map((a) => (
                <div key={a.id} className="px-5 py-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-signal font-medium uppercase">{a.action}</span>
                    <span className="text-ink-faint font-mono">{new Date(a.timestamp + 'Z').toLocaleString('pt-BR')}</span>
                  </div>
                  <p className="text-ink-dim font-mono truncate mt-0.5">{a.target} {a.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </UploadZone>
  );
}
