import { C, Callout, CodeBlock, DocLink, DocTable, H2, P, Ul } from '../../components/docui';
import type { DocPage } from '../types';

export const arquivos: DocPage = {
  slug: 'arquivos',
  title: 'Gerenciamento de arquivos',
  navLabel: 'Arquivos',
  description: 'Workspaces, editor integrado, upload/download e todas as operações do gerenciador de arquivos do Pterodroid.',
  keywords: ['upload', 'download', 'editor', 'workspace', 'renomear', 'mover', 'copiar', 'busca', 'FILES_ROOT', '2MB', 'auditoria', 'path traversal', 'escrita atômica'],
  sourcePath: 'README.md',
  sections: [
    { id: 'workspaces', title: 'Workspaces' },
    { id: 'operacoes', title: 'Operações disponíveis' },
    { id: 'editor', title: 'Editor integrado' },
    { id: 'upload', title: 'Upload e download' },
    { id: 'limites', title: 'Limites conhecidos' },
    { id: 'seguranca', title: 'Segurança' },
  ],
  render: () => (
    <>
      <H2 id="workspaces">Workspaces</H2>
      <P>
        Cada serviço ganha um diretório exclusivo em <C>&lt;DATA_ROOT&gt;/workspaces/&lt;nome-do-serviço&gt;</C>,
        criado automaticamente. O gerenciador existe em dois lugares com <strong>exatamente as mesmas operações</strong>:
      </P>
      <Ul>
        <li><strong>Visão global</strong> (aba Arquivos do painel): navega a raiz definida por <C>FILES_ROOT</C> — por padrão, a própria raiz de workspaces. Aponte para <C>$HOME</C> para navegar o dispositivo inteiro.</li>
        <li><strong>Aba Arquivos de cada serviço:</strong> restrita ao workspace daquele serviço.</li>
      </Ul>

      <H2 id="operacoes">Operações disponíveis</H2>
      <DocTable
        head={['Operação', 'Detalhes']}
        rows={[
          ['Navegar', 'Estrutura de pastas completa da raiz configurada.'],
          ['Criar', 'Arquivos e pastas; criação automática de pastas intermediárias.'],
          ['Editar', 'Editor de texto integrado com escrita atômica.'],
          ['Excluir', 'Arquivos e pastas.'],
          ['Copiar / Mover / Renomear', 'Direto pela interface.'],
          ['Buscar', 'Busca de arquivos pelo painel.'],
          ['Upload / Download', 'Multipart via multer, com resolução de conflito de nomes.'],
        ]}
      />
      <P>Todas as ações relevantes ficam registradas em um <strong>log de auditoria</strong>.</P>

      <H2 id="editor">Editor integrado</H2>
      <Ul>
        <li>Abre arquivos de até <strong>2 MB</strong> (configurável via <C>EDITOR_MAX_BYTES</C>).</li>
        <li><strong>Escrita atômica:</strong> o arquivo nunca fica pela metade se algo falhar no meio do salvamento.</li>
        <li>Ideal para <C>.env</C>, configs e ajustes rápidos de código sem sair do navegador.</li>
      </Ul>

      <H2 id="upload">Upload e download</H2>
      <Ul>
        <li>Limite padrão de <strong>2 GB por arquivo</strong> (<C>UPLOAD_MAX_BYTES</C>).</li>
        <li>Conflitos de nome no upload são resolvidos automaticamente.</li>
        <li>Download direto de qualquer arquivo do workspace.</li>
      </Ul>

      <H2 id="limites">Limites conhecidos</H2>
      <Ul>
        <li>O editor não abre arquivos acima do limite configurado (padrão 2 MB) — para arquivos grandes, use download/upload.</li>
        <li>A visão global só enxerga o que está dentro de <C>FILES_ROOT</C>.</li>
      </Ul>

      <H2 id="seguranca">Segurança</H2>
      <Ul>
        <li><strong>Validação de caminho com proteção contra path traversal</strong> — coberta pela suíte de testes do backend.</li>
        <li>Toda operação exige autenticação (JWT).</li>
        <li>Log de auditoria das operações de arquivo.</li>
      </Ul>
      <Callout type="warning">
        <p>
          Se você apontar <C>FILES_ROOT</C> para <C>$HOME</C>, qualquer pessoa logada no painel navega o dispositivo
          inteiro. Combine isso com uma senha forte — veja <DocLink to="/docs/primeiro-acesso">Primeiro acesso</DocLink>.
        </p>
      </Callout>
    </>
  ),
};

