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

cmd_start() {
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

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  *)
    echo "Uso: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
