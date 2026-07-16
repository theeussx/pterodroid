#!/bin/bash
# install-termux.sh — sets up Pterodroid inside Termux.
set -euo pipefail

if [ -z "${PREFIX:-}" ] || [[ "$PREFIX" != *com.termux* ]]; then
  echo "Este script é para o Termux (variável \$PREFIX do Termux não encontrada)."
  echo "Rodando fora do Termux? Use install-ubuntu-proot.sh."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== Atualizando pacotes =="
pkg update -y

echo "== Instalando Node.js e Cloudflared =="
pkg install -y nodejs cloudflared

echo ""
echo "== Bancos de dados (opcional) =="
echo "O painel suporta PostgreSQL e MySQL/MariaDB como instâncias locais."
read -r -p "Instalar PostgreSQL agora? [s/N] " ans
if [[ "$ans" =~ ^[sS]$ ]]; then
  pkg install -y postgresql
fi
read -r -p "Instalar MariaDB agora? [s/N] " ans
if [[ "$ans" =~ ^[sS]$ ]]; then
  pkg install -y mariadb
  echo "Nota: o primeiro-uso do MariaDB no Termux tem particularidades de autenticação —"
  echo "o painel já sabe contornar isso automaticamente ao provisionar uma instância."
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
echo "== Recomendado: termux-wake-lock =="
echo "Sem isso, o Android pode suspender o Termux em segundo plano e derrubar seus"
echo "serviços. Se ainda não tem o pacote Termux:API instalado:"
echo "  pkg install termux-api"
echo "E rode 'termux-wake-lock' antes de iniciar o painel (ou adicione ao seu .bashrc)."

echo ""
echo "=================================================="
echo " Instalação concluída!"
echo ""
echo " Para iniciar o painel:"
echo "   $ROOT_DIR/panelctl.sh start"
echo ""
echo " Acesse http://localhost:3001 no navegador do celular"
echo " (ou http://<ip-do-celular>:3001 de outro dispositivo na mesma rede)."
echo ""
echo " Login padrão: admin / admin — troque em Configurações após entrar."
echo "=================================================="
