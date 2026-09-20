# Validação do relatório de evolução + plano de execução — Fase 0

> **Contexto.** Este documento registra a validação linha a linha do
> "Relatório técnico de evolução do Pterodroid" (19/09/2026) contra o
> commit exato que ele analisou (`3e281a65e755415e06a186df3d226c77a370c8ec`),
> executando testes e build de verdade, e depois converte a Fase 0 do
> roadmap em pacotes de trabalho implementáveis, com critérios de aceite
> verificáveis.
>
> **Ambiente da validação:** Node v22.22.3 · npm 10.9.8 · Linux x86_64
> (sandbox). `shellcheck` não disponível no sandbox — ShellCheck entra via
> CI (ver WP-01).

---

## 1. Veredito

**O relatório é majoritariamente preciso.** Todas as afirmações da seção
2 (validação executada) e as 14 boas decisões da seção 3.1 foram
confirmadas em código e/ou por execução. A suíte do backend passou após
`npm ci` limpo e o frontend compilou em produção com **exatamente 1.636
módulos** — número idêntico ao do relatório, evidência de que ele foi
escrito contra este commit.

A validação encontrou **6 correções a fazer ao relatório** (seção 4), das
quais uma é um **defeito real de segurança** que o relatório não menciona:
o container Docker roda o painel como `root` (ver D1). Esse item sobe
para o topo da Fase 0.

---

## 2. Reprodução da seção 2 do relatório

| Verificação do relatório | Resultado nesta validação | Evidência |
|---|---|---|
| `npm ci` do backend passa | ✅ Confirmado | `rm -rf node_modules && npm ci` → sucesso |
| `npm test` no backend passa | ✅ Confirmado | `bash tests/run-all.sh` → 10 suítes, "✅ Todas as suítes passaram" |
| `npm ci` do frontend passa | ✅ Confirmado | 113 pacotes, sucesso |
| `npm run build` do frontend (Vite 8.2.1, 1.636 módulos) | ✅ Confirmado | `vite v8.2.1`, **1636 modules transformed**, `dist/assets/index-*.js` 394 KB (116 KB gzip) |
| Docker Engine real não validado | ✅ Confirmado (idempotente) | Único teste Docker usa API simulada (`tests/docker-engine-smoke-test.js`); daemon real continua sem cobertura |
| PostgreSQL/MySQL reais não validados | ✅ Confirmado | smoke test reporta "PostgreSQL not found / MySQL/MariaDB not found" neste host |
| Cloudflare Tunnel real não validado | ✅ Confirmado | depende de credencial externa |
| ARM físico não validado | ✅ Confirmado | sandbox é x86_64 |

Suítes executadas pelo runner (`apps/backend/tests/run-all.sh`):

1. `log-level-test.js` — classificação de níveis de log
2. `recipe-test.js` — catálogo de receitas
3. `workspace-files-test.js` — workspaces, arquivos, parser de comando
4. `docker-engine-smoke-test.js` — cliente da Engine com API simulada
5. `docker-driver-test.js` — driver Docker com engine simulada
6. `auth-security-test.js` — segurança da autenticação
7. `database-security-test.js` — segurança das instâncias de banco
8. `archive-test.js` — Zip Slip em compactar/descompactar
9. `terminal-test.js` — terminal do serviço
10. `smoke-test.sh` — API HTTP completa (inclui ciclo de backup: criar →
    listar → limite de 10 → download é ZIP válido → restore → delete →
    limpeza ao apagar serviço)

> **Observação sobre o falso negativo relatado:** o relatório atribui a
> falha inicial a `node_modules` ausente. O runner não valida
> pré-condições antes de executar, então a falha de dependência vira uma
> cascata de erros secundários. Isso motiva o WP-07 (robustez do runner).

## 3. Verificação item a item da seção 3.1

Cada "boa decisão técnica" que o relatório afirma existir:

| # | Afirmação do relatório | Status | Evidência (arquivo) |
|---|---|---|---|
| 1 | `WORKSPACES_ROOT` é a raiz canônica | ✅ | `src/config.js:34-37` (alias `PROJECTS_ROOT` preservado) + `services/workspaceManager.js` |
| 2 | Validação de caminho, anti-travessia, symlink, escrita atômica | ✅ | `services/fileManager.js:62-80` (realpath de base e pai) e `:169-177` (`atomicWrite` com tmp+rename) |
| 3 | Uploads em área temporária, sem sobrescrita silenciosa | ✅ | `routes/fileRoutesFactory.js:24` (`UPLOAD_TMP_DIR='.pterodroid-tmp'`) + rename pós-upload |
| 4 | Estado desejado ≠ estado observado | ✅ | `services/processManager.js:61-64` (grava `desired_state`), `:119-135` (restore pelo desejado) |
| 5 | Falha de spawn passa por finalização comum | ✅ | `processManager.js:318-385` (`finalize(code, spawnError)` trata `exit` e `error`) |
| 6 | Setup assíncrono (clone/install fora do request) | ✅ | `services/setupManager.js` — máquina de estados `cloning→installing→building→starting` persistida no SQLite + eventos socket.io |
| 7 | Tradução de bind mount no container | ✅ | `config.js:49-55` (`HOST_WORKSPACES_ROOT`) + `dockerServiceDriver.js` (`toHostPath()`) |
| 8 | Compose com health check, log limit e bind único | ✅ | `docker-compose.yml` (healthcheck curl, `max-size: 10m × 3`, `./data:/data`) |
| 9 | Migrações incrementais de colunas | ✅ | `src/db/index.js:14-23` (`PRAGMA table_info` + `ALTER TABLE ... ADD COLUMN` condicional) |
| 10 | Backups fora da raiz do workspace | ✅ | `config.js:59-66` (`BACKUPS_ROOT` fora de `WORKSPACES_ROOT`) |
| 11 | Login: bloqueio progressivo, bcrypt p/ usuário inexistente, rotas bloqueadas até trocar senha | ✅ | `services/loginThrottle.js` (3 grátis → delay progressivo → lock 5 min após 8 erros; chave IP+usuário); `routes/auth.js:40` (hash dummy); smoke test confirma `403 SETUP_REQUIRED` |
| 12 | Terminal: teto de saída, timeout, grupo de processo, cwd persistente | ✅ | `services/terminalManager.js:47-48` (256 KB / 10 min), `:122` (`detached:true`), `:251` (`kill(-pid)`), `:150` (cwd persistido) |
| 13 | Arquitetura modular (rotas/gerenciadores/drivers separados) | ✅ | `src/routes` (11 arquivos), `src/services` (25 módulos, 8.255 linhas de serviços+rotas) |
| 14 | Frontend com páginas dedicadas | ✅ | `apps/frontend/src/pages`: Dashboard, Services, Databases, Files, Logs, Monitoring, DockerHosts, Settings, Login |

**E as lacunas que o relatório afirma existir** — todas confirmadas:

| Lacuna citada | Status | Evidência |
|---|---|---|
| Sem `.github/workflows` | ✅ Confirmado | diretório inexistente |
| `panelctl.sh` sem `doctor` | ✅ Confirmado | só `start/stop/restart/status/logs` |
| Sem unidade systemd | ✅ Confirmado | nenhum `.service` no repo |
| Sem `flock` no `panel.db` | ✅ Confirmado | nenhuma ocorrência de `flock`/`lockf`/`O_EXCL` |
| Single-user | ✅ Confirmado | `db/index.js:261` insere apenas `admin` |
| Sem revogação de JWT/sessões | ✅ Confirmado | `middleware/auth.js` sem blacklist/sessão |
| Sem rate limit por rota | ✅ Confirmado | sem `express-rate-limit` nas dependências |
| Sem 2FA/TOTP | ✅ Confirmado | nenhuma referência |
| `sql.js` em todos os modos | ✅ Confirmado | `src/db/sqliteCompat.js` (WASM, flush 1s) |

## 4. Correções ao relatório (achados da validação)

### D1 — 🔴 NOVO: o painel roda como `root` dentro do container Docker

O Dockerfile define `USER root` (`Dockerfile:54`) com o comentário de que o
entrypoint "ajusta as permissões do volume antes de iniciar o processo como
usuário node". **O `entrypoint.sh` não faz isso:**

```sh
mkdir -p /data /data/workspaces
chown -R root:root /data /app      # desfaz o `chown -R node:node` do Dockerfile
exec /sbin/tini -- "$@"            # node sobe como root
```

