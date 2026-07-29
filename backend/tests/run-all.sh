#!/bin/bash
# run-all.sh — roda toda a bateria de testes do backend.
#
# Nenhum deles precisa de Docker instalado nem toca no painel real: os
# testes de unidade usam diretórios temporários, e os de integração sobem
# um servidor próprio numa porta separada com banco descartável.
#
#   bash tests/run-all.sh
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

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

run "Unidade — workspaces, arquivos e parser de comando" node tests/workspace-files-test.js
run "Unidade — cliente da Docker Engine (API simulada)"  node tests/docker-engine-smoke-test.js
run "Integração — driver Docker (engine simulada)"       node tests/docker-driver-test.js
run "Integração — segurança da autenticação"             node tests/auth-security-test.js
run "Integração — segurança das instâncias de banco"    node tests/database-security-test.js
run "Integração — terminal do serviço"                   node tests/terminal-test.js
run "Integração — API HTTP completa"                     bash tests/smoke-test.sh

echo ""
echo "════════════════════════════════════════════════════════"
if [ $TOTAL_FAIL -eq 0 ]; then
  echo "  ✅ Todas as suítes passaram"
else
  echo "  ❌ $TOTAL_FAIL suíte(s) com falha"
fi
echo "════════════════════════════════════════════════════════"
exit $TOTAL_FAIL
