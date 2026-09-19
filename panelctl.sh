#!/bin/bash
# panelctl.sh — start/stop/status for the panel's own backend process.
# No systemd anywhere in the loop: this is a plain PID-file-based control
# script, which is the right tool on Termux and works identically inside
# Ubuntu-proot.

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/backend"
RUN_DIR="$ROOT_DIR/data"
PID_FILE="$RUN_DIR/panel.pid"
LOG_FILE="$RUN_DIR/panel.out.log"
# Mesma convenção do backend: o binário do cloudflared pode ser apontado
# por env (CLOUDFLARED_BIN); o padrão é o nome no PATH.
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-cloudflared}"

mkdir -p "$RUN_DIR"

# O painel (e o build do frontend, Vite 8) exige Node 20.19+ ou 22.12+.
# Sem esta checagem, quem instalou o `nodejs` do apt do Ubuntu (18.x)
# ganha um erro críptico depois — aqui o aviso vem antes, com a solução.
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local ver rest major minor
  ver="$(node --version 2>/dev/null | sed 's/^v//')" || return 1
  major="${ver%%.*}"
  rest="${ver#*.}"
  minor="${rest%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] && [[ "$minor" =~ ^[0-9]+$ ]] || return 1
  if [ "$major" -gt 22 ]; then return 0; fi
  if [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; then return 0; fi
  if [ "$major" -eq 20 ] && [ "$minor" -ge 19 ]; then return 0; fi
  return 1
}

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

# Executar o painel como root dá a qualquer serviço/terminal gerenciado
# privilégio total no host (o relatório de evolução lista isso como P0).
# Duas exceções legítimas reconhecidas por marcador explícito:
#   1. containers Docker (o entrypoint baixa para o usuário `node`);
#   2. Ubuntu proot no Termux, onde TUDO reporta uid 0 (fake root) e não
#      existe outro usuário — o instalador grava data/.allow-root.
# Override manual documentado: PTERODROID_ALLOW_ROOT=1 ./panelctl.sh start
root_guard() {
  [ "$(id -u)" = "0" ] || return 0
  [ -n "${PTERODROID_ALLOW_ROOT:-}" ] && return 0
  [ -f /.dockerenv ] && return 0
  [ -f "$RUN_DIR/.allow-root" ] && return 0
  echo "Erro: recusando iniciar o painel como root."
  echo "      Qualquer serviço ou comando de terminal executado pelo painel herdaria"
  echo "      privilégio total do sistema. Caminhos corretos:"
  echo "        Linux nativo: ./install-linux.sh (cria um usuário de serviço dedicado)"
  echo "        Docker:       docker compose up -d (o painel já roda como usuário node)"
  echo "      Se este é um ambiente de root falso (proot) ou você sabe o que está"
  echo "      fazendo: PTERODROID_ALLOW_ROOT=1 $0 start"
  exit 1
}

# Dois `panelctl start` concorrentes geravam dois processos disputando o
# panel.db (e o lock do banco derrubava um deles com erro, sujando o log).
# flock aqui só serializa o COMANDO start — a proteção real do banco é o
# lock exclusivo no backend (dbLock.js), que funciona até sem flock.
with_start_lock() {
  local start_lock="$RUN_DIR/.panelctl.start.lock"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$start_lock"
    flock 9
  fi
  "$@"
}

cmd_start() {
  root_guard
  with_start_lock _cmd_start_inner
}

