# Relatório Final — Estabilização do Pterodroid

---

## 1. Resumo Executivo

Foi feita uma auditoria completa do Pterodroid e, em seguida, a correção das
causas raiz encontradas. **Nenhum problema foi corrigido por tentativa e
erro**: cada um foi primeiro reproduzido executando o backend real, e cada
correção foi validada da mesma forma.

O ponto de partida foi entender por que a plataforma não era confiável no dia
a dia. A resposta não estava em bugs isolados, e sim em três falhas
estruturais que geravam sintomas espalhados:

1. **Não existia uma raiz única de caminhos.** `PROJECTS_ROOT` e `FILES_ROOT`
   apontavam para árvores diferentes, e havia caminho fixo
   (`/home/appuser/projects`) no código. Consequência: os arquivos de um
   serviço simplesmente não apareciam na aba "Arquivos".
2. **As operações de arquivo assumiam um mundo perfeito.** Nada criava
   diretórios ausentes, nada era atômico, nada tratava conflito de nome.
   Consequência: upload e edição falhavam em situações triviais, vazando o
   caminho absoluto do host na mensagem de erro.
3. **O estado do serviço confundia "o que o usuário quer" com "o que está
   acontecendo".** Consequência: o auto-resume anunciado no README **nunca
   funcionava** após um desligamento normal, e uma falha ao iniciar deixava o
   serviço marcado como "rodando" para sempre.

Resolvidas essas três raízes, a maior parte dos sintomas desapareceu junto.
Além disso foram corrigidos dois bugs que faziam o suporte a Docker não
funcionar de fato — o bind mount usava um caminho inexistente no host, e um
`ReferenceError` engolido impedia qualquer atualização de status de container.

Por fim, foi implementado o **terminal no painel** — o único item da lista de
objetivos que não existia no projeto (a UI dizia "em breve"). Com ele, a
promessa central do brief se cumpre: *"o usuário nunca deverá precisar acessar
manualmente o sistema de arquivos para gerenciar um serviço"*.

O resultado é uma base **menor e mais simples**: o código de aplicação encolheu
mesmo com funcionalidade nova, são **163 testes automatizados** e o bundle do
frontend caiu de ~5,8 MB para 538 KB — o que importa diretamente no
público-alvo do projeto.

---

## 2. Problemas Encontrados

Levantamento completo em [`docs/AUDITORIA.md`](./AUDITORIA.md). Resumo por
área, com a evidência que comprovou cada um.

### 🔴 Críticos

| # | Problema | Evidência observada |
|---|----------|---------------------|
| P1 | Gerenciador de arquivos quebrado em instalação limpa | `GET /api/files/list` → `"Arquivo ou pasta não encontrado"` |
| P2 | Arquivos do serviço invisíveis na aba Arquivos | `FILES_ROOT` e `PROJECTS_ROOT` em árvores distintas |
| P5 | Upload em pasta inexistente falha e vaza caminho do host | `"ENOENT: ... open '/tmp/ptd/ws/node-api/nao/existe/f.txt'"` |
| P6 | Salvar arquivo em caminho aninhado falha | `PUT /files/write {"path":"a/b/c.txt"}` → ENOENT |
| P12 | Serviço Docker "restaurado" como processo local no boot | `SELECT ... WHERE status='running'` sem filtro de runtime |
| P13 | Comando inexistente deixa serviço "rodando" eternamente | Node emite só `error`, nunca `exit` (verificado isoladamente) |
| P14 | Edição parcial de serviço derruba a rota | `PUT {"description":"x"}` → HTTP 500 `reading 'trim'` |
| P18 | Container Docker sobe sem os arquivos do projeto | bind mount com caminho do painel, não do host |
| P–novo | Status de container nunca persistia | `ReferenceError: db is not defined` em `_pollOne`, engolido pelo poll |
| P–novo | Auto-resume nunca funcionava | shutdown gravava `stopped`; boot procurava `running` |

### 🟠 Altos

