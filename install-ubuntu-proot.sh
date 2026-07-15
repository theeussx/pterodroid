#!/bin/bash
# install-ubuntu-proot.sh — sets up Pterodroid inside an Ubuntu proot
# (e.g. proot-distro on Termux).
set -euo pipefail

if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then
  echo "Este script espera um ambiente Ubuntu. /etc/os-release não indica Ubuntu."
  echo "Continuando mesmo assim em 5s (Ctrl+C para cancelar)..."
  sleep 5
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

echo "== Atualizando pacotes =="
sudo -n apt-get update -qq 2>/dev/null || apt-get update -qq

echo "== Instalando Node.js e Cloudflared =="
if ! command -v node >/dev/null 2>&1; then
  (sudo -n apt-get install -y -qq nodejs npm 2>/dev/null || apt-get install -y -qq nodejs npm)
fi
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Instalando cloudflared..."
  curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  (sudo -n dpkg -i cloudflared.deb 2>/dev/null || dpkg -i cloudflared.deb)
  rm cloudflared.deb
fi
node --version
cloudflared --version

echo ""
echo "== Bancos de dados (opcional) =="
read -r -p "Instalar PostgreSQL agora? [s/N] " ans
if [[ "$ans" =~ ^[sS]$ ]]; then
  (sudo -n apt-get install -y -qq postgresql 2>/dev/null || apt-get install -y -qq postgresql)
fi
read -r -p "Instalar MariaDB agora? [s/N] " ans
if [[ "$ans" =~ ^[sS]$ ]]; then
  (sudo -n apt-get install -y -qq mariadb-server 2>/dev/null || apt-get install -y -qq mariadb-server)
fi

echo ""
echo "== Instalando dependências do backend =="
cd "$ROOT_DIR/backend"
npm install

echo "== Instalando dependências do frontend e gerando build =="
cd "$ROOT_DIR/frontend"
npm install
npm run build

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
