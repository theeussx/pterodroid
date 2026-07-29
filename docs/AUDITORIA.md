# Auditoria Técnica — Pterodroid

> Levantamento feito **antes** de qualquer alteração de código. Cada item foi
> validado executando o backend real (não por leitura de código apenas).
> Ambiente de validação: Node 22, backend rodando em `PORT=3999` com
> `DATA_ROOT`/`PROJECTS_ROOT`/`FILES_ROOT` isolados em `/tmp`.

## 1. Mapa da arquitetura

```
                    ┌──────────────────────────────────────────┐
   Browser  ───────▶│ Express (server.js)                      │
   (React/Vite)     │  /api/auth        routes/auth.js         │
        │           │  /api/services    routes/services.js ────┼──▶ serviceDriverRegistry
        │           │  /api/services/:id/files  serviceFiles.js│      ├─ processManager  (child_process)
        │           │  /api/files       routes/files.js        │      └─ dockerServiceDriver
        │           │  /api/docker      routes/docker.js       │           └─ dockerHostManager
        │           │  /api/databases   routes/databases.js ───┼──▶ dbInstanceManager
        │           │  /api/monitor     routes/monitor.js  ────┼──▶ systemMonitor (/proc, df, ps)
        │           │  /api/settings    routes/settings.js ────┼──▶ tunnelManager / namedTunnelManager
        └── ws ────▶│ socket.io (sockets/index.js)             │
                    └──────────────────────────────────────────┘
                                     │
                            db/sqliteCompat.js (sql.js WASM, flush debounced)
```

Persistência: SQLite em WASM mantido **inteiro em memória**, serializado para
`panel.db` a cada 1s de debounce (`DB_FLUSH_DEBOUNCE`).

## 2. Problemas encontrados

Legenda de severidade: 🔴 crítico · 🟠 alto · 🟡 médio · ⚪ baixo

### Workspaces e caminhos

| # | Sev | Problema | Causa raiz | Evidência |
|---|-----|----------|------------|-----------|
| P1 | 🔴 | `FILES_ROOT` nunca é criado no boot | `config.js` só faz `mkdirSync` de `DATA_ROOT` | `GET /api/files/list` → `{"error":"Arquivo ou pasta não encontrado"}` num install limpo |
| P2 | 🔴 | Gerenciador global e workspaces de serviço apontam para árvores diferentes no Docker | `FILES_ROOT=/workspaces/.../files` vs `PROJECTS_ROOT=/workspaces/.../projects` | Arquivos de serviço invisíveis na aba Arquivos |
| P3 | 🟠 | Caminho legado hardcoded `/home/appuser/projects` | `serviceWorkspace.normalizeWorkingDirectory` | leitura direta |
| P4 | 🟠 | Não existe conceito de "raiz única de workspaces" | `PROJECTS_ROOT` e `FILES_ROOT` independentes | brief Etapa 2 |

### Gerenciamento de arquivos e upload

| # | Sev | Problema | Causa raiz | Evidência |
|---|-----|----------|------------|-----------|
| P5 | 🔴 | Upload em pasta inexistente falha e **vaza caminho absoluto do host** | multer `destination` usa `resolveSafePath` sem `mkdir` | `{"error":"ENOENT: ... open '/tmp/ptd/ws/node-api/nao/existe/f.txt'"}` |
| P6 | 🔴 | `write` em caminho aninhado inexistente falha | `fs.writeFileSync` sem criar diretório pai | `PUT /api/files/write {"path":"a/b/c.txt"}` → ENOENT |
| P7 | 🟠 | Upload sobrescreve arquivo existente silenciosamente | multer grava direto no nome final | sem tratamento de conflito |
| P8 | 🟠 | Escrita não atômica (arquivo truncado se cair no meio) | `writeFileSync` direto no destino | brief Etapa 5 |
| P9 | 🟠 | Rotas por serviço não têm `copy` nem `search` | endpoints inexistentes | `POST /api/services/1/files/copy` → `{"error":"Not found"}` |
| P10 | 🟡 | `loadManager()` sempre devolve `isDocker:false` | valor fixo | ramo `if (isDocker)` do download é inalcançável → chamaria `fm.readRaw` inexistente |
| P11 | ⚪ | Imports mortos (`config`, `PathError`, `hosts`) | resto de refatoração | `routes/serviceFiles.js` |