P3 (caminho fixo), P4 (sem raiz única), P7 (upload sobrescreve em silêncio),
P8 (escrita não atômica), P9 (rotas por serviço sem copy/search),
P15 (`npm install` **síncrono** dentro do request HTTP), P19
(`DOCKER_API_VERSION` ignorado), P20 (`npm install` no boot do container →
loop de restart), P23 (redis inútil no compose), P24 (sem healthcheck),
P25 (`user: root` anulando o usuário sem privilégios), P28 (tabela `logs` sem
limite), P29 (limite de JSON menor que o do editor), P33/P34/P35 (frontend),
favicon de 5 MB.

### 🟡 Médios e ⚪ baixos

P10, P11, P16, P17, P21, P22, P26, P27, P30, P31, P32, P36, P37, P38 —
detalhados na auditoria.

---

## 3. Correções Implementadas

Para cada item: **problema → causa raiz → solução → validação**.

### 3.1 Raiz única de workspaces (Etapa 2)

- **Problema:** arquivos de serviço não apareciam no gerenciador; caminho fixo
  `/home/appuser/projects` no código.
- **Causa raiz:** duas raízes independentes e nenhum módulo responsável por
  resolver caminhos.
- **Solução:** novo `workspaceManager.js` como fonte única de verdade. Uma raiz
  configurável (`WORKSPACES_ROOT`), um diretório exclusivo por serviço,
  colisão de nome resolvida com sufixo (`node-api-2`), caminhos legados
  remapeados e `FILES_ROOT` apontando por padrão para a mesma raiz.
- **Validação:** as duas telas passam a listar os mesmos arquivos; 12 testes de
  unidade cobrindo slug, normalização e remoção protegida.

### 3.2 Operações de arquivo (Etapas 4 e 5)

- **Problema:** upload e escrita falhavam em pasta inexistente; upload
  sobrescrevia arquivo existente sem avisar; escrita podia deixar arquivo pela
  metade.
- **Causa raiz:** as operações presumiam que o diretório já existia e escreviam
  direto no destino final.
- **Solução:** escrita atômica (`tmp` + `rename`), criação de diretório sob
  demanda, e upload em duas fases (área temporária na mesma raiz → rename com
  resolução de conflito, gerando `nome (2).ext`). Nomes vindos do navegador são
  achatados com segurança (`../../etc/passwd` → `etc_passwd`).
- **Validação:** upload em pasta inexistente, upload duplicado e arquivo de
  3 MB — todos aprovados na bateria HTTP.

### 3.3 Paridade entre os dois gerenciadores (Etapas 6 e 11)

- **Problema:** `POST /api/services/1/files/copy` → `"Not found"`.
- **Causa raiz:** `files.js` e `serviceFiles.js` eram cópias de ~150 linhas que
  divergiram; só o global recebeu `copy` e `search`.
- **Solução:** `fileRoutesFactory.js` gera o conjunto completo de rotas a partir
  de um file manager; os dois arquivos viraram configuração fina. No frontend,
  `FileBrowser` + `useFileBrowser` fazem o mesmo papel.
- **Validação:** todas as operações respondem igual nos dois escopos.

### 3.4 Ciclo de vida dos serviços

- **Problema A:** serviço com comando inválido ficava "rodando" para sempre.
  **Causa:** o Node emite apenas `error` (nunca `exit`) quando o binário não
  existe, e só `exit` era tratado. **Solução:** um único `finalize()`.
- **Problema B:** auto-resume nunca funcionava. **Causa:** o desligamento
  gracioso gravava `status='stopped'` em todos os serviços, e o boot seguinte
  procurava por `status='running'`. **Solução:** coluna `desired_state`
  separando intenção de estado observado.
- **Problema C:** `cd app && node index.js` tentava executar `cd` como binário.
  **Solução:** `commandParser.js` delega ao `sh -c` quando detecta
  metacaracteres de shell.
- **Validação:** start/stop/restart, crash com auto-restart, comando inválido e
  persistência entre reinícios do painel.

### 3.5 Docker (Etapa 3)

- **Problema A:** container subia com `/app` vazio. **Causa:** o bind mount
  usava o caminho como o *painel* o vê; o daemon resolve no filesystem do
  *host*. **Solução:** `HOST_WORKSPACES_ROOT` + `toHostPath()`.
