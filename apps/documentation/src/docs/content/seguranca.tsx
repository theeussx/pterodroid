import { Callout, CodeBlock, C, DocLink, DocTable, H2, P, Ul } from '../../components/docui';
import type { DocPage } from '../types';

export const seguranca: DocPage = {
  slug: 'seguranca',
  title: 'Segurança',
  navLabel: 'Segurança',
  description: 'Senha padrão obrigatória, cifra em repouso, limite de tentativas, trava de força bruta e alertas de queda de serviço do Pterodroid.',
  keywords: ['senha', 'cifra', 'criptografia', 'secret', 'token', 'brute force', 'CORS', 'setup', 'alerta', 'webhook', 'segurança', 'cifra em repouso', 'hash'],
  sourcePath: 'apps/documentation/src/docs/content/seguranca.tsx',
  sections: [
    { id: 'senha-padrao', title: 'Senha padrão (obrigatória trocar)' },
    { id: '2fa', title: 'Dupla verificação (2FA)' },
    { id: 'sessoes', title: 'Sessões revogáveis' },
    { id: 'auditoria', title: 'Auditoria central' },
    { id: 'cifra-em-repouso', title: 'Segredos cifrados em repouso' },
    { id: 'limite-login', title: 'Limite de tentativas de login' },
    { id: 'cors', title: 'CORS configurável' },
    { id: 'alerta', title: 'Alertas de queda de serviço' },
  ],
  render: () => (
    <>
      <Callout type="warning" title="Senha padrão em uso = painel travado">
        Por padrão o painel nasce com <C>admin</C> / <C>admin</C>. Depois de autenticado, TODAS as rotas de negócio
        (serviços, terminal, banco, arquivos, docker) respondem <C>403 SETUP_REQUIRED</C> até a senha ser trocada.
        Isso impede que quem alcançar o login antes de você ganhe execução remota no dispositivo.
      </Callout>
      <P>
        Antes de expor o painel à internet, leia o checklist completo em{' '}
        <DocLink to="/docs/producao">Publicação segura</DocLink> — e confira o que é realmente testado na{' '}
        <DocLink to="/docs/recursos">matriz de recursos</DocLink>.
      </P>

      <H2 id="senha-padrao">Senha padrão (obrigatória trocar)</H2>
      <P>
        A interface não bloqueia o acesso ao formulário de <strong>Alterar senha</strong> — pelo contrário, é para
        onde você é levado. O painel só destrava <C>setup_done</C> quando a senha padrão deixa de existir.
      </P>
      <Ul>
        <li>Enquanto <C>setup_done=false</C>, a sidebar continua aparecendo, mas qualquer navegação redireciona de volta para <strong>Configurações</strong>.</li>
        <li>O backend também bloqueia as rotas (defesa em profundidade) — mesmo chamando a API diretamente, você recebe <C>403</C>.</li>
        <li>A nova senha precisa ter <strong>pelo menos 8 caracteres</strong> e ser diferente da atual.</li>
      </Ul>

      <H2 id="2fa">Dupla verificação (2FA)</H2>
      <P>
        Em <strong>Configurações → Verificação em 2 etapas</strong> você ativa um segundo fator TOTP (Aegis, 2FAS,
        Google Authenticator...). O segredo é cifrado em repouso e só passa a valer para o login quando o primeiro
        código correto é apresentado — um segredo pendente não tranca por acidente. Na ativação o painel emite{' '}
        <strong>8 códigos de recuperação</strong> de uso único (formato <C>XXXX-XXXX</C>), mostrados uma única vez;
        no banco ficam apenas os <strong>hashes</strong>.
      </P>
      <Ul>
        <li>Com 2FA ativo, o login sem código volta <C>401 TOTP_REQUIRED</C> — a interface então pede o código (ou um código de recuperação).</li>
        <li>Desativar ou regenerar recuperação exige digitar a <strong>senha</strong> de novo (reautenticação para ações sensíveis).</li>
        <li>Os códigos TOTP errados contam para a trava de força bruta; pedidos apenas de relatório de código (<C>TOTP_REQUIRED</C>), não.</li>
      </Ul>

      <H2 id="sessoes">Sessões revogáveis</H2>
      <P>
        Cada login vira uma <strong>sessão com identidade própria</strong> (o <C>jti</C> do JWT): você vê em
        Configurações quais dispositivos ainda estão conectados (navegador e IP de origem) e pode{' '}
        <strong>encerrar qualquer um à distância</strong> — o token daquele dispositivo morre na próxima
        requisição, não em 7 dias, quando o JWT expiraria.
      </P>
      <Ul>
        <li><strong>Trocar a senha</strong> encerra automaticamente todas as outras sessões (um invasor logado é despejado na hora).</li>
        <li><strong>Sair (logout)</strong> revoga só a sessão atual; <strong>“Encerrar todas as outras”</strong> revoga as demais.</li>
        <li>Tokens emitidos por versões antigas (sem <C>jti</C>) deixam de valer e ganham <C>401</C> pedindo novo login — os dispositivos precisam entrar de novo uma única vez.</li>
        <li>O socket de logs ao vivo também exige token válido no handshake: sessão revogada não conecta de novo.</li>
      </Ul>

      <H2 id="auditoria">Auditoria central</H2>
      <P>
        Na página <strong>Logs → Auditoria</strong> fica a trilha completa: quem logou (e de que IP), falhas de
        login e bloqueios, ativações/desativações de 2FA, sessões encerradas, criação/edição/remoção de serviços e
        bancos, backups, hosts Docker, túneis, edições de configuração e todas as operações de arquivo/terminal que
        já existiam. Filtre por ação, usuário, período ou texto livre.
      </P>

      <H2 id="cifra-em-repouso">Segredos cifrados em repouso</H2>
      <P>
        <strong>Cifrados antes de ir para o banco:</strong> <C>git_token</C> dos serviços, <strong>senhas das
        instâncias de banco de dados</strong>, <strong>chaves/certificados TLS dos hosts Docker</strong>,{' '}
        <strong>token do Cloudflare Tunnel</strong> e o <strong>segredo TOTP</strong> do 2FA. O painel só devolve o
        valor em claro para o código que precisa dele de verdade; quem lê o arquivo <C>panel.db</C> cru não vê os
        segredos.
      </P>
      <P>
        Bancos de instalações antigas com os valores em texto puro são cifrados automaticamente na inicialização
        seguinte (migração idempotente, sem intervenção do usuário). A chave da cifra deriva de <C>JWT_SECRET</C> —
        trocar a secret invalida os segredos guardados (re-cadastre-os depois de trocá-la); uma chave mestra
        separada é item previsto da Fase 3 do roadmap.
      </P>

      <H2 id="limite-login">Limite de tentativas de login</H2>
      <P>
        Há uma trava de força bruta por <C>IP + usuário</C>: tentativas erradas consecutivas ficam
        progressivamente mais lentas e, depois de ~8 falhas, o login responde <C>429</C> com cabeçalho{' '}
        <C>Retry-After</C> — mesmo que a senha digitada esteja certa. Cada usuário tem contador próprio, então um
        atacante a um usuário inventado não derruba o dono do painel.
      </P>

      <H2 id="cors">CORS configurável</H2>
      <P>
        Por padrão o painel aceita qualquer origem. Como a autenticação é por <strong>Bearer token</strong>
        (sem cookies), o risco clássico de CSRF não se aplica. Para restringir, defina a variável
        <C> CORS_ORIGINS</C> com uma lista separada por vírgula.
      </P>
      <CodeBlock lang="bash" code={`CORS_ORIGINS="https://meu.dominio,https://painel.meu.dominio"`} />

      <H2 id="alerta">Alertas de queda de serviço</H2>
      <P>
        Quando um serviço cai ou entra em <strong>crash-loop</strong>, o painel reinicia sozinho (se <C>auto_restart</C> estiver
        ativo). Além disso, pode notificar você num webhook configurado em <strong>Configurações</strong>:
      </P>
      <DocTable
        head={['Alerta', 'Quando dispara']}
        rows={[
          ['Serviço caiu', 'Processo morreu com código ≠ 0; o painel vai tentar reiniciar.'],
          ['Crash-loop', 'Esgotou as <code>max_restarts</code> tentativas consecutivas.'],
          ['Painel iniciou', 'O Pterodroid subiu (útil para perceber reinício inesperado).'],
        ]}
      />
      <P>
        O webhook aceita Telegram Bot API, Discord, Slack, ntfy.sh ou qualquer endpoint JSON. Há um botão{' '}
        <strong>Enviar alerta de teste</strong> em Configurações, e um cooldown de 5 minutos por serviço evita spam
        em crash-loops.
      </P>
      <P>
        O <strong>healthcheck</strong> por serviço é a camada que pega "o processo está vivo mas não responde": se a
        URL de verificação falhar por mais que o timeout, o processo é encerrado e reiniciado como um crash. Os
        campos aparecem no formulário do serviço e ficam no banco mesmo após reinícios.
      </P>
    </>
  ),
};
