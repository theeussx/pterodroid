import { useState, useCallback } from 'react';
import {
  FolderPlus, FilePlus, Upload, Search, X, Trash2, Copy, Move,
  Download, RefreshCw, ListChecks, Pencil, CheckSquare, AlertCircle,
} from 'lucide-react';
import Card from '../Card';
import Button from '../Button';
import ConfirmDialog from '../ConfirmDialog';
import Modal from '../Modal';
import { Input } from '../Field';
import Breadcrumbs from './Breadcrumbs';
import FileRow from './FileRow';
import FileEditor from './FileEditor';
import NewItemModal from './NewItemModal';
import MoveCopyModal from './MoveCopyModal';
import UploadZone from './UploadZone';
import { isEditable } from './fileUtils';
import { useFileBrowser } from './useFileBrowser';
import { useToast } from '../../stores/ToastContext';

/**
 * Navegador de arquivos completo, usado tanto pela página global quanto
 * pela aba de arquivos de um serviço.
 *
 * Todo o comportamento vem do useFileBrowser; o que muda entre os dois
 * usos é só o `adapter` (quais funções de API chamar) e alguns enfeites
 * (altura, densidade). Antes eram dois componentes com recursos
 * diferentes — o do serviço não tinha copiar, mover, renomear nem buscar.
 */
