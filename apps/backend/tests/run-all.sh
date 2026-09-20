#!/bin/bash
# run-all.sh — roda toda a bateria de testes do backend.
#
# Nenhum deles precisa de Docker instalado nem toca no painel real: os
# testes de unidade usam diretórios temporários, e os de integração sobem
# um servidor próprio numa porta separada com banco descartável.
#
#   bash tests/run-all.sh
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

# ── Pré-voo ──────────────────────────────────────────────────────────────
# Falhar CEDO e com a causa raiz. Antes disto, rodar `npm test` sem ter
# instalado as dependências produzia dezenas de erros secundários (JSON
# inválido, conexão recusada...) que escondiam o problema real — um falso
# negativo clássico em contribuição nova (relatório de evolução, seção 2).
preflight() {
  local fatal=0
  if ! command -v node >/dev/null 2>&1; then
    echo "  FALHA PRÉ-VOO: node não encontrado no PATH (exige 20.19+ ou 22.12+)."
    fatal=1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "  FALHA PRÉ-VOO: curl não encontrado (necessário para a suíte HTTP)."
    fatal=1
  fi
  if [ -d node_modules ] && [ ! -d node_modules/sql.js ]; then
    echo "  FALHA PRÉ-VOO: node_modules existe mas está incompleto (sql.js ausente)."
    echo "                 Provável instalação interrompida — refaça com: npm ci"
    fatal=1
  fi
  if [ ! -d node_modules ]; then
    echo "  FALHA PRÉ-VOO: dependências não instaladas (node_modules ausente)."
    echo "                 Rode primeiro:  npm ci"
    fatal=1
  fi
  if [ $fatal -ne 0 ]; then
    echo ""
    echo "  Pré-voo falhou — nenhuma suíte foi executada. Corrija a causa acima"
    echo "  em vez de tratar os erros em cascata como bugs de teste."
    exit 1
  fi
}
preflight

TOTAL_FAIL=0
run() {
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  $1"
  echo "════════════════════════════════════════════════════════"
  shift
  "$@"
  local code=$?
  [ $code -ne 0 ] && TOTAL_FAIL=$((TOTAL_FAIL + 1))
  return $code
}

run "Unidade — classificação de níveis de log"             node tests/log-level-test.js
run "Unidade — catálogo de receitas de serviços"         node tests/recipe-test.js
run "Unidade — workspaces, arquivos e parser de comando" node tests/workspace-files-test.js
run "Unidade — cliente da Docker Engine (API simulada)"  node tests/docker-engine-smoke-test.js
run "Unidade — backup pré-migração do banco"             node tests/migration-backup-test.js
run "Integração — lock exclusivo do banco"               node tests/db-lock-test.js
run "Integração — driver Docker (engine simulada)"       node tests/docker-driver-test.js
run "Integração — segurança da autenticação"             node tests/auth-security-test.js
run "Integração — sessões revogáveis e 2FA TOTP"        node tests/auth-sessions-2fa-test.js
run "Unidade — cobertura da cifra de segredos"          node tests/secret-coverage-test.js
run "Fila — jobs persistentes (FIFO, cancel, zumbi)"    node tests/job-queue-test.js
run "Integração — segurança das instâncias de banco"    node tests/database-security-test.js
run "Segurança — compactar/descompactar (Zip Slip)"      node tests/archive-test.js
run "Integração — terminal do serviço"                   node tests/terminal-test.js
run "Integração — API HTTP completa"                     bash tests/smoke-test.sh
run "Pré-voo — panelctl doctor"                          bash ../../panelctl.sh doctor

echo ""
echo "════════════════════════════════════════════════════════"
if [ $TOTAL_FAIL -eq 0 ]; then
  echo "  ✅ Todas as suítes passaram"
else
  echo "  ❌ $TOTAL_FAIL suíte(s) com falha"
fi
echo "════════════════════════════════════════════════════════"
exit $TOTAL_FAIL