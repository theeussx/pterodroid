import { useState, useRef, useCallback } from 'react';
import { UploadCloud } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../stores/ToastContext';

export default function UploadZone({ path, onUploaded, children }) {
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState([]); // [{name, progress}]
  const dragCounter = useRef(0);
  const inputRef = useRef(null);
  const { notify } = useToast();

  const doUpload = useCallback(async (fileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploads(files.map((f) => ({ name: f.name, progress: 0 })));
    try {
      await api.uploadFiles(path, files, (pct) => {
        setUploads((prev) => prev.map((u) => ({ ...u, progress: pct })));
      });
      notify(`${files.length} arquivo(s) enviado(s)`, 'success');
      onUploaded?.();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setUploads([]);
    }
  }, [path, onUploaded, notify]);

  const onDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (e.dataTransfer.files?.length) doUpload(e.dataTransfer.files);
  };

  const onDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) setDragging(false);
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      className="relative"
    >
      {children({ openPicker: () => inputRef.current?.click() })}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files.length) doUpload(e.target.files); e.target.value = ''; }}
      />

      {dragging && (
        <div className="absolute inset-0 z-10 bg-signal-soft border-2 border-dashed border-signal rounded-xl flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <UploadCloud size={32} className="mx-auto text-signal mb-2" />
            <p className="text-signal font-medium text-sm">Solte para enviar</p>
          </div>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-surface border border-line rounded-lg shadow-xl p-3 w-72">
          {uploads.map((u) => (
            <div key={u.name} className="mb-1.5 last:mb-0">
              <div className="flex justify-between text-xs text-ink-dim mb-1">
                <span className="truncate">{u.name}</span>
                <span className="font-mono shrink-0 ml-2">{u.progress}%</span>
              </div>
              <div className="h-1 bg-raised rounded-full overflow-hidden">
                <div className="h-full bg-signal transition-all" style={{ width: `${u.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
