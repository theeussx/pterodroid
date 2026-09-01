import { C, Callout, CodeBlock, DocLink, DocTable, H2, P, Steps, Ul } from '../../components/docui';
import type { DocPage } from '../types';

/* ═══════════════════════ Backup e restauração ═══════════════════════ */

export const backup: DocPage = {
  slug: 'backup',
  title: 'Backup e restauração',
  navLabel: 'Backup e restauração',
  description: 'Como fazer backup completo do Pterodroid (banco, workspaces, bancos de dados, Cloudflare) e restaurar em uma instalação — do zero ou no mesmo dispositivo.',
  keywords: ['backup', 'restaurar', 'restore', 'data', 'panel.db', 'backups', 'zip', 'tar', 'consistência', 'jwt-secret', 'cloudflared', 'crash', 'recuperação', 'cópia'],
  sourcePath: 'apps/documentation/src/docs/content/ops.tsx',
  sections: [
    { id: 'o-que-guardar', title: 'O que o painel guarda' },
    { id: 'backup-completo', title: 'Backup completo (recomendado)' },
    { id: 'backup-docker', title: 'Backup na instalação Docker' },
    { id: 'restaurar', title: 'Restaurar' },
    { id: 'consistencia', title: 'Consistência do banco' },
    { id: 'boas-praticas', title: 'Boas práticas e limitações' },
  ],
  render: () => (
    <>
      <P>
        Tudo o que o Pterodroid guarda vive em <strong>uma única pasta</strong>: <C>data/</C> na raiz do repositório
        (instalações Termux/proot/Linux) ou <C>./data</C> no host (instalação Docker, montada em <C>/data</C> dentro do
        container). <strong>Backup = copiar essa pasta</strong>; restauração = devolvê-la a uma instalação nova.
      </P>

      <H2 id="o-que-guardar">O que o painel guarda</H2>
      <DocTable
        head={['Item', 'Caminho (dentro de data/)', 'Conteúdo']}
        rows={[
          [<strong key="1">Banco do painel</strong>, <C key="1b">panel.db</C>, 'Serviços, instâncias de banco, settings, logs e audit. É o estado do painel.'], 
          [<strong key="2">Workspaces</strong>, <C key="2b">workspaces/&lt;serviço&gt;</C>, 'O código de cada serviço — a parte mais pesada do backup.'],
          [<strong key="3">Bancos provisionados</strong>, <C key="3b">databases/</C>, 'Diretórios de dados das instâncias PostgreSQL/MySQL/MariaDB.'],
          [<strong key="4">Backups por serviço</strong>, <C key="4b">backups/</C>, 'ZIPs criados pela aba Backups dos serviços.'],
          [<strong key="5">Cloudflare</strong>, <C key="5b">cloudflared/</C>, 'Credenciais, config.yml e tunnel creds dos Named Tunnels.'],
          [<strong key="6">Segredo JWT</strong>, <C key="6b">.jwt-secret</C>, 'Chave dos tokens de login (gerada no primeiro boot, se você não definiu JWT_SECRET).'],
          [<strong key="7">Runtime do painel</strong>, <C key="7b">panel.pid / panel.out.log</C>, 'PID file e log do processo — dispensáveis no backup (o log é útil para diagnóstico).'],
        ]}
      />
      <Callout type="important" title="Backup de verdade = pasta completa">
        <p>
          Um backup que copie só <C>panel.db</C> restaura o <em>catálogo</em>, mas não os arquivos dos serviços nem os
          dados dos bancos. Copie a pasta <C>data/</C> inteira.
        </p>
      </Callout>

      <H2 id="backup-completo">Backup completo (recomendado)</H2>
      <Steps
        items={[
          { title: 'Pare as instâncias de banco pelo painel', body: <>Na área de bancos, clique em <strong>Parar</strong> em cada instância antes de copiar — assim os arquivos de dados ficam consistentes. Depois pode iniciá-las de novo.</> },
          { title: 'Pare o painel (limpeza do banco)', body: <>O <C>panelctl.sh stop</C> envia SIGTERM e o servidor <strong>grava o SQLite em disco</strong> (flush) antes de sair. Encerrar com <C>kill -9</C> pode deixar o <C>panel.db</C> com o último segundo de alterações perdido.</> },
          { title: 'Copie a pasta data/', body: <CodeBlock cwd="~" platform="termux/linux" code={`cd pterodroid\n./panelctl.sh stop\ntar czf pterodroid-backup-$(date +%F).tar.gz data/\n./panelctl.sh start`} description="Cria um .tar.gz compactado de toda a pasta de dados. Troque por `cp -a data backup-data` se preferir uma cópia simples." /> },
          { title: 'Confira o arquivo', body: <>Verifique o tamanho (arquivos de serviço e bancos dominam) e guarde o backup <strong>fora do dispositivo</strong> (PC, nuvem, cartão).</> },
        ]}
      />
      <Callout type="tip" title="Backup por serviço (sem parar nada)">
        <p>
          Para o código de um serviço específico, use a aba <strong>Backups</strong> do serviço: gera um <C>.zip</C> sem
          parar o painel nem o serviço. Ele não inclui banco do painel nem instâncias de banco de dados — para esses,
          use o backup completo acima.
        </p>
      </Callout>

      <H2 id="backup-docker">Backup na instalação Docker</H2>
      <P>
        Os dados ficam em <C>./data</C> no host. O procedimento é idêntico, mas o painel é parado pelo compose:
      </P>
      <CodeBlock
        cwd="~"
        platform="docker"
        title="backup (host)"
        code={`cd pterodroid\ndocker compose stop\ntar czf pterodroid-backup-$(date +%F).tar.gz data/\ndocker compose start`}
        description="Pare as instâncias de banco pelo painel antes (ou apenas pare o compose se os bancos estiverem parados)."
      />
      <P>
        Não é necessário entrar no container: a pasta <C>./data</C> do host <strong>é</strong> o <C>/data</C> de dentro,
        então o backup feito no host já contém tudo.
      </P>

      <H2 id="restaurar">Restaurar</H2>
      <Steps
        items={[
          { title: 'Instale o Pterodroid de novo', body: <>Termux/proot/Linux ou <DocLink to="/docs/docker">Docker</DocLink>, sem rodar o painel ainda.</> },
          { title: 'Pare o painel (se estiver rodando)', body: <><C>./panelctl.sh stop</C> ou <C>docker compose stop</C>.</> },
          { title: 'Substitua a pasta de dados', body: <>Apague (ou renomeie) a <C>data/</C> existente e extraia o backup no lugar, preservando a estrutura <C>data/panel.db</C>, <C>data/workspaces/…</C>.</> },
          { title: 'Confira permissões', body: <>No Termux/Linux o usuário que roda o painel precisa ler/escrever em <C>data/</C>. Se restaurou como root, ajuste: <C>chown -R $(id -u):$(id -g) data</C>.</> },
          { title: 'Inicie e verifique', body: <><C>./panelctl.sh start</C> (ou <C>docker compose up -d</C>) e confirme o healthcheck.</> },
          { title: 'Teste o acesso', body: <>Faça login — a senha é a que estava em uso no momento do backup (o hash fica no <C>panel.db</C>).</> },
        ]}
      />
      <CodeBlock
        cwd="~"
        platform="termux/linux"
        title="restauração (Termux/proot/Linux)"
        code={`cd pterodroid\n./panelctl.sh stop\nmv data data.antiga                   # não apague antes de confirmar\ntar xzf pterodroid-backup-2026-09-01.tar.gz\n./panelctl.sh start                 # healthcheck em /api/health`}
      />
      <Callout type="warning" title="Bancos de dados provisionados">
        <p>
          As instâncias de banco restauradas voltam como <strong>paradas</strong> (decisão de segurança: bancos nunca
          sobem sozinhos). Inicie cada uma pelo painel depois de conferir os logs.
        </p>
      </Callout>

      <H2 id="consistencia">Consistência do banco</H2>
      <Ul>
        <li><strong>Desligamento limpo:</strong> <C>./panelctl.sh stop</C> → SIGTERM → backend grava o banco e sai. É o caminho para o backup.</li>
        <li><strong>Queda brusca</strong> (bateria, OOM, <C>kill -9</C>): o SQLite em memória pode perder as últimas alterações antes do debounce de 1s, e o painel reconcilia o estado dos serviços no boot (limpa PIDs órfãos). Leia o log e reinicie serviços se necessário.</li>
        <li><strong>Banco corrompido:</strong> se o painel não subir, o log (<C>./panelctl.sh logs</C>) indica o problema; a recuperação via backup é o caminho previsto — por isso o teste periódico de restauração importa.</li>
      </Ul>

      <H2 id="boas-praticas">Boas práticas e limitações</H2>
      <Ul>
        <li><strong>Teste a restauração de verdade</strong> em um diretório novo, pelo menos uma vez — não confie no backup que nunca foi restaurado.</li>
        <li>Guarde o backup <strong>fora do dispositivo</strong>: o Pterodroid roda no seu celular, e celular quebra.</li>
        <li>O <C>.jwt-secret</C> faz parte do backup de propósito — sem ele os logins antigos são invalidados (o painel gera um novo). Se você define <C>JWT_SECRET</C> no <C>.env</C>, esse valor é o segredo de verdade.</li>
        <li>Backups de serviços ficam em <C>data/backups/</C> e são limitados por <C>MAX_BACKUPS_PER_SERVICE</C> (padrão 10).</li>
        <li>Restaurar sobrescreve apenas o que existe no backup — arquivos criados depois do backup não são apagados.</li>
      </Ul>
      <P>
        Prefere o procedimento passo a passo na interface? Veja também <DocLink to="/docs/primeiro-servico">Primeiro
        serviço</DocLink> (aba Backups) e <DocLink to="/docs/configuracao">Configuração</DocLink> (variáveis de backup).
      </P>
    </>
  ),
};

