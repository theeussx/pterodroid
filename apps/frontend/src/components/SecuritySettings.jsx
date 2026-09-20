import { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, Copy, CheckCheck } from 'lucide-react';
import { api } from '../lib/api';
import Card from './Card';
import Button from './Button';
import { Label, Input } from './Field';
import { useToast } from '../stores/ToastContext';

/**
 * Verificação em 2 etapas (TOTP). O fluxo de ativação é deliberadamente
 * executado em estados ('prompt' → 'code' → 'codes') porque o segredo e os
 * códigos de recuperação são exibidos UMA ÚNICA VEZ — no fim do processo o
 * backend só guarda o segredo cifrado e hashes dos códigos.
 */
export default function SecuritySettings() {
  const { notify } = useToast();
  const [status, setStatus] = useState(null); // {enabled, recoveryLeft}
  const [phase, setPhase] = useState('idle'); // idle | setup | codes | disable | regen
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const refresh = () => api.totpStatus().then(setStatus).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const copy = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      notify('Não consegui copiar — selecione e copie manualmente', 'error');
    }
  };

  const beginSetup = async () => {
    setBusy(true);
    try {
      const r = await api.totpSetup();
      setSecret(r.secret);
      setUri(r.uri);
      setPhase('setup');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.totpEnable(code.trim());
      setRecoveryCodes(r.recoveryCodes || []);
      setCode('');
      setPhase('codes');
      refresh();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Desativar e regenerar pedem a SENHA (decisão do backend: ação
  // sensível exige reautenticação, e assim continua sendo possível
  // recuperar o painel quando o celular some — contrário seria o 2FA
  // trancando o dono para sempre).
  const runPasswordAction = async (actionFn) => {
    setBusy(true);
    try {
      const r = await actionFn(password);
      setPassword('');
      setPhase('idle');
      refresh();
      return r;
    } catch (e) {
      notify(e.message, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e) => {
    e.preventDefault();
    const out = await runPasswordAction((v) => api.totpDisable(v));
    if (out) notify('2FA desativado', 'success');
  };

  const regenerate = async (e) => {
    e.preventDefault();
    const out = await runPasswordAction((v) => api.totpNewRecoveryCodes(v));
    if (out) {
      setRecoveryCodes(out.recoveryCodes || []);
      setPhase('codes');
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-semibold text-sm text-ink flex items-center gap-2">
          <ShieldCheck size={15} className={status?.enabled ? 'text-running' : 'text-ink-faint'} />
          Verificação em 2 etapas (2FA)
        </h2>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status?.enabled ? 'bg-running-soft text-running' : 'bg-raised text-ink-faint'}`}>
          {status ? (status.enabled ? 'Ativa' : 'Desativada') : '...'}
        </span>
      </div>

      <p className="text-sm text-ink-dim mb-3">
        Além da senha, o login pede um código do app autenticador
        (Aegis, 2FAS, Google Authenticator...). Se perder o celular, os códigos
        de recuperação abrem a conta.
        {status?.enabled && status.recoveryLeft !== undefined && (
          <span className={status.recoveryLeft < 3 ? ' text-error font-medium' : ''}>
            {' '}Restam <strong>{status.recoveryLeft}</strong> códigos de recuperação.
          </span>
        )}
      </p>

      {/* ── Estado: exibir o segredo para cadastro no app ── */}
      {phase === 'setup' && (
        <div className="space-y-3 border-t border-line pt-3">
          <p className="text-sm text-ink-dim">
            <strong>1.</strong> Adicione esta conta no seu app autenticador
            (toque em “inserir manualmente” e use a chave abaixo):
          </p>
          <div className="bg-raised rounded-lg p-3 flex items-center justify-between gap-2">
            <code className="text-sm font-mono tracking-wider break-all">{secret}</code>
            <button type="button" onClick={() => copy('secret', secret)} className="shrink-0 text-ink-faint hover:text-ink">
              {copied === 'secret' ? <CheckCheck size={16} className="text-running" /> : <Copy size={16} />}
            </button>
          </div>
          <details className="text-xs text-ink-faint">
            <summary className="cursor-pointer hover:text-ink-dim">Ou use a URI completa (gera QR no próprio app)</summary>
            <code className="block mt-1 break-all font-mono text-[11px]">{uri}</code>
          </details>
          <form onSubmit={confirmSetup} className="space-y-2 border-t border-line pt-3">
            <p className="text-sm text-ink-dim"><strong>2.</strong> Digite o código de 6 dígitos gerado para confirmar:</p>
            <div>
              <Label htmlFor="totp-code">Código</Label>
              <Input id="totp-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="123456" autoFocus required />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={busy}>Ativar 2FA</Button>
              <Button type="button" variant="ghost" onClick={() => { setPhase('idle'); setCode(''); }}>Cancelar</Button>
            </div>
          </form>
        </div>
      )}

      {/* ── Estado: códigos de recuperação (uma vez só) ── */}
      {phase === 'codes' && (
        <div className="space-y-3 border-t border-line pt-3">
          <p className="text-sm text-ink-dim">
            <KeyRound size={14} className="inline mr-1 -mt-0.5" />
            Guarde estes <strong>códigos de recuperação</strong> agora — eles não serão
            mostrados de novo e cada um vale um único login sem o celular:
          </p>
          <div className="bg-raised rounded-lg p-3 grid grid-cols-2 gap-1.5">
            {recoveryCodes.map((c) => (
              <code key={c} className="text-sm font-mono block text-center">{c}</code>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => copy('codes', recoveryCodes.join('\n'))}>
              {copied === 'codes' ? <CheckCheck size={15} /> : <Copy size={15} />} Copiar todos
            </Button>
            <Button type="button" variant="primary" onClick={() => { setPhase('idle'); setRecoveryCodes([]); }}>Guardei os códigos</Button>
          </div>
        </div>
      )}

      {/* ── Estado: desativar ou regenerar (reautenticação por senha) ── */}
      {(phase === 'disable' || phase === 'regen') && (
        <form onSubmit={phase === 'disable' ? disable : regenerate} className="space-y-2 border-t border-line pt-3">
          <p className="text-sm text-ink-dim">
            {phase === 'disable'
              ? 'Confirme com a sua senha para desativar a 2FA:'
              : 'Confirme com a sua senha para gerar novos códigos de recuperação (os antigos param de valer):'}
          </p>
          <div>
            <Label htmlFor="totp-pw">Senha atual</Label>
            <Input id="totp-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant={phase === 'disable' ? 'danger' : 'primary'} loading={busy}>
              {phase === 'disable' ? 'Desativar 2FA' : 'Gerar novos códigos'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setPhase('idle'); setPassword(''); }}>Cancelar</Button>
          </div>
        </form>
      )}

      {phase === 'idle' && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {!status?.enabled ? (
            <Button variant="primary" onClick={beginSetup} loading={busy}>Ativar 2FA</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setPhase('regen')}><KeyRound size={15} /> Novos códigos de recuperação</Button>
              <Button variant="danger" onClick={() => setPhase('disable')}>Desativar 2FA</Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
