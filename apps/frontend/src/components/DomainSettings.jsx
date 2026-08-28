import { useEffect, useState, useCallback } from 'react';
import { Globe2, ShieldCheck, ShieldAlert, CheckCircle2, Circle, KeyRound, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import Card from './Card';
import Button from './Button';
import { Label, Input, MonoInput } from './Field';
import { useToast } from '../stores/ToastContext';

function StepRow({ done, children }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      {done ? <CheckCircle2 size={16} className="text-running shrink-0 mt-0.5" /> : <Circle size={16} className="text-ink-faint shrink-0 mt-0.5" />}
      <span className={done ? 'text-ink-dim' : 'text-ink'}>{children}</span>
    </div>
  );
}

function ModeBadge({ active }) {
  if (!active) return null;
  return <span className="text-xs text-running flex items-center gap-1"><ShieldCheck size={13} /> ativo</span>;
}

export default function DomainSettings() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ base_domain: '', panel_tunnel_hostname: '' });
  const [tunnelName, setTunnelName] = useState('pterodroid');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  const load = useCallback(() => {
    api.domainsStatus().then((s) => {
      setStatus(s);
      setForm({ base_domain: s.baseDomain || '', panel_tunnel_hostname: s.panelTunnelHostname || '' });
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onStatus = () => load();
    socket.on('domains:status', onStatus);
    return () => socket.off('domains:status', onStatus);
  }, [load]);

  const run = async (fn, successMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      if (successMsg) notify(successMsg(res), 'success');
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveDomains = () => run(() => api.updateDomains(form), () => 'Domínio salvo');
  const createTunnel = () => run(() => api.createNamedTunnel(tunnelName), () => 'Túnel criado');
  const apply = () => run(() => api.applyDomains(), (res) => `Aplicado: ${res.hostnames.length} domínio(s) roteado(s)`);
  const stop = () => run(() => api.stopDomains(), () => 'Túnel parado');
  const connectToken = () => run(() => api.startTokenTunnel(token), () => 'Conectando... acompanhe o status abaixo');

  if (!status) return null;

  const cliActive = status.running && status.mode === 'cli';
  const tokenActive = status.running && status.mode === 'token';

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold text-sm text-ink">Domínio personalizado (avançado)</h2>
        </div>

        <p className="text-sm text-ink-dim mb-2">
          Use um domínio seu (via sua conta Cloudflare) em vez da URL aleatória do acesso remoto simples.
          Duas formas de configurar — use a que funcionar melhor no seu aparelho, elas não rodam ao mesmo tempo.
        </p>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-sm text-ink">Opção A — Túnel gerenciado pelo painel</h3>
          <ModeBadge active={cliActive} />
        </div>

        <p className="text-xs text-ink-faint mb-4">
          Totalmente automatizado, incluindo os registros DNS. Depende do fluxo de login por CLI do
          cloudflared funcionar direito no seu aparelho.
        </p>

        <div className="space-y-2 mb-4 pb-4 border-b border-line-soft">
          <StepRow done={status.authenticated}>
            {status.authenticated
              ? 'cloudflared autenticado com sua conta'
              : <>Autentique rodando <code className="font-mono text-signal">cloudflared tunnel login</code> em um terminal</>}
          </StepRow>
          <StepRow done={status.tunnelCreated}>
            {status.tunnelCreated ? `Túnel "${status.tunnelName}" criado` : 'Criar o túnel nomeado'}
          </StepRow>
          <StepRow done={!!status.baseDomain || !!status.panelHostname}>
            Domínio configurado abaixo
          </StepRow>
          <StepRow done={cliActive}>
            {cliActive ? 'Túnel rodando e roteando tráfego' : 'Aplicar configuração para ativar'}
          </StepRow>
        </div>

        {!status.authenticated && (
          <p className="text-xs text-provisioning flex items-start gap-1.5 mb-4">
            <ShieldAlert size={13} className="shrink-0 mt-0.5" />
            Esse passo precisa ser feito manualmente, uma vez só — abre o navegador para você entrar na
            conta Cloudflare. Depois de autenticado, volte aqui.
          </p>
        )}

        <div className="space-y-4">
          <div>
            <Label htmlFor="base_domain">Domínio base</Label>
            <Input
              id="base_domain"
              value={form.base_domain}
              onChange={(e) => setForm((f) => ({ ...f, base_domain: e.target.value }))}
              placeholder="meudominio.com"
            />
            <p className="text-xs text-ink-faint mt-1">
              Usado quando você digita só um nome (ex: "site1") no domínio de um serviço — vira site1.meudominio.com automaticamente.
            </p>
          </div>

          <div>
            <Label htmlFor="panel_hostname">Domínio do painel</Label>
            <Input
              id="panel_hostname"
              value={form.panel_tunnel_hostname}
              onChange={(e) => setForm((f) => ({ ...f, panel_tunnel_hostname: e.target.value }))}
              placeholder="painel (ou painel.outrodominio.com)"
            />
            {status.panelHostname && <p className="text-xs text-signal mt-1 font-mono">{status.panelHostname}</p>}
          </div>

          <Button variant="secondary" onClick={saveDomains} loading={busy}>Salvar domínios</Button>

          {!status.tunnelCreated && (
            <div className="pt-3 border-t border-line-soft">
              <Label htmlFor="tunnel_name">Nome do túnel</Label>
              <div className="flex gap-2">
                <Input id="tunnel_name" value={tunnelName} onChange={(e) => setTunnelName(e.target.value)} />
                <Button variant="primary" onClick={createTunnel} loading={busy} disabled={!status.authenticated}>
                  <Globe2 size={15} /> Criar túnel
                </Button>
              </div>
            </div>
          )}

          {status.tunnelCreated && (
            <div className="flex gap-2 pt-3 border-t border-line-soft">
              <Button variant="primary" onClick={apply} loading={busy}>
                Aplicar configuração
              </Button>
              {cliActive && <Button variant="danger" onClick={stop} loading={busy}>Parar</Button>}
            </div>
          )}

          <p className="text-xs text-ink-faint">
            "Aplicar" reconstrói a configuração com todos os domínios atuais (painel + serviços + bancos) e
            reinicia o túnel — isso interrompe brevemente todos os domínios que passam por ele, não só o que mudou.
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-sm text-ink">Opção B — Colar token do dashboard Cloudflare</h3>
          <ModeBadge active={tokenActive} />
        </div>

        <p className="text-sm text-ink-dim mb-3">
          Mais simples de conectar: crie o túnel direto no{' '}
          <a
            href="https://one.dash.cloudflare.com/"
            target="_blank"
            rel="noreferrer"
            className="text-signal underline inline-flex items-center gap-1"
          >
            dashboard Zero Trust da Cloudflare <ExternalLink size={11} />
          </a>{' '}
          (Networks → Tunnels → Create). Ele te dá um comando com um token — cole só o token abaixo, o
          painel cuida de rodar e manter o processo vivo.
        </p>

        <p className="text-xs text-provisioning flex items-start gap-1.5 mb-4">
          <ShieldAlert size={13} className="shrink-0 mt-0.5" />
          Nesse modo, o roteamento de cada domínio (qual hostname vai para qual porta) é configurado
          direto no dashboard, na aba "Public Hostname" do túnel — os campos de domínio dos formulários
          de serviço/banco não se aplicam aqui.
        </p>

        <div className="space-y-3">
          <div>
            <Label htmlFor="cf_token">Token do túnel</Label>
            <MonoInput
              id="cf_token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="eyJhIjoi..."
            />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={connectToken} loading={busy} disabled={!token.trim()}>
              <KeyRound size={15} /> Conectar
            </Button>
            {tokenActive && <Button variant="danger" onClick={stop} loading={busy}>Parar</Button>}
          </div>
        </div>
      </Card>
    </>
  );
}
