import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../stores/AuthContext';

export default function SetupBanner() {
  const { setupDone, markSetupDone } = useAuth();
  if (setupDone) return null;

  const dismiss = async () => {
    try { await api.completeSetup(); } catch { /* best effort */ }
    markSetupDone();
  };

  return (
    <div className="bg-provisioning-soft border border-provisioning/30 rounded-lg px-4 py-3 flex items-center gap-3 text-sm mb-4">
      <AlertTriangle size={16} className="text-provisioning shrink-0" />
      <p className="text-ink flex-1">
        Você ainda está usando a senha padrão.{' '}
        <Link to="/settings" className="text-provisioning underline underline-offset-2">Troque agora</Link> para manter o painel seguro.
      </p>
      <button onClick={dismiss} className="text-ink-faint hover:text-ink shrink-0" title="Dispensar">
        <X size={16} />
      </button>
    </div>
  );
}
