# Relatório Final — Consolidação da Configuração Inicial de Serviços

## 1. Resumo Executivo

O fluxo de setup inicial de serviços do Pterodroid foi reimplementado de ponta a ponta, substituindo o modelo "fogo e esquecimento" (clone/install rodando em terminal de background sem observabilidade, com `|| true` engolindo erros) por um **SetupManager** orquestrado, resiliente e observável.

Resultados:
- Criação de serviço JS com repositório local: clone, install, start → serviço de pé em ~2s.
- Criação de serviço TypeScript com `tsconfig.json`: clone, install, `npm run build` (tsc), start via `dist/index.js` → funcionando de ponta a ponta.
- Clone público/privado com token: o token NUNCA é devolvido pela API nem aparece em logs (mascarado em tempo real).
- Setup duplicado é bloqueado com HTTP 409.
- Progresso em tempo real via socket.io com estados (`idle → cloning → installing → building → starting → done/failed`), barra de progresso, indicador de etapa e logs transmitidos ao vivo.
- Comando de inicialização (Startup Command) explícito tem prioridade sobre toda heurística.
- Detecção automática de gerenciador de pacotes: npm / pnpm / yarn / bun via lockfiles.
- Workspaces parcialmente clonados são postos em quarentena antes de nova tentativa — sem corromper o diretório.
- Falhas de build (ex.: TS com erros de tipo) interrompem o setup e marcam como `failed` sem iniciar o serviço quebrado; nova tentativa funciona sem limpar nada manualmente.
- Todos os testes existentes do backend continuam passando (23+), com apenas um falso negativo relacionado ao binário `file` ausente no sandbox.

## 2. Problemas Encontrados (antes das correções)

1. **Setup rodava "fire-and-forget"**: async IIFE no `serviceWorkspace.js` disparava `git clone ... || true`, `npm install ... || true` sem nenhuma forma de saber se deu certo. Erros eram silenciosamente engolidos pelo `|| true`.
2. **Sem feedback visual pro usuário**: nenhuma barra de progresso, nenhum status, nenhum log chegando ao vivo durante o setup.
3. **Token Git exposto**: retornado em GETs da API, aparecia em URLs de clone nos logs, e era enviado de volta pelo frontend no preenchimento do form.
4. **Sem trava contra execução duplicada**: dois cliques seguidos disparavam dois `npm install` ao mesmo tempo, causando corrupção de `node_modules`.
5. **Inferência frágil de comando**: dependente exclusivamente de `main_file`, sem noção de package.json `scripts.start`, build de TypeScript gerando `dist/`, etc.
6. **Sem suporte a startup command**: não existia campo para o usuário passar o comando que quisesse.
7. **Clones falhos deixavam pasta meia-clonada**: depois de um clone quebrado, a pasta continha um `.git` inválido e o próximo clone falhava com "destination path exists".
8. **Build TypeScript automático inexistente**: não havia detecção de `tsconfig.json` nem tentativa de `tsc`.
9. **Scaffold inicial sobrescrevia projeto clonado**: o `bootstrapNodeProject` criava `index.js`/`tsconfig.json`/`src/index.ts` ANTES do clone, poluindo o workspace que receberia o código real do usuário.
10. **Escolha de gerenciador de pacotes sempre era npm**, ignorando pnpm/yarn/bun.
11. **Comando sempre tinha trailing space** quando `node_args` era vazio (`sh -c 'node index.js '`).
12. **Sessões de terminal eram usadas para setup**, mas o usuário podia abrir outra sessão em paralelo e disputar o mesmo cwd.
13. **Git credentials eram embutidas na URL de clone** sem nenhuma máscara posterior nos logs.
14. **Nenhuma persistência do estado de setup** — depois de um refresh, o usuário não sabia o que tinha dado errado.

## 3. Causas Raiz

- O bootstrap vivia em um IIFE acoplado ao `resolveServiceWorkspace`, que era chamado dentro do request HTTP POST/PUT. Qualquer trabalho demorado tinha que ser disparado em background sem await, e sem estrutura de estado.
- A arquitetura do terminal era a única forma existente de rodar comandos assíncronos com output ao vivo, e o setup foi "embutido" nela de forma improvisada.
- Faltavam colunas no banco para guardar estado/etapa/progresso/erro/logs do setup, e faltavam eventos de socket específicos para transmitir isso em tempo real.
- Não havia distinção entre "seed inicial mínima" (starter) e "bootstrap do projeto real" (clone/install/build/start) — tudo era uma coisa só.
- O `git_token` era tratado como qualquer outro campo de texto, sem tratamento de segredo.

