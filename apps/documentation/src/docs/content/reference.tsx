import { C, Callout, CodeBlock, DocLink, DocTable, Ext, H2, P, Ul } from '../../components/docui';
import { docsUpdatedLabel } from '../../version';
import type { DocPage } from '../types';

/* ═══════════════════════ Matriz de recursos ═══════════════════════ */

export const recursos: DocPage = {
  slug: 'recursos',
  title: 'Matriz de recursos e status',
  navLabel: 'Recursos (matriz)',
  description: 'Status de cada recurso anunciado pelo Pterodroid: implementado e testado, best-effort, limitado ou não suportado — com a validação do commit atual.',
  keywords: ['matriz', 'status', 'recursos', 'validação', 'testado', 'experimental', 'beta', 'limitações', 'compatibilidade', 'roadmap', 'multi-usuário'],
  sourcePath: 'apps/documentation/src/docs/content/reference.tsx',
  sections: [
    { id: 'como-ler', title: 'Como ler esta matriz' },
    { id: 'recursos', title: 'Recursos por status' },
    { id: 'fora-do-escopo', title: 'Fora do escopo (por decisão)' },
    { id: 'validacao', title: 'Como foi validado' },
  ],
  render: () => (
    <>
      <H2 id="como-ler">Como ler esta matriz</H2>
      <P>
        O Pterodroid não publica releases versionadas; a referência é a branch <C>main</C>. Cada recurso abaixo foi
        verificado no commit desta documentação ({docsUpdatedLabel()}) com a suíte do backend e/ou uso real. Use esta
        página para saber se uma promessa da <DocLink to="/docs/introducao">home</DocLink> é “feito de verdade” ou
        “melhor esforço”.
      </P>
      <DocTable
        head={['Status', 'Significado']}
        rows={[
          [<C key="1">Testado</C>, 'Coberto por testes automatizados e/ou validado em uso real no commit atual.'],
          [<C key="2">Best-effort</C>, 'Funciona quando o ambiente colabora (ex.: exige prlimit, cloudflared, Java).'],
          [<C key="3">Limitado</C>, 'Funciona, mas com restrição documentada (ex.: terminal sem PTY, Quick Tunnel só HTTP).'],
          [<C key="4">Não suportado</C>, 'Não existe por decisão de design (multi-tenancy, Windows oficial).'],
        ]}
      />

      <H2 id="recursos">Recursos por status</H2>
      <DocTable
        head={['Recurso', 'Status', 'Validação / limitação']}
        rows={[
          ['Supervisor de processos (child_process)', <strong key="1">Testado</strong>, 'Ciclo de vida completo via HTTP coberto pela suíte; reinício automático após crash testado no smoke-test.'],
          ['Watchdog com backoff', <strong key="2">Testado</strong>, <>Reinício após morte do processo e contagem de <C>max_restarts</C>; contador zera após <C>RESTART_STABLE_MS</C>.</>],
          ['Healthcheck por serviço', <strong key="3">Testado</strong>, 'Verifica URL/intervalo/timeout; falha encerra e reinicia o processo.'],
          ['Limites de CPU/memória (processos)', <C key="4">Best-effort</C>, <>Aplicados via <C>prlimit</C> quando o binário existe; sem ele, roda sem limite e loga.</>],
          ['Bancos PostgreSQL/MySQL/MariaDB locais', <C key="5">Testado</C>, 'Provisionamento e ciclo de vida testados; exigem os binários instalados no ambiente.'],
          ['Sem reinício automático de bancos', <strong key="6">Testado (decisão)</strong>, 'Deliberado: evita corrupção — reinicie manualmente.'],
          ['Gerenciador de arquivos (global + por serviço)', <strong key="7">Testado</strong>, 'Path traversal, escrita atômica, upload, busca e auditoria cobertos por testes.'],
          ['Backups por serviço (ZIP)', <strong key="8">Testado</strong>, 'Criar/listar/baixar/restaurar/apagar testados end-to-end; limite via MAX_BACKUPS_PER_SERVICE.'],
          ['Terminal no painel', <C key="9">Testado (limitado)</C>, 'Parser de comandos testado; sem PTY — vim/htop/nano não funcionam (decisão para o Termux).'],
          ['Receitas (tipos dedicados)', <strong key="10">Testado</strong>, 'Catálogo, defaults e scaffold testados; mapeamento de tipos legados incluído.'],
          ['Setup inicial (Git, npm/pip, TS build)', <C key="11">Testado</C>, 'Estado persistido e transmitido via socket; rodas em sessões paralelas sem travar o request.'],
          ['Serviços em container Docker', <C key="12">Testado</C>, 'Cliente da Engine e montagem (incl. bind mount traduzido para o host) testados contra engine simulada; precisa de Docker real no ambiente.'],
          ['Cloudflare Quick Tunnel', <C key="13">Best-effort</C>, 'Depende do cloudflared instalado; URL não persiste; só HTTP/HTTPS.'],
          ['Named Tunnel (CLI ou token)', <C key="14">Best-effort</C>, 'Gerenciado pelo painel ou pelo dashboard Zero Trust; roteamento por hostname no painel vale só no modo CLI.'],
          ['Monitoramento (CPU/RAM/disco/rede/temperatura)', <C key="15">Testado</C>, 'Lê /proc, /sys/class/thermal, ps, df; temperatura depende dos sensores do aparelho.'],
          ['Alertas via webhook', <C key="16">Testado</C>, 'Queda, crash-loop e boot do painel; cooldown de 5 min por serviço; botão de teste em Configurações.'],
          ['Cifra de segredos em repouso (git_token/environment)', <strong key="17">Testado</strong>, 'AES-256-GCM; legado em texto puro migrado no boot.'],
          ['Trava da senha padrão (SETUP_REQUIRED)', <strong key="18">Testado</strong>, '403 em todas as rotas de negócio até trocar a senha; teste de integração cobre.'],
          ['Rate limit de login', <C key="19">Testado</C>, 'Bloqueio após ~8 falhas (429 + Retry-After); contador por IP+usuário.'],
          ['JWT 7 dias / bcryptjs', <strong key="20">Testado</strong>, 'Autenticação e troca de senha cobertos pela suíte.'],
          ['CORS configurável', <C key="21">Testado</C>, 'Padrão aberto (Bearer sem cookies); CORS_ORIGINS restringe.'],
        ]}
      />

      <H2 id="fora-do-escopo">Fora do escopo (por decisão)</H2>
      <DocTable
        head={['Item', 'Motivo']}
        rows={[
          ['Multi-usuário / multi-tenancy', 'Painel pessoal, uma conta, uma credencial — decisão central do projeto.'],
          ['Terminal PTY completo', 'Modulos nativos não compilam no Termux; terminal orientado a comando de propósito.'],
          ['Suporte oficial a Windows', 'Não validado; Docker Desktop/WSL é experimental.'],
          ['Marketplace de templates', 'Sem distribuição de receitas de terceiros; catálogo é embutido no painel.'],
        ]}
      />

      <H2 id="validacao">Como foi validado</H2>
      <Ul>
        <li><C>npm test</C> em <C>apps/backend</C>: 10 suítes (unidade + integração + segurança + smoke HTTP) passando no commit desta documentação.</li>
        <li>Build de produção do frontend do painel (<C>npm run build</C>) e servidor subindo com o build embutido.</li>
        <li>Recursos que dependem de binário externo (cloudflared, Docker real, PostgreSQL/Java) são <strong>best-effort</strong> e exigem o ambiente correspondente — se faltar, o painel loga e continua.</li>
        <li>Itens de projetos anteriores listados como pendentes pela auditoria interna (<Ext href="https://github.com/theeussx/pterodroid/blob/main/docs/RELATORIO.md">docs/RELATORIO.md</Ext>) foram revalidados no commit atual antes de entrar nesta matriz.</li>
      </Ul>
    </>
  ),
};

