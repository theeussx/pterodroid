import { Link, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../stores/AuthContext';

/**
 * Aviso de senha padrão.
 *
 * Antes este banner tinha um "X" que chamava completeSetup() — ou seja,
 * dispensá-lo marcava a configuração como concluída **sem trocar a senha**,
 * e o painel parava de avisar. O aviso existia, mas a única ação óbvia era
 * silenciá-lo.
 *
 * Isso ficou mais grave depois que o painel ganhou terminal: com a senha
 * padrão, quem chegar ao login executa comandos no dispositivo. Agora o
 * banner só some quando a senha é realmente trocada (é a própria rota de
 * troca de senha que marca setup_done), e ele leva direto para lá.
 */
export default function SetupBanner() {
  const { setupDone } = useAuth();
  const { pathname } = useLocation();

  if (setupDone) return null;

  // Na página de configurações o formulário de senha já está à vista;
  // repetir o aviso ali só empurraria o formulário para baixo.
  const onSettings = pathname === '/settings';

  return (
    <div className="bg-error-soft border border-error/30 rounded-lg px-4 py-3 flex items-center gap-3 text-sm mb-4">
      <ShieldAlert size={16} className="text-error shrink-0" />
      <p className="text-ink flex-1">
        <strong>Senha padrão em uso.</strong>{' '}
        Qualquer pessoa que alcance este painel pode gerenciar seus serviços e
        executar comandos pelo terminal.
        {!onSettings && (
          <>
            {' '}
            <Link to="/settings" className="text-error underline underline-offset-2 font-medium">
              Trocar agora
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