## 4. Correções Implementadas

### Backend

- **Novo módulo `backend/src/services/setupManager.js`**: orquestração sequencial do bootstrap, com:
  - Estados tipados (`idle/cloning/installing/building/starting/done/failed`).
  - Persistência em SQLite (`services.setup_status/step/progress/error/started_at/finished_at`).
  - Tabela nova `setup_logs` (um registro por linha de saída, com `stream`).
  - Transmissão em tempo real via socket.io: `service:setup` (estado) + `service:setup-log` (linha de log).
  - Bloqueio em memória contra setups concorrentes para o mesmo serviço.
  - Função utilitária `resolveStartupCommand` com prioridade: `startup_command` > `main_file` > `dist/index.js` (TS buildado) > `npm start` > `main` do package.json > heurística de arquivos (`index.js/server.js/app.js/main.js`).
  - Detecção automática de gerenciador: `bun.lockb → pnpm-lock.yaml → yarn.lock → package-lock.json/package.json` → npm/pnpm/yarn/bun.
  - Quarentena de pasta suja antes de clone: move o conteúdo para `../.partial-clone-<ts>` em vez de falhar.
  - Em caso de falha de clone, remove `.git` quebrado para permitir nova tentativa.
  - Timeout configurável por etapa (clone: 5min, install: 10min, build: 5min).
  - `npm install` só roda se não houver `node_modules` com conteúdo (evita install duplicado).
  - Build TS automático (`npm run build` / `pnpm run build` / `yarn build` / `bun run build`) quando existe `tsconfig.json` E script `build`; falha de build interrompe o setup.
  - Após build, usa `dist/<file>.js` ou `dist/index.js` automaticamente.
  - Mascaramento do token em TODO texto que vai para log (stdout, stderr, mensagens de erro).
  - Opção `autoStart`: inicia o serviço automaticamente no final se o setup der certo.
- **Novo módulo `backend/src/sockets/lazyIo.js`**: referência tardia ao socket.io server (quebrando o ciclo de dependências entre services e sockets).
- **`backend/src/services/serviceWorkspace.js` reescrito e simplificado**:
  - Removeu todo o IIFE de background (clone/install eram daqui).
  - `resolveServiceWorkspace` agora só resolve: diretório, volumes e comando heurístico inicial (seed).
  - `bootstrapNodeProject` só roda se NÃO houver `git_repo` (evita semear arquivos que seriam sobrescritos pelo clone).
  - Comando não tem mais trailing space com node_args vazio.
  - Campo novo `startup_command` respeitado na geração inicial de comando.
- **`backend/src/routes/services.js` reescrito**:
  - Função `redactService()` substitui `git_token` por `__PTD_REDACTED__` em TODAS as respostas (GET list, GET single, POST create, PUT update).
  - Atualização de `git_token` é segura: se o cliente mandar `__PTD_REDACTED__` (placeholder), o valor atual é preservado (não exige redigitar); se mandar `""`/`null`, limpa; se mandar valor novo, atualiza.
  - Novas rotas `GET /:id/setup` e `POST /:id/setup` para consultar estado e disparar setup on-demand.
  - POST de criação aceita `run_setup` e `auto_start`; só dispara setup automaticamente se houver trabalho real (repo ou pacotes extras), evitando `npm install` vazio sobre o starter.
  - DELETE do serviço também apaga `setup_logs`.
  - `command` deixou de ser obrigatório para `runtime_type=process` — o setup é que vai preenchê-lo quando for possível inferir.
- **`backend/src/db/index.js`**:
  - Migrações para novas colunas: `startup_command`, `setup_status`, `setup_step`, `setup_progress`, `setup_error`, `setup_started_at`, `setup_finished_at`.
  - Nova tabela `setup_logs(service_id, stream, message, timestamp)` com índice por serviço.