export const terminal: DocPage = {
  slug: 'terminal',
  title: 'Terminal no painel',
  description: 'Como usar o terminal embutido do Pterodroid: histórico, cd persistente, Ctrl+C e as limitações por design.',
  keywords: ['terminal', 'comandos', 'histórico', 'cd', 'ctrl+c', 'docker exec', 'pty', 'vim', 'htop', 'npm install', 'git pull'],
  sourcePath: 'README.md',
  sections: [
    { id: 'visao-geral', title: 'Visão geral' },
    { id: 'recursos', title: 'Recursos' },
    { id: 'comandos-uteis', title: 'Comandos úteis' },
    { id: 'limitacoes', title: 'Limitações (por design)' },
  ],
  render: () => (
    <>
      <H2 id="visao-geral">Visão geral</H2>
      <P>
        Cada serviço tem um terminal que executa comandos <strong>direto no workspace</strong> — <C>npm install</C>,{' '}
        <C>git pull</C>, <C>ls</C>, <C>node -v</C> — sem sair do navegador. Funciona para processos locais e para
        containers (via <C>docker exec</C>).
      </P>
      <Callout type="important" title="Orientado a comandos, não um PTY">
        <p>
          O terminal é <strong>orientado a comando</strong>: você digita, ele executa e transmite a saída ao vivo. Não
          é um terminal PTY completo — escolha deliberada para não depender de módulos nativos que não compilam no
          Termux.
        </p>
      </Callout>

      <H2 id="recursos">Recursos</H2>
      <Ul>
        <li><strong>Histórico</strong> com as setas ↑/↓.</li>
        <li><strong><C>cd</C> persistente:</strong> o diretório atual é mantido entre comandos.</li>
        <li><strong>Saída ao vivo</strong> conforme o comando roda.</li>
        <li><strong>Ctrl+C</strong> para interromper o comando em execução.</li>
        <li><strong>Containers:</strong> os comandos rodam dentro do container via <C>docker exec</C>.</li>
      </Ul>

      <H2 id="comandos-uteis">Comandos úteis</H2>
      <CodeBlock
        platform="painel"
        title="exemplos no terminal do serviço"
        code={`node -v            # versão do Node disponível para o serviço
npm install         # instala dependências no workspace
git pull            # atualiza o código do repositório configurado
ls -la              # lista os arquivos do workspace
cat data/panel.out.log | tail -n 50   # inspeciona logs`}
        description="Todos executam no diretório do workspace do serviço, com cd persistente entre comandos."
      />

      <H2 id="limitacoes">Limitações (por design)</H2>
      <Ul>
        <li><strong>Programas de tela cheia não são suportados:</strong> <C>vim</C>, <C>htop</C>, <C>nano</C> e similares precisam de um PTY. Para editar arquivos, use o <DocLink to="/docs/arquivos">editor do painel</DocLink>; para monitorar, use o <DocLink to="/docs/monitoramento">monitoramento integrado</DocLink>.</li>
        <li>Prompts interativos que exigem TTY podem não funcionar — prefira flags não interativas (<C>-y</C>, <C>--yes</C>).</li>
      </Ul>
      <Callout type="danger" title="Terminal = acesso ao dispositivo">
        <p>
          Quem faz login no painel executa comandos no seu dispositivo. Nunca exponha o painel com a senha padrão —
          troque-a no <DocLink to="/docs/primeiro-acesso">primeiro acesso</DocLink>.
        </p>
      </Callout>
    </>
  ),
};

