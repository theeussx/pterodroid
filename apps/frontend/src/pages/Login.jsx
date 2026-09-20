import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../stores/AuthContext';
import { Input, Label } from '../components/Field';
import Button from '../components/Button';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  // step: 'credenciais' → 'totp' (só quando a conta tem 2FA ativo)
  const [step, setStep] = useState('credentials');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password, step === 'totp' ? totp.trim() : undefined);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      if (err.code === 'TOTP_REQUIRED' && step !== 'totp') {
        // Credenciais certas — o backend agora quer também o código do
        // app autenticador (ou um código de recuperação).
        setStep('totp');
        setError('');
      } else {
        // Código TOTP errado, login bloqueado por tentativas etc. chegam
        // aqui como erro comum — limpa o campo para nova tentativa.
        if (step === 'totp') setTotp('');
        setError(err.message || 'Falha ao entrar');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/images/logo.jpg" alt="Pterodroid"
            className="w-12 h-12 object-contain mb-4"
          />
          <h1 className="font-display font-semibold text-xl text-ink">Pterodroid</h1>
          <p className="text-sm text-ink-faint mt-1">Painel pessoal de hospedagem</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface border border-line rounded-xl p-6 space-y-4">
          {step === 'totp' ? (
            <>
              <div className="text-sm text-ink-dim">
                Sua conta tem verificação em 2 etapas ativa. Digite o código do
                app autenticador — ou um <strong>código de recuperação</strong>.
              </div>
              <div>
                <Label htmlFor="totp">Código de verificação</Label>
                <Input
                  id="totp"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  placeholder="123456"
                  autoFocus
                  required
                />
                <p className="text-xs text-ink-faint mt-1">
                  Recuperação no formato XXXX-XXXX.
                </p>
              </div>
              <Button type="submit" variant="primary" className="w-full" loading={loading}>
                Verificar e entrar
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-ink-faint hover:text-ink-dim"
                onClick={() => { setStep('credentials'); setError(''); setTotp(''); }}
              >
                ← Voltar e trocar usuário/senha
              </button>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="username">Usuário</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
              </div>
              <div>
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </div>
              <Button type="submit" variant="primary" className="w-full" loading={loading}>
                Entrar
              </Button>
            </>
          )}
          {error && <p className="text-xs text-error">{error}</p>}
        </form>
        <p className="text-center text-xs text-ink-faint mt-4">
          Primeiro acesso? Usuário <code className="text-ink-dim font-mono">admin</code> / senha <code className="text-ink-dim font-mono">admin</code>
        </p>
      </div>
    </div>
  );
}
