import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Filter } from 'lucide-react';
import { api } from '../lib/api';
import Card from './Card';
import Button from './Button';
import { Input, Label } from './Field';

/**
 * Auditoria central (Fase 1): trilha completa de quem fez o quê no painel —
 * logins (com origem/IP), 2FA, criação/remoção de serviços e bancos,
 * backups, hosts Docker, túneis, edições de configuração e ações de
 * arquivos. Filtros viram query string; o seletor de ação é montado com as
 * ações que realmente existem no banco (nada de lista hardcoded).
 */
export default function AuditView() {
  const [data, setData] = useState(null); // {items, total, limit, offset, actions}
  const [filters, setFilters] = useState({ action: '', username: '', q: '', from: '', to: '' });
  const [applied, setApplied] = useState({});
  const [page, setPage] = useState(0);
  const LIMIT = 50;

  const load = useCallback((params, pg = 0) => {
    api.audit({ ...params, limit: LIMIT, offset: pg * LIMIT })
      .then(setData)
      .catch(() => setData({ items: [], total: 0, actions: [] }));
  }, []);

  useEffect(() => { load(applied, page); }, [applied, page, load]);

  const applyFilters = (e) => {
    e.preventDefault();
    setPage(0);
    setApplied({ ...filters });
  };

  const actionLabel = (a) => ACTION_LABELS[a] || a.replaceAll('_', ' ');

  return (
    <div className="space-y-3">
      <Card>
        <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Label htmlFor="af-action">Ação</Label>
            <select
              id="af-action"
              value={filters.action}
              onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
              className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink"
            >
              <option value="">Todas</option>
              {(data?.actions || []).map((a) => (
                <option key={a} value={a}>{actionLabel(a)}</option>
              ))}
            </select>
          </div>
          <div className="w-32">
            <Label htmlFor="af-user">Usuário</Label>
            <Input id="af-user" value={filters.username} onChange={(e) => setFilters((f) => ({ ...f, username: e.target.value }))} placeholder="admin" />
          </div>
          <div className="w-44 flex-1">
            <Label htmlFor="af-q">Busca (alvo/detalhe)</Label>
            <Input id="af-q" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="texto livre..." />
          </div>
          <div className="w-36">
            <Label htmlFor="af-from">De</Label>
            <Input id="af-from" type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          </div>
          <div className="w-36">
            <Label htmlFor="af-to">Até</Label>
            <Input id="af-to" type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
          </div>
          <Button type="submit" variant="primary" size="md"><Filter size={14} /> Filtrar</Button>
          <button type="button" onClick={() => load(applied, page)} className="p-2 text-ink-faint hover:text-ink" title="Atualizar">
            <RefreshCw size={15} />
          </button>
        </form>
      </Card>

      <Card padded={false}>
        {data?.items?.length ? (
          <ul className="divide-y divide-line-soft">
            {data.items.map((r) => (
              <li key={r.id} className="px-4 py-2.5 flex items-start gap-3">
                <span className="shrink-0 w-36 text-[11px] text-ink-faint font-mono pt-0.5">{fmtTs(r.timestamp)}</span>
                <span className={`shrink-0 mt-0.5 w-2 h-2 rounded-full ${DOT_COLOR[r.action] || 'bg-signal-dim'}`} title={actionLabel(r.action)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">
                    <span className="font-medium">{actionLabel(r.action)}</span>
                    {r.target && <> · <span className="text-ink-dim">{r.target}</span></>}
                  </p>
                  {(r.detail || r.username || r.ip) && (
                    <p className="text-[11px] text-ink-faint font-mono truncate">
                      {r.detail}{r.detail && ' · '}
                      {r.username ? `@${r.username}` : ''}{r.ip ? ` · ${r.ip}` : ''}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-faint">
            {data ? 'Nenhum registro com esses filtros.' : 'Carregando...'}
          </p>
        )}
      </Card>

      {data?.total > LIMIT && (
        <div className="flex items-center justify-between text-sm">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Mais recentes</Button>
          <span className="text-ink-faint text-xs">
            {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, data.total)} de {data.total}
          </span>
          <Button variant="secondary" size="sm" disabled={(page + 1) * LIMIT >= data.total} onClick={() => setPage((p) => p + 1)}>Mais antigas →</Button>
        </div>
      )}
    </div>
  );
}

// Os nomes abaixo são os GRAVADOS pelas rotas (nunca os exibidos) — quando
// algo novo começar a ser auditado sem rótulo aqui, o fallback mostra o
// nome cru com underscores trocados por espaços (nada quebra silencioso).
const ACTION_LABELS = {
  login_sucesso: 'Login (sucesso)', login_falha: 'Login (falha)', login_bloqueado: 'Login (bloqueado)',
  logout: 'Logout', senha_alterada: 'Senha alterada',
  '2fa_ativado': '2FA ativado', '2fa_desativado': '2FA desativado', '2fa_falha': '2FA (código errado)',
  '2fa_recuperacao_usada': 'Login via código de recuperação', '2fa_codigos_regenerados': 'Códigos de recuperação regenerados',
  sessao_revogada: 'Sessão encerrada', sessoes_revogadas: 'Outras sessões encerradas',
  servico_criado: 'Serviço criado', servico_editado: 'Serviço editado', servico_removido: 'Serviço removido',
  servico_iniciado: 'Serviço iniciado', servico_parado: 'Serviço parado', servico_reiniciado: 'Serviço reiniciado',
  banco_criado: 'Banco criado', banco_editado: 'Banco editado', banco_removido: 'Banco removido',
  banco_iniciado: 'Banco iniciado', banco_parado: 'Banco parado', banco_reiniciado: 'Banco reiniciado',
  backup_criado: 'Backup criado', backup_restaurado: 'Backup restaurado', backup_removido: 'Backup removido', backup_baixado: 'Backup baixado',
  docker_host_adicionado: 'Host Docker adicionado', docker_host_removido: 'Host Docker removido',
  tunel_iniciado: 'Túnel iniciado', tunel_parado: 'Túnel parado',
  dominio_tunel_criado: 'Túnel de domínio criado', dominio_config_aplicada: 'DNS de domínio aplicado',
  dominio_tunel_token_iniciado: 'Túnel por token iniciado', dominio_tunel_parado: 'Túnel de domínio parado',
  config_editada: 'Configuração editada',
  write: 'Arquivo escrito', mkdir: 'Pasta criada', touch: 'Arquivo criado',
  rename: 'Arquivo renomeado', move: 'Arquivo movido', copy: 'Arquivo copiado',
  delete: 'Item(ns) apagado(s)', upload: 'Upload de arquivo(s)', download: 'Download de arquivo',
  compress: 'Arquivo(s) compactado(s)', extract: 'Arquivo extraído',
  exec: 'Comando no terminal',
};

const DOT_COLOR = {
  login_falha: 'bg-error', login_bloqueado: 'bg-error', '2fa_falha': 'bg-error',
  login_sucesso: 'bg-running', servico_iniciado: 'bg-running', banco_iniciado: 'bg-running', tunel_iniciado: 'bg-running',
  servico_removido: 'bg-error', banco_removido: 'bg-error', backup_removido: 'bg-error', docker_host_removido: 'bg-error',
  servico_parado: 'bg-provisioning', banco_parado: 'bg-provisioning', tunel_parado: 'bg-provisioning', '2fa_desativado': 'bg-provisioning',
};

function fmtTs(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso.replace(' ', 'T')}Z`);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