export const dockerServices: DocPage = {
  slug: 'docker-services',
  title: 'Serviços em containers Docker',
  navLabel: 'Serviços Docker',
  description: 'Crie serviços como containers Docker: imagens, bind mounts do workspace, logs, restart e persistência.',
  keywords: ['container', 'imagem', 'bind mount', 'HOST_WORKSPACES_ROOT', 'docker exec', 'DOCKER_HOST', 'restart', 'persistência', 'docker engine'],
  sourcePath: 'README.md',
  sections: [
    { id: 'requisitos', title: 'Requisitos' },
    { id: 'como-funciona', title: 'Como funciona' },
    { id: 'bind-mounts', title: 'Bind mounts e HOST_WORKSPACES_ROOT' },
    { id: 'operacao', title: 'Logs, restart e comandos' },
    { id: 'troubleshooting', title: 'Troubleshooting rápido' },
  ],
  render: () => (
    <>
      <H2 id="requisitos">Requisitos</H2>
      <Ul>
        <li>Um <strong>Docker Engine acessível</strong>: nativo no Linux/VPS, ou o Docker do host quando o painel roda via <DocLink to="/docs/docker">instalação Docker</DocLink>.</li>
        <li><strong>Termux e proot não rodam Docker</strong> — nesses ambientes, use serviços como processos locais.</li>
      </Ul>
      <P>
        O cliente da Docker Engine é implementado no próprio backend (coberto por testes), falando com{' '}
        <C>unix:///var/run/docker.sock</C> ou <C>tcp://</C> conforme <C>DOCKER_HOST</C>.
      </P>

      <H2 id="como-funciona">Como funciona</H2>
      <Ul>
        <li>Ao criar o serviço, você escolhe o runtime <strong>container</strong> e informa a imagem.</li>
        <li>O painel monta o container com o <strong>workspace do serviço como bind mount</strong> — seu código fica visível dentro do container.</li>
        <li>Start/stop/restart, logs ao vivo e status funcionam como nos processos locais.</li>
        <li>O <DocLink to="/docs/terminal">terminal</DocLink> executa comandos dentro do container via <C>docker exec</C>.</li>
      </Ul>

      <H2 id="bind-mounts">Bind mounts e HOST_WORKSPACES_ROOT</H2>
      <Callout type="important">
        <p>
          Quando o <strong>painel roda dentro de um container</strong> e cria outros containers no host, o caminho do
          workspace que o painel enxerga não existe no host. Defina <C>HOST_WORKSPACES_ROOT</C> com o caminho{' '}
          <strong>como o host o enxerga</strong>, senão o container do serviço sobe sem os arquivos do projeto.
        </p>
      </Callout>
      <CodeBlock
        platform="docker"
        lang="ini"
        title=".env (raiz do projeto)"
        code={`HOST_WORKSPACES_ROOT=/home/voce/pterodroid/data/workspaces`}
        description="A tradução do bind mount para o host é coberta pela suíte de testes do backend."
      />

      <H2 id="operacao">Logs, restart e comandos</H2>
      <Ul>
        <li><strong>Logs:</strong> stdout/stderr do container ao vivo, na mesma aba de logs dos demais serviços.</li>
        <li><strong>Restart:</strong> o watchdog reinicia containers de serviço que caírem, com backoff.</li>
        <li><strong>Persistência:</strong> o que estiver no workspace (bind mount) sobrevive à recriação do container; o que for gravado fora dele segue o ciclo de vida do container.</li>
        <li><strong>Comandos:</strong> use o terminal do serviço (via <C>docker exec</C>).</li>
      </Ul>

      <H2 id="troubleshooting">Troubleshooting rápido</H2>
      <DocTable
        head={['Sintoma', 'Verifique']}
        rows={[
          ['Painel não enxerga o Docker', <>No modo Docker: <C>DOCKER_GID</C> correto no <C>.env</C> (<C>getent group docker | cut -d: -f3</C>). No modo local: usuário no grupo <C>docker</C>.</>],
          ['Container sobe sem os arquivos', <><C>HOST_WORKSPACES_ROOT</C> ausente ou errado.</>],
          ['Conexão recusada ao daemon', <><C>DOCKER_HOST</C> apontando para o socket certo; daemon ativo.</>],
        ]}
      />
      <P>
        Mais casos em <DocLink to="/docs/troubleshooting">Troubleshooting</DocLink>.
      </P>
    </>
  ),
};