/* ═══════════════════════ Matriz de compatibilidade ═══════════════════════ */

export const compatibilidade: DocPage = {
  slug: 'compatibilidade',
  title: 'Matriz de compatibilidade',
  navLabel: 'Compatibilidade',
  description: 'O que é suportado em cada ambiente (Termux, proot, Linux, Docker, ARM/x86), versões de Node, recursos mínimos e limitações por plataforma.',
  keywords: ['compatibilidade', 'android', 'termux', 'proot', 'linux', 'raspberry pi', 'arm', 'x86', 'windows', 'node 18', 'node 20', 'docker', 'recursos mínimos', 'memória', 'armazenamento'],
  sourcePath: 'apps/documentation/src/docs/content/reference.tsx',
  sections: [
    { id: 'ambientes', title: 'Ambientes suportados' },
    { id: 'arquiteturas', title: 'Arquiteturas e versões' },
    { id: 'recursos-minimos', title: 'Recursos mínimos recomendados' },
    { id: 'dependencias-opcionais', title: 'Dependências opcionais' },
  ],
  render: () => (
    <>
      <H2 id="ambientes">Ambientes suportados</H2>
      <DocTable
        head={['Ambiente', 'Status', 'Notas']}
        rows={[
          ['Android / Termux', <strong key="1">Oficial (principal)</strong>, <>Sem root, sem systemd. Docker <strong>não</strong> roda; use serviços como processo local.</>],
          ['Android / Ubuntu proot', <strong key="2">Oficial</strong>, <>Userland Ubuntu dentro do Termux; sem Docker; I/O mais lento (tradução de syscalls).</>],
          ['Linux (Debian/Ubuntu/Fedora/Arch…)', <strong key="3">Oficial</strong>, 'Método manual com Node 18+ ou container Docker.'],
          ['Raspberry Pi (ARM64/ARMv7)', <strong key="4">Oficial</strong>, 'Sem dependências de compilação nativa — a stack foi escolhida para ARM.'],
          ['Docker (VPS/homelab/PC)', <strong key="5">Oficial</strong>, 'Imagem Alpine + Node 20, healthcheck embutido; gerencia containers do host via docker.sock.'],
          ['Windows', <C key="6">Não suportado</C>, 'Docker Desktop/WSL é experimental; nenhum script oficial.'],
        ]}
      />

      <H2 id="arquiteturas">Arquiteturas e versões</H2>
      <Ul>
        <li><strong>x86_64 e ARM (aarch64/armv7):</strong> suportados. As dependências são instaladas na própria plataforma (por isso o pacote não inclui <C>node_modules</C>).</li>
        <li><strong>Node.js:</strong> 18+ para o método manual (testado na prática com Node 20/22). No Termux, instale o pacote LTS (<C>nodejs-lts</C>); a imagem Docker usa Node 20 Alpine.</li>
        <li><strong>SQLite via WASM, bcryptjs puro-JS:</strong> nenhum módulo compilado nativamente — é o que permite ARM e Termux.</li>
      </Ul>

      <H2 id="recursos-minimos">Recursos mínimos recomendados</H2>
      <DocTable
        head={['Item', 'Mínimo', 'Comentário']}
        rows={[
          ['RAM', '512 MB (1 GB recomendado)', 'O painel é leve; os seus serviços é que consomem — Minecraft e bancos pesam.'],
          ['Armazenamento', '200 MB + workspaces + bancos', 'Node_modules de cada serviço vivem no workspace.'],
          ['Portas', <><C>3001</C> (painel) + porta de cada serviço</>, 'Configure <C>PORT</C> se 3001 estiver ocupada.'],
          ['Rede', 'Wi-Fi/4G normal', 'Túneis Cloudflare consomem banda conforme o tráfego dos serviços.'],
          ['Bateria/Android', 'Wake lock ativo', 'Sem <C>termux-wake-lock</C>, o Android pode suspender o Termux.'],
        ]}
      />

      <H2 id="dependencias-opcionais">Dependências opcionais</H2>
      <DocTable
        head={['Recurso', 'O que instalar', 'Onde']}
        rows={[
          ['Acesso remoto', <C key="1">cloudflared</C>, <><C>pkg install cloudflared</C> (Termux), <C>apt install cloudflared</C> ou binário oficial (Linux).</>],
          ['Bancos de dados', <><C>postgresql</C> / <C>mariadb</C></>, 'pkg (Termux) ou apt (proot/Linux). Sem eles, a área de bancos mostra "não instalado".'],
          ['Servidor Minecraft', <C key="3">Java (JRE 17+)</C>, 'pkg install openjdk-17 (Termux) / apt install default-jre (Linux).'],
          ['Containers', <><C>docker</C> + compose</>, 'Só faz sentido em Linux/VPS — não roda no Termux/proot.'],
          ['Termux:API + wake lock', <C key="5">termux-api</C>, 'Persistência em segundo plano no Android.'],
        ]}
      />
      <Callout type="note">
        <p>
          Nenhuma dessas dependências é obrigatória para o painel subir — cada uma habilita um recurso específico. O
          instalador de cada ambiente pergunta sobre bancos e instala o cloudflared.
        </p>
      </Callout>
    </>
  ),
};