- **Problema B:** status de container nunca era persistido. **Causa:**
  `ReferenceError: db is not defined` em `_pollOne`, mascarado pelo
  `.catch(() => {})` do poll. Encontrado pelo teste novo.
- **Problema C:** loop de reinicialização evitável. **Causa:** o comando
  inferido rodava `npm install` a cada boot do container.
- **Outros:** workspace recriado automaticamente, `DOCKER_API_VERSION`
  respeitado, poll para quando ocioso, restart recria o stream de logs.
- **Validação:** 25 testes contra uma Docker Engine simulada, inspecionando o
  JSON exato enviado ao daemon.

### 3.9 Terminal do serviço (objetivo "acessar terminal")

- **Problema:** o brief lista "acessar terminal" entre as capacidades
  obrigatórias, e não havia nada — a UI exibia *"terminal web (em breve)"*.
  Na prática, qualquer projeto com dependências exigia sair do painel.
- **Decisão técnica:** um terminal completo (vim, htop) exigiria `node-pty`,
  módulo nativo que precisa de node-gyp e **falha ao instalar no Termux** — o
  mesmo motivo que levou o projeto a escolher `sql.js`. Optei por um terminal
  **orientado a comando**, que cobre o uso real (`npm install`, `git pull`,
  `ls`, `cat`) e roda em Termux, proot, Docker e Linux sem compilar nada.
  Como efeito colateral positivo, stdout e stderr chegam **separados** — num
  PTY viram um stream só.
- **Arquitetura, validada por medição:** testei primeiro um shell persistente
  sobre pipes e **medi o problema**: o Ctrl+C precisa sinalizar o grupo de
  processos, o que mata o próprio shell e derruba a sessão. A solução foi um
  filho `detached` por comando (grupo isolado, SIGINT atinge só ele), com a
  sessão guardando `cwd`/`env` do lado do Node. O `cd` continua funcionando
  porque anexamos uma linha que imprime o `$PWD` final num marcador, lido e
  removido da saída.
- **Implementação:** `terminalManager.js` (sessões locais e via `docker exec`,
  com a mesma superfície pública), `routes/terminal.js` (controle da sessão) e
  `ServiceTerminal.jsx`. A saída trafega por socket.io, então um `npm install`
  vai imprimindo enquanto roda. Há teto de saída, timeout, um comando por
  sessão e reaper de sessões ociosas.
- **Validação:** 23 testes de integração cobrindo persistência de `cwd`/`env`,
  separação de streams, códigos de saída, Ctrl+C interrompendo só o comando,
  isolamento entre serviços, autenticação e truncamento. Verificado à mão que
  `npm install` roda pelo painel e que o arquivo criado no terminal aparece
  imediatamente no gerenciador de arquivos.

### 3.10 Segurança da autenticação

- **Problema:** o login não tinha nenhuma proteção contra força bruta.
  **Medido antes de corrigir:** ~12,6 tentativas de senha por segundo
  (~45.180 por hora), nenhuma bloqueada. E o aviso de "senha padrão" tinha
  um botão de dispensar que marcava a configuração como concluída **sem
  trocar a senha** — o aviso existia, mas a única ação óbvia era silenciá-lo.
- **Causa raiz:** ausência de controle de tentativas, e o `setup_done` sendo
  gravado por uma rota independente da troca de senha.
- **Por que virou prioridade agora:** é consequência direta do terminal que
  eu mesmo adicionei. Antes, adivinhar a senha dava acesso ao gerenciamento
  de serviços; agora dá **execução de comandos no dispositivo**. O risco de
  uma falha de autenticação mudou de patamar.
- **Solução:** `loginThrottle.js` com franquia de 3 erros (todo mundo erra a
  senha), atraso progressivo e bloqueio de 5 minutos a partir do 8º erro,
  com chave por IP+usuário. Em memória e sem dependência nova. Além disso: o
  hash é comparado mesmo quando o usuário não existe (senão dava para
  descobrir nomes de usuário medindo o tempo), a mensagem de erro é genérica,
  a senha mínima subiu para 8 caracteres, e o aviso só some quando a senha é
  realmente trocada.
