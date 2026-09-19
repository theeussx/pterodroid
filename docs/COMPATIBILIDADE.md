# Compatibilidade e modos de operação

> Fase 0 (WP-08) — o que o Pterodroid suporta, em qual modo, e o que cada
> modo sacrifica. Se o seu host não está aqui, `./panelctl.sh doctor` diz na
> hora o que falta.

## 1. Os três modos oficiais

| | **Portátil** | **Linux nativo** | **Docker** |
|---|---|---|---|
| Onde | Termux, Ubuntu proot, hardware ARM limitado | Debian/Ubuntu, Fedora/RHEL-like, Arch, openSUSE (PC, VPS, Raspberry Pi) | Qualquer host com Docker Engine |
| Gerenciador do painel | `panelctl.sh` | `panelctl.sh` **ou** `pterodroid.service` (systemd opcional) | o próprio container (`restart: unless-stopped`) |
| Banco da aplicação | SQLite via `sql.js` (WASM) | `sql.js` (nativo opcional é decisão da Fase 1) | `sql.js` |
| Usuário de execução | o usuário do Termux / root falso do proot (exceção `data/.allow-root`) | usuário dedicado **não-root** (obrigatório) | `node` (uid 1000) dentro do container |
| Containers gerenciados | não | sim, se Docker instalado e usuário no grupo `docker` | sim, **se** `/var/run/docker.sock` montado |
| systemd | nunca | opcional (`contrib/install-service.sh`) | n/a |

Regras de fronteira (decisões registradas na Fase 0):

- **Nunca root.** O `panelctl.sh` recusa `start` com uid 0. Exceções
  explícitas: proot/Termux (root falso, marcador `data/.allow-root` gravado
  pelo instalador) e override manual documentado `PTERODROID_ALLOW_ROOT=1`.
- **docker.sock = privilégio.** Montá-lo equivale a acesso administrativo ao
  host. É opt-out (remova a linha no compose) e o aviso aparece no compose,
  no `doctor` e no log do entrypoint. Socket proxy/agent é item da Fase 1.
- **systemd é opcional, nunca requisito.** A unidade é template + instalador
  em `contrib/`; sem systemd o produto é cidadão de primeira classe igual.

## 2. Versões suportadas

| Componente | Requisito | Onde é verificado |
|---|---|---|
| Node.js (backend) | `>=20.19.0` (`engines`) | `panelctl.sh doctor`, CI (20.19 e 22) |
| Node.js (frontend/build) | `^20.19.0 \|\| >=22.12.0` (Vite 8) | `install-linux.sh`, CI (22) |
| npm | o do Node correspondente | `doctor` |
| Bash | 4+ (scripts) | shebang `#!/bin/bash` |
| shellcheck | — (só CI) | `.github/workflows/ci.yml` |

O pacote `nodejs` do apt do Debian/Ubuntu é Node 18 e **não funciona** — o
instalador usa NodeSource/binário oficial. Detalhes no README.

## 3. Matriz de sistemas

| Sistema | Situação | Evidência |
|---|---|---|
| Ubuntu 22.04/24.04, Debian 12 | ✅ suportado | `ubuntu-latest` no CI roda toda a bateria a cada push |
| Fedora/RHEL-like, Arch, openSUSE | 🟡 suportado pelo instalador (`dnf`/`pacman`/`zypper`) | sem job dedicado no CI ainda — validação manual |
| Alpine/musl (host, fora de container) | 🟡 funciona via binário oficial Node + APK | caminho menos testado |
| Termux (Android) | ✅ suportado | `install-termux.sh` + `panelctl.sh` |
| Ubuntu proot (Android) | ✅ suportado | `install-ubuntu-proot.sh` + marcador `.allow-root` |
| Docker (qualquer host) | ✅ suportado | job `docker-build` no CI: build, compose válido, painel como uid 1000, healthcheck |

## 4. Arquiteturas

| Arch | Situação |
|---|---|
| x86_64 | ✅ validado (CI + desenvolvimento) |
| ARM64 (aarch64) | 🟡 instalador baixa os binários corretos (Node/cloudflared); sem matriz de hardware no CI — relatos bem-vindos |
| ARMv7 | 🟡 mesmo caminho do ARM64, menos testado |

## 5. Recursos opcionais por pré-voo

O `panelctl.sh doctor` detecta e classifica (nada disso é requisito):

| Recurso | Precisa de | Sem ele |
|---|---|---|
| Bancos PostgreSQL | binários `postgres`/`initdb` | instâncias Postgres indisponíveis |
| Bancos MySQL/MariaDB | `mysqld`/`mariadbd` | instâncias indisponíveis |
| Cloudflare Tunnel | `cloudflared` | acesso remoto por túnel indisponível |
| Limites de processo | `prlimit` | limites de memória/CPU relatados como "não aplicados" |
| Clonar projetos | `git` | setup a partir de repositório indisponível |
| Containers | Docker Engine acessível | serviços rodam só como processo local |

## 6. Banco de dados da aplicação

- Arquivo único `data/panel.db` (SQLite via `sql.js`, flush atômico tmp+rename).
- **Lock exclusivo** (`panel.db.lock`): um segundo painel sobre o mesmo
  banco falha no boot com remediação impressa em vez de sobrescrever dados.
- **Backup pré-migração**: toda evolução de schema copia o arquivo antes
  (`panel.db.mig-backup-*`, retenção de 3). Restauração manual: pare o
  painel, copie o backup sobre `panel.db`, suba de novo.
- Lock obsoleto (painel morto por SIGKILL/reboot) é recuperado pelo próximo
  boot automaticamente.

## 7. O que ainda não é validado automaticamente

Honestidade operacional (espelha a seção 7 do plano de Fase 0):

| Item | Status |
|---|---|
| Fedora físico/VM | manual; instalador cobre `dnf`/`yum` |
| ARM64 físico | sem hardware no CI |
| Docker Engine real no CI | job `docker-build` usa o daemon do runner (build + execução do painel); driver de serviços testado com Engine simulada nos testes unitários |
| PostgreSQL/MariaDB reais | binários ausentes no CI; segurança de provisionamento coberta por teste dedicado sem binários |
| Cloudflare Tunnel real | exige credenciais externas |
