import { C, Callout, CodeBlock, DocLink, DocTable, Ext, H2, P, Steps, Tabs, Ul } from '../../components/docui';
import { site } from '../../site';
import type { DocPage } from '../types';

export const primeiroAcesso: DocPage = {
  slug: 'primeiro-acesso',
  title: 'Primeiro acesso',
  description: 'Do painel recém-instalado ao login seguro: credenciais padrão, troca de senha e verificação do ambiente.',
  keywords: ['login', 'admin', 'senha padrão', 'trocar senha', 'primeiro login', 'credenciais', '3001', 'configuração inicial'],
  sourcePath: 'apps/documentation/src/docs/content/firstSteps.tsx',
  sections: [
    { id: 'fluxo', title: 'O fluxo completo' },
    { id: 'credenciais', title: 'Credenciais padrão' },
    { id: 'verificar', title: 'Verificar se está tudo certo' },
    { id: 'erros-comuns', title: 'Erros comuns no primeiro acesso' },
  ],
  render: () => (
    <>
      <H2 id="fluxo">O fluxo completo</H2>
      <Steps
        items={[
          { title: 'Instalação concluída', body: <>Qualquer um dos métodos: <DocLink to="/docs/termux">Termux</DocLink>, <DocLink to="/docs/proot">proot</DocLink>, <DocLink to="/docs/docker">Docker</DocLink> ou <DocLink to="/docs/linux">Linux</DocLink>.</> },
          { title: 'Iniciar o painel', body: <><C>./panelctl.sh start</C> (Termux/proot/Linux) ou <C>docker compose up -d</C> (Docker).</> },
          { title: 'Abrir o navegador', body: <><C>http://localhost:3001</C> — ou <C>http://&lt;ip-do-dispositivo&gt;:3001</C> de outro aparelho na mesma rede.</> },
          { title: 'Login', body: <>Usuário <C>admin</C>, senha <C>admin</C>.</> },
          { title: 'Configuração inicial', body: 'Troque a senha em Configurações. O aviso no topo da tela só desaparece quando a senha for realmente trocada.' },
          { title: 'Criar o primeiro serviço', body: <>Siga <DocLink to="/docs/primeiro-servico">Primeiro serviço</DocLink>.</> },
        ]}
      />

      <H2 id="credenciais">Credenciais padrão</H2>
      <DocTable head={['Campo', 'Valor']} rows={[[<strong key="u">Usuário</strong>, <C key="uv">admin</C>], [<strong key="p">Senha</strong>, <C key="pv">admin</C>]]} />
      <Callout type="danger" title="Troque a senha imediatamente">
        <p>
          O painel tem um <DocLink to="/docs/terminal">terminal embutido</DocLink>: quem alcançar o login com a senha
          padrão consegue executar comandos no seu dispositivo. A troca é feita na seção de Configurações do painel, e
          o banner de aviso permanece até que a senha seja alterada de fato.
        </p>
      </Callout>
      <P>
        A autenticação usa <strong>JWT com validade de 7 dias</strong> e as senhas são armazenadas com hash{' '}
        <C>bcryptjs</C>.
      </P>

      <H2 id="verificar">Verificar se está tudo certo</H2>
      <CodeBlock
        platform="qualquer"
        title="suite de testes do backend"
        code={`cd apps/backend && npm test`}
        description="mais de 160 testes. Não exigem Docker instalado e nunca tocam no seu painel real — rodam em diretórios temporários e numa porta separada."
      />

      <H2 id="erros-comuns">Erros comuns no primeiro acesso</H2>
      <DocTable
        head={['Sintoma', 'Causa provável', 'Solução']}
        rows={[
          ['Página em branco', 'Frontend não compilado', <><C>cd apps/frontend && npm install && npm run build</C></>],
          ['Painel não responde', 'Backend não subiu', <><C>./panelctl.sh logs</C> ou <C>docker compose logs -f</C></>],
          [<>Erro de porta ao iniciar</>, <>Porta <C>3001</C> ocupada</>, <>Defina <C>PORT=3002</C> no <C>apps/backend/.env</C> (ou no <C>.env</C> da raiz, no Docker)</>],
          ['Não abre de outro aparelho', 'Usando localhost fora do dispositivo', <>Use o IP local do aparelho: <C>http://&lt;ip&gt;:3001</C></>],
        ]}
      />
      <P>
        Central completa de problemas: <DocLink to="/docs/troubleshooting">Troubleshooting</DocLink>.
      </P>
    </>
  ),
};

export const configuracao: DocPage = {
  slug: 'configuracao',
  title: 'Configuração (.env)',
  navLabel: 'Configuração (.env)',
  description: 'Referência completa das variáveis de ambiente do Pterodroid: onde fica o .env, caminhos, permissões, Docker, limites, logs, backup e acesso remoto.',
  keywords: ['env', 'PORT', 'JWT_SECRET', 'DATA_ROOT', 'WORKSPACES_ROOT', 'FILES_ROOT', 'HOST_WORKSPACES_ROOT', 'DOCKER_HOST', 'DOCKER_GID', 'UPLOAD_MAX_BYTES', 'EDITOR_MAX_BYTES', 'CLOUDFLARED_BIN', 'CORS_ORIGINS', 'BACKUPS_ROOT', 'variáveis de ambiente', 'permissões', 'chown'],
  sourcePath: 'apps/documentation/src/docs/content/firstSteps.tsx',
  sections: [
    { id: 'onde-fica', title: 'Onde fica o .env' },
    { id: 'basico', title: 'Básico' },
    { id: 'caminhos', title: 'Caminhos e permissões' },
    { id: 'docker', title: 'Docker' },
    { id: 'limites', title: 'Limites, logs e backup' },
    { id: 'seguranca', title: 'Segurança e CORS' },
    { id: 'remoto', title: 'Acesso remoto' },
    { id: 'dados', title: 'Onde ficam seus dados' },
  ],
  render: () => (
    <>
      <P>
        <strong>Nenhuma variável é obrigatória</strong> — o painel funciona com zero configuração, usando os padrões
        abaixo com segurança. O arquivo de referência é o <Ext href={site.repo.envExample}>.env.example</Ext> na raiz
        do repositório.
      </P>
      <H2 id="onde-fica">Onde fica o .env</H2>
      <DocTable
        head={['Instalação', 'Local do .env', 'Quem lê']}
        rows={[
          ['Docker', <><C>.env</C> na <strong>raiz do projeto</strong></>, 'O docker-compose (passa JWT_SECRET/HOST_WORKSPACES_ROOT para o container).'],
          ['Termux / proot / Linux', <><C>apps/backend/.env</C></>, 'O backend (config.js carrega esse arquivo, não o da raiz).'],
        ]}
      />
      <Callout type="note">
        <p>
          No Docker, o <C>.env</C> da raiz não é lido pelo backend diretamente — o compose injeta as variáveis no
          container. Em instalações locais, os valores do <C>apps/backend/.env</C> são carregados pelo Node.
        </p>
      </Callout>

      <H2 id="basico">Básico</H2>
      <DocTable
        head={['Variável', 'Padrão', 'Descrição', 'Risco se ignorado']}
        rows={[
          [<C key="1">PORT</C>, <C key="1b">3001</C>, 'Porta do backend (e da interface, servida por ele).', 'Baixo — mude apenas se a porta estiver ocupada.'],
          [<C key="2">JWT_SECRET</C>, 'gerado no boot', <>Segredo dos tokens de login. Sem definir, o painel gera e salva em <C>&lt;DATA_ROOT&gt;/.jwt-secret</C>. Gere com <C>openssl rand -hex 32</C>.</>, 'Médio — quem lê o arquivo do disco consegue forjar tokens.'],
          [<C key="3">CORS_ORIGINS</C>, '<C>*</C> (vazio)', <>Lista separada por vírgula de origens permitidas — ex.: <C>https://painel.meu.dominio</C>. Autenticação é por Bearer (sem cookies), então CSRF não se aplica, mas restringir reduz superfície.</>, 'Médio em instância pública — qualquer site pode chamar a API com um token vazado.'],
        ]}
      />
      <CodeBlock
        lang="bash"
        title="exemplo seguro (Termux/Linux)"
        code={`echo "JWT_SECRET=$(openssl rand -hex 32)" >> apps/backend/.env\necho 'CORS_ORIGINS="https://painel.meu.dominio"' >> apps/backend/.env`}
        description="Gere o segredo e restrinja o CORS antes de expor o painel via Cloudflare Tunnel."
      />

      <H2 id="caminhos">Caminhos e permissões</H2>
      <DocTable
        head={['Variável', 'Padrão', 'Descrição']}
        rows={[
          [<C key="1">DATA_ROOT</C>, <>raiz do projeto <C>data/</C></>, <>Onde fica <strong>tudo</strong> (banco, workspaces, bancos provisionados, backups e cloudflared). No Docker, o compose monta <C>./data</C> do host em <C>/data</C>.</>],
          [<C key="2">WORKSPACES_ROOT</C>, <C key="2b">&lt;DATA_ROOT&gt;/workspaces</C>, 'Raiz única dos workspaces; cada serviço ganha uma subpasta exclusiva.'],
          [<C key="3">FILES_ROOT</C>, <C key="3b">= WORKSPACES_ROOT</C>, <>Raiz do gerenciador de arquivos global. Aponte para <C>$HOME</C> para navegar o dispositivo inteiro — nunca em instância pública.</>],
          [<C key="4">HOST_WORKSPACES_ROOT</C>, '—', <>Só quando o painel roda <strong>dentro</strong> de um container e cria outros no host: caminho dos workspaces <strong>como o host os enxerga</strong> (senão os bind mounts apontam para um caminho que não existe).</>],
          [<C key="5">BACKUPS_ROOT</C>, <C key="5b">&lt;DATA_ROOT&gt;/backups</C>, 'Onde os ZIPs de backup por serviço ficam (fora da raiz de workspaces).'],
          [<C key="6">DB_PATH</C>, <C key="6b">&lt;DATA_ROOT&gt;/panel.db</C>, 'Caminho do arquivo do SQLite do painel.'],
        ]}
      />
      <Callout type="important" title="Permissões: quem roda o painel é dono dos dados">
        <p>
          O processo do painel precisa <strong>ler e escrever</strong> em <C>data/</C>. No Termux isso é natural. No
          proot, rodando como root, PostgreSQL/MariaDB recusam iniciar — use um usuário comum (o{' '}
          <C>install-ubuntu-proot.sh</C> oferece criar um). Restaurando um backup como root, ajuste:
          <CodeBlock lang="bash" code={`chown -R $(id -u):$(id -g) data`} />
        </p>
      </Callout>

      <H2 id="docker">Docker</H2>
      <DocTable
        head={['Variável', 'Padrão', 'Descrição']}
        rows={[
          [<C key="1">DOCKER_HOST</C>, 'auto', <>Host Docker no formato da CLI (<C>unix://</C> ou <C>tcp://</C>). Detectado automaticamente; também aceito via env no modo local (atalho para um único host).</>],
          [<C key="2">DOCKER_API_VERSION</C>, <C key="2b">v1.43</C>, 'Versão da API da Engine a ser usada no cliente embutido.'],
          [<C key="3">DOCKER_GID</C>, '—', <>GID do grupo <C>docker</C> do host (usado pelo <C>docker-compose.yml</C> via <C>group_add</C>). Descubra com <C>getent group docker | cut -d: -f3</C>.</>],
        ]}
      />
      <Callout type="warning" title="docker.sock = privilégio de host">
        <p>
          O compose monta <C>/var/run/docker.sock</C> por padrão. Se você não usa serviços em container, remova a linha
          do <C>docker-compose.yml</C> — é o acesso de maior privilégio que o painel pode ter.
        </p>
      </Callout>

      <H2 id="limites">Limites, logs e backup</H2>
      <DocTable
        head={['Variável', 'Padrão', 'Descrição']}
        rows={[
          [<C key="1">UPLOAD_MAX_BYTES</C>, '2 GB', 'Tamanho máximo de upload por arquivo, em bytes.'],
          [<C key="2">EDITOR_MAX_BYTES</C>, '2 MB', 'Tamanho máximo que o editor do painel abre.'],
          [<C key="3">JSON_BODY_LIMIT</C>, <C key="3b">8mb</C>, 'Limite do corpo JSON (precisa caber um arquivo do editor + escape).'],
          [<C key="4">LOG_MAX_MEMORY</C>, <C key="4b">500</C>, 'Linhas de log por serviço mantidas em memória.'],
          [<C key="5">LOG_MAX_DB</C>, <C key="5b">1000</C>, 'Linhas de log por serviço persistidas no banco.'],
          [<C key="6">LOG_PRUNE_INTERVAL_MS</C>, <C key="6b">1800000</C>, 'Intervalo de limpeza dos logs persistidos (30 min).'],
          [<C key="7">RESTART_STABLE_MS</C>, <C key="7b">60000</C>, 'Tempo que um serviço precisa ficar de pé para o contador de reinícios zerar.'],
          [<C key="8">MAX_BACKUPS_PER_SERVICE</C>, <C key="8b">10</C>, 'Quantidade máxima de backups ZIP mantidos por serviço.'],
        ]}
      />

      <H2 id="seguranca">Segurança e CORS</H2>
      <Ul>
        <li><C>CORS_ORIGINS</C> — restringir em instância pública (ver tabela Básico).</li>
        <li><C>JWT_SECRET</C> — valor forte e estável; trocá-lo invalida todos os tokens.</li>
        <li><C>CLOUDFLARED_BIN</C> — caminho do binary se não estiver no PATH.</li>
        <li>Não há variável para expor a porta: no Docker, a porta é publicada com <C>PTERODROID_PORT</C> no compose.</li>
      </Ul>
      <P>
        Detalhes de senha padrão, cifra e rate limit: <DocLink to="/docs/seguranca">Segurança</DocLink>. Checklist para
        expor: <DocLink to="/docs/producao">Publicação segura</DocLink>.
      </P>

      <H2 id="remoto">Acesso remoto</H2>
      <DocTable
        head={['Variável', 'Padrão', 'Descrição']}
        rows={[[<C key="1">CLOUDFLARED_BIN</C>, <C key="1b">cloudflared</C>, 'Caminho do binário do cloudflared, caso não esteja no PATH — usado por Quick e Named Tunnels.']]}
      />

      <H2 id="dados">Onde ficam seus dados</H2>
      <DocTable
        head={['Instalação', 'Caminho']}
        rows={[
          ['Termux / proot / Linux', <C key="1">data/</C>],
          ['Docker', <><C>./data/</C> (na raiz do projeto, montado em <C>/data</C> no container)</>],
        ]}
      />
      <Callout type="tip" title="Backup = copiar a pasta de dados">
        <p>
          A pasta contém o banco, os workspaces de todos os serviços, os bancos provisionados, os backups por serviço e
          a configuração do cloudflared. Para começar do zero, apague-a. Procedimento completo:{' '}
          <DocLink to="/docs/backup">Backup e restauração</DocLink>.
        </p>
      </Callout>
    </>
  ),
};

export const primeiroServico: DocPage = {
  slug: 'primeiro-servico',
  title: 'Criando o primeiro serviço',
  navLabel: 'Primeiro serviço',
  description: 'Passo a passo para criar, configurar e iniciar seu primeiro serviço no Pterodroid — com exemplos reais.',
  keywords: ['criar serviço', 'runtime', 'workspace', 'main_file', 'git clone', 'npm install', 'discord bot', 'api', 'node', 'typescript', 'watchdog', 'auto-update', 'starter', 'receita', 'tipo dedicado', 'template', 'scaffold', 'minecraft', 'site estático', 'python'],
  sourcePath: 'apps/documentation/src/docs/content/firstSteps.tsx',
  sections: [
    { id: 'passo-a-passo', title: 'Passo a passo' },
    { id: 'tipos-dedicados', title: 'Tipos dedicados (receitas)' },
    { id: 'config-inicial', title: 'Configuração inicial do serviço' },
    { id: 'exemplos', title: 'Exemplos reais' },
    { id: 'watchdog', title: 'Watchdog e reinício automático' },
  ],
  render: () => (
    <>
      <H2 id="passo-a-passo">Passo a passo</H2>
      <Steps
        items={[
          { title: 'Criar serviço', body: 'No painel, clique em "Novo serviço".' },
          { title: 'Escolher o tipo dedicado', body: <>O painel pergunta "o que você quer hospedar?". Escolha uma <strong>receita</strong> dedicada — API Node.js, bot, site estático, servidor Minecraft, API Python ou container Docker. Cada uma já traz a porta, o comando de início e, se for o caso, um projeto inicial de exemplo.</> },
          { title: 'Definir o nome', body: <>O nome define o workspace: <C>&lt;DATA_ROOT&gt;/workspaces/&lt;nome-do-serviço&gt;</C>, criado automaticamente. Você nunca precisa mexer no sistema de arquivos manualmente.</> },
          { title: 'Ajustar o que precisar', body: 'O formulário já vem preenchido com os defaults do tipo. Se quiser, troque a porta, adicione Git, variáveis de ambiente ou um comando de inicialização próprio na "Configuração inicial".' },
          { title: 'Opcional: configurar Git', body: 'Aponte repositório e branch; o painel dispara git clone e instala dependências (npm ou pip) em background quando necessário.' },
          { title: 'Salvar e iniciar', body: 'Salve e clique em iniciar.' },
          { title: 'Abrir os logs', body: 'Acompanhe stdout/stderr ao vivo (WebSocket) na aba de logs.' },
          { title: 'Verificar o status', body: 'O card do serviço mostra o estado atual; o watchdog cuida de quedas inesperadas.' },
        ]}
      />

      <H2 id="tipos-dedicados">Tipos dedicados (receitas)</H2>
      <P>
        Em vez de um formulário genérico, o Pterodroid oferece <strong>receitas dedicadas</strong> por tipo de serviço,
        no espírito dos <em>eggs</em>/<em>nests</em> de painéis como o Pterodactyl. Você escolhe o que quer hospedar e o
        painel guia pelo caminho certo:
      </P>
      <DocTable
        head={['Receita', 'O que é', 'Já vem com']}
        rows={[
          ['API Node.js', 'Servidor HTTP em Node/Express', 'porta 3000, comando node, starter com package.json e src/index.js'],
          ['Bot (Discord/Telegram)', 'Bot em Node, rodando em background', 'starter Node, token via variável de ambiente'],
          ['Site Node.js', 'Web app servido por Node', 'porta 3000, starter que serve uma pasta public/'],
          ['Site estático', 'HTML/CSS/JS puros, sem build', 'porta 8080, comando python http.server, index.html pronto'],
          ['API Python', 'Flask/FastAPI ou http.server', 'porta 8000, app.py + requirements.txt, pip install automático'],
          ['Servidor Minecraft', 'Servidor Java (Paper/Spigot/Vanilla)', 'porta 25565, comando java, eula.txt e server.properties de exemplo'],
          ['Container Docker', 'Qualquer imagem em host Docker', 'runtime docker, bind mount automático do workspace'],
          ['Geral / customizado', 'Qualquer comando ou processinho', 'workspace vazio, você define tudo'],
        ]}
      />
      <P>
        Ao escolher a receita, vários campos já vêm preenchidos (porta, comando, runtime) e, quando a receita tem{' '}
        <strong>template</strong>, você pode pedir um <em>projeto inicial de exemplo</em> — criado na hora na pasta do
        serviço. O tipo continua editável depois, então nada trava.
      </P>
      <Callout type="note" title="Tipos antigos continuam funcionando">
        <p>
          Serviços criados antes deste recurso usam o campo <C>type</C> (node, bot, api, web, python, shell). O painel
          deriva a receita mais próxima para exibir o rótulo e o ícone corretos — nada é quebrado, você pode editar e
          escolher uma receita a qualquer momento.
        </p>
      </Callout>

      <H2 id="config-inicial">Configuração inicial do serviço</H2>
      <P>
        Cada serviço tem uma aba de configuração inicial (no modal de detalhes), <strong>persistente e editável</strong>{' '}
        após a criação:
      </P>
      <Ul>
        <li>repositório Git e branch;</li>
        <li>arquivo principal (<C>main_file</C>) ou comando completo;</li>
        <li>instalação automática de dependências (<C>npm install</C> em background);</li>
        <li>argumentos de execução, auto-update e permissões de upload.</li>
      </Ul>
      <Callout type="tip" title="Starter Node/TypeScript automático">
        <p>
          Para projetos Node/TypeScript, se o workspace ainda não existe, o painel semeia um starter mínimo com{' '}
          <C>package.json</C>, <C>tsconfig.json</C> e <C>src/index.ts</C> — o primeiro boot funciona sem montar nada à
          mão.
        </p>
      </Callout>

      <H2 id="exemplos">Exemplos reais</H2>
      <Tabs
        tabs={[
          {
            label: 'API Node/TS',
            content: (
              <>
                <P>Escolha a receita <strong>API Node.js</strong>. O painel preenche porta 3000 e o comando <C>node src/index.js</C>; se você ativar o template, gera <C>package.json</C> e <C>src/index.js</C> de exemplo. Edite o código direto no <DocLink to="/docs/arquivos">gerenciador de arquivos</DocLink>.</P>
              </>
            ),
          },
          {
            label: 'Bot de Discord',
            content: (
              <>
                <P>Escolha a receita <strong>Bot (Discord/Telegram)</strong>. Na configuração inicial, aponte o repositório Git do bot e a branch; ative a instalação automática de dependências. Guarde o token do bot como variável de ambiente (chave <C>TOKEN</C>), editável pelo painel.</P>
              </>
            ),
          },
          {
            label: 'Site estático',
            content: (
              <>
                <P>Escolha a receita <strong>Site estático</strong>: o painel traz a porta 8080, o comando <C>python3 -m http.server</C> e um <C>index.html</C> de exemplo. Envie seus arquivos pelo upload do gerenciador de arquivos, sem build.</P>
              </>
            ),
          },
          {
            label: 'Servidor Minecraft',
            content: (
              <>
                <P>Escolha a receita <strong>Servidor Minecraft</strong>: porta 25565, comando Java e arquivos <C>eula.txt</C>/<C>server.properties</C> de exemplo. Basta colocar o <C>server.jar</C> na pasta do serviço e iniciar (requer Java instalado).</P>
              </>
            ),
          },
          {
            label: 'Container Docker',
            content: (
              <>
                <P>Escolha a receita <strong>Container Docker</strong>: o runtime já vem como container e o painel monta o bind mount do workspace. Detalhes e ressalvas em <DocLink to="/docs/docker-services">Serviços Docker</DocLink>.</P>
              </>
            ),
          },
        ]}
      />

      <H2 id="watchdog">Watchdog e reinício automático</H2>
      <P>
        Um watchdog integrado reinicia <strong>serviços</strong> automaticamente em caso de falha inesperada, com
        política de <em>backoff</em> configurável (<C>RESTART_STABLE_MS</C> controla quando o contador de reinícios
        zera).
      </P>
      <Callout type="warning">
        <p>
          <strong>Bancos de dados não são reiniciados automaticamente</strong> — decisão deliberada para evitar
          corrupção de dados. Veja <DocLink to="/docs/bancos">Bancos de dados</DocLink>.
        </p>
      </Callout>
    </>
  ),
};