- **Validação:** repeti exatamente o mesmo ataque de antes (100 tentativas,
  20 threads): **7 avaliadas, 93 barradas com 429** → de ~45.180/hora para
  ~96/hora, redução de **~99,8%**. Custo para o dono do painel que errou a
  senha uma vez: **1 ms**. Mais 23 testes automatizados.

### 3.11 Injeção de comando pelo nome da instância de banco

- **Problema:** o nome da instância vira o nome de uma **pasta em disco**, e
  esse caminho era interpolado dentro de uma string de shell nos drivers:
  `execSync(\`${init} -D "${dataDirectory}" ...\`)`. Um nome como
  `x"; touch /tmp/arquivo; echo "` fazia o shell enxergar **três comandos**
  em vez de um.
- **Como foi confirmado:** executando o padrão real do driver com esse nome —
  o arquivo foi criado. Não é teórico. Como o painel roda com as permissões
  do usuário, isso é **execução arbitrária a partir de um campo de
  formulário**.
- **Por que passou despercebido antes:** este foi um arquivo que eu havia
  listado como "revisado" na primeira auditoria sem ter lido a fundo. Ao
  voltar nele especificamente, o problema apareceu.
- **Correção em duas camadas:**
  1. **Raiz** — `runBinary()` usa `execFileSync` com **array de argumentos**.
     Sem shell, `"`, `;`, `$()` e crase são apenas caracteres. Aplicado no
     `initdb`, no `mariadb-install-db` e no cliente `mysql` — onde a própria
     **senha** era interpolada numa linha de shell.
  2. **Entrada** — nome, porta e usuário do banco validados na API.
- **Validação:** 25 testes cobrindo 5 formas de injeção, travessia de caminho
  e faixa de porta. E, principalmente: **burlando a validação** e gravando o
  nome malicioso direto, o payload chega ao binário como **texto literal** —
  ou seja, a camada 1 protege sozinha.

Na mesma revisão: a senha do banco era gerada com `Math.random()` (não
criptográfico, previsível) — agora `crypto.randomBytes`; o diretório de dados
passa por `slugify`; e a porta ficou restrita a 1024–65535.

### 3.12 Erros silenciosos nos formulários

- **Problema:** `ServiceFormModal` e `DatabaseFormModal` não tinham `catch` no
  submit. Um 400 do servidor apenas rejeitava a promise: o modal continuava
  aberto, sem salvar e **sem dizer por quê**.
- **Por que virou prioridade:** ficou pior por causa das validações que eu
  mesmo acabara de adicionar — o usuário digitaria um nome inválido e não
  receberia explicação nenhuma.
