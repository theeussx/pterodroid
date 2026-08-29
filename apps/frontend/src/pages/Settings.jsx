import { useEffect, useState, useCallback } from 'react';
import { ShieldAlert, Globe } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../stores/AuthContext';
import { getSocket } from '../lib/socket';
import Card from '../components/Card';
import Button from '../components/Button';
import StatusDot from '../components/StatusDot';
import DomainSettings from '../components/DomainSettings';
import { Label, Input } from '../components/Field';
import { useToast } from '../stores/ToastContext';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [remoteAccess, setRemoteAccess] = useState(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const { notify } = useToast();
  const { markSetupDone, setupDone } = useAuth();

  const loadRemoteAccess = useCallback(() => {
    api.remoteAccessStatus().then(setRemoteAccess).catch(() => {});
  }, []);

  useEffect(() => {
    api.getSettings().then(setSettings).catch((e) => notify(e.message, 'error'));
    loadRemoteAccess();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onStatus = (payload) => { if (payload.type === 'panel') loadRemoteAccess(); };
    socket.on('tunnel:status', onStatus);
    return () => socket.off('tunnel:status', onStatus);
  }, [loadRemoteAccess]);

  const toggleRemoteAccess = async () => {
    setRemoteBusy(true);
    try {
      if (remoteAccess?.active) {
        await api.stopRemoteAccess();
        notify('Acesso remoto desativado', 'success');
      } else {
        await api.startRemoteAccess();
        notify('Conectando... a URL aparece em alguns segundos', 'success');
      }
      loadRemoteAccess();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setRemoteBusy(false);
    }
  };

  const saveGeneral = async (e) => {
    e.preventDefault();
    setSavingGeneral(true);
    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated);
      notify('Configurações salvas', 'success');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSavingGeneral(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (pwForm.next.length < 8) {
      notify('A nova senha precisa ter ao menos 8 caracteres', 'error');
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      notify('As senhas não coincidem', 'error');
      return;
    }
    setSavingPw(true);
    try {
      // A rota de troca de senha já marca a configuração como concluída.
      await api.changePassword(pwForm.current, pwForm.next);
      markSetupDone();
      notify('Senha alterada com sucesso', 'success');
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSavingPw(false);
    }
  };

  // Enquanto a senha padrão não é trocada, o backend devolve 403 p/ as rotas
  // de configuração (parte da trava de segurança). Isso NÃO pode impedir o
  // formulário de "Alterar senha" de aparecer — é justamente o que o usuário
  // precisa para destravar o painel. O card "Painel" segue a mesma ideia: se
  // os settings ainda não carregaram (ou foram bloqueados), ele só desativa
  // os campos em vez de derrubar a página inteira.
  const settingsReady = !!settings;
  const safeSettings = settings || {
    panel_name: '', panel_color: '', log_retention_days: 7, alert_webhook_url: '',
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <h2 className="font-display font-semibold text-sm text-ink mb-4">Painel</h2>
        <form onSubmit={saveGeneral} className="space-y-4">
          {!settingsReady && (
            <p className="text-xs text-ink-faint">
              Os campos abaixo são liberados depois que a senha padrão for trocada
              (você ainda pode alterar a senha no card no fim desta página).
            </p>
          )}
          <div>
            <Label htmlFor="panel_name">Nome do painel</Label>
            <Input
              id="panel_name"
              value={safeSettings.panel_name}
              disabled={!settingsReady}
              onChange={(e) => setSettings((s) => ({ ...s, panel_name: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="panel_color">Cor de destaque</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                id="panel_color"
                value={safeSettings.panel_color}
                disabled={!settingsReady}
                onChange={(e) => setSettings((s) => ({ ...s, panel_color: e.target.value }))}
                className="w-10 h-10 rounded-lg border border-line bg-raised cursor-pointer"
              />
              <span className="text-sm text-ink-dim font-mono">{safeSettings.panel_color}</span>
            </div>
          </div>
          <div>
            <Label htmlFor="log_retention_days">Retenção de logs (dias)</Label>
            <Input
              id="log_retention_days"
              type="number"
              min="1"
              value={safeSettings.log_retention_days}
              disabled={!settingsReady}
              onChange={(e) => setSettings((s) => ({ ...s, log_retention_days: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="alert_webhook_url">Webhook de alerta (opcional)</Label>
            <Input
              id="alert_webhook_url"
              value={safeSettings.alert_webhook_url || ''}
              disabled={!settingsReady}
              onChange={(e) => setSettings((s) => ({ ...s, alert_webhook_url: e.target.value }))}
              placeholder="https://api.telegram.org/bot<TOKEN>/sendMessage  ou um webhook do Discord/ntfy.sh"
            />
            <p className="text-xs text-ink-faint mt-1">
              O Pterodroid avisa quando um serviço cai ou entra em crash-loop. Deixe vazio para desativar.
            </p>
            <button
              type="button"
              onClick={async () => {
                if (!safeSettings.alert_webhook_url) { notify('Configure um webhook primeiro', 'error'); return; }
                try {
                  const r = await api.testAlertWebhook();
                  if (r.ok) notify('Alerta de teste enviado', 'success');
                  else if (r.skipped) notify('Nenhum webhook configurado', 'error');
                  else notify(`Falha ao enviar (${r.status})`, 'error');
                } catch (e) { notify(e.message, 'error'); }
              }}
              className="mt-2 text-xs text-signal hover:underline"
            >
              Enviar alerta de teste
            </button>
          </div>
          <Button type="submit" variant="primary" loading={savingGeneral} disabled={!settingsReady}>Salvar</Button>
        </form>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold text-sm text-ink">Acesso remoto</h2>
          {remoteAccess?.active && <StatusDot status={remoteAccess.status === 'connected' ? 'running' : 'provisioning'} />}
        </div>

        {remoteAccess?.ok === false ? (
          <p className="text-sm text-provisioning flex items-start gap-2">
            <ShieldAlert size={16} className="shrink-0 mt-0.5" /> {remoteAccess.message}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-dim">
              Cria uma URL pública (via Cloudflare Tunnel) para acessar este painel de qualquer lugar,
              sem precisar estar na mesma rede Wi-Fi.
            </p>

            {!setupDone && (
              <p className="text-xs text-error flex items-start gap-1.5">
                <ShieldAlert size={13} className="shrink-0 mt-0.5" />
                Troque a senha padrão antes de ativar isso — com acesso remoto, qualquer pessoa com a
                URL chega até a tela de login do painel.
              </p>
            )}

            {remoteAccess?.active && (
              <div className="bg-signal-soft rounded-lg p-3 text-xs">
                <p className="text-signal mb-1 font-semibold">
                  {remoteAccess.status === 'connected' ? 'URL pública' : 'Conectando...'}
                </p>
                {remoteAccess.url && (
                  <a href={remoteAccess.url} target="_blank" rel="noreferrer" className="text-signal underline break-all font-mono">
                    {remoteAccess.url}
                  </a>
                )}
              </div>
            )}

            <Button
              variant={remoteAccess?.active ? 'danger' : 'primary'}
              onClick={toggleRemoteAccess}
              loading={remoteBusy}
            >
              <Globe size={15} /> {remoteAccess?.active ? 'Desativar' : 'Ativar acesso remoto'}
            </Button>

            <p className="text-xs text-ink-faint">
              A URL muda toda vez que o acesso remoto é reativado. Para um domínio fixo, veja o README.
            </p>
          </div>
        )}
      </Card>

      <DomainSettings />

      <Card>
        <h2 className="font-display font-semibold text-sm text-ink mb-4">Alterar senha</h2>
        <form onSubmit={savePassword} className="space-y-4">
          <div>
            <Label htmlFor="current">Senha atual</Label>
            <Input id="current" type="password" value={pwForm.current} onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} required />
          </div>
          <div>
            <Label htmlFor="next">Nova senha</Label>
            <Input id="next" type="password" value={pwForm.next} onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))} minLength={8} required />
          </div>
          <div>
            <Label htmlFor="confirm">Confirmar nova senha</Label>
            <Input id="confirm" type="password" value={pwForm.confirm} onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))} minLength={8} required />
          </div>
          <Button type="submit" variant="primary" loading={savingPw}>Alterar senha</Button>
        </form>
      </Card>
    </div>
  );
}