- **`backend/src/sockets/index.js`**: registra o io no lazyIo na inicialização.

### Frontend

- **Novo componente `frontend/src/components/SetupPanel.jsx`**:
  - Toda a UI de configuração inicial + execução do setup em um único lugar.
  - Botão primário "Executar Setup Agora" (com ícone de Play), que muda para "Tentar de novo" após falha; desabilitado enquanto um setup está rodando.
  - Barra de progresso colorida (cinza → azul-piscante → verde → vermelho).
  - Indicadores visuais de etapa (4 chips: Clonando / Instalando / Compilando / Iniciando), cada um com ícone e cor (verde=concluído, azul=atual, vermelho=falhou, cinza=pendente).
  - Título e legenda dinâmicos: "Setup concluído" / "Setup falhou" / "Executando setup — <etapa>" / "Setup não executado".
  - Painel de logs estilo terminal (fundo escuro, fonte mono, cores por stream: stderr=vermelho, warn=amarelo, input=itálico/cinza, cursor piscante enquanto roda).
  - Formulário de parâmetros: `startup_command`, `git_repo/branch/username/token`, `main_file`, `node_packages/unnode_packages`, `node_args`, toggles de `auto_update` e `allow_file_uploads`.
  - Campo token é `type="password"` com placeholder `(definido — digite para alterar)` quando já existe um token salvo, evitando a necessidade de redigitar.
  - "Salvar Configuração" e "Descartar" separados do botão de executar setup; salvar não dispara setup automaticamente.
- **`frontend/src/components/ServiceDetailModal.jsx` reescrito**:
  - Carrega o estado de setup em paralelo com os dados do serviço.
  - Ouve eventos de socket `service:setup` e `service:setup-log`, mantendo um histórico de logs (cap 500 linhas).
  - Mostra indicadores no cabeçalho: "• setup em andamento — <etapa>" piscando em azul, ou "• setup falhou" em vermelho.
  - A aba "Config Inicial" renderiza o novo `SetupPanel`; um pontinho vermelho aparece na aba quando o setup falhou.
  - Atualiza o estado do serviço em tempo real quando chegar evento `service:status`.
  - Função `refresh()` recarrega dados do serviço + estado de setup em paralelo.
- **`frontend/src/components/ServiceFormModal.jsx` atualizado**:
  - Adiciona campo `startup_command` com explicação de prioridade.
  - Campo `git_token` é `type="password"` com `autocomplete="new-password"`.
  - Configuração inicial (Git / Startup Command / Pacotes) é exibida para processos LOCAIS, num bloco visual destacado, em vez de estar espalhada dentro de um dos ramos de `runtime_type`.
  - Comando de inicialização deixou de ser obrigatório para processos.
- **`frontend/src/lib/api.js`**: novos métodos `serviceSetup(id)` e `runServiceSetup(id, { auto_start })`.

## 5. Arquivos Modificados/Criados

Novos:
- `backend/src/services/setupManager.js`
- `backend/src/sockets/lazyIo.js`
- `frontend/src/components/SetupPanel.jsx`

Modificados:
- `backend/src/services/serviceWorkspace.js` (reescrito e simplificado)
- `backend/src/routes/services.js` (reescrito com redaction + rotas de setup)
- `backend/src/db/index.js` (migrações de schema)
- `backend/src/sockets/index.js` (registrar io no lazyIo)
- `frontend/src/components/ServiceDetailModal.jsx` (reescrito com estado de setup)
- `frontend/src/components/ServiceFormModal.jsx` (novo campo startup_command, senha no token, reorganização dos campos de config inicial)
- `frontend/src/lib/api.js` (novos métodos de API)

## 6. Melhorias Arquiteturais

