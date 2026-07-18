import { useEffect, useState, useCallback } from 'react';
import { Globe2, ShieldCheck, ShieldAlert, CheckCircle2, Circle } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import Card from './Card';
import Button from './Button';
import { Label, Input } from './Field';
import { useToast } from '../stores/ToastContext';

function StepRow({ done, children }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      {done ? <CheckCircle2 size={16} className="text-running shrink-0 mt-0.5" /> : <Circle size={16} className="text-ink-faint shrink-0 mt-0.5" />}
      <span className={done ? 'text-ink-dim' : 'text-ink'}>{children}</span>
    </div>
  );
}

export default function DomainSettings() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ base_domain: '', panel_tunnel_hostname: '' });
  const [tunnelName, setTunnelName] = useState('pterodroid');
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  const load = useCallback(() => {
    api.domainsStatus().then((s) => {
      setStatus(s);
      setForm({ base_domain: s.baseDomain || '', panel_tunnel_hostname: '' });
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

  const saveDomains = async () => {
    setBusy(true);
    try {
      await api.updateDomains(form);
      notify('Domínio salvo', 'success');
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const createTunnel = async () => {
    setBusy(true);
    try {
      await api.createNamedTunnel(tunnelName);
      notify('Túnel criado', 'success');
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const res = await api.applyDomains();
      notify(`Aplicado: ${res.hostnames.length} domínio(s) roteado(s)`, 'success');
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await api.stopDomains();
      notify('Túnel de domínio parado', 'success');
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-semibold text-sm text-ink">Domínio personalizado (avançado)</h2>
        {status.running && <span className="text-xs text-running flex items-center gap-1"><ShieldCheck size={13} /> ativo</span>}
      </div>

      <p className="text-sm text-ink-dim mb-4">
        Use um domínio seu (via sua conta Cloudflare) em vez da URL aleatória do acesso remoto simples.
        Isso vale para o painel e para qualquer serviço/banco com um domínio configurado no formulário dele.
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
        <StepRow done={status.running}>
          {status.running ? 'Túnel rodando e roteando tráfego' : 'Aplicar configuração para ativar'}
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
            {status.running && (
              <Button variant="danger" onClick={stop} loading={busy}>Parar</Button>
            )}
          </div>
        )}

        <p className="text-xs text-ink-faint">
          "Aplicar" reconstrói a configuração com todos os domínios atuais (painel + serviços + bancos) e
          reinicia o túnel — isso interrompe brevemente todos os domínios que passam por ele, não só o que mudou.
        </p>
      </div>
    </Card>
  );
}
