#!/bin/bash
# install-ubuntu-proot.sh — sets up Pterodroid inside an Ubuntu proot
# (e.g. proot-distro on Termux).
#
# Em Linux "de verdade" (PC/VPS/Raspberry Pi), use install-linux.sh.
set -euo pipefail

# O frontend (Vite 8 + @vitejs/plugin-react 6 + rolldown) exige
# "^20.19.0 || >=22.12.0". O `apt install nodejs` do Ubuntu entrega um Node
# antigo (18.x) que quebra o build com:
#   SyntaxError: The requested module 'node:util' does not provide
#   an export named 'styleText'
NODE_LTS_MAJOR="22"
MIN_NODE_20_MINOR="19"
MIN_NODE_22_MINOR="12"

if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then
  echo "Este script espera um ambiente Ubuntu. /etc/os-release não indica Ubuntu."
  echo "Em Linux de verdade, prefira ./install-linux.sh."
  echo "Continuando mesmo assim em 5s (Ctrl+C para cancelar)..."
  sleep 5
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

have() { command -v "$1" >/dev/null 2>&1; }

# node_ok: o Node atual atende "^20.19.0 || >=22.12.0"?
node_ok() {
  have node || return 1
  local ver rest major minor
  ver="$(node --version 2>/dev/null | sed 's/^v//')" || return 1
  major="${ver%%.*}"
  rest="${ver#*.}"
  minor="${rest%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] && [[ "$minor" =~ ^[0-9]+$ ]] || return 1
  if [ "$major" -gt 22 ]; then return 0; fi
  if [ "$major" -eq 22 ] && [ "$minor" -ge "$MIN_NODE_22_MINOR" ]; then return 0; fi
  if [ "$major" -eq 20 ] && [ "$minor" -ge "$MIN_NODE_20_MINOR" ]; then return 0; fi
  return 1
}

node_version() {
  if have node; then node --version 2>/dev/null; else echo "(não instalado)"; fi
}

detect_cf_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    armv7l|armv6l|armhf) echo "arm" ;;
    *) echo "unknown" ;;
  esac
}

# PostgreSQL and MariaDB both refuse to run as root, and proot commonly
# presents everything as root by default (it's a fakeroot-style
# implementation, not real kernel privilege separation). Handle this
# upfront instead of letting the user hit a cryptic failure later when
# they try to start a database instance from the panel.
if [ "$(id -u)" = "0" ]; then
  echo "=================================================="
  echo " Você está como root."
  echo " PostgreSQL e MariaDB recusam rodar como root — isso vai bloquear"
  echo " o provisionamento de bancos de dados pelo painel mais tarde."
  echo "=================================================="
  read -r -p "Criar um usuário comum agora para rodar o painel? [S/n] " ans
  if [[ ! "$ans" =~ ^[nN]$ ]]; then
    read -r -p "Nome do usuário [pterodroid]: " newuser
    newuser="${newuser:-pterodroid}"
    if ! id "$newuser" >/dev/null 2>&1; then
      apt-get update -qq
      apt-get install -y -qq sudo
      useradd -m -s /bin/bash "$newuser"
      usermod -aG sudo "$newuser"
      passwd "$newuser"
    fi
    chown -R "$newuser:$newuser" "$ROOT_DIR"
    echo ""
    echo "Usuário '$newuser' pronto. Agora rode:"
    echo "  su - $newuser"
    echo "  cd $ROOT_DIR"
    echo "  ./install-ubuntu-proot.sh"
    exit 0
  fi
  echo "Seguindo como root — bancos de dados locais não vão funcionar até você"
  echo "rodar o painel como um usuário comum."
fi

APT() { sudo -n apt-get "$@" 2>/dev/null || apt-get "$@"; }

echo "== Atualizando pacotes =="
APT update -qq

echo "== Garantindo Node.js $NODE_LTS_MAJOR LTS (exigido: 20.19+ ou 22.12+) =="
echo "Node atual: $(node_version)"
if ! node_ok; then
  if have node; then
    echo "O Node atual é antigo demais para o frontend (Vite 8). Atualizando via NodeSource..."
  fi
  APT install -y -qq ca-certificates curl gnupg git
  echo "Adicionando repositório NodeSource (Node $NODE_LTS_MAJOR)..."
  # shellcheck disable=SC2024
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_LTS_MAJOR}.x" | (sudo -n -E bash - 2>/dev/null || bash -)
  APT install -y -qq nodejs git curl
fi

if ! node_ok; then
  echo ""
  echo "ERRO: o Node.js continua abaixo do exigido (atual: $(node_version); exigido: 20.19+ ou 22.12+)."
  echo "O build do frontend (Vite 8) NÃO funciona no Node 18 — corrija o Node e rode de novo."
  exit 1
fi
echo "Node.js OK: $(node_version)"

echo "== Garantindo git, curl e cloudflared =="
APT install -y -qq git curl
if ! have cloudflared; then
  echo "Instalando cloudflared..."
  CF_ARCH="$(detect_cf_arch)"
  if [ "$CF_ARCH" = "unknown" ]; then
    echo "Aviso: arquitetura '$(uname -m)' não reconhecida — pulei o cloudflared."
    echo "O painel funciona sem ele; só o acesso remoto (túneis) fica indisponível."
  else
    DEB="cloudflared-linux-${CF_ARCH}.deb"
    if curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/$DEB"; then
      (sudo -n dpkg -i /tmp/cloudflared.deb 2>/dev/null || dpkg -i /tmp/cloudflared.deb) \
        || APT install -y -qq -f
      rm -f /tmp/cloudflared.deb
    else
      echo "Aviso: falha ao baixar o cloudflared para ${CF_ARCH}."
      echo "O painel funciona sem ele; só o acesso remoto (túneis) fica indisponível."
    fi
  fi
fi
node --version
have cloudflared && cloudflared --version | head -n1 || echo "(cloudflared ausente — túneis indisponíveis)"

echo ""
echo "== Bancos de dados (opcional) =="
read -r -p "Instalar PostgreSQL agora? [s/N] " ans
if [[ "$ans" =~ ^[sS]$ ]]; then
  APT install -y -qq postgresql
fi
read -r -p "Instalar MariaDB agora? [s/N] " ans
if [[ "$ans" =~ ^[sS]$ ]]; then
  APT install -y -qq mariadb-server
fi

echo ""
echo "== Instalando dependências do backend =="
cd "$ROOT_DIR/apps/backend"
npm install

echo "== Instalando dependências do frontend e gerando build =="
cd "$ROOT_DIR/apps/frontend"
npm install
npm run build

if [ ! -f "$ROOT_DIR/apps/frontend/dist/index.html" ]; then
  echo ""
  echo "ERRO: o build terminou mas apps/frontend/dist/index.html não existe."
  echo "Veja a saída acima e, se precisar, abra uma issue com o log completo:"
  echo "https://github.com/theeussx/pterodroid/issues"
  exit 1
fi

echo ""
echo "=================================================="
echo " Instalação concluída!"
echo ""
echo " Para iniciar o painel:"
echo "   $ROOT_DIR/panelctl.sh start"
echo ""
echo " Acesse http://localhost:3001 no navegador."
echo " Login padrão: admin / admin — troque em Configurações após entrar."
echo "=================================================="