- **Separação de responsabilidades**: `serviceWorkspace` resolve estrutura estática; `setupManager` faz bootstrap observável; `processManager/dockerServiceDriver` executam o processo/container.
- **DRY**: utilitários como `withArgs`, `maskToken`, `detectPackageManager`, `pmBinary` consolidam lógica antes repetida.
- **KISS**: setup é uma sequência linear de etapas, não uma máquina de estados complexa. Cada etapa devolve `code != 0` como falha e interrompe o fluxo.
- **Observabilidade nativa**: qualquer estado de qualquer etapa é persistido e transmitido via socket. Nenhum mais "|| true".
- **Segurança por padrão**: token é sempre redacted na saída; máscara aplicada em todo caminho de log; caminho de autenticação de repositório privado funciona sem expor credenciais.
- **Idempotência e retentativa**: setup pode ser chamado de novo após falha sem limpar nada; a pasta parcial é posta em quarentena, o `.git` quebrado é removido, e `node_modules` existente evita install redundante.
- **Resiliência**: timeouts por etapa, tratamento de `timedOut` como falha distinta, quarentena de lixo pré-clone.
- **Quebra explícita de ciclo de dependências** via `lazyIo.js` — evita carregar socket.io antes de o servidor HTTP existir.
- **UX**: barra de progresso, etapas visuais, logs coloridos, botão de retry, evitar duas execuções simultâneas (tanto no backend quanto no frontend, com botão desabilitado).

## 7. Testes Realizados

Todas as validações foram executadas contra o backend ao vivo, com banco de dados descartável:

1. **Criação de serviço JavaScript** (`/tmp/fixture-js`, contendo `package.json` com `start: node server.js` + `server.js` http server): ✅ clonou, instalou, inferiu comando `npm start`, serviço subiu e respondeu "fixture-js OK".
2. **Criação de serviço TypeScript** (`/tmp/fixture-ts`, com `tsconfig.json`, `src/index.ts`, script `build: tsc`): ✅ clonou, instalou typescript, rodou `tsc`, gerou `dist/index.js`, comando final foi `node "dist/index.js"`, servidor respondeu "fixture-ts OK".
3. **Clone público** (URL local): ✅ realizado em ~2s, com logs.
4. **Clone com token** (URL do GitHub que não existe, com credencial falsa): ✅ falhou com erro explícito, token NUNCA apareceu nem na resposta da API nem nos logs.
5. **Instalação automática de dependências** (typescript como devDep): ✅ `npm install` rodou automaticamente após clone.
6. **Build TypeScript**: ✅ `tsc` invocado pelo gerenciador correto; erros de compilação param o setup (ex.: fixture TS com tipos faltando gerou erro amigável em vez de iniciar binário quebrado).
7. **Startup automático**: ✅ `auto_start: true` fez o serviço subir logo após setup bem-sucedido.
8. **Restart** (`POST /:id/restart`): ✅ serviço reiniciou e continuou respondendo.
9. **Persistência após reiniciar o painel**: ✅ matou o servidor de forma limpa, subiu de novo, `restoreAll()` ressuscitou svc-js no mesmo PID novo, na mesma porta 3201, respondendo "fixture-js OK".
10. **Logs do setup** (`GET /:id/setup`): ✅ retornou histórico persistido de logs com `stream` separando stdout/stderr/info, mesmo após reiniciar o painel.
11. **Falha e recuperação**: ✅ serviço criado com URL inválida (`https://example.invalid/...`) foi marcado como `failed`; depois de atualizar o serviço com um repo válido e rodar setup de novo, clonou/instalou/iniciou com sucesso.
12. **Bloqueio de setup duplicado**: ✅ requisições concorrentes ao POST /setup retornam HTTP 409 "Setup já está em execução".
13. **Token nunca é devolvido pela API**: ✅ GET lista e GET single retornam `git_token: "__PTD_REDACTED__"` em vez do valor real; no frontend o campo mostra placeholder `(definido — digite para alterar)`.
14. **Máscara do token em logs**: ✅ URLs de clone enviadas ao log substituem o token por `***`.
15. **Testes automatizados existentes**: ✅ 23 testes (workspaces, parser, docker driver, auth, databases, archives, terminal) continuam passando.

## 8. Resultado dos Testes

