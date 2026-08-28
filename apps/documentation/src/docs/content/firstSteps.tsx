import { C, Callout, CodeBlock, DocLink, DocTable, Ext, H2, P, Steps, Tabs, Ul } from '../../components/docui';
import { site } from '../../site';
import type { DocPage } from '../types';

export const primeiroAcesso: DocPage = {
  slug: 'primeiro-acesso',
  title: 'Primeiro acesso',
  description: 'Do painel recém-instalado ao login seguro: credenciais padrão, troca de senha e verificação do ambiente.',
  keywords: ['login', 'admin', 'senha padrão', 'trocar senha', 'primeiro login', 'credenciais', '3001', 'configuração inicial'],
  sourcePath: 'README.md',
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
        code={`cd backend && npm test`}
        description="163 testes. Não exigem Docker instalado e nunca tocam no seu painel real — rodam em diretórios temporários e numa porta separada."
      />

      <H2 id="erros-comuns">Erros comuns no primeiro acesso</H2>
      <DocTable
        head={['Sintoma', 'Causa provável', 'Solução']}
        rows={[
          ['Página em branco', 'Frontend não compilado', <><C>cd frontend && npm install && npm run build</C></>],
          ['Painel não responde', 'Backend não subiu', <><C>./panelctl.sh logs</C> ou <C>docker compose logs -f</C></>],
          [<>Erro de porta ao iniciar</>, <>Porta <C>3001</C> ocupada</>, <>Defina <C>PORT=3002</C> no <C>backend/.env</C> (ou no <C>.env</C> da raiz, no Docker)</>],
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
  description: 'Referência completa das variáveis de ambiente do Pterodroid: portas, caminhos, Docker, limites e cloudflared.',
  keywords: ['env', 'PORT', 'JWT_SECRET', 'DATA_ROOT', 'WORKSPACES_ROOT', 'FILES_ROOT', 'HOST_WORKSPACES_ROOT', 'DOCKER_HOST', 'UPLOAD_MAX_BYTES', 'EDITOR_MAX_BYTES', 'CLOUDFLARED_BIN', 'variáveis de ambiente'],
  sourcePath: '.env.example',
  sections: [
    { id: 'onde-fica', title: 'Onde fica o .env' },
    { id: 'basico', title: 'Básico' },
    { id: 'caminhos', title: 'Caminhos' },
    { id: 'docker', title: 'Docker' },
    { id: 'limites', title: 'Limites e logs' },
    { id: 'remoto', title: 'Acesso remoto' },
    { id: 'dados', title: 'Onde ficam seus dados' },
  ],
  render: () => (
    <>
      <P>
        <strong>Tudo é opcional</strong> — o painel funciona com zero configuração. O arquivo de referência é o{' '}
        <Ext href={site.repo.envExample}>.env.example</Ext> na raiz do repositório.
      </P>
      <H2 id="onde-fica">Onde fica o .env</H2>
      <DocTable
        head={['Instalação', 'Local do .env']}
        rows={[
          ['Docker', <>Copie para <C>.env</C> na <strong>raiz do projeto</strong> (o compose lê daqui).</>],
          ['Termux / proot / Linux', <>Copie para <C>backend/.env</C>.</>],
        ]}
      />

      <H2 id="basico">Básico</H2>
      <DocTable
        head={['Variável', 'Padrão', 'Descrição']}
        rows={[
          [<C key="1">PORT</C>, <C key="1b">3001</C>, 'Porta em que o backend (e a interface, servida por ele) escuta.'],
          [<C key="2">JWT_SECRET</C>, 'gerado', <>Segredo dos tokens de login. Sem definir, o painel gera e salva em <C>&lt;DATA_ROOT&gt;/.jwt-secret</C>. Gere um forte com <C>openssl rand -hex 32</C>.</>],
        ]}
      />

      <H2 id="caminhos">Caminhos</H2>
      <DocTable
        head={['Variável', 'Padrão', 'Descrição']}
        rows={[
          [<C key="1">DATA_ROOT</C>, <C key="1b">./data</C>, <>Onde fica <strong>tudo</strong>: banco, workspaces e configuração do cloudflared (relativo à pasta <C>backend/</C>).</>],
          [<C key="2">WORKSPACES_ROOT</C>, <C key="2b">&lt;DATA_ROOT&gt;/workspaces</C>, 'Raiz única dos workspaces; cada serviço ganha uma subpasta exclusiva.'],
          [<C key="3">FILES_ROOT</C>, <C key="3b">workspaces</C>, <>Raiz do gerenciador de arquivos global. Aponte para <C>$HOME</C> para navegar o dispositivo inteiro pelo painel.</>],
          [<C key="4">HOST_WORKSPACES_ROOT</C>, '—', <>Só quando o painel roda <strong>dentro</strong> de um container e cria outros no host: caminho dos workspaces como o host os enxerga (senão os bind mounts apontam para um caminho inexistente).</>],
        ]}
      />

      <H2 id="docker">Docker</H2>
      <DocTable
        head={['Variável', 'Padrão', 'Descrição']}
        rows={[
          [<C key="1">DOCKER_HOST</C>, 'auto', <>Host Docker no formato da CLI (<C>unix://</C> ou <C>tcp://</C>). Detectado automaticamente.</>],
          [<C key="2">DOCKER_API_VERSION</C>, 'auto', <>Ex.: <C>v1.43</C>.</>],
          [<C key="3">DOCKER_GID</C>, '—', <>GID do grupo <C>docker</C> do host (usado pelo <C>docker-compose.yml</C>). Descubra com <C>getent group docker | cut -d: -f3</C>.</>],
        ]}
      />

      <H2 id="limites">Limites e logs</H2>
      <DocTable
        head={['Variável', 'Padrão', 'Descrição']}
        rows={[
          [<C key="1">UPLOAD_MAX_BYTES</C>, '2 GB', 'Tamanho máximo de upload por arquivo, em bytes.'],
          [<C key="2">EDITOR_MAX_BYTES</C>, '2 MB', 'Tamanho máximo que o editor do painel abre.'],
          [<C key="3">LOG_MAX_MEMORY</C>, <C key="3b">500</C>, 'Linhas de log por serviço mantidas em memória.'],
          [<C key="4">LOG_MAX_DB</C>, <C key="4b">1000</C>, 'Linhas de log por serviço persistidas no banco.'],
          [<C key="5">RESTART_STABLE_MS</C>, <C key="5b">60000</C>, 'Tempo que um serviço precisa ficar de pé para o contador de reinícios zerar.'],
        ]}
      />

      <H2 id="remoto">Acesso remoto</H2>
      <DocTable
        head={['Variável', 'Padrão', 'Descrição']}
        rows={[[<C key="1">CLOUDFLARED_BIN</C>, <C key="1b">cloudflared</C>, 'Caminho do binário do cloudflared, caso não esteja no PATH.']]}
      />

      <H2 id="dados">Onde ficam seus dados</H2>
      <DocTable
        head={['Instalação', 'Caminho']}
        rows={[
          ['Termux / proot / Linux', <C key="1">backend/data/</C>],
          ['Docker', <><C>./data/</C> (na raiz do projeto)</>],
        ]}
      />
      <Callout type="tip" title="Backup em uma linha">
        <p>
          <strong>Backup = copiar a pasta de dados.</strong> Ela contém o banco, os workspaces de todos os serviços e a
          configuração do cloudflared. Para começar do zero, apague-a.
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
  keywords: ['criar serviço', 'runtime', 'workspace', 'main_file', 'git clone', 'npm install', 'discord bot', 'api', 'node', 'typescript', 'watchdog', 'auto-update', 'starter'],
  sourcePath: 'README.md',
  sections: [
    { id: 'passo-a-passo', title: 'Passo a passo' },
    { id: 'config-inicial', title: 'Configuração inicial do serviço' },
    { id: 'exemplos', title: 'Exemplos reais' },
    { id: 'watchdog', title: 'Watchdog e reinício automático' },
  ],
  render: () => (
    <>
      <H2 id="passo-a-passo">Passo a passo</H2>
      <Steps
        items={[
          { title: 'Criar serviço', body: 'No painel, crie um novo serviço.' },
          { title: 'Definir o nome', body: <>O nome define o workspace: <C>&lt;DATA_ROOT&gt;/workspaces/&lt;nome-do-serviço&gt;</C>, criado automaticamente. Você nunca precisa mexer no sistema de arquivos manualmente.</> },
          { title: 'Escolher o runtime', body: <>Processo local (Node etc., gerenciado por <C>child_process</C>) ou container Docker, se houver um Docker Engine disponível.</> },
          { title: 'Configurar o comando', body: <>Informe o <C>main_file</C> (ex.: <C>src/index.ts</C>, <C>dist/index.js</C>) ou um comando completo como <C>node .</C> — o painel infere o comando de início a partir dele.</> },
          { title: 'Opcional: configurar Git', body: <>Aponte repositório e branch; o painel dispara <C>git clone</C> e <C>npm install</C> em background quando necessário.</> },
          { title: 'Salvar e iniciar', body: 'Salve e clique em iniciar.' },
          { title: 'Abrir os logs', body: 'Acompanhe stdout/stderr ao vivo (WebSocket) na aba de logs.' },
          { title: 'Verificar o status', body: 'O card do serviço mostra o estado atual; o watchdog cuida de quedas inesperadas.' },
        ]}
      />

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
                <P>Crie o serviço, escolha runtime local e informe <C>src/index.ts</C> como arquivo principal. Sem workspace prévio, o painel gera o starter TypeScript e você edita o código direto no <DocLink to="/docs/arquivos">gerenciador de arquivos</DocLink>.</P>
              </>
            ),
          },
          {
            label: 'Bot de Discord',
            content: (
              <>
                <P>Na configuração inicial, aponte o repositório Git do bot e a branch. Ative a instalação automática de dependências e defina o <C>main_file</C> (ex.: <C>index.js</C>). Guarde o token do bot em um arquivo <C>.env</C> dentro do workspace, editável pelo painel.</P>
              </>
            ),
          },
          {
            label: 'Site estático',
            content: (
              <>
                <P>Crie o serviço com um servidor estático como comando (ex.: um <C>server.js</C> simples com Express) e envie os arquivos do site pelo upload do gerenciador de arquivos — resolução de conflitos de nome é automática.</P>
              </>
            ),
          },
          {
            label: 'Container Docker',
            content: (
              <>
                <P>Escolha o runtime Docker, informe a imagem e o painel monta o container com bind mount do workspace. Detalhes e ressalvas em <DocLink to="/docs/docker-services">Serviços Docker</DocLink>.</P>
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