/* ═══════════════════════ Referência de API e WebSocket ═══════════════════════ */

export const api: DocPage = {
  slug: 'api',
  title: 'Referência da API e WebSocket',
  navLabel: 'API e WebSocket',
  description: 'Autenticação, endpoints REST, códigos de erro, eventos em tempo real (Socket.io), limites de upload e exemplos com curl.',
  keywords: ['api', 'rest', 'endpoints', 'curl', 'websocket', 'socket.io', 'auth', 'login', 'token', 'jwt', 'eventos', 'erros', 'setup_required', '429', 'upload'],
  sourcePath: 'apps/documentation/src/docs/content/reference.tsx',
  sections: [
    { id: 'auth', title: 'Autenticação' },
    { id: 'erros', title: 'Códigos de erro' },
    { id: 'servicos', title: 'Serviços' },
    { id: 'arquivos', title: 'Arquivos' },
    { id: 'outros', title: 'Bancos, Docker, monitor e settings' },
    { id: 'websocket', title: 'Eventos WebSocket' },
    { id: 'exemplos', title: 'Exemplos com curl' },
  ],
  render: () => (
    <>
      <P>
        A API é REST, servida pelo backend na mesma porta do painel (<C>3001</C> por padrão), sob o prefixo{' '}
        <C>/api</C>. Todas as rotas de negócio exigem <C>Authorization: Bearer &lt;token&gt;</C>. O tempo real usa{' '}
        <C>Socket.io</C> — o frontend do painel é o cliente de referência.
      </P>

      <H2 id="auth">Autenticação</H2>
      <DocTable
        head={['Endpoint', 'Método', 'Descrição']}
        rows={[
          [<C key="1">/api/auth/login</C>, 'POST', <>Corpo <C>{'{'}username, password{'}'}</C> → <C>{'{'}token{'}'}</C> (JWT, 7 dias). 401 se a senha estiver errada.</>],
          [<C key="2">/api/auth/me</C>, 'GET', 'Dados do usuário autenticado (exige Bearer).'],
          [<C key="3">/api/auth/change-password</C>, 'POST', <>Troca a senha (mín. 8 caracteres). É o que marca <C>setup_done</C>.</>],
        ]}
      />
      <Callout type="warning" title="Sem refresh token">
        <p>
          O token dura 7 dias e não há endpoint de refresh. Para forçar logout de todas as sessões, troque a senha ou o{' '}
          <C>JWT_SECRET</C>.
        </p>
      </Callout>

      <H2 id="erros">Códigos de erro</H2>
      <DocTable
        head={['Status', 'Quando', 'Corpo']}
        rows={[
          [<C key="1">401</C>, 'Token ausente/inválido ou senha errada.', <C key="1b">{'{'} error: string {'}'}</C>],
          [<C key="2">403</C>, <>Senha padrão ainda em uso → <C>code: "SETUP_REQUIRED"</C>.</>, <C key="2b">{'{'} error, code {'}'}</C>],
          [<C key="3">404</C>, 'Endpoint/rota inexistente.', <C key="3b">{'{'} error: "Endpoint não encontrado" {'}'}</C>],
          [<C key="4">413/400</C>, 'Upload/JSON acima do limite ou corpo inválido.', <C key="4b">{'{'} error {'}'}</C>],
          [<C key="5">429</C>, 'Muitas tentativas de login (rate limit).', <><C>Retry-After</C> + <C>{'{'} error, retryAfterSec {'}'}</C></>],
          [<C key="6">500</C>, 'Erro interno (mensagem genérica para o cliente).', <C key="6b">{'{'} error: "Erro interno do servidor" {'}'}</C>],
        ]}
      />

      <H2 id="servicos">Serviços</H2>
      <DocTable
        head={['Endpoint', 'Método', 'Descrição']}
        rows={[
          [<C key="1">/api/services</C>, 'GET / POST', 'Lista serviços / cria (aceita recipe, git, env, auto_start…).'],
          [<C key="1b">/api/services/recipes</C>, 'GET', 'Catálogo de receitas (porta, comando, template).'],
          [<C key="2">/api/services/:id</C>, 'GET / PUT / DELETE', 'Detalhes (com recipe e setup), edição, remoção.'],
          [<C key="3">/api/services/:id/start|stop|restart</C>, 'POST', 'Ciclo de vida do serviço.'],
          [<C key="4">/api/services/:id/logs</C>, 'GET', 'Logs persistidos (stdout/stderr).'],
          [<C key="5">/api/services/:id/input</C>, 'POST', 'Envia stdin para o processo.'],
          [<C key="6">/api/services/:id/disk-usage</C>, 'GET', 'Uso de disco do workspace (cache 20s).'],
          [<C key="7">/api/services/:id/setup</C>, 'GET / POST', 'Estado do setup (step/progress/logs) / dispara setup.'],
          [<C key="8">/api/services/:id/files/…</C>, '* ', 'Mesmas operações do gerenciador, restritas ao workspace.'],
          [<C key="9">/api/services/:id/terminal/…</C>, '* ', 'Sessões de terminal (POST cria, exec, interrupt, DELETE).'],
          [<C key="10">/api/services/:id/backups</C>, '* ', 'Criar/listar/baixar/restaurar/apagar backups ZIP.'],
        ]}
      />

      <H2 id="arquivos">Arquivos</H2>
      <P>Disponíveis em <C>/api/files</C> (global, raiz = <C>FILES_ROOT</C>) e <C>/api/services/:id/files</C> (workspace do serviço):</P>
      <Ul>
        <li><C>GET /list?path=</C>, <C>GET /read?path=</C>, <C>GET /search?q=</C>, <C>GET /download?path=</C>, <C>GET /archive/peek</C>;</li>
        <li><C>POST /mkdir</C>, <C>/touch</C>, <C>/copy</C>, <C>/move</C>, <C>/rename</C>, <C>/delete</C>, <C>/compress</C>, <C>/extract</C>, <C>/upload</C> (multipart);</li>
        <li><C>PUT /write</C> (texto, escrita atômica, até <C>EDITOR_MAX_BYTES</C>);</li>
        <li><C>GET /api/files/audit</C> — log de auditoria global.</li>
      </Ul>

      <H2 id="outros">Bancos, Docker, monitor e settings</H2>
      <DocTable
        head={['Área', 'Endpoints principais']}
        rows={[
          ['Bancos', <><C>/api/databases</C> (GET/POST), <C>/:id</C> (GET/PUT/DELETE), <C>/:id/start|stop|restart</C>, <C>/:id/logs</C>, <C>/engines</C></>],
          ['Docker', <><C>/api/docker/hosts</C> (CRUD + ping), <C>/hosts/:id/containers|images|networks|volumes</C> (list/pull/create/start/stop/restart/delete)</>],
          ['Monitor', <><C>/api/monitor/snapshot</C>, <C>/overview</C>, <C>/processes</C></>],
          ['Settings', <><C>/api/settings</C> (GET/PUT), <C>/alert/test</C>, <C>/domains</C> (GET/PUT + tunnel/token/apply/stop), <C>/remote-access</C> (start/stop)</>],
        ]}
      />

      <H2 id="websocket">Eventos WebSocket</H2>
      <P>
        Conecte ao Socket.io do backend (mesma porta). Painel single-user: todo evento é broadcast para todos os
        clientes conectados.
      </P>
      <DocTable
        head={['Evento', 'Payload (essencial)', 'Quando']}
        rows={[
          [<C key="1">service:log</C>, <C key="1b">{'{'} serviceId, level, message, ts {'}'}</C>, 'Linha de log de um serviço (local ou container).'],
          [<C key="2">service:status</C>, <C key="2b">{'{'} serviceId, status, pid? {'}'}</C>, 'Mudança de estado do serviço (running/stopped/error).'],
          [<C key="3">service:setup</C>, <C key="3b">{'{'} serviceId, step, progress, status {'}'}</C>, 'Progresso do setup (clone/install/build).'],
          [<C key="4">db:log / db:status</C>, <C key="4b">{'{'} instanceId, … {'}'}</C>, 'Logs e estado de instâncias de banco.'],
          [<C key="5">tunnel:url / tunnel:status</C>, <C key="5b">{'{'} type, id, url? {'}'}</C>, 'Quick Tunnels.'],
          [<C key="6">domains:status / domains:log</C>, <C key="6b">{'{'} status, mode? {'}'}</C>, 'Named Tunnels (modo CLI/token).'],
          [<C key="7">terminal:data / terminal:exit</C>, <C key="7b">{'{'} sessionId, … {'}'}</C>, 'Saída ao vivo e término de sessão de terminal.'],
          [<C key="8">monitor:snapshot</C>, <C key="8b">{'{'} cpu, mem, disk, net, temp, processes {'}'}</C>, 'Snapshot periódico do monitor (só enquanto houver clientes).'],
        ]}
      />

      <H2 id="exemplos">Exemplos com curl</H2>
      <CodeBlock
        title="login e listagem de serviços"
        code={`TOKEN=$(curl -s http://localhost:3001/api/auth/login \\\n  -H 'Content-Type: application/json' \\\n  -d '{"username":"admin","password":"SUA_SENHA"}' | jq -r .token)\ncurl -s http://localhost:3001/api/services -H "Authorization: Bearer $TOKEN" | jq`}
      />
      <CodeBlock
        title="criar serviço usando uma receita"
        code={`curl -s -X POST http://localhost:3001/api/services \\\n  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\\n  -d '{"name":"minha-api","recipe":"node-api","use_template":true}' | jq`}
      />
      <CodeBlock
        title="upload de um arquivo (multipart)"
        code={`curl -s -X POST "http://localhost:3001/api/files/upload?path=minha-api" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -F "file=@./app.js"`}
      />
    </>
  ),
};

