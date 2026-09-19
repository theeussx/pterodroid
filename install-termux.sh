#!/bin/bash
# install-termux.sh — sets up Pterodroid inside Termux.
set -euo pipefail

if [ -z "${PREFIX:-}" ] || [[ "$PREFIX" != *com.termux* ]]; then
  echo "Este script é para o Termux (variável \$PREFIX do Termux não encontrada)."
  echo "Rodando fora do Termux? Use install-ubuntu-proot.sh."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# O frontend (Vite 8) exige Node "^20.19.0 || >=22.12.0" — o nodejs-lts do
# Termux já atende, mas validamos para dar um erro claro em vez de um build
# quebrado (ex.: "does not provide an export named 'styleText'").
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

echo "== Atualizando pacotes =="
pkg update -y

echo "== Instalando Node.js LTS e Cloudflared =="
pkg install -y nodejs-lts cloudflared

if ! node_ok; then
  echo ""
  echo "ERRO: o Node.js instalado ($(node --version 2>/dev/null || echo '?')) é antigo demais."
  echo "O frontend exige Node 20.19+ ou 22.12+. Atualize os pacotes (pkg upgrade) e rode de novo."
  exit 1
fi
echo "Node.js OK: $(node --version)"

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
