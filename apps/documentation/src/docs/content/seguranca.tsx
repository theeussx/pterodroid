import { Callout, CodeBlock, C, DocTable, H2, P, Ul } from '../../components/docui';
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

      <H2 id="cifra-em-repouso">Segredos cifrados em repouso</H2>
      <P>
        <C>git_token</C> (para clonar repositórios) e o conteúdo do <C>environment</C> de cada serviço são
        <strong> cifrados</strong> antes de ir para o banco. O painel só devolve o valor em claro para o dono
        autenticado; quem lê o arquivo <C>panel.db</C> cru não vê os segredos.
      </P>
      <P>Serviços antigos que guardaram <C>git_token</C> em texto puro são migrados automaticamente na inicialização.</P>

      <H2 id="limite-login">Limite de tentativas de login</H2>
      <P>
        Há uma trava de força bruta por <C>IP + usuário</C>: tentativas erradas consecutivas ficam
        progressivamente mais lentas e, depois de ~12 falhas, o login responde <C>429</C> com cabeçalho
        <C> Retry-After</C> — mesmo que a senha digitada esteja certa. Cada usuário tem contador próprio, então um
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
        O webhook aceita Telegram Bot API, Discord, Slack, ntfy.sh ou qualquer endpoint JSON. Há um botão
        <strong> Enviar alerta de teste</strong> em Configurações, e um cooldown de 5 minutos por serviço evita spam
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
