import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../stores/AuthContext';
import Card from '../components/Card';
import Button from '../components/Button';
import { Label, Input } from '../components/Field';
import { useToast } from '../stores/ToastContext';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const { notify } = useToast();
  const { markSetupDone } = useAuth();

  useEffect(() => {
    api.getSettings().then(setSettings).catch((e) => notify(e.message, 'error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (pwForm.next !== pwForm.confirm) {
      notify('As senhas não coincidem', 'error');
      return;
    }
    setSavingPw(true);
    try {
      await api.changePassword(pwForm.current, pwForm.next);
      await api.completeSetup().catch(() => {});
      markSetupDone();
      notify('Senha alterada com sucesso', 'success');
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSavingPw(false);
    }
  };

  if (!settings) return <div className="text-ink-faint text-sm">Carregando...</div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <h2 className="font-display font-semibold text-sm text-ink mb-4">Painel</h2>
        <form onSubmit={saveGeneral} className="space-y-4">
          <div>
            <Label htmlFor="panel_name">Nome do painel</Label>
            <Input
              id="panel_name"
              value={settings.panel_name}
              onChange={(e) => setSettings((s) => ({ ...s, panel_name: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="panel_color">Cor de destaque</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                id="panel_color"
                value={settings.panel_color}
                onChange={(e) => setSettings((s) => ({ ...s, panel_color: e.target.value }))}
                className="w-10 h-10 rounded-lg border border-line bg-raised cursor-pointer"
              />
              <span className="text-sm text-ink-dim font-mono">{settings.panel_color}</span>
            </div>
          </div>
          <div>
            <Label htmlFor="log_retention_days">Retenção de logs (dias)</Label>
            <Input
              id="log_retention_days"
              type="number"
              min="1"
              value={settings.log_retention_days}
              onChange={(e) => setSettings((s) => ({ ...s, log_retention_days: e.target.value }))}
            />
          </div>
          <Button type="submit" variant="primary" loading={savingGeneral}>Salvar</Button>
        </form>
      </Card>

      <Card>
        <h2 className="font-display font-semibold text-sm text-ink mb-4">Alterar senha</h2>
        <form onSubmit={savePassword} className="space-y-4">
          <div>
            <Label htmlFor="current">Senha atual</Label>
            <Input id="current" type="password" value={pwForm.current} onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} required />
          </div>
          <div>
            <Label htmlFor="next">Nova senha</Label>
            <Input id="next" type="password" value={pwForm.next} onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))} minLength={6} required />
          </div>
          <div>
            <Label htmlFor="confirm">Confirmar nova senha</Label>
            <Input id="confirm" type="password" value={pwForm.confirm} onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))} minLength={6} required />
          </div>
          <Button type="submit" variant="primary" loading={savingPw}>Alterar senha</Button>
        </form>
      </Card>
    </div>
  );
}
