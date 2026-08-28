import { useState } from 'react';
import { X, History } from 'lucide-react';
import { api } from '../lib/api';
import FileBrowser from '../components/files/FileBrowser';

/**
 * Página global de arquivos — enraizada em FILES_ROOT (por padrão, a raiz
 * de workspaces, então os arquivos dos serviços aparecem aqui também).
 *
 * Todo o comportamento vive no FileBrowser, compartilhado com a aba de
 * arquivos de cada serviço. O que sobra aqui é só o painel de auditoria,
 * que é exclusivo da visão global.
 */
export default function Files() {
  const [showAudit, setShowAudit] = useState(false);
  const [audit, setAudit] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const openAudit = () => {
    setShowAudit(true);
    setLoadingAudit(true);
    api.filesAudit(50)
      .then(setAudit)
      .catch(() => setAudit([]))
      .finally(() => setLoadingAudit(false));
  };

  return (
    <>
      <div className="flex justify-end -mb-1">
        <button
          onClick={openAudit}
          className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink transition-colors p-2"
          title="Atividade recente"
        >
          <History size={15} /> atividade
        </button>
      </div>

      <FileBrowser adapter={api.files} />

      {showAudit && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-void/80" onClick={() => setShowAudit(false)} />
          <div className="relative w-full sm:max-w-lg bg-surface border border-line rounded-t-2xl sm:rounded-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <h2 className="font-display font-semibold text-ink">Atividade recente</h2>
              <button onClick={() => setShowAudit(false)} className="text-ink-faint hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-line-soft">
              {loadingAudit && <p className="text-sm text-ink-faint p-4">Carregando...</p>}
              {!loadingAudit && audit.length === 0 && <p className="text-sm text-ink-faint p-4">Nada ainda.</p>}
              {audit.map((a) => (
                <div key={a.id} className="px-5 py-2.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-signal font-medium uppercase">{a.action}</span>
                    <span className="text-ink-faint font-mono shrink-0">
                      {new Date(`${a.timestamp}Z`).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <p className="text-ink-dim font-mono truncate mt-0.5">{a.target} {a.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