### Processos e ciclo de vida

| # | Sev | Problema | Causa raiz | Evidência |
|---|-----|----------|------------|-----------|
| P12 | 🔴 | `restoreAll()` do processManager ressuscita **serviços Docker como processo local** | query sem filtro `runtime_type` | `SELECT * FROM services WHERE status='running'` |
| P13 | 🔴 | Falha de spawn (ENOENT) deixa entrada órfã no mapa e status `running` eterno | Node emite só `error`, nunca `exit`, quando o binário não existe | teste isolado: `events: error` |
| P14 | 🔴 | `PUT /api/services/:id` quebra com update parcial | `name.trim()` sobre `req.body.name` indefinido | `{"description":"x"}` → HTTP 500 `Cannot read properties of undefined (reading 'trim')` |
| P15 | 🟠 | `npm install` **síncrono dentro do request HTTP** | `bootstrapNodeProject` usa `execFileSync` | trava event loop por minutos no Termux |
| P16 | 🟡 | `cd x && node y` roda `cd` como binário | `_parseCommand` não trata metacaracteres de shell | tokenizador próprio |
| P17 | ⚪ | `restart_count` nunca zera após execução estável | sem lógica de reset | serviço acumula até `max_restarts` |

### Docker

| # | Sev | Problema | Causa raiz | Evidência |
|---|-----|----------|------------|-----------|
| P18 | 🔴 | Bind mount usa caminho **de dentro do painel** quando o painel roda em container | `buildContainerSpec` usa `v.source` cru | Docker cria pasta vazia no host; arquivos somem |
| P19 | 🟠 | `DOCKER_API_VERSION` do config é ignorado | `rowToClient` não repassa `apiVersion` | config morto |
| P20 | 🟠 | Comando inferido roda `npm install` no start do container | `inferDockerCommand` | falha de rede → exit → loop de restart |
| P21 | 🟡 | Poll de 3s nunca para, mesmo sem serviço docker | `_ensurePolling` sem contrapartida | consumo em dispositivo móvel |
| P22 | 🟡 | `restartService` não recria o stream de logs nem o túnel | fluxo diferente de `startService` | logs ao vivo somem após restart |

### Infra / Docker Compose

| # | Sev | Problema | Causa raiz | Evidência |
|---|-----|----------|------------|-----------|
| P23 | 🟠 | Serviço `redis` no compose é **totalmente inútil** | nenhum cliente redis no código | `grep -ri redis backend/src` → nada |
| P24 | 🟠 | Sem `HEALTHCHECK` em lugar nenhum | ausente no Dockerfile e no compose | brief pede validação de healthcheck |
| P25 | 🟠 | `user: "root"` anula o `appuser`/`chown` do Dockerfile | compose sobrescreve | permissões inconsistentes |
| P26 | 🟡 | Dados divididos entre volume nomeado e bind | `pterodroid_data` + `./data` | `panel.db` fica invisível pro usuário |
| P27 | 🟡 | Node como PID 1 não faz reap de processos órfãos | sem `init` | zumbis ao matar serviços |

### Banco, logs e performance

| # | Sev | Problema | Causa raiz | Evidência |
|---|-----|----------|------------|-----------|
| P28 | 🟠 | Tabela `logs` cresce **sem limite** | `LOG_MAX_DB` e `log_retention_days` nunca são usados | `grep LOG_MAX_DB` → só a definição |
| P29 | 🟠 | `express.json()` no default de 100kb, editor permite 2MB | limite não configurado | `PUT /api/files/write` com 300KB → HTTP 500 |
| P30 | 🟡 | `df` e `ps` executados de forma **síncrona** a cada 2s | `execSync` no snapshot loop | bateria/CPU no Android |
| P31 | 🟡 | Loop de snapshot pode não parar quando o último cliente sai | `clientsCount` lido durante o `disconnect` | timer vazando |
| P32 | 🟡 | Cada linha de stderr agenda flush do **banco inteiro** | `scheduleFlush` por INSERT | I/O constante com serviço verboso |

### Instâncias de banco de dados

