#!/bin/bash
# panelctl.sh — start/stop/status for the panel's own backend process.
# No systemd anywhere in the loop: this is a plain PID-file-based control
# script, which is the right tool on Termux and works identically inside
# Ubuntu-proot.

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
RUN_DIR="$ROOT_DIR/data"
PID_FILE="$RUN_DIR/panel.pid"
LOG_FILE="$RUN_DIR/panel.out.log"

mkdir -p "$RUN_DIR"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

cmd_start() {
  if is_running; then
    echo "Já está rodando (pid $(cat "$PID_FILE"))."
    exit 0
  fi
  echo "Iniciando TermuxPanel..."
  cd "$BACKEND_DIR"
  nohup node src/server.js >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  disown 2>/dev/null || true
  sleep 1
  if is_running; then
    echo "Rodando (pid $(cat "$PID_FILE")). Logs em: $LOG_FILE"
  else
    echo "Falhou ao iniciar — veja $LOG_FILE"
    exit 1
  fi
}

cmd_stop() {
  if ! is_running; then
    echo "Não está rodando."
    rm -f "$PID_FILE"
    exit 0
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
    echo "TermuxPanel rodando (pid $(cat "$PID_FILE"))."
  else
    echo "TermuxPanel parado."
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