export default function FileBrowser({
  adapter,
  initialPath = '',
  compact = false,
  listHeight = compact ? 'max-h-[50vh]' : '',
}) {
  const browser = useFileBrowser(adapter, { initialPath });
  const {
    path, setPath, entries, loading, error, busy,
    sortBy, setSortBy, selected, selectionMode, setSelectionMode,
    toggleSelect, startSelection, clearSelection, selectAll,
    selectedPaths, joinCurrent, load, run,
  } = browser;

  const [editingPath, setEditingPath] = useState(null);
  const [newItemKind, setNewItemKind] = useState(null);
  const [moveMode, setMoveMode] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const { notify } = useToast();

  const report = ({ ok, error: message }, successMessage) => {
    if (ok) { if (successMessage) notify(successMessage, 'success'); }
    else notify(message, 'error');
    return ok;
  };

  const openEntry = (entry) => {
    const full = joinCurrent(entry.name);
    if (entry.type === 'dir') { setPath(full); setSearchResults(null); setSearchQuery(''); return; }
    if (isEditable(entry.ext)) { setEditingPath(full); return; }
    adapter.download(full, entry.name).catch((e) => notify(e.message, 'error'));
  };

  const handleCreate = async (kind, name) => {
    const result = await run(() => (kind === 'dir' ? adapter.mkdir(path, name) : adapter.touch(path, name)));
    if (!result.ok) { notify(result.error, 'error'); throw new Error(result.error); }
  };

  const handleDelete = async () => {
    const targets = selectedPaths();
    const result = await run(() => adapter.remove(targets));
    setDeleteConfirm(false);
    if (!result.ok) return notify(result.error, 'error');
    const { deleted = targets.length, errors = [] } = result.result || {};
    notify(
      errors.length ? `${deleted} removido(s), ${errors.length} com erro` : `${deleted} item(ns) removido(s)`,
      errors.length ? 'error' : 'success',
    );
    clearSelection();
  };

  const handleMoveOrCopy = async (destDir) => {
    const action = moveMode === 'move' ? adapter.move : adapter.copy;
    const sources = selectedPaths();
    const failures = [];
    await run(async () => {
      for (const source of sources) {
        try {
          await action(source, destDir);
        } catch (e) {
          failures.push(`${source.split('/').pop()}: ${e.message}`);
        }
      }
    });
    if (failures.length) notify(failures[0], 'error');
    else notify(moveMode === 'move' ? 'Itens movidos' : 'Itens copiados', 'success');
    clearSelection();
    setMoveMode(null);
  };

  const handleRename = async (e) => {
    e?.preventDefault();
    if (!renameValue.trim() || !renaming) return;
    const ok = report(
      await run(() => adapter.rename(joinCurrent(renaming.name), renameValue.trim())),
      'Item renomeado',
    );
    if (ok) setRenaming(null);
  };

  const handleDownloadSelected = async () => {
    const files = entries.filter((e) => selected.has(e.name) && e.type === 'file');
    if (files.length === 0) return notify('Selecione ao menos um arquivo (pastas não podem ser baixadas)', 'error');
    for (const entry of files) {
      // Sequencial de propósito: disparar N downloads de uma vez faz o
      // navegador bloquear os seguintes como pop-up.
      await adapter.download(joinCurrent(entry.name), entry.name).catch((e) => notify(e.message, 'error'));
    }
  };

  const runSearch = useCallback(async (q) => {
    setSearchQuery(q);
    if (q.trim().length < 2) { setSearchResults(null); return; }
    try {
      const r = await adapter.search(path, q.trim());
      setSearchResults(r.results || []);
    } catch (e) {
      notify(e.message, 'error');
    }
  }, [adapter, path, notify]);

  const displayEntries = searchResults !== null ? searchResults : entries;
  const iconSize = compact ? 14 : 15;

  if (error) {
    return (
      <Card className="text-center py-8">
        <AlertCircle size={22} className="mx-auto text-error mb-2" />
        <p className="text-sm text-error mb-1">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => load()} className="mx-auto mt-2">
          <RefreshCw size={14} /> Tentar de novo
        </Button>
      </Card>
    );
  }

  return (
    <>
      <UploadZone path={path} onUploaded={() => load()} uploadFn={adapter.upload}>
        {({ openPicker }) => (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Breadcrumbs
                path={path}
                onNavigate={(p) => { setPath(p); setSearchResults(null); setSearchQuery(''); }}
              />
              <button
                onClick={() => load()}
                className="p-2 text-ink-faint hover:text-ink transition-colors shrink-0 disabled:opacity-40"
                title="Atualizar"
                disabled={loading}
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
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
                  <button
                    onClick={() => { setSearchQuery(''); setSearchResults(null); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              {!compact && (
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
              )}
              <Button variant="secondary" size="sm" onClick={() => setNewItemKind('dir')} disabled={busy}>
                <FolderPlus size={iconSize} /> <span className="hidden sm:inline">Pasta</span>
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setNewItemKind('file')} disabled={busy}>
                <FilePlus size={iconSize} /> <span className="hidden sm:inline">Arquivo</span>
              </Button>
              <Button variant="primary" size="sm" onClick={openPicker} disabled={busy}>
                <Upload size={iconSize} /> <span className="hidden sm:inline">Enviar</span>
              </Button>
            </div>

            {selectionMode && (
              <div className="flex items-center justify-between gap-2 bg-signal-soft border border-signal/30 rounded-lg px-3 py-2 flex-wrap">
                <span className="text-xs text-signal font-medium">{selected.size} selecionado(s)</span>
                <div className="flex items-center gap-1">
                  <button onClick={selectAll} className="p-1.5 text-ink-dim hover:text-ink" title="Selecionar tudo">
                    <CheckSquare size={15} />
                  </button>
                  {selected.size === 1 && (
                    <button
                      onClick={() => {
                        const name = [...selected][0];
                        setRenaming({ name });
                        setRenameValue(name);
                      }}
                      className="p-1.5 text-ink-dim hover:text-ink"
                      title="Renomear"
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  <button onClick={handleDownloadSelected} className="p-1.5 text-ink-dim hover:text-ink" title="Baixar">
                    <Download size={15} />
                  </button>
                  <button onClick={() => setMoveMode('copy')} className="p-1.5 text-ink-dim hover:text-ink" title="Copiar">
                    <Copy size={15} />
                  </button>
                  <button onClick={() => setMoveMode('move')} className="p-1.5 text-ink-dim hover:text-ink" title="Mover">
                    <Move size={15} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="p-1.5 text-error hover:text-error/80 disabled:opacity-40"
                    title="Excluir"
                    disabled={selected.size === 0}
                  >
                    <Trash2 size={15} />
                  </button>
                  <button onClick={clearSelection} className="p-1.5 text-ink-faint hover:text-ink ml-1" title="Cancelar">
                    <X size={15} />
                  </button>
                </div>
              </div>
            )}

            <Card padded={false}>
              {!selectionMode && displayEntries.length > 0 && searchResults === null && (
                <button
                  onClick={() => setSelectionMode(true)}
                  className="flex items-center gap-2 px-3 pt-3 text-xs text-ink-faint hover:text-ink transition-colors"
                >
                  <ListChecks size={13} /> selecionar
                </button>
              )}
              <div className={`p-2 ${listHeight} ${listHeight ? 'overflow-y-auto' : ''}`}>
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
                      ? () => {
                        const parent = (entry.path || '').split('/').slice(0, -1).join('/');
                        setPath(parent);
                        setSearchResults(null);
                        setSearchQuery('');
                      }
                      : openEntry}
                    onToggleSelect={toggleSelect}
                    onLongPress={startSelection}
                  />
                ))}
              </div>
            </Card>
          </div>
        )}
      </UploadZone>

      {newItemKind && (
        <NewItemModal
          open={!!newItemKind}
          kind={newItemKind}
          onClose={() => setNewItemKind(null)}
          onCreate={(name) => handleCreate(newItemKind, name)}
        />
      )}

      {editingPath && (
        <FileEditor
          path={editingPath}
          onClose={() => setEditingPath(null)}
          onSaved={() => load()}
          readFn={adapter.read}
          writeFn={adapter.write}
        />
      )}

      <MoveCopyModal
        open={!!moveMode}
        mode={moveMode}
        itemCount={selected.size}
        onClose={() => setMoveMode(null)}
        onConfirm={handleMoveOrCopy}
        listFn={adapter.list}
      />

      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Renomear"
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>Cancelar</Button>
            <Button variant="primary" onClick={handleRename} loading={busy}>Renomear</Button>
          </>
        )}
      >
        <form onSubmit={handleRename}>
          <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Excluir itens"
        message={`Excluir ${selected.size} item(ns) selecionado(s)? Pastas são removidas com todo o conteúdo. Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        loading={busy}
      />
    </>
  );
}