_cmd_start_inner() {
  if is_running; then
    echo "Já está rodando (pid $(cat "$PID_FILE"))."
    exit 0
  fi

  if ! node_ok; then
    echo "Erro: Node.js $(node --version 2>/dev/null || echo '(não instalado)') — o Pterodroid exige Node 20.19+ ou 22.12+."
    echo "      Rode o instalador do seu ambiente para corrigir:"
    echo "        Linux (PC/VPS/Raspberry Pi): ./install-linux.sh"
    echo "        Termux (Android):            ./install-termux.sh"
    echo "        Ubuntu proot:                ./install-ubuntu-proot.sh"
    exit 1
  fi

  # Avisa cedo em vez de deixar a pessoa abrir o navegador e ver uma
  # página em branco sem entender o porquê.
  if [ ! -f "$ROOT_DIR/apps/frontend/dist/index.html" ]; then
    echo "Aviso: a interface ainda não foi compilada."
    echo "       Rode: cd apps/frontend && npm install && npm run build"
  fi
  if [ ! -d "$BACKEND_DIR/node_modules" ]; then
    echo "Erro: dependências do backend não instaladas."
    echo "      Rode: cd apps/backend && npm install"
    exit 1
  fi

  echo "Iniciando Pterodroid..."
  cd "$BACKEND_DIR"
  nohup node src/server.js >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  disown 2>/dev/null || true
  # Espera o servidor responder de verdade, e não só o processo existir —
  # um erro de inicialização (porta ocupada, banco corrompido) mata o
  # processo poucos segundos depois de ele nascer.
  for _ in $(seq 1 15); do
    sleep 1
    is_running || break
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS "http://127.0.0.1:${PORT:-3001}/api/health" >/dev/null 2>&1; then
        echo "Rodando (pid $(cat "$PID_FILE")) em http://localhost:${PORT:-3001}"
        echo "Logs em: $LOG_FILE"
        exit 0
      fi
    else
      echo "Rodando (pid $(cat "$PID_FILE")). Logs em: $LOG_FILE"
      exit 0
    fi
  done

  if is_running; then
    echo "Processo de pé, mas o painel não respondeu ao healthcheck a tempo."
    echo "Veja: $LOG_FILE"
  else
    echo "Falhou ao iniciar — últimas linhas do log:"
    tail -n 15 "$LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
  fi
}

cmd_stop() {
  if ! is_running; then
    echo "Não está rodando."
    rm -f "$PID_FILE"
    return 0
  fi
  PID="$(cat "$PID_FILE")"
  echo "Parando (pid $PID)..."
  kill -TERM "$PID" 2>/dev/null || true
  for _ in $(seq 1 15); do
    is_running || break
    sleep 1
  done
  if is_running; then
    echo "Não respondeu a SIGTERM, forçando com SIGKILL..."
    kill -KILL "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "Parado."
}

cmd_status() {
  if is_running; then
    echo "Pterodroid rodando (pid $(cat "$PID_FILE"))."
  else
    echo "Pterodroid parado."
  fi
}

cmd_logs() {
  touch "$LOG_FILE"
  tail -n 100 -f "$LOG_FILE"
}

# ── doctor: pré-voo do ambiente ──────────────────────────────────────────
# Verifica tudo o que o painel precisa (e o que é opcional) ANTES de a
# pessoa descobrir o problema em runtime. Imprime um relatório OK/AVISO/FALHA
# por item e uma matriz final de recursos; sai com código 1 se houver alguma
# FALHA bloqueante (CIs usam isso para validar instalações limpas).
DOCTOR_FAIL=0
DOCTOR_WARN=0

d_ok()    { printf '  [ OK ] %s\n' "$1"; }
d_aviso() { printf '  [AVISO] %s\n' "$1"; DOCTOR_WARN=$((DOCTOR_WARN + 1)); }
d_falha() { printf '  [FALHA] %s\n' "$1"; DOCTOR_FAIL=$((DOCTOR_FAIL + 1)); }
d_info()  { printf '  [INFO] %s\n' "$1"; }

check_bin() {
  # $1 binário · $2 rótulo · $3 obrigatório? (obrigatorio|opcional) · $4 dica
  if command -v "$1" >/dev/null 2>&1; then
    d_ok "$2 disponível ($("$1" --version 2>/dev/null | head -n 1 || echo presente))"
  elif [ "$3" = obrigatorio ]; then
    d_falha "$2 não encontrado — $4"
  else
    d_aviso "$2 não encontrado — $4"
  fi
}