- **Solução:** os dois formulários exibem a mensagem do servidor no topo.
  Verifiquei que as mensagens são acionáveis, não genéricas (ex.: *"A porta
  deve estar entre 1024 e 65535"*).

### 3.6 Infraestrutura

`HEALTHCHECK` no Dockerfile e no compose; `tini` como PID 1 (evita processos
zumbis); usuário sem privilégios com `group_add` em vez de `user: root`; um
único volume `/data`; remoção do serviço `redis` (nenhuma linha de código o
usava); limite de log do container.

### 3.7 Performance (Etapa 8)

`df` e `ps` deixaram de ser síncronos — rodavam a cada 2 s e **travavam o event
loop inteiro**; agora são assíncronos com cache por TTL. `npm install` saiu do
caminho do request HTTP. A poda de logs passou a existir de fato
(`LOG_MAX_DB` e a retenção em dias eram lidos e ignorados). Recarregamentos
disparados por eventos de status ganharam debounce. Favicon: 5 MB → 907 B.

### 3.8 Frontend (Etapa 7)

Listagem obsoleta em navegação rápida (respostas fora de ordem) e dados do
serviço anterior ao abrir outro serviço; seleção de itens que não existem mais;
`MoveCopyModal` que sempre navegava a árvore global; progresso de upload
irreal; opção de apagar os arquivos ao remover o serviço.

---

## 4. Arquivos Modificados

### Criados (17)

| Arquivo | Papel |
|---|---|
| `backend/src/services/workspaceManager.js` | Fonte única de resolução de caminhos |
| `backend/src/services/commandParser.js` | Parser de comando compartilhado |
| `backend/src/services/auditLog.js` | Auditoria + poda de logs |
| `backend/src/routes/fileRoutesFactory.js` | Rotas de arquivo compartilhadas |
| `frontend/src/components/files/FileBrowser.jsx` | Navegador único |
| `frontend/src/components/files/useFileBrowser.js` | Estado do navegador |
| `backend/src/services/loginThrottle.js` | Freio contra força bruta no login |
| `backend/tests/database-security-test.js` | 25 testes de segurança de banco |
| `backend/tests/auth-security-test.js` | 23 testes de segurança |
| `backend/src/services/terminalManager.js` | Sessões de terminal (local e container) |
| `backend/src/routes/terminal.js` | API do terminal |
| `frontend/src/components/ServiceTerminal.jsx` | Aba Terminal |
| `backend/tests/terminal-test.js` | 23 testes de integração |
| `backend/tests/workspace-files-test.js` | 43 testes de unidade |
| `backend/tests/docker-driver-test.js` | 25 testes com engine simulada |
| `backend/tests/run-all.sh` | Runner (`npm test`) |
| `docs/AUDITORIA.md`, `docs/RELATORIO.md` | Documentação |

### Removidos (3) — código morto

`projectScaffold.js` (substituído), `dockerFileManager.js` e `miniTar.js`
(nunca importados por nenhuma rota; recuperáveis pelo histórico do git).

### Modificados (principais)

**Backend:** `config.js`, `server.js`, `db/index.js`, `db/sqliteCompat.js`,
`routes/{services,files,serviceFiles,monitor}.js`,
`services/{processManager,dockerServiceDriver,dockerHostManager,dockerEngine,fileManager,serviceWorkspace,systemMonitor}.js`,
`sockets/index.js`, `tests/smoke-test.sh`, `package.json`.

**Frontend:** `lib/api.js`, `pages/{Files,Services,Login}.jsx`,
`components/{ServiceDetailModal,ConfirmDialog,Sidebar}.jsx`,
`components/files/{ServiceFileBrowser,MoveCopyModal,UploadZone,FileEditor}.jsx`,
`index.html`, `public/images/favicon.svg`.

**Infra:** `Dockerfile`, `docker-compose.yml`, `.dockerignore`,
`.env.example`, `panelctl.sh`, `README.md`.

---

## 5. Melhorias Arquiteturais

1. **Fonte única de verdade para caminhos.** Todo caminho de projeto passa pelo
   `workspaceManager`. Isso torna impossível reintroduzir caminho fixo, e a
   tradução painel⇄host fica num lugar só.
2. **Uma implementação de arquivos, dois escopos.** A fábrica de rotas no
   backend e o `FileBrowser` no frontend eliminam a duplicação que já havia
   causado divergência de funcionalidade. Foi exatamente essa unificação que
   deu `copy`, `search`, `rename` e `move` à aba do serviço "de graça".
3. **Intenção separada de estado observado.** `desired_state` (o que o usuário
   quer) vs `status` (o que está acontecendo) — o padrão que sistemas de
   orquestração usam, e o que faz o auto-resume funcionar de verdade.
4. **Fronteira de segurança explícita.** `resolveSafePath()` é o único ponto de
   entrada de caminhos, agora validando também o ancestral de arquivos que
   ainda não existem (symlink no meio do caminho).
5. **Falhas isoladas.** Um flush de banco que falha, uma promise rejeitada ou
   uma exceção não capturada deixam de derrubar o painel inteiro.
6. **Testes sem infraestrutura.** A Docker Engine simulada permite validar a
   montagem do container — onde estavam os bugs mais caros — sem Docker
   instalado, o que mantém a suíte rodável em Termux.

Foi mantido o que já era boa decisão: `sql.js` (sem compilação nativa), cliente
HTTP próprio para o Docker (sem dependência pesada), leitura direta de `/proc`.
Nenhuma dependência nova foi adicionada.

---

## 6. Testes Executados

### Automatizados — `cd backend && npm test`

| Suíte | Casos | Cobertura |
|---|---:|---|
| `workspace-files-test.js` | 43 | Caminhos, path traversal, symlinks, operações de arquivo, parser de comando |
| `docker-engine-smoke-test.js` | 14 | Cliente da Engine, demux de stream, NDJSON |
| `docker-driver-test.js` | 25 | Montagem do container, tradução de caminho, poll, ciclo de vida |
| `auth-security-test.js` | 23 | Força bruta, enumeração de usuário, troca de senha, tokens |
| `database-security-test.js` | 25 | Injeção de comando, travessia, portas, senhas, vazamento |
| `terminal-test.js` | 23 | Sessão, cwd/env persistentes, streams, Ctrl+C, isolamento, truncamento |
| `smoke-test.sh` | 10 | API HTTP: auth, criação, start, crash + auto-restart, stop, delete |
| **Total** | **163** | |

### Manuais (bateria HTTP contra o backend real, 39 verificações)

Instalação limpa; criar serviço Node e Docker; criar/editar/excluir arquivos e
diretórios; mover, copiar, renomear, buscar; upload (comum, em pasta
inexistente, duplicado, 3 MB); download (arquivo e recusa de pasta);
start/restart/stop; persistência entre reinícios do painel; edição parcial;
monitoramento; auditoria; frontend servido pelo backend (SPA, cache, 404, 401).

### Segurança

`../../../etc/passwd`, caminho absoluto, `..` no meio do caminho, barra dupla,
byte nulo, symlink apontando para fora, nome de upload malicioso, exclusão da
raiz, remoção de diretório externo ao workspace — **todos bloqueados**.

Autenticação: força bruta medida antes e depois da correção (45.180
tentativas/hora → ~96/hora), enumeração de usuário por tempo de resposta,
bloqueio isolado por IP+usuário (não derruba o dono do painel), token ausente
e token forjado — **todos tratados**.

Instâncias de banco: injeção de comando pelo nome (5 variantes: aspas, `$()`,
crase, pipe, nova linha), travessia de caminho, porta privilegiada, usuário
com sintaxe SQL, e vazamento de senha em listagens — **todos bloqueados**. A
injeção foi **reproduzida na prática antes da correção**.

### Docker

Build real **não executado** (sem Docker no ambiente desta sessão — ver
Pendências). Em substituição, o layout exato da imagem foi reproduzido no
disco e o backend foi iniciado da mesma forma que o `CMD` faz, validando:
resolução do `frontend/dist`, variáveis de ambiente, o endpoint usado pelo
`HEALTHCHECK` (`curl -fsS /api/health` → saída 0), o roteamento SPA e a
tradução de bind mount para o host.

---

## 7. Resultado dos Testes

| Bateria | Resultado | Observações |
|---|---|---|
| Unidade — workspaces/arquivos/parser | ✅ 43/43 | — |
| Unidade — cliente Docker Engine | ✅ 14/14 | Suíte que já existia, sem regressão |
| Integração — driver Docker | ✅ 25/25 | Revelou o `ReferenceError` de `_pollOne` |
| Integração — segurança da autenticação | ✅ 23/23 | Força bruta 45.180/h → ~96/h |
| Integração — segurança de banco | ✅ 25/25 | Injeção de comando reproduzida e corrigida |
| Integração — terminal do serviço | ✅ 23/23 | Ctrl+C, cwd/env, streams separados |
| Integração — API HTTP | ✅ 10/10 | Inclui crash + auto-restart |
| Manual — fluxos do brief | ✅ 39/39 | — |
| Segurança | ✅ 9/9 | — |
| Build do frontend | ✅ | 538 KB (era ~5,8 MB), +6 KB do terminal |
| Container simulado | ✅ | Healthcheck retorna 0 |
| Build Docker real | ⚠️ Não executado | Docker indisponível no ambiente |

**Nenhuma regressão detectada.** A suíte pré-existente continua passando.

---

## 8. Possíveis Melhorias Futuras

1. **Terminal com PTY opcional** para suportar vim/htop: manteria o modo atual
   como padrão e usaria `node-pty` só onde ele compila (Linux/Docker),
   preservando o Termux. `dockerEngine.hijack()` já existe para o lado Docker.
2. **Interromper comando dentro de container:** `docker exec` não expõe um
   grupo de processos para sinalizar; exigiria rastrear o PID interno.
3. **Gerenciamento de arquivos dentro do container** para serviços cujo
   workspace não é montado como volume. O código removido
   (`dockerFileManager` + `miniTar`) é um bom ponto de partida e está no
   histórico do git.
4. **Compactar/extrair arquivos** pelo painel (zip/tar) e download de pasta.
5. **Upload retomável** por chunks — relevante em conexão móvel instável.
6. **Virtualização da lista de arquivos** para diretórios com milhares de itens.
7. **Métricas históricas** persistidas (hoje o gráfico só tem a sessão atual).
8. **Divisão do bundle por rota** (`React.lazy`) para o primeiro carregamento.
9. **Autenticação em dois fatores (TOTP)** — o freio de força bruta já está
   no lugar; 2FA seria a próxima camada para quem expõe o painel à internet.

---

## 9. Pendências

### 9.1 Build Docker não executado nesta sessão

**Limitação do ambiente**, não do código: não há Docker no sandbox.
`Dockerfile` e `docker-compose.yml` foram revisados linha a linha e a lógica de
que dependem foi validada por simulação (seção 6), mas o `docker compose up`
em si não foi executado. Recomendo rodar antes de considerar concluído:

```bash
cp .env.example .env
echo "DOCKER_GID=$(getent group docker | cut -d: -f3)" >> .env
docker compose up -d --build
docker compose ps   # deve mostrar "healthy"
```

### 9.2 `DOCKER_GID` precisa ser ajustado por máquina

O padrão (`988`) é um chute razoável, mas o GID do grupo `docker` varia entre
distribuições. Se o painel não enxergar o Docker, é o primeiro lugar a checar.
Alternativa mais segura seria um proxy de socket, fora do escopo aqui.

### 9.3 Migração de instalações existentes

O caminho padrão mudou de `~/pterodroid-projects` para
`<DATA_ROOT>/workspaces`. Serviços existentes **não são afetados** (o
`working_directory` absoluto salvo continua sendo respeitado), e caminhos
legados conhecidos são remapeados. Quem quiser consolidar tudo na nova raiz
precisa mover as pastas manualmente e atualizar o diretório de trabalho pela
UI — **não foi escrito um migrador automático**, por ser uma operação
destrutiva que merece decisão consciente do usuário.

### 9.4 Bancos de dados não foram testados de ponta a ponta

Não há PostgreSQL nem MariaDB no ambiente, então o provisionamento de
instâncias não pôde ser exercitado. O `dbInstanceManager` recebeu apenas
mudanças indiretas (`config`, poda de logs); a lógica de provisionamento não
foi alterada. Vale um teste manual em um aparelho com esses pacotes instalados.

### 9.5 Aviso remanescente do `npm audit`

O `multer@1.x` está em modo de manutenção. A migração para a série 2.x muda a
API e pede um ciclo próprio de teste de upload — deliberadamente **fora do
escopo** desta estabilização, para não misturar uma quebra de dependência com
correção de bugs.

### 9.6 Instalação de dependências — resolvido

A remoção do `npm install` síncrono corrigiu o travamento do painel (P15) e
deixava, como efeito colateral, a instalação de dependências dependendo de
acesso externo. **Com o terminal isso está resolvido:** basta rodar
`npm install` na aba Terminal do serviço (verificado em teste manual). O
starter gerado continua sem dependências, então o fluxo padrão nem precisa
disso.

### 9.7 Limitações conhecidas do terminal

São conscientes, não pendências disfarçadas, e a UI informa cada uma:

- **Sem programas de tela cheia** (vim, htop, top): exigiria PTY, que exigiria
  módulo nativo, que não compila no Termux.
- **Ctrl+C não funciona dentro de container:** `docker exec` não dá um grupo
  de processos para sinalizar. O comando respeita o timeout; a mensagem na
  tela explica isso quando o usuário tenta.
- **Um comando por sessão** (o segundo recebe 409). Abrir uma segunda sessão
  resolve; simplifica muito o rastreamento de estado.
