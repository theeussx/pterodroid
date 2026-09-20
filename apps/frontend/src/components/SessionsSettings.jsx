import { useEffect, useState } from 'react';
import { MonitorSmartphone, LogOut, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import Card from './Card';
import Button from './Button';
import { useToast } from '../stores/ToastContext';

/**
 * Sessões ativas: cada login (token JWT) vira uma linha aqui, identificada
 * pelo navegador e pelo IP aproximado. Revogar derruba o token na hora —
 * útil para “deslogar o celular que perdi” sem trocar a senha.
 */
export default function SessionsSettings() {
  const { notify } = useToast();
  const [sessions, setSessions] = useState(null);
  const [busyJti, setBusyJti] = useState(null);

  const load = () => api.listSessions().then(setSessions).catch(() => {});
  useEffect(() => { load(); }, []);

  const revoke = async (s) => {
    setBusyJti(s.jti);
    try {
      await api.revokeSession(s.jti);
      if (s.current) {
        // Não deve acontecer (botão da sessão atual não é exibido), mas se
        // acontecer o próximo request cai com 401 e o app volta pro login.
        notify('Sessão atual revogada — faça login de novo', 'success');
      } else {
        notify('Sessão revogada', 'success');
      }
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusyJti(null);
    }
  };

  const revokeOthers = async () => {
    try {
      const r = await api.revokeOtherSessions();
      notify(r.revoked > 0 ? `${r.revoked} sessão(ões) encerrada(s)` : 'Não havia outras sessões', 'success');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  // user-agent curto: pega a última família ("Chrome/…" → "Chrome") senão corta
  const device = (ua) => {
    if (!ua) return 'desconhecido';
    const m = ua.match(/(firefox|edg|chrome|safari|opera|curl)\/[\d.]+/i);
    return m ? m[1] : ua.slice(0, 40);
  };

  const count = sessions?.count ?? 0;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-semibold text-sm text-ink flex items-center gap-2">
          <MonitorSmartphone size={15} className="text-ink-faint" />
          Dispositivos conectados {count ? `(${count})` : ''}
        </h2>
        <button type="button" onClick={load} className="text-ink-faint hover:text-ink" title="Atualizar">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="space-y-2">
        {(sessions?.items || []).map((s) => (
          <div
            key={s.jti}
            className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${s.current ? 'border-signal/40 bg-signal-soft' : 'border-line'}`}
          >
            <div className="min-w-0">
              <p className="text-sm text-ink truncate">
                {device(s.user_agent)}
                {s.current && <span className="ml-2 text-[11px] font-medium text-signal">esta sessão</span>}
              </p>
              <p className="text-[11px] text-ink-faint font-mono truncate">
                {s.ip || 'IP não registrado'} · criada {fmt(s.created_at)} · ativa {fmt(s.last_seen_at)}
              </p>
            </div>
            {!s.current && (
              <button
                type="button"
                disabled={busyJti === s.jti}
                onClick={() => revoke(s)}
                className="shrink-0 text-xs text-error hover:underline disabled:opacity-50"
              >
                Encerrar
              </button>
            )}
          </div>
        ))}
        {sessions && count === 0 && (
          <p className="text-xs text-ink-faint">Lista vazia — recarregue a página.</p>
        )}
      </div>

      {(sessions?.items || []).some((s) => !s.current) && (
        <div className="border-t border-line mt-3 pt-3">
          <Button variant="ghost" onClick={revokeOthers}>
            <LogOut size={15} /> Encerrar todas as outras sessões
          </Button>
        </div>
      )}
    </Card>
  );
}

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso.replace(' ', 'T')}Z`); // timestamps do SQLite são UTC
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
