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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Falha ao entrar');
    } finally {
      setLoading(false);
    }
  };

 return (
  <div className="min-h-screen flex items-center justify-center px-4">
    <div className="w-full max-w-sm">
      <div className="flex flex-col items-center mb-8">
        <img src="public/images/logo.jpg" alt="Pterodroid" 
          className="w-12 h-12 object-contain mb-4"
        />
        <h1 className="font-display font-semibold text-xl text-ink">Pterodroid</h1>
        <p className="text-sm text-ink-faint mt-1">Painel pessoal de hospedagem</p>
      </div>

        <form onSubmit={handleSubmit} className="bg-surface border border-line rounded-xl p-6 space-y-4">
          <div>
            <Label htmlFor="username">Usuário</Label>
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" loading={loading}>
            Entrar
          </Button>
        </form>
        <p className="text-center text-xs text-ink-faint mt-4">
          Primeiro acesso? Usuário <code className="text-ink-dim font-mono">admin</code> / senha <code className="text-ink-dim font-mono">admin</code>
        </p>
      </div>
    </div>
  );
}