cmd_doctor() {
  echo "Pterodroid doctor — pré-voo do ambiente"
  echo "════════════════════════════════════════"

  echo "» Node.js e gerenciador de pacotes"
  if node_ok; then
    d_ok "Node $(node --version) dentro da faixa suportada (20.19+ / 22.12+)"
  elif command -v node >/dev/null 2>&1; then
    d_falha "Node $(node --version) fora da faixa (exige 20.19+ ou 22.12+) — rode o instalador do seu ambiente"
  else
    d_falha "Node.js não instalado — rode ./install-linux.sh, ./install-termux.sh ou ./install-ubuntu-proot.sh"
  fi
  check_bin npm npm obrigatorio "instale o Node com npm (o Vite e o backend dependem dele)"

  echo "» Dependências do projeto"
  if [ -d "$BACKEND_DIR/node_modules/sql.js" ]; then
    d_ok "dependências do backend instaladas (apps/backend/node_modules)"
  else
    d_falha "dependências do backend ausentes/incompletas — rode: cd apps/backend && npm ci"
  fi
  if [ -f "$ROOT_DIR/apps/frontend/dist/index.html" ]; then
    d_ok "frontend compilado (apps/frontend/dist)"
  elif [ -d "$ROOT_DIR/apps/frontend/node_modules" ]; then
    d_aviso "frontend não compilado — rode: cd apps/frontend && npm run build"
  else
    d_aviso "frontend sem build nem dependências — sem dist/ o painel sobe só com a API"
  fi

  echo "» Execução e sistema"
  d_info "arquitetura: $(uname -m) · kernel: $(uname -sr)"
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    d_info "distro: $(. /etc/os-release && echo "${PRETTY_NAME:-desconhecida}")"
  fi
  if [ -f /.dockerenv ]; then
    d_info "modo detectado: container Docker (o painel deve rodar como usuário node aqui)"
  elif command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    d_info "modo detectado: Linux com systemd (veja contrib/pterodroid.service para a unidade opcional)"
  elif [ "$(id -u)" = "0" ] && [ -n "${PREFIX:-}" ]; then
    d_info "modo detectado: proot/Termux (root falso — sem systemd, use panelctl.sh)"
  else
    d_info "modo detectado: Linux sem systemd (panelctl.sh é o gerenciador de processo)"
  fi
  if [ "$(id -u)" = "0" ]; then
    if [ -f /.dockerenv ] || [ -n "${PTERODROID_ALLOW_ROOT:-}" ] || [ -f "$RUN_DIR/.allow-root" ]; then
      d_aviso "rodando como root com exceção reconhecida (proot/override/explícito) — prefira um usuário dedicado"
    else
      d_falha "sessão root sem exceção reconhecida — o painel recusa iniciar assim desde a Fase 0; use o instalador para criar um usuário de serviço"
    fi
  else
    d_ok "usuário não privilegiado ($(id -un), uid $(id -u))"
  fi
  check_bin git git opcional "necessário para clonar projetos pelo painel"
  check_bin curl curl opcional "necessário para healthchecks locais e integrações"
  check_bin prlimit prlimit opcional "sem ele, limites de memória/CPU de processos não são aplicados"
  check_bin bash bash opcional "scripts do painel usam bash"

  echo "» Porta, disco e diretórios"
  local port="${PORT:-3001}"
  if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null; then
    if is_running; then
      d_ok "porta $port responde ao healthcheck — é este painel (pid $(cat "$PID_FILE"))"
    else
      d_aviso "porta $port já responde a HTTP mas não temos PID registrado — outro processo está usando"
    fi
  elif is_running; then
    d_aviso "tem PID registrado mas a porta $port não responde — veja: $0 logs"
  else
    d_ok "porta $port livre"
  fi
  mkdir -p "$RUN_DIR"
  if [ -w "$RUN_DIR" ]; then
    d_ok "diretório de dados gravável ($RUN_DIR)"
  else
    d_falha "diretório de dados SEM permissão de escrita ($RUN_DIR)"
  fi
  local avail_mb
  avail_mb="$(df -Pm "$RUN_DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
  if [ -n "$avail_mb" ] && [ "$avail_mb" -lt 1024 ]; then
    d_aviso "disco do diretório de dados com ${avail_mb} MB livres (recomendado ≥ 1 GB)"
  elif [ -n "$avail_mb" ]; then
    d_ok "espaço em disco: ${avail_mb} MB livres"
  fi
  if [ -f "$RUN_DIR/panel.db.lock" ]; then
    local lock_pid
    lock_pid="$(cut -d: -f1 "$RUN_DIR/panel.db.lock" 2>/dev/null)"
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
      d_info "panel.db em uso pelo processo $lock_pid (lock exclusivo ativo)"
    else
      d_aviso "existe panel.db.lock obsoleto — será recuperado automaticamente no próximo start"
    fi
  fi

  echo "» Recursos opcionais"
  check_bin "$CLOUDFLARED_BIN" "cloudflared" opcional "túneis Cloudflare ficam indisponíveis (instale cloudflared)"
  if command -v psql >/dev/null 2>&1 || command -v initdb >/dev/null 2>&1; then
    d_ok "PostgreSQL disponível"
  else
    d_aviso "PostgreSQL não encontrado — instâncias de Postgres ficam indisponíveis"
  fi
  if command -v mariadbd >/dev/null 2>&1 || command -v mysqld >/dev/null 2>&1; then
    d_ok "MySQL/MariaDB disponível"
  else
    d_aviso "MySQL/MariaDB não encontrado — instâncias desses bancos ficam indisponíveis"
  fi
  if [ -S /var/run/docker.sock ]; then
    if curl -fsS --unix-socket /var/run/docker.sock --max-time 3 "http://localhost/_ping" >/dev/null 2>&1; then
      d_aviso "Docker Engine acessível via /var/run/docker.sock — lembre-se: isso equivale a acesso administrativo ao host; monte-o apenas se precisa gerenciar containers"
    else
      d_aviso "docker.sock existe mas não responde ao ping — daemon parado ou permissão negada"
    fi
  elif command -v docker >/dev/null 2>&1; then
    d_aviso "CLI do docker presente mas /var/run/docker.sock ausente — recursos Docker indisponíveis"
  else
    d_info "Docker ausente — serviços rodam como processos locais (modo suportado)"
  fi

  echo "════════════════════════════════════════"
  echo "Matriz de recursos desta máquina:"
  printf '  %-34s %s\n' "execução do backend" "$([ $DOCTOR_FAIL -eq 0 ] && echo habilitada || echo BLOQUEADA)"
  printf '  %-34s %s\n' "frontend (interface web)" "$([ -f "$ROOT_DIR/apps/frontend/dist/index.html" ] && echo disponível || echo pendente)"
  printf '  %-34s %s\n' "bancos PostgreSQL" "$(command -v psql >/dev/null 2>&1 || command -v initdb >/dev/null 2>&1 && echo disponível || echo indisponível)"
  printf '  %-34s %s\n' "bancos MySQL/MariaDB" "$(command -v mariadbd >/dev/null 2>&1 || command -v mysqld >/dev/null 2>&1 && echo disponível || echo indisponível)"
  printf '  %-34s %s\n' "Cloudflare Tunnel" "$(command -v "$CLOUDFLARED_BIN" >/dev/null 2>&1 && echo disponível || echo indisponível)"
  printf '  %-34s %s\n' "Docker Engine" "$([ -S /var/run/docker.sock ] && echo "socket montado (privilegiado)" || echo ausente)"

  echo ""
  if [ $DOCTOR_FAIL -gt 0 ]; then
    echo "  ❌ doctor: $DOCTOR_FAIL falha(s) bloqueante(s), $DOCTOR_WARN aviso(s)."
    exit 1
  fi
  echo "  ✅ doctor: ambiente apto a rodar o painel ($DOCTOR_WARN aviso(s))."
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  doctor)  cmd_doctor ;;
  *)
    echo "Uso: $0 {start|stop|restart|status|logs|doctor}"
    exit 1
    ;;
esac