Resultado: o backend executa como `root` no modo Docker — exatamente o que o
relatório lista como P0 ("nunca executar como root por padrão") **e que ele
acredita estar resolvido** (o comentário do compose diz que o `group_add`
corrigiu isso, e a seção 3.1 elogia a decisão). O `chown -R root:root` também
reverte a cada boot o `RUN chown -R node:node /data /app` do Dockerfile. O
defeito veio no commit desta análise (PR #15). **Fica em P0 como primeiro
item da Fase 0.**

### D2 — Cifragem de segredos já existe (cobertura parcial, ~40%)

O item P0-segurança-4 ("cifrar todos os segredos persistidos") não parte do
zero: `services/secretCipher.js` (AES-256-GCM, formato `enc:v1:`, fallback
para texto claro legado) já cifra as **variáveis de ambiente de serviços**
(`routes/services.js:38-113`, usado também por `processManager.js` e
`setupManager.js`). Porém **não é usado** em `dockerHostManager.js`
(chaves TLS), `tunnelManager.js`/`namedTunnelManager.js` (tokens
Cloudflare) nem `dbInstanceManager.js` (senhas de banco). O trabalho real é
estender a cobertura + procedimento de recuperação, não criar a cifra.

### D3 — Drift código × comentário no secretCipher

O cabeçalho diz "chave derivada de JWT_SECRET via **HKDF/SHA-256**", mas
`deriveKey()` usa `crypto.createHash('sha256')` puro (sem salt, sem HKDF).
Funcionalmente aceitável para um segredo de alta entropia, mas o comentário
induz auditor a erro — corrigir junto com D2.

### D4 — Circuit breaker básico já existe; falta o que o relatório pede

O item P1-2 ("circuit breaker com backoff exponencial e botão de
desbloqueio") parte de algo existente: `RESTART_MAX=10`, delay fixo de 3s e
reset do contador após 60s estável (`config.js`, `processManager.js`). O que
falta: backoff **exponencial**, registro do motivo do desistir e o
desbloqueio manual na UI.

### D5 — Health check por serviço já existe para processos locais

`processManager.js:254-280` já implementa health check HTTP com intervalo/
timeout configuráveis e reinício em falha. O P1-3 ("watchdog distinguir
vivo/aberto/saudável") está parcialmente atendido; faltam porta/TCP e
classificação na UI.

### D6 — Auditoria já tem infra de banco; falta UI e cobertura

`src/db/index.js:94` cria `audit_log`; `services/auditLog.js` grava (rotas
de arquivos) e poda por idade (`log_retention_days`) e quantidade
(`LOG_MAX_DB`). Falta o P1-6: tela central com filtros e registro das
demais rotas (auth, serviços, backups, Docker).

### D7 — O instalador Linux já avisa sobre root (parcial)

`install-linux.sh:160-182` detecta root, explica que PostgreSQL/MariaDB
recusam root e oferece criar usuário (`pterodroid`). Falta: tornar a
recusa/o usuário de serviço o caminho padrão, instalar unidade systemd
opcional e travar o banco.

## 5. Baseline confirmado (lacunas Fase 0)

Consolidando relatório + achados, o que a Fase 0 precisa entregar:

1. **WP-01 — CI** (ausente)
2. **WP-02 — `panelctl doctor`** (ausente; pré-voo + matriz de recursos)
3. **WP-03 — Docker sem root** (defeito D1)
4. **WP-04 — Instalação Linux nativa não-root + systemd opcional** (parcial: D7)
5. **WP-05 — `flock`/lock exclusivo do `panel.db`** (ausente)
6. **WP-06 — Backup automático do banco antes de migrações** (ausente)
7. **WP-07 — Robustez do runner de testes** (pré-condições + erro raiz)
8. **WP-08 — Matriz de compatibilidade e documentação de modos** (ausente; três modos da seção 5.1 do relatório)

---

## 6. Plano de execução — Fase 0 (detalhado)

Ordem de ataque escolhida para destravar cedo o que gera mais valor de
verificação (CI primeiro) e corrigir o P0 de segurança em seguida.

### WP-01 — Pipeline de CI (`.github/workflows/ci.yml`)

**Arquivos:** `.github/workflows/ci.yml` (novo).

Jobs:
1. `backend-tests` — Node 20 e 22 (cobre `engines: >=20.19.0`): `npm ci` +
   `npm test` em `apps/backend`.
2. `frontend-build` — Node 22 (Vite 8 exige `^20.19 || >=22.12`):
   `npm ci` + `npm run build` em `apps/frontend`.
3. `shellcheck` — `shellcheck -S warning` em `panelctl.sh`,
   `install-*.sh`, `entrypoint.sh`, `apps/backend/tests/*.sh`.
4. `docker-build` — `docker build -t pterodroid:ci .` + `docker compose
   config -q` (invalida compose quebrado).
5. `docs-build` — `npm ci` + build de `apps/documentation` (existe e tem
   `vite.config.ts`).
6. `docker-engine-real` (separado, `continue-on-error` inicial) — sobe o
   backend na VM do GHA (que tem daemon Docker) e roda um smoke mínimo de
   driver real; promove a required quando estável.

**Aceite:** workflow verde em push/PR; falha de qualquer job bloqueia merge;
cache de npm ativo por lockfile.

### WP-02 — `panelctl.sh doctor`

**Arquivos:** `panelctl.sh` (adicionar subcomando `doctor`, sem quebrar os 5
existentes); novo teste `apps/backend/tests/doctor-test.sh` (ou seção no
smoke) se invocável sem painel.

Verificações (cada item → `OK` / `AVISO` / `FALHA` com remediação impressa):
- Node presente e versão satisfaz `engines` do backend (`>=20.19.0`) e do
  frontend quando build local;
- `npm` presente; dependências instaladas (`node_modules` existe → evita o
  falso negativo da seção 2 do relatório);
- arquitetura (`uname -m`), kernel, distro (`/etc/os-release` quando houver);
- espaço em disco em `DATA_ROOT` (aviso < 1 GB);
- porta do painel livre (`PORT`, default 3001);
- binários: `git`, `cloudflared` (`CLOUDFLARED_BIN`), `prlimit`, `sh/bash`,
  `python3`;
- bancos: `postgres`/`initdb`, `mysqld`/`mariadbd` no PATH;
- Docker: binário + daemon alcançável (`GET /_ping` via socket) +
  **aviso destacado de que montar `/var/run/docker.sock` concede controle
  do host** (seção 5.1/7.3 do relatório);
- modo detectado: portátil / Linux nativo (systemd presente?) / Docker
  (`/.dockerenv`);
- `panel.db` gravável e lockfile obtível (pré-requisito do WP-05).

Saída final: matriz "recurso → disponível/indisponível → impacto", exit 0
sem falhas bloqueantes, 1 caso contrário.

**Aceite:** `./panelctl.sh doctor` roda no sandbox e em install limpa Ubuntu
(CI) e imprime a matriz; smoke test existente continua passando.

### WP-03 — Container sem root (corrige D1)

**Arquivos:** `entrypoint.sh`, `Dockerfile`, `docker-compose.yml`, README.

- `entrypoint.sh`: `chown -R node:node /data /app` (não `root:root`) e
  `exec /sbin/tini -- su -s /bin/sh node -c 'exec "$@"' -- "$@"`
  (Alpine tem `su`; alternativa explícita: `setpriv`/`su-exec` comentada).
- Manter socket via `group_add` do compose, que já está correto — passa a
  valer de verdade quando o processo não for root.
- Teste/aceite: `docker run --rm pterodroid:ci id -u` ≠ 0; healthcheck do
  compose verde; painel cria workspace e cifra segredos como `node`.
- README: seção de segurança do socket movida para destaque (relatório 7.3).

**Aceite:** backend dentro do container executa como UID 1000 (`node`), sem
quebrar bind nem o grupo docker.

### WP-04 — Linux nativo não-root + systemd opcional

**Arquivos:** `install-linux.sh`, novo `contrib/pterodroid.service`,
`panelctl.sh` (comentários de integração), README.

- Instalador: criar usuário de serviço dedicado por padrão quando root
  (refinar o fluxo que hoje só "avisa", D7); ownership de `data/` e
  `apps/`; recusar `panelctl start` como root fora de container (override
  explícito via env documentada).
- `contrib/pterodroid.service`: `User=pterodroid`, `Restart=on-failure`,
  `NoNewPrivileges=true`, `ProtectSystem=full`, `ReadWritePaths=<data>`,
  `LimitNOFILE`, `Environment=NODE_ENV=production`, comentada como
  opcional (Termux/proot seguem com `panelctl.sh`).
- Instalador detecta `systemctl` → oferece instalar/habilitar a unit;
  sem systemd, imprime instruções do `panelctl.sh`.

**Aceite:** instalação limpa Ubuntu 22.04/24.04 (container no CI) termina
com painel servindo como usuário não-root e reinício por `systemctl` ou
`panelctl.sh restart`.

### WP-05 — Lock exclusivo do `panel.db`

**Arquivos:** `src/db/index.js` (lockfile `panel.db.lock` com `fs.openSync
O_CREAT|O_EXCL` + PID + limpeza em shutdown e checagem de PID vivo para
lock obsoleto), `panelctl.sh` (`flock` quando disponível, em Termux/proot
cai no lockfile do backend).

**Aceite:** segundo `node src/server.js` com mesmo `DB_PATH` falha com
mensagem clara; lock obsoleto (PID morto) é recuperado; teste de
integração novo cobre os dois cenários.

### WP-06 — Backup do banco antes de migrações

**Arquivos:** `src/db/index.js` — antes de qualquer `ADD COLUMN`, flush +
cópia `panel.db.mig-backup-<ts>` (reter N=3); teste novo
`tests/migration-backup-test.js` com fixture de banco antigo.

**Aceite:** aplicar migração sobre fixture gera backup consultável; restore
manual documentado na matriz de compatibilidade/README.

### WP-07 — Robustez do runner de testes

**Arquivos:** `apps/backend/tests/run-all.sh`, `tests/smoke-test.sh`.

- Pré-voo: checar `node`, `node_modules` existentes, porta livre e servidor
  de pé antes das asserções HTTP; abortar **cedo e único** com a causa raiz
  (ex.: "dependências ausentes — rode npm ci") em vez de N erros de JSON.
- Tornar as suítes independentes de cwd.

**Aceite:** rodar `npm test` sem `npm ci` produz 1 erro claro e exit≠0;
com `npm ci`, as 10 suítes continuam verdes.

### WP-08 — Matriz de compatibilidade + documentação dos 3 modos

**Arquivos:** novo `docs/COMPATIBILIDADE.md`; atualizações pontuais em
`README.md`/`COMECE-AQUI.md`.

Conteúdo: três modos (portátil / Linux nativo / Docker) com limites de
segurança explícitos; Node suportado (≥20.19 backend; ^20.19/≥22.12
frontend); distros testadas (Ubuntu 22.04/24.04 em CI; Fedora via container
no CI — sandbox físico não testa); arquiteturas (x86_64 validado; ARM64
"planejado, sem matriz de hardware" — como o relatório já honesta); o que é
privilégio (docker.sock) e como operar sem ele (`compose.local.yml` é Fase 1
— fora de escopo aqui, apenas documentado).

**Aceite:** qualquer pessoa consegue, a partir do doc, dizer se seu host é
suportado e qual modo usar.

---

## 7. O que não é validável neste sandbox (e onde fica coberto)

| Item | Cobertura proposta |
|---|---|
| Fedora/RHEL-like real | job de CI em container `fedora:latest` (WP-01/WP-04) |
| ARM64 físico | fora de escopo da Fase 0; documentado como "planejado" (WP-08) |
| Docker Engine real | CI GHA tem daemon real (WP-01 job dedicado) |
| PostgreSQL/MariaDB reais | job de CI com `apt install postgresql mariadb-server` no futuro; Fase 1 |
| Cloudflare Tunnel real | teste manual com conta dedicada; Fase 1 |
| Instalação Ubuntu "bare metal" | containers Ubuntu 22.04/24.04 no CI aproximam bem |

## 8. Sequência e estimativa

| Ordem | WP | Bloqueia | Esforço estimado |
|---|---|---|---|
| 1 | WP-03 Docker sem root (D1) | — | P (horas) |
| 2 | WP-01 CI | protege todos os demais | M |
| 3 | WP-07 runner robusto | WP-01 mais útil | P |
| 4 | WP-02 `doctor` | WP-04, contribuições futuras | M |
| 5 | WP-05 lock do banco | — | P |
| 6 | WP-06 backup pré-migração | — | P |
| 7 | WP-04 instalação nativa + systemd | usa WP-02 | M |
| 8 | WP-08 docs/matriz | registra tudo | P |

Critério de saída da Fase 0 (igual ao do relatório, tornado verificável):
*"Uma instalação limpa em Linux cria o usuário de serviço, inicia, reinicia
e restaura dados sem intervenção manual inesperada"* — medido pelo CI
(WP-01 jobs 1-5 verdes) + checklist manual executado em VM/container Ubuntu
limpo com o `doctor` sem `FALHA`.

## 9. Decisões pendentes que bloqueiam a Fase 1 (não implementar agora)

1. Aceitar `docker.sock` como padrão ou exigir opt-in explícito no compose?
   (Recomendação: perfis `compose.local.yml`/`compose.docker.yml` — Fase 1.)
2. Estender `secretCipher` para TLS/Cloudflare/senhas de banco: manter
   derivação via JWT_SECRET (trocar secret = re-setar segredos) ou
   introduzir chave mestre fora do banco? (Fase 1, item P0-segurança-4.)
3. SQLite nativo opcional no modo Linux: `better-sqlite3` pré-compilado ou
   manter `sql.js`? (Decisão arquitetural da seção 13 do relatório.)

---

## 10. Status de implementação (atualizado após a execução)

A Fase 0 foi executada nesta branch. Situação por pacote de trabalho:

| WP | Escopo | Status | Evidência |
|---|---|---|---|
| WP-03 | Docker sem root (corrige D1) | ✅ Implementado | `entrypoint.sh` reescrito (fast path de chown + `su-exec node[:gid-sock]`), `su-exec` no Dockerfile, `group_add`/`DOCKER_GID` removidos do compose; prova de regressão no CI |
| WP-01 | Pipeline de CI | ✅ Implementado | `contrib/ci/workflow.yml` — 6 jobs: backend (Node 20.19/22), frontend, docs, ShellCheck, doctor standalone, docker-build (build + compose config + uid=1000 + healthcheck). **Ativação pendente:** mover para `.github/workflows/ci.yml` (o token do agente não tem escopo `workflows`; ver `contrib/ci/README.md`) |
| WP-07 | Runner robusto | ✅ Implementado | pré-voo com causa raiz em `run-all.sh`; espera ativa por healthcheck com log no `smoke-test.sh` (fim do `sleep 4` cego e da cascata de JSON) |
| WP-02 | `panelctl.sh doctor` | ✅ Implementado | relatório OK/AVISO/FALHA + matriz de recursos + exit≠0 em falha bloqueante; roda como 13ª suíte do `npm test` e em job próprio no CI |
| WP-05 | Lock exclusivo do `panel.db` | ✅ Implementado | `src/db/dbLock.js` (O_EXCL + PID vivo + recuperação de lock obsoleto), `closeDB()` no shutdown gracioso, `flock` para serializar `panelctl start`; teste de integração sobe 2 servidores no mesmo banco |
| WP-06 | Backup pré-migração | ✅ Implementado | migrações viraram lista declarativa (`MIGRATIONS`); backup `panel.db.mig-backup-*` antes de qualquer ALTER, retenção de 3; teste com fixture de banco legado |
| WP-04 | Instalação nativa não-root + systemd | ✅ Implementado | guarda anti-root no `panelctl.sh start` (exceções: proot `.allow-root`, container, `PTERODROID_ALLOW_ROOT=1`); `contrib/pterodroid.service` + `contrib/install-service.sh`; `install-linux.sh` oferece o serviço e roda o doctor no final |
| WP-08 | Matriz + docs de modos | ✅ Implementado | `docs/COMPATIBILIDADE.md` (3 modos, versões, distros, archs, recursos opcionais); README e `.env.example` atualizados |

Suíte final: **13 suítes verdes** (`npm test` no backend), incluindo as duas
novas (`migration-backup-test.js`, `db-lock-test.js`) e o `doctor`.
Relatório original arquivado em `docs/RELATORIO-EVOLUCAO.md`.

Pendências registradas que dependem de ambiente fora do sandbox:
build real da imagem + prova do uid 1000 (job `docker-build` no CI), Fedora
e ARM físico (documentados na matriz), e as decisões da Fase 1 (seção 9).

## 11. Fase 1 — slice de segurança (executado nesta branch)

O primeiro bloco da Fase 1 (segurança de acesso e segredos) foi executado
como continuação direta da Fase 0. Itens e evidências:

| Item | Escopo | Status | Evidência |
|---|---|---|---|
| Cifra — cobertura completa (D2) | Cifrar em repouso também `db_instances.db_password`, `docker_hosts.tls_*`, `settings.named_tunnel_token` e segredo TOTP; migrar valores legados em claro no boot | ✅ | `services/secretCipher.js` reaplicado nos managers/rotas (escrita) e leituras (`dbInstanceManager`, `dockerHostManager`, `namedTunnelManager`); migração idempotente `encryptLegacyColumn` + branch do token de túnel no `initDB`; suíte `secret-coverage-test.js` (18 asserções) |
| 2FA TOTP (P1-segurança) | Segundo fator sem dependência externa, com códigos de recuperação | ✅ | `services/totp.js` (RFC 6238 puro: base32/HOTP/TOTP, janela ±1 com comparação em tempo constante, 8 códigos de recuperação `XXXX-XXXX` guardados só como hash SHA-256); rotas `GET /2fa/status`, `POST /2fa/setup|enable|disable|recovery-codes`; login responde `401 TOTP_REQUIRED` quando a conta exige o código; UI em `Settings → Verificação em 2 etapas` e passo dedicado no `Login.jsx` |
| Sessões revogáveis (P0-segurança) | Token JWT deixa de ser "só assinatura + expiração" | ✅ | Tabela `sessions` (jti uuid, ip, user-agent, last_seen, revoked); `services/sessionManager.js` (teto de 25 sessões/usuário, touch ≤1/min); tokens antigos sem `jti` ganham `401 SESSION_UPGRADE_REQUIRED`; revogado ganha `401 SESSION_REVOKED`; `POST /logout`, `GET/DELETE /sessions`, `POST /sessions/revoke-others`; troca de senha revoga as outras; socket também valida a sessão; UI em `Settings → Dispositivos conectados` |
| Auditoria central (P1-segurança) | Uma visão única para todas as ações auditadas | ✅ | Coluna `audit_log.ip` + `recordAudit` com IP; `GET /api/audit` com filtros (ação, usuário, texto, período, paginação) e lista de ações distintas; instrumentação das rotas de serviços, bancos, backups, Docker, configurações e autenticação (as de arquivos/terminal, que já existiam, ganharam IP); UI em `Logs → Auditoria` |
| Documentação | Manter o material de operação alinhado | ✅ | Seção ✅ "2FA/Sessões/Auditoria" na página Segurança do site de docs; README com 2FA, dispositivos e trilha de auditoria |

Suíte final com a Fase 1: **15 suítes verdes** (`npm test`), incluindo as
novas `auth-sessions-2fa-test.js` (37 asserções) e `secret-coverage-test.js`
(18 asserções); builds do frontend (`vite build`) e do site de docs verdes.

Decisões tomadas no slice (registradas para quem pegar os próximos blocos):

* **Tokens legados são rejeitados, não converter.** Reemitir exige um login
  — a conveniência de manter tokens antigos não compensa o furo na
  revogabilidade ("tokens que não estão na tabela não morrem nunca").
* **Cifra aplicada no ponto de escrita/leitura existe no código, não no
  driver do banco** — o SQL nas rotas continua idiomático e a migração de
  legados acontece UMA vez no boot, sem interceptador mágico.
* **Desativar/regenerar 2FA pede a senha** (reautenticação), não o código
  TOTP: continua viável recuperar a conta quando o celular some.
* A chave da cifra segue derivada de `JWT_SECRET` (ver seção 9, item 3) —
  a chave mestre separada permanece como decisão aberta da Fase 3, já com o
  contrato `enc:v1:` isolado no `secretCipher` para trocar a derivação sem
  tocar nos consumidores.

Fora do escopo deste slice (permanecem na lista da Fase 1): fila de jobs
persistente (feita na seção 12), métricas históricas e alertas, backups
off-site/dump nativo, proxy reverso/TLS, hardening do socket e perfis de
usuário, migração sql.js → better-sqlite3, e a chave mestra da cifra.

## 12. Fase 1 — fila de jobs persistente (executado nesta branch)

A "fila de jobs" era o único item P0 que faltava da matriz de prioridades
do relatório (seção 12 de `docs/RELATORIO-EVOLUCAO.md`). O que entrou:

| Item | Status | Evidência |
|---|---|---|
| `services/jobQueue.js` — fila FIFO persistente no SQLite (tabela `jobs`), 1 job por vez, retenção de 200 registros, cancelamento do que ainda está `queued`, evento socket `job:update` | ✅ | suíte `tests/job-queue-test.js` (25 asserções: ordem FIFO, falha de handler, cancelamento, reconciliação de zumbis, fluxo HTTP completo) |
| Reconciliação no boot — jobs `queued`/`running` viram `failed` com explicação; status zumbis anteriores à fila são limpos no mesmo passe (`backups` em `creating`/`restoring`, `setup_status='running'`) | ✅ | `reconcileBoot()` + asserções na suíte; complementa o `reconcileStaleState` de serviços |
| `backup.create` e `backup.restore` migrados para a fila (202 `{job}` imediato, auditoria atribuída a quem enfileirou via `payload.by/ip`) | ✅ | `routes/backups.js` + handlers em `services/jobHandlers.js`; UI (`BackupsTab`) mostra o aviso por socket e recarrega a lista ao terminar |
| `docker.image_pull` migrado para a fila (progresso em rampa via callback do engine) | ✅ | `routes/docker.js` + handler; antes o request ficava pendurado no pull inteiro |
| API `GET /api/jobs` (filtros/paginação), `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel` | ✅ | `routes/jobs.js`, mesmo middleware de auth/setup das demais |
| Painel "Tarefas em segundo plano" no dashboard (ao vivo pelo socket; some quando vazio) | ✅ | `components/JobsPanel.jsx` + `pages/Dashboard.jsx` |
| Smoke test adaptado ao modelo assíncrono (sonda 'ready' na listagem, drena fila antes de contar limite, espera o restore) | ✅ | `tests/smoke-test.sh`; suíte final: **16 suítes verdes** |

Decisões deste slice:

* **Um job por vez, globalmente.** Um painel pessoal sofre mais com
  contenção de disco/rede (zip grande + pull gordo simultâneos) do que com
  espera — e a explicação de fila fica trivial: olhar a tabela `jobs`.
* **Nada de replay automático dos zumbis.** Handlers não são reentrantes;
  a decisão honesta no boot é falhar com mensagem clara e deixar o operador
  repetir a operação, nunca repetir efeitos colaterais no escuro.
* **Cancelar só o que ainda não começou.** Interromper um handler em voo
  exigiria checkpoints por etapa dentro dele; fora do tamanho deste slice.
* **O setup de serviço (clone/install/build) NÃO migrou para a fila** —
  ele já tinha runner próprio assíncrono com estado persistido por serviço
  (`setup_status` + tolerância a staleness); a ÚNICA melhoria que a fila
  acrescentaria ali (visibilidade unificada) não compensa fazer dois
  sistemas conversarem. Em troca, o boot agora também limpa o zumbi de
  `setup_status='running'` que ficava eterno em reinício no meio do setup.
* **Respostas HTTP de backup mudaram** (202 + job em vez do objeto pronto) —
  a UI de backups foi adaptada no mesmo commit; API externa que depender do
  formato antigo precisa desse ajuste (não documentado antes).

O que continua fora do escopo e segue na fila da Fase 1: métricas
históricas e alertas por limiar, backups off-site e restore verificado
agendado (a fila viabiliza: o agendador tem onde enfileirar), dump
engine-aware (pg_dump/mysqldump), proxy reverso/TLS, hardening do socket.

---

*Validação executada em 19/09/2026 sobre `3e281a6`, branch
`arena/01a0bab5-pterodroid`. Todos os caminhos citados referem-se a
`apps/backend/` salvo indicação contrária.*
