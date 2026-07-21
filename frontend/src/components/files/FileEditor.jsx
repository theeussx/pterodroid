import { useState, useEffect, useCallback } from 'react';
import { Save, X } from 'lucide-react';
import { api } from '../../lib/api';
import Button from '../Button';
import { useToast } from '../../stores/ToastContext';

export default function FileEditor({ path, onClose, onSaved }) {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { notify } = useToast();

  useEffect(() => {
    setLoading(true);
    api.readFile(path)
      .then((r) => { setContent(r.content); setOriginal(r.content); })
      .catch((e) => { notify(e.message, 'error'); onClose(); })
      .finally(() => setLoading(false));
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = content !== original;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api.writeFile(path, content);
      setOriginal(content);
      notify('Arquivo salvo', 'success');
      onSaved?.();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }, [path, content]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestClose = () => {
    if (dirty && !window.confirm('Sair sem salvar as alterações?')) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const lines = content.split('\n').length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-void">
      <div className="flex items-center justify-between px-4 h-14 border-b border-line shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm text-ink truncate">{path}</span>
          {dirty && <span className="w-1.5 h-1.5 rounded-full bg-provisioning shrink-0" title="Não salvo" />}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty}>
            <Save size={14} /> Salvar
          </Button>
          <button onClick={requestClose} className="text-ink-faint hover:text-ink p-1.5">
            <X size={18} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-ink-faint text-sm">Carregando...</div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="flex-1 w-full bg-void text-ink font-mono text-sm p-4 resize-none focus:outline-none leading-relaxed"
          style={{ tabSize: 2 }}
        />
      )}

      <div className="flex items-center justify-between px-4 py-1.5 border-t border-line-soft text-xs text-ink-faint font-mono shrink-0">
        <span>{lines} linha{lines !== 1 ? 's' : ''}</span>
        <span>{dirty ? 'não salvo' : 'salvo'} · Ctrl+S para salvar</span>
      </div>
    </div>
  );
}
