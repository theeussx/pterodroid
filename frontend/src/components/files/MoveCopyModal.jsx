import { useState, useEffect } from 'react';
import { Folder, ChevronRight } from 'lucide-react';
import Modal from '../Modal';
import Button from '../Button';
import Breadcrumbs from './Breadcrumbs';
import { api } from '../../lib/api';
import { useToast } from '../../stores/ToastContext';

export default function MoveCopyModal({ open, onClose, onConfirm, mode, itemCount }) {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  useEffect(() => {
    if (!open) return;
    setPath('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.listFiles(path)
      .then((r) => setEntries(r.entries.filter((e) => e.type === 'dir')))
      .catch((e) => notify(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [open, path]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(path);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${mode === 'move' ? 'Mover' : 'Copiar'} ${itemCount} item(ns) para...`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={confirm} loading={busy}>
            {mode === 'move' ? 'Mover aqui' : 'Copiar aqui'}
          </Button>
        </>
      }
    >
      <Breadcrumbs path={path} onNavigate={setPath} />
      <div className="h-64 overflow-y-auto mt-2 border border-line rounded-lg">
        {loading && <p className="text-xs text-ink-faint p-3">Carregando...</p>}
        {!loading && entries.length === 0 && <p className="text-xs text-ink-faint p-3">Nenhuma subpasta aqui.</p>}
        {entries.map((entry) => {
          const target = path ? `${path}/${entry.name}` : entry.name;
          return (
            <button
              key={target}
              onClick={() => setPath(target)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-ink hover:bg-raised transition-colors"
            >
              <span className="flex items-center gap-2 truncate">
                <Folder size={15} className="text-signal shrink-0" /> {entry.name}
              </span>
              <ChevronRight size={14} className="text-ink-faint shrink-0" />
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