export const bancos: DocPage = {
  slug: 'bancos',
  title: 'Bancos de dados',
  navLabel: 'Bancos de dados',
  description: 'Provisionamento local de PostgreSQL e MySQL/MariaDB pelo Pterodroid: criação, credenciais, portas, persistência e limitações.',
  keywords: ['postgresql', 'mysql', 'mariadb', 'banco de dados', 'credenciais', 'porta', 'persistência', 'watchdog', 'quick tunnel', 'cloudflared access tcp'],
  sourcePath: 'README.md',
  sections: [
    { id: 'visao-geral', title: 'Visão geral' },
    { id: 'criacao', title: 'Criação e credenciais' },
    { id: 'acesso', title: 'Acesso e portas' },
    { id: 'persistencia', title: 'Persistência' },
    { id: 'limitacoes', title: 'Limitações' },
  ],
  render: () => (
    <>
      <H2 id="visao-geral">Visão geral</H2>
      <P>
        O Pterodroid provisiona e gerencia instâncias de <strong>PostgreSQL</strong> e{' '}
        <strong>MySQL/MariaDB</strong> como <strong>processos filhos diretos</strong> do backend — sem systemd, sem
        containers obrigatórios. É o suficiente para ambientes de desenvolvimento completos no próprio dispositivo.
      </P>

      <H2 id="criacao">Criação e credenciais</H2>
      <Ul>
        <li>A criação é feita pelo painel, na área de bancos de dados.</li>
        <li>O provisionamento é <strong>automatizado</strong>: o painel prepara a instância e as credenciais de acesso.</li>
        <li>Os dados da instância vivem dentro de <C>DATA_ROOT</C>, junto do restante dos dados do painel.</li>
      </Ul>
      <Callout type="note">
        <p>
          Os binários do banco (PostgreSQL/MariaDB) precisam estar disponíveis no ambiente — no Termux, instaláveis via{' '}
          <C>pkg</C>.
        </p>
      </Callout>

      <H2 id="acesso">Acesso e portas</H2>
      <Ul>
        <li>Cada instância escuta em uma porta local; apps no mesmo dispositivo conectam via <C>localhost</C>.</li>
        <li>Serviços do painel usam as credenciais geradas normalmente (ex.: <C>DATABASE_URL</C> no <C>.env</C> do workspace).</li>
        <li>Acesso remoto a bancos <strong>não funciona por Quick Tunnel</strong> (HTTP-only). Com Named Tunnel, o cliente precisa de <C>cloudflared access tcp</C> — veja <DocLink to="/docs/cloudflare">Cloudflare</DocLink>.</li>
      </Ul>

      <H2 id="persistencia">Persistência</H2>
      <Ul>
        <li>Dados persistem em <C>DATA_ROOT</C> — o backup da pasta de dados inclui os bancos.</li>
        <li>Pare o banco pelo painel antes de copiar a pasta para um backup consistente.</li>
      </Ul>

      <H2 id="limitacoes">Limitações</H2>
      <Callout type="warning" title="Sem reinício automático">
        <p>
          O watchdog <strong>não reinicia bancos de dados automaticamente</strong> — decisão deliberada para evitar
          corrupção de dados. Se uma instância cair, reinicie-a manualmente pelo painel depois de verificar os logs.
        </p>
      </Callout>
      <Ul>
        <li>Uso pessoal/single-user: não há gestão multi-tenant de bancos.</li>
        <li>Exposição pública de bancos exige Named Tunnel + <C>cloudflared access tcp</C> no cliente.</li>
      </Ul>
    </>
  ),
};
