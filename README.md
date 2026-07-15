# Pterodroid

Painel pessoal de hospedagem, inspirado no Pterodactyl, para rodar dentro do **Termux** ou de um **Ubuntu proot** no Android. Gerencia serviços (bots, APIs, sites), instâncias de banco de dados locais, logs em tempo real e monitoramento de recursos — tudo sem depender de systemd.

Uso pessoal, single-user, sem multi-tenancy, sem marketplace.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + Vite + Tailwind v3)                    │
│  Servido como arquivos estáticos pelo próprio backend     │
└───────────────────────┬─────────────────────────────────┘
                         │ REST (JWT) + WebSocket
┌───────────────────────▼─────────────────────────────────┐
│  Backend (Node.js + Express + Socket.io)                  │
│  ┌─────────────────┐  ┌──────────────────┐               │
│  │ ProcessManager   │  │ DBInstanceManager │              │
│  │ (watchdog para   │  │ (provisiona e     │              │
│  │  serviços)        │  │  gerencia PG/     │              │
│  │                   │  │  MySQL/MariaDB)   │              │
│  └─────────────────┘  └──────────────────┘               │
│  Banco interno: SQLite via sql.js (WASM)                  │
└─────────────────────────────────────────────────────────┘
```

Não há systemd em lugar nenhum do fluxo. O próprio backend é o supervisor: ele spawna processos filhos (`child_process.spawn`), escuta stdout/stderr, e reinicia automaticamente em caso de falha (com backoff e limite máximo de tentativas). O painel em si é iniciado/parado via `panelctl.sh`, um script baseado em PID file — o substituto direto de um serviço systemd nesse cenário.

---

## Stack tecnológica e por quê

| Camada | Escolha | Motivo |
|---|---|---|
| Backend | Node.js + Express | Leve, mesma linguagem do frontend, ecossistema maduro para process management (`child_process`). |
| Tempo real | Socket.io | Logs e status ao vivo sem polling. |
| Banco interno | **SQLite via `sql.js` (WASM)**, não `better-sqlite3` | `better-sqlite3` exige compilação nativa via node-gyp no `npm install`. O Termux frequentemente não tem toolchain de compilação C++ funcional, e essa instalação falha. `sql.js` é o SQLite real compilado para WebAssembly — roda em qualquer lugar que o V8 rode, sem compilador nenhum. A troca custa manter o banco em memória e persistir em disco (com debounce de ~1s a cada escrita), o que é perfeitamente aceitável para o volume de dados de um painel pessoal. |
| Hash de senha | **`bcryptjs`**, não `bcrypt` | Mesmo motivo: `bcrypt` é um addon nativo. `bcryptjs` é puro JavaScript, mesma API. |
| Frontend build | Vite + **Tailwind v3** (não v4) | O Tailwind v4 usa um compilador em Rust (`@tailwindcss/oxide`) sem binário pré-compilado para Android/ARM em ambientes Termux — instala mas falha silenciosamente ou trava no build. v3 usa PostCSS puro-JS, sem esse problema. |
| Ícones | `lucide-react` | Puro JS, tree-shakeable, sem dependência nativa. |
| Bancos gerenciados | PostgreSQL + MySQL/MariaDB como processos filhos diretos (não via `pg_ctl`/`mysqld_safe`) | Rodar o binário do servidor diretamente (`postgres -D ... -p ...`, `mariadbd --datadir=...`) em vez de wrappers de gerenciamento mantém o processo em foreground, com stdout/stderr capturáveis pelo mesmo pipeline de logs dos outros serviços — consistente com a arquitetura "tudo é um child_process supervisionado". |

### PostgreSQL vs. MySQL/MariaDB no Termux

**PostgreSQL é o caminho mais maduro** nesse ambiente — é pacote oficial do Termux (`pkg install postgresql`) e comportamento estável. **MariaDB é tratado como best-effort**: o pacote existe (`pkg install mariadb`), mas o primeiro-uso tem uma pegadinha conhecida — o `mariadb-install-db` cria usuários anônimos (`''@'localhost'`) que **interceptam** a autenticação de qualquer usuário novo conectando via socket local, porque o MariaDB prioriza especificidade de host sobre nome de usuário na hora de casar credenciais. O driver do painel já contorna isso automaticamente (remove os usuários anônimos durante o provisionamento, no mesmo espírito do `mysql_secure_installation`), mas se você editar esse fluxo manualmente, vale saber que essa é a causa mais provável de "access denied" em uma instância recém-criada.

### root no Ubuntu-proot

PostgreSQL e MariaDB **recusam rodar como root** — é uma proteção de segurança dos dois, não uma limitação do painel. Como o `proot` normalmente apresenta tudo como root por padrão (é um fake-root, não isolamento real de privilégios de kernel), isso pode travar o provisionamento de bancos dentro do Ubuntu-proot especificamente. `install-ubuntu-proot.sh` detecta esse caso e oferece criar um usuário comum automaticamente. No Termux isso nunca acontece — apps Android já rodam com um UID sem privilégios.

---

## Estrutura de pastas

```
pterodroid/
├── panelctl.sh                 # start/stop/status/logs do painel (sem systemd)
├── install-termux.sh
├── install-ubuntu-proot.sh
├── backend/
│   ├── src/
│   │   ├── server.js            # entrypoint
│   │   ├── config.js
│   │   ├── db/
│   │   │   ├── index.js         # schema + inicialização
│   │   │   └── sqliteCompat.js  # shim sql.js → API estilo better-sqlite3
│   │   ├── middleware/auth.js   # JWT
│   │   ├── routes/              # services, databases, monitor, settings, auth
│   │   ├── services/
│   │   │   ├── processManager.js     # watchdog de serviços
│   │   │   ├── dbInstanceManager.js  # provisionamento/lifecycle de bancos
│   │   │   ├── dbDrivers/            # postgresql.js, mysql.js (padrão registry)
│   │   │   └── systemMonitor.js      # CPU/RAM/disco via /proc
│   │   └── sockets/index.js     # eventos em tempo real
│   └── data/                    # panel.db + dados dos bancos provisionados (git-ignored)
├── frontend/
│   └── src/
│       ├── pages/                # Dashboard, Services, Databases, Logs, Monitoring, Settings
│       ├── components/
│       ├── stores/               # AuthContext, ToastContext
│       └── lib/                  # api.js, socket.js, hooks.js
└── examples/
    └── discord-bot/              # serviço de exemplo funcional