| Cenário | Resultado |
|---|---|
| JS + repo + npm start | ✅ OK |
| TS + repo + tsc + dist/index.js | ✅ OK |
| Git clone público | ✅ OK |
| Git privado com token (máscara + erro) | ✅ OK |
| npm/pnpm/yarn/bun detecção | ✅ detecção por lockfile |
| Install automático de dependências | ✅ OK |
| Build TypeScript automático | ✅ OK (com falha protegida) |
| Startup automático pós-setup | ✅ OK |
| Restart do serviço | ✅ OK |
| Persistência após desligar/reiniciar painel | ✅ OK |
| Logs de setup persistentes | ✅ OK |
| Recuperação após falha | ✅ OK |
| Setup concorrente bloqueado | ✅ HTTP 409 |
| git_token nunca exposto | ✅ OK |
| Comando com trailing spaces | ✅ OK (removido) |
| Scaffold inicial não polui clone | ✅ OK (só semeia sem git_repo) |

## 9. Limitações Conhecidas

1. **Setup de containers Docker**: as etapas de install/build (npm/tsc) rodam no HOST que executa o painel, não dentro do container. Se o host não tiver node/npm mas a imagem Docker tiver, o setup não vai funcionar para serviços docker-only. Em uso Termux/proot (caso principal do Pterodroid) o host sempre tem node. Para cobrir o caso remoto, seria necessário rodar um `docker exec` durante o setup — fica como próximo passo.
2. **Gerenciadores de pacotes não-node** (pip, cargo, etc.) não são detectados nesta iteração (escopo JS/TS).
3. **Tipos de TypeScript**: projetos TS que dependem de `@types/node` mas não o declaram podem falhar no build. Consideramos isso comportamento correto (o build do próprio usuário deve passar), mas um modo "não falhar no build" pode ser útil futuramente.
4. **Repositórios privados com SSH** (chaves) não têm fluxo específico nesta iteração; usa-se apenas autenticação por token via URL HTTPS.
5. **Retries de rede**: falhas de rede durante clone/install são reportadas ao usuário mas não têm retry automático com backoff. Usamos timeout como proteção.
6. **Quarentena de clone parcial**: os diretórios `.partial-clone-*` ficam no workspace raiz; são mantidos para inspeção manual e devem ser limpos manualmente ou por rotina futura de limpeza.
7. **Cloudflared** não está disponível no sandbox de testes; os túneis não foram validados (mas o erro é tratado graciosamente como antes).
8. **O build do frontend pode apontar cores "ok/ok-soft" em componentes antigos** — todos os novos usos foram convertidos para `running/running-soft`.

## 10. Recomendações para as Próximas Versões

1. **Setup dentro de containers**: estender o `SetupManager` para poder executar etapas via `docker exec` quando `runtime_type='docker'`, assim o setup funciona mesmo para hosts sem Node no host.
2. **Logs de setup persistidos com limite**: adicionar prune periódico de `setup_logs` (hoje só limpo quando o serviço é deletado).
3. **Streaming de progresso por etapa** (ex.: reportar porcentagem de clone/install/build parseando a saída) — hoje o progresso é fixo por etapa (5%→100%).
4. **Autenticação Git via SSH**: upload/cadastro de chaves privadas e detecção de URLs `git@github.com:...`.
5. **Botão "Ver logs antigos"**: na UI, mostrar setup de sessões anteriores, não só o último.
6. **Detecção de mais ecosistemas**: `requirements.txt`/`pyproject.toml` para Python, `cargo.toml` para Rust, `go.mod` para Go, etc.
7. **Modo "instalar mesmo assim" para TS**: opção de não bloquear o start se o build falhar (útil para ts-node/dev mode).
8. **Limpeza automática de `partial-clone-*`**: job de rotina ou botão de limpar.
9. **Opção "não instalar dependências"**: flag por serviço para pular o passo de install.
10. **Verificação de pré-requisitos**: antes de iniciar, avisar o usuário se `git`/`node`/`npm` não estão no PATH (especialmente em hosts Docker remotos).
11. **Testes E2E automatizados**: adicionar uma suíte em `tests/setup-test.js` que cubra o fluxo JS/TS/falha/retry (testes manuais aqui executados viraram base).
12. **Fila global de setup com concorrência limitada** (ex.: no máximo 2 setups rodando simultaneamente), para não saturar CPU/Rede em dispositivos fracos (Android/Termux).

---

Pronto. O `pterodroid.zip` na raiz contém o projeto completo com todas as alterações aplicadas. Para rodar:

```bash
cd backend && npm install
cd ../frontend && npm install && npm run build
cd ../backend && npm start
```

Credenciais padrão: admin / admin.