| # | Sev | Problema | Causa raiz | Evidência |
|---|-----|----------|------------|-----------|
| P44 | 🔴 | **Injeção de comando** pelo nome da instância | caminho derivado do nome interpolado em string de shell (`execSync`) | reproduzido: nome `x"; touch /tmp/f; echo "` criou o arquivo |
| P45 | 🟠 | Senha do banco gerada com `Math.random()` | gerador não criptográfico | `routes/databases.js` |
| P46 | 🟡 | Nome sem validação de formato vira nome de pasta | só verificava se não estava vazio | `routes/databases.js` |
| P47 | ⚪ | Porta aceita valores privilegiados (<1024) | validação só checava se era número | bancos recusam rodar como root |

### Frontend (segunda revisão)

| # | Sev | Problema | Causa raiz | Evidência |
|---|-----|----------|------------|-----------|
| P48 | 🟠 | Erro do servidor não aparece nos formulários | `handleSubmit` sem `catch` | modal fica aberto, sem salvar e sem explicar |

### Autenticação

| # | Sev | Problema | Causa raiz | Evidência |
|---|-----|----------|------------|-----------|
| P40 | 🔴 | Login sem proteção contra força bruta | nenhum controle de tentativas | medido: ~12,6 tentativas/s (~45.180/hora), nenhuma bloqueada |
| P41 | 🟠 | Aviso de senha padrão podia ser silenciado sem trocar a senha | botão de dispensar chamava `completeSetup()` | `SetupBanner.jsx` |
| P42 | 🟡 | Dá para descobrir usuários pelo tempo de resposta | bcrypt só era executado se o usuário existisse | `routes/auth.js` |
| P43 | ⚪ | Senha mínima de 6 caracteres | validação frouxa | `routes/auth.js` |

### Funcionalidade ausente

| # | Sev | Problema | Causa raiz | Evidência |
|---|-----|----------|------------|-----------|
| P39 | 🟠 | Não existe terminal, apesar de constar nos objetivos | nunca implementado | UI mostra "terminal web (em breve)"; sem ele, projeto com dependências exige sair do painel |

### Frontend

| # | Sev | Problema | Causa raiz | Evidência |
|---|-----|----------|------------|-----------|
| P33 | 🟠 | `ServiceDetailModal` mostra dados do serviço anterior ao trocar de id | `service` não é limpo | estado obsoleto entre aberturas |
| P34 | 🟠 | Sem renomear/mover/copiar/buscar no navegador de arquivos do serviço | funcionalidade ausente | brief Etapa 4 |
| P35 | 🟠 | Sem opção de apagar o workspace ao remover serviço | `deleteFiles` existe na API, não na UI | pasta órfã confirmada após DELETE |
| P36 | 🟡 | Todo evento `service:status` dispara `GET /api/services` completo | sem debounce | chamadas duplicadas |
| P37 | 🟡 | `MoveCopyModal` sempre lista a árvore **global** | usa `api.listFiles` fixo | inutilizável em escopo de serviço |
| P38 | ⚪ | Progresso de upload é o mesmo para todos os arquivos | um único `onProgress` | cosmético |

## 3. Código morto identificado

- `backend/src/services/dockerFileManager.js` e `miniTar.js`: nunca importados
  por nenhuma rota (só um pelo outro).
- Ramo `if (isDocker)` em `routes/serviceFiles.js` (download): inalcançável.
- `config.DOCKER_DEFAULT_HOST`, `config.LOG_MAX_DB`: definidos e não usados.
- Setting `log_retention_days`: editável na UI, sem efeito nenhum.
- Serviço `redis` no `docker-compose.yml`.
- Imports não utilizados em `routes/serviceFiles.js`.

## 4. Duplicação identificada

- `routes/files.js` e `routes/serviceFiles.js`: ~150 linhas praticamente
  idênticas (list/read/write/mkdir/touch/rename/move/delete/download/upload),
  divergindo só na origem do file manager e no formato do audit.
- `slugify` implementado 3x (`projectScaffold`, `serviceWorkspace`,
  `dockerServiceDriver`).
- Tokenizador de comando duplicado (`processManager._parseCommand` e
  `dockerServiceDriver.splitCommand`).
- Bloco de upload multer duplicado nas duas rotas de arquivo.