```

---

## Modelo de dados (SQLite)

- **users** — login local do painel (usuário + hash bcrypt)
- **services** — nome, comando, tipo, diretório, env (JSON), política de restart, status, PID, contador de restarts
- **db_instances** — nome, tipo (postgresql/mysql), porta, credenciais, diretório de dados, status, se já foi provisionado
- **logs** — linhas de nível `error` persistidas por serviço/instância (o restante fica só em memória, num ring buffer de 500 linhas, para não inchar o banco)
- **settings** — nome do painel, cor, retenção de logs, flag de setup inicial

---

## Instalação

### Termux

```bash
git clone <seu-repo> pterodroid   # ou copie a pasta pro celular
cd pterodroid
./install-termux.sh
./panelctl.sh start
```

Acesse `http://localhost:3001` no navegador do celular, ou `http://<ip-do-celular>:3001` de outro aparelho na mesma rede Wi-Fi.

**Persistência em segundo plano:** o Android suspende apps (incluindo o Termux) para economizar bateria. Instale o Termux:API (`pkg install termux-api`) e rode `termux-wake-lock` antes de iniciar o painel para reduzir a chance de o sistema derrubar os processos. Para sobreviver ao fechamento do terminal, rode dentro de uma sessão `tmux`/`screen`, ou simplesmente confie no `nohup` que o `panelctl.sh` já usa internamente.

### Ubuntu Proot

```bash
cd pterodroid
./install-ubuntu-proot.sh
./panelctl.sh start
```

O script detecta se você está como root (comum em proot) e oferece criar um usuário comum — necessário para os bancos de dados funcionarem (veja a seção acima).

---

## Uso

- **Login inicial:** `admin` / `admin`. O painel mostra um aviso persistente até você trocar a senha em Configurações.
- **Criar um serviço:** página Serviços → Novo serviço. O comando roda exatamente como escrito (ex: `node index.js`, `python bot.py`). Variáveis de ambiente vão num campo JSON — não precisa hardcodar tokens no código do serviço.
- **Bot de exemplo:** `examples/discord-bot/` funciona em modo demo sem nenhuma configuração (heartbeat nos logs) e vira um bot Discord real assim que você define `DISCORD_TOKEN` nas variáveis de ambiente do serviço no painel.
- **Criar um banco:** página Bancos de Dados → escolha o motor (o painel avisa na hora se o binário não estiver instalado) → a primeira vez que você clicar em Iniciar, ele provisiona automaticamente (cria o diretório de dados, usuário e senha).
- **Editar/parar/reiniciar:** os ícones em cada card fazem exatamente o que dizem. Reiniciar um serviço zera o contador de falhas — é um "começo do zero" deliberado.

---

## Segurança

- Autenticação local via JWT (7 dias de validade), senha com bcrypt (bcryptjs).
- CORS liberado (`origin: '*'`) — apropriado para uso pessoal em rede local; se algum dia expuser o painel publicamente na internet, isso precisa ser revisto junto com HTTPS na frente.
- Variáveis de ambiente sensíveis (`LD_PRELOAD`, `LD_LIBRARY_PATH`) são bloqueadas na configuração de serviços.
- Instâncias de banco de dados **não reiniciam automaticamente após falha** — decisão deliberada. Auto-restart de um processo de banco que acabou de cair pode transformar um crash isolado em corrupção de dados. Você reinicia manualmente depois de checar os logs.

## Limitações conhecidas

- MySQL/MariaDB é best-effort no Termux (veja seção de stack acima).
- `sql.js` mantém o banco do painel inteiro em memória, com flush em disco a cada ~1s de mudança. Para o volume de dados de um painel pessoal (serviços, instâncias, configurações, logs de erro) isso é imperceptível; não é uma escolha adequada se o objetivo fosse um banco de propósito geral com alto volume de escrita.
- Sem suporte a múltiplos usuários — por design, conforme especificado.