/* ═══════════════════════ Publicação segura (produção) ═══════════════════════ */

export const producao: DocPage = {
  slug: 'producao',
  title: 'Publicação segura (produção vs. teste)',
  navLabel: 'Produção segura',
  description: 'Modelo de ameaça do Pterodroid exposto à internet, checklist antes de publicar via Cloudflare Tunnel e como fazer rollback.',
  keywords: ['produção', 'teste', 'expor', 'internet', 'segurança', 'threat model', 'checklist', 'publicar', 'cloudflare access', 'firewall', 'rollback', 'senha forte', 'CORS', 'docker.sock'],
  sourcePath: 'apps/documentation/src/docs/content/ops.tsx',
  sections: [
    { id: 'modelo-de-ameaca', title: 'Modelo de ameaça' },
    { id: 'teste-vs-producao', title: 'Teste vs. produção' },
    { id: 'checklist', title: 'Checklist antes de publicar' },
    { id: 'publicacao-avancada', title: 'Publicação avançada (recomendada)' },
    { id: 'rollback', title: 'Rollback' },
  ],
  render: () => (
    <>
      <H2 id="modelo-de-ameaca">Modelo de ameaça</H2>
      <Callout type="danger" title="Publicar o painel = publicar o dispositivo">
        <p>
          Quem autentica no Pterodroid tem <strong>capacidade administrativa completa</strong>: terminal que executa
          comandos no dispositivo, gerenciador de arquivos (que pode navegar <C>$HOME</C>, se <C>FILES_ROOT</C> apontar
          para lá) e, na instalação Docker, acesso ao <strong>daemon Docker do host</strong> via{' '}
          <C>/var/run/docker.sock</C>. Não trate isso como “só um painel de hospedagem”.
        </p>
      </Callout>
      <P>
        Cada decisão abaixo reduz uma superfície de ataque concreta. O Pterodroid é <strong>single-user</strong>: não
        existe conceito de permissões por usuário — a única credencial é a senha do painel.
      </P>

      <H2 id="teste-vs-producao">Teste vs. produção</H2>
      <DocTable
        head={['Critério', 'Teste (Quick Tunnel)', 'Produção (Named Tunnel)']}
        rows={[
          ['URL', 'Aleatória, muda a cada reinício', 'Fixa, com seu domínio'],
          ['Autenticação extra', 'Só a senha do painel', 'Pode adicionar <C>Cloudflare Access</C> (Zero Trust)'],
          ['Persistência', 'Nenhuma', 'Persistente (credenciais do túnel ficam em <C>data/cloudflared/</C>)'],
          ['Uso recomendado', 'Demostração, revisão rápida', 'Uso diário, apps que clientes acessam'],
          ['Bancos de dados remotamente', 'Não suportado', 'Via <C>cloudflared access tcp</C> no cliente'],
        ]}
      />
      <Callout type="warning">
        <p>
          O Quick Tunnel <strong>não é mais seguro</strong> que o Named Tunnel — só é mais simples. A URL pública existe
          nos dois casos; a diferença é controle e persistência.
        </p>
      </Callout>

      <H2 id="checklist">Checklist antes de publicar</H2>
      <Ul>
        <li><strong>Troque a senha padrão</strong> — o painel fica travado até isso acontecer, mas não confie só na trava: defina uma senha longa e única.</li>
        <li><strong>Gere um <C>JWT_SECRET</C> forte</strong> (<C>openssl rand -hex 32</C>) e mantenha-o no <C>.env</C> (Docker) ou <C>apps/backend/.env</C> (Termux/Linux).</li>
        <li><strong>Não exponha a porta 3001</strong> diretamente (porta aberta no roteador / firewall). Para acesso externo, use <DocLink to="/docs/cloudflare">Cloudflare Tunnel</DocLink>.</li>
        <li><strong>Restrinja CORS</strong>: defina <C>CORS_ORIGINS</C> com os domínios que você usa, em vez do padrão <C>*</C>.</li>
        <li><strong>Não aponte <C>FILES_ROOT</C> para <C>$HOME</C></strong> em instância pública — a aba Arquivos navegando o dispositivo inteiro é exatamente o que um invasor quer.</li>
        <li><strong>Remova o mount do <C>docker.sock</C></strong> se você não usa serviços em container — é o item de maior privilégio da instalação.</li>
        <li><strong>Atualize antes de publicar</strong> e <strong>faça backup</strong> (<DocLink to="/docs/backup">Backup e restauração</DocLink>).</li>
        <li><strong>Teste o login a partir de outro dispositivo/rede</strong> e revogue sessões trocando a senha ou o <C>JWT_SECRET</C> se notar algo estranho.</li>
      </Ul>

      <H2 id="publicacao-avancada">Publicação avançada (recomendada)</H2>
      <Steps
        items={[
          { title: 'Named Tunnel + Cloudflare Access', body: <>Além da senha do painel, exija autenticação do Cloudflare Zero Trust (e-mail/OTP) no hostname — assim mesmo credenciais do painel vazadas não bastam para entrar.</> },
          { title: 'Segredos do painel', body: <>JWT_SECRET forte no .env; os segredos dos serviços (<C>git_token</C>, variáveis de ambiente) já são cifrados em repouso pelo painel.</> },
          { title: 'Atualização com janela de rollback', body: <>Antes de atualizar, guarde o backup e o commit atual (<C>git rev-parse HEAD</C>). Veja <DocLink to="/docs/atualizacao">Atualização</DocLink>.</> },
          { title: 'Acompanhe', body: <>Configure o <DocLink to="/docs/seguranca">webhook de alertas</DocLink> (Telegram/Discord/ntfy) e monitore os logs do painel.</> },
        ]}
      />
      <Callout type="note">
        <p>
          Em Android/Termux não há firewall por usuário; a proteção de rede vem do roteador (não encaminhar portas) e
          do túnel Cloudflare. Em VPS/Linux, mantenha <C>ufw</C>/iptables fechando a porta do painel para a internet.
        </p>
      </Callout>

      <H2 id="rollback">Rollback</H2>
      <P>
        Se uma atualização quebrar, o caminho rápido é voltar ao commit anterior (código) e restaurar os dados do
        backup. Detalhes em <DocLink to="/docs/atualizacao">Atualização e rollback</DocLink>:
      </P>
      <CodeBlock
        cwd="~"
        platform="termux/linux"
        title="rollback via Git"
        code={`cd pterodroid\ngit log --oneline -5                  # anote o commit atual\ngit checkout <commit-anterior>\ncd apps/frontend && npm install && npm run build\ncd ../backend && npm install\ncd ../.. && ./panelctl.sh restart`}
      />
    </>
  ),
};