/* ═══════════════════════ Glossário ═══════════════════════ */

export const glossario: DocPage = {
  slug: 'glossario',
  title: 'Glossário',
  navLabel: 'Glossário',
  description: 'Termos usados na documentação e no código do Pterodroid explicados em uma frase — Termux, proot, workspace, tunnel, bind mount, healthcheck e mais.',
  keywords: ['glossário', 'termux', 'proot', 'workspace', 'supervisor', 'quick tunnel', 'named tunnel', 'bind mount', 'healthcheck', 'docker exec', 'runtime', 'recipe', 'watchdog'],
  sourcePath: 'apps/documentation/src/docs/content/reference.tsx',
  sections: [
    { id: 'termos', title: 'Termos' },
    { id: 'grafico', title: 'Mapa rápido' },
  ],
  render: () => (
    <>
      <H2 id="termos">Termos</H2>
      <DocTable
        head={['Termo', 'Definição']}
        rows={[
          ['Termux', 'Emulador de terminal Android em userland, sem root — o ambiente principal do Pterodroid.'],
          ['proot (proot-distro)', 'Camada que emula um sistema Linux completo (ex.: Ubuntu) dentro do Termux, sem root.'],
          ['Workspace', 'Diretório exclusivo de um serviço, em <C>data/workspaces/&lt;nome&gt;</C>, criado automaticamente.'],
          ['Supervisor-filho', 'Modelo em que o backend do painel é pai direto dos processos dos serviços — sem pm2/systemd.'],
          ['Receita (recipe)', 'Molde por tipo de serviço (API, bot, static…) que preenche porta, comando, runtime e template.'],
          ['Watchdog', 'Reinício automático de serviços que caíram, com backoff e limite de tentativas.'],
          ['Healthcheck', 'Verificação HTTP de que o processo está vivo E respondendo; falha = restart.'],
          ['Quick Tunnel', 'Túnel Cloudflare temporário com URL aleatória (trycloudflare.com), sem conta.'],
          ['Named Tunnel', 'Túnel Cloudflare persistente com domínio próprio (via CLI cloudflared ou token do dashboard).'],
          ['bind mount', 'Montagem de uma pasta do host dentro de um container — é como o workspace chega ao container.'],
          ['docker exec', 'Execução de um comando dentro de um container em execução; o terminal do painel usa isso.'],
          ['docker.sock', 'Socket do daemon Docker; montá-lo no container dá ao painel controle sobre containers do host.'],
          ['runtime', 'Como o serviço roda: processo local (child_process) ou container Docker.'],
          ['main_file', '<>Arquivo principal do serviço (ex.: <C>src/index.ts</C>); o comando de início pode ser inferido dele (ex.: <C>node .</C>).</>'],
          ['SETUP_REQUIRED', 'Código 403 devolvido pelas rotas de negócio enquanto a senha padrão não for trocada.'],
        ]}
      />
      <H2 id="grafico">Mapa rápido</H2>
      <P>
        Novato? A ordem recomendada: <DocLink to="/docs/introducao">Comece aqui</DocLink> →{' '}
        <DocLink to="/docs/instalacao">Instalação</DocLink> → <DocLink to="/docs/primeiro-acesso">Primeiro
        acesso</DocLink> → <DocLink to="/docs/primeiro-servico">Primeiro serviço</DocLink>. Termos específicos de
        Cloudflare estão no <DocLink to="/docs/cloudflare">guia de acesso remoto</DocLink>.
      </P>
    </>
  ),
};
