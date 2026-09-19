#!/bin/bash
# install-service.sh — instala/remove a unidade systemd opcional do
# Pterodroid (contrib/pterodroid.service), preenchendo o template com os
# caminhos e o usuário reais desta máquina.
#
# Uso:
#   ./contrib/install-service.sh [--user U] [--dir D] [--no-start]
#   ./contrib/install-service.sh --uninstall
#
# Regra de ouro: NÃO use o serviço systemd e o `panelctl.sh start` para o
# mesmo painel ao mesmo tempo — os dois subiriam processos disputando o
# panel.db (o lock exclusivo do backend derrubaria um deles com erro).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT_DIR/contrib/pterodroid.service"
UNIT_PATH="/etc/systemd/system/pterodroid.service"

SVC_USER="$(id -un)"
SVC_DIR="$ROOT_DIR"
AUTO_START=1
ACTION="install"

usage() {
  cat <<'EOF'
Uso: ./contrib/install-service.sh [opções]

Instala a unidade systemd do Pterodroid (Linux nativo, opcional — em
Termux/proot ou sem systemd, use o panelctl.sh).

Opções:
  --user U      Usuário de serviço (padrão: o usuário atual; nunca root)
  --dir D       Diretório do repositório (padrão: detectado pelo script)
  --no-start    Instala e habilita no boot, mas não inicia agora
  --uninstall   Para, desabilita e remove a unidade
  -h, --help    Mostra esta ajuda
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --user)      SVC_USER="${2:?--user precisa de um valor}"; shift 2 ;;
    --dir)       SVC_DIR="${2:?--dir precisa de um valor}"; shift 2 ;;
    --no-start)  AUTO_START=0; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "Opção desconhecida: $1 (veja --help)"; exit 1 ;;
  esac
done

have() { command -v "$1" >/dev/null 2>&1; }

if ! have systemctl || [ ! -d /run/systemd/system ]; then
  echo "systemd não está ativo nesta máquina — nada a fazer."
  echo "Use o panelctl.sh como gerenciador de processo (funciona em qualquer Linux):"
  echo "  $ROOT_DIR/panelctl.sh start"
  exit 0
fi

SUDO=""
if [ "$(id -u)" != "0" ]; then
  if have sudo; then
    SUDO="sudo"
  else
    echo "Erro: preciso de root ou sudo para mexer em $UNIT_PATH."
    exit 1
  fi
fi

if [ "$ACTION" = "uninstall" ]; then
  echo "Removendo pterodroid.service..."
  $SUDO systemctl disable --now pterodroid.service 2>/dev/null || true
  $SUDO rm -f "$UNIT_PATH"
  $SUDO systemctl daemon-reload
  echo "Removido. O panelctl.sh continua disponível para uso manual."
  exit 0
fi

# ── Validações antes de escrever a unidade ───────────────────────────────
if [ "$SVC_USER" = "root" ]; then
  echo "Erro: instalar o serviço como root NÃO é suportado — o painel recusa"
  echo "iniciar como root desde a Fase 0 (qualquer serviço/terminal herdaria"
  echo "privilégio total do sistema). Crie um usuário dedicado primeiro:"
  echo "  sudo useradd -m -s /bin/bash pterodroid"
  echo "  sudo chown -R pterodroid:pterodroid $SVC_DIR"
  echo "  $0 --user pterodroid"
  exit 1
fi
if ! id "$SVC_USER" >/dev/null 2>&1; then
  echo "Erro: usuário '$SVC_USER' não existe."
  exit 1
fi
if [ ! -f "$SVC_DIR/apps/backend/src/server.js" ]; then
  echo "Erro: '$SVC_DIR' não parece ser a raiz do repositório Pterodroid."
  exit 1
fi
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Erro: node não encontrado no PATH — rode ./install-linux.sh primeiro."
  exit 1
fi

# Garante que o diretório de dados existe e pertence ao usuário de serviço
# (um bind mal montado ou um clone feito por outro usuário dariam EACCES no
# primeiro boot do serviço — falhar aqui com explicação é melhor).
mkdir -p "$SVC_DIR/data"
if [ "$(id -u)" = "0" ] || [ -n "$SUDO" ]; then
  $SUDO chown -R "$SVC_USER:$SVC_USER" "$SVC_DIR/data"
fi

echo "Instalando pterodroid.service..."
echo "  usuário:   $SVC_USER"
echo "  diretório: $SVC_DIR"
echo "  node:      $NODE_BIN"

rendered="$(mktemp)"
sed \
  -e "s|__PTERODROID_USER__|$SVC_USER|g" \
  -e "s|__PTERODROID_DIR__|$SVC_DIR|g" \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  "$TEMPLATE" > "$rendered"

$SUDO install -m 0644 "$rendered" "$UNIT_PATH"
rm -f "$rendered"
$SUDO systemctl daemon-reload

if [ "$AUTO_START" = "1" ]; then
  # Se o painel está de pé pelo panelctl, o lock do banco faria o serviço
  # falhar no primeiro boot — avisar é melhor do que deixar quebrar.
  if [ -f "$SVC_DIR/data/panel.pid" ] && kill -0 "$(cat "$SVC_DIR/data/panel.pid")" 2>/dev/null; then
    echo ""
    echo "Aviso: o painel está rodando via panelctl (pid $(cat "$SVC_DIR/data/panel.pid"))."
    echo "Pare-o antes — dois processos disputariam o panel.db:"
    echo "  $SVC_DIR/panelctl.sh stop"
  fi
  $SUDO systemctl enable --now pterodroid.service
  echo ""
  echo "Serviço instalado e iniciado. Comandos úteis:"
else
  $SUDO systemctl enable pterodroid.service
  echo ""
  echo "Serviço instalado (habilitado no boot, ainda não iniciado). Comandos úteis:"
fi
echo "  sudo systemctl status pterodroid      # estado"
echo "  journalctl -u pterodroid -f           # logs"
echo "  sudo systemctl restart pterodroid     # reiniciar"
echo "  $0 --uninstall                        # remover"