/* ═══════════════════════ Atualização e rollback ═══════════════════════ */

export const atualizacao: DocPage = {
  slug: 'atualizacao',
  title: 'Atualização e rollback',
  navLabel: 'Atualização',
  description: 'Como atualizar o Pterodroid (Git ou Docker) preservando os dados, verificar o healthcheck e voltar ao commit anterior com segurança.',
  keywords: ['atualizar', 'update', 'git pull', 'rollback', 'git checkout', 'docker compose up -d --build', 'healthcheck', 'migração', 'dados', 'backup'],
  sourcePath: 'apps/documentation/src/docs/content/ops.tsx',
  sections: [
    { id: 'antes', title: 'Antes de atualizar' },
    { id: 'git', title: 'Atualização via Git (Termux/proot/Linux)' },
    { id: 'docker', title: 'Atualização via Docker' },
    { id: 'migracoes', title: 'Migrações de banco' },
    { id: 'rollback', title: 'Rollback' },
  ],
  render: () => (
    <>
      <H2 id="antes">Antes de atualizar</H2>
      <Ul>
        <li>Anote o commit atual: <C>git rev-parse --short HEAD</C> (é a sua âncora de rollback).</li>
        <li>Faça um <DocLink to="/docs/backup">backup completo</DocLink> da pasta <C>data/</C>.</li>
        <li>Prefira horário com poucos serviços ativos: o restart encerra e religa tudo o que estava rodando.</li>
      </Ul>

      <H2 id="git">Atualização via Git (Termux/proot/Linux)</H2>
      <CodeBlock
        platform="termux/linux"
        title="atualizar"
        code={`cd pterodroid\ngit pull --ff-only\necho "ANTES: $(git rev-parse --short HEAD)"   # já atualizou — esse era o alvo\ncd apps/frontend && npm install && npm run build\ncd ../backend && npm install\ncd ../.. && ./panelctl.sh restart`}
        description="Pull do main, recompila o frontend, instala dependências novas do backend e reinicia o painel."
      />
      <Callout type="tip">
        <p>
          O <C>panelctl.sh restart</C> espera o <C>/api/health</C> responder de verdade. Se o servidor não subir, ele
          imprime as últimas linhas do log — leia antes de tentar rollback.
        </p>
      </Callout>

      <H2 id="docker">Atualização via Docker</H2>
      <CodeBlock
        platform="docker"
        title="atualizar"
        code={`cd pterodroid\ngit pull --ff-only\ndocker compose up -d --build\ndocker compose ps          # deve mostrar "healthy"`}
        description="Reconstrói a imagem (frontend + backend) e recria o container. Os dados em ./data permanecem intactos."
      />
      <P>
        A pasta <C>./data</C> <strong>não</strong> é tocada pelo rebuild — banco, workspaces e cloudflared sobrevivem à
        atualização. Se o <C>HOST_WORKSPACES_ROOT</C> do compose usa <C>${'{'}PWD{ '}'}</C>, ele acompanha o diretório
        do clone.
      </P>

      <H2 id="migracoes">Migrações de banco</H2>
      <P>
        O schema do SQLite usa <C>CREATE TABLE IF NOT EXISTS</C> + <C>ensureColumn</C>: colunas novas são adicionadas
        automaticamente no boot, sem passo manual. Ainda assim:
      </P>
      <Ul>
        <li>o backup antes de atualizar cobre o caso de uma migração quebra (voltou o código, restaurou os dados);</li>
        <li>a abertura de <C>panel.db</C> de versão mais nova em versão antiga <strong>não é suportada</strong> — para voltar, restaure o <C>panel.db</C> do backup, não o do futuro.</li>
      </Ul>

      <H2 id="rollback">Rollback</H2>
      <Steps
        items={[
          { title: 'Volte o código', body: <CodeBlock platform="termux/linux" code={`git checkout <commit-anterior>`} /> },
          { title: 'Rebuild do frontend + deps do backend', body: <CodeBlock platform="termux/linux" code={`cd apps/frontend && npm install && npm run build\ncd ../backend && npm install\ncd ../.. && ./panelctl.sh restart`} /> },
          { title: 'Se o banco ficou incompatível', body: <>Pare o painel, devolva o <C>panel.db</C> do backup (<DocLink to="/docs/backup">Backup e restauração</DocLink>) e suba de novo.</> },
        ]}
      />
      <Callout type="warning">
        <p>
          Em Docker, “voltar” exige rebuild: <C>git checkout &lt;commit&gt; && docker compose up -d --build</C>. Imagens
          de versões anteriores não são publicadas — a referência é sempre o código da branch.
        </p>
      </Callout>
    </>
  ),
};
