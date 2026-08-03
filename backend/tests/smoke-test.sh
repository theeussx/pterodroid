#!/bin/bash
# smoke-test.sh — exercises the real backend end-to-end against a throwaway
# database on a separate port, so it's safe to run even if your real panel
# (with your real services configured) is already up.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Ambiente 100% isolado: banco, workspaces e arquivos vão para uma pasta
# temporária, então rodar isto NUNCA toca no painel real de quem executa.
export DATA_ROOT="/tmp/pterodroid-smoketest-$$"
export DB_PATH="$DATA_ROOT/panel.db"
export WORKSPACES_ROOT="$DATA_ROOT/workspaces"
export FILES_ROOT="$DATA_ROOT/workspaces"
export JWT_SECRET="smoketest"
export PORT=3099
BASE="http://localhost:$PORT"
rm -rf "$DATA_ROOT"
mkdir -p "$WORKSPACES_ROOT"

node src/server.js > /tmp/smoketest-server.log 2>&1 &
SERVER_PID=$!
sleep 4

pass() { echo "  PASS: $1"; }
# Sem o contador, um "FAIL" aqui só aparecia no log — o processo sempre saía
# com código 0 (o do último comando, o "echo" final), então run-all.sh nunca
# detectava uma asserção que falhou aqui, só um crash de verdade do script.
FAILURES=0
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

echo "== health =="
H=$(curl -s "$BASE/api/health")
echo "$H"
echo "$H" | grep -q '"ok":true' && pass "health ok" || fail "health check failed"

echo "== login =="
LOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"username":"admin","password":"admin"}')
TOKEN=$(echo "$LOGIN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")
[ -n "$TOKEN" ] && pass "logged in, token acquired" || fail "login failed: $LOGIN"
AUTH="Authorization: Bearer $TOKEN"

echo "== wrong password should 401 =="
BADLOGIN=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"username":"admin","password":"wrong"}')
[ "$BADLOGIN" = "401" ] && pass "wrong password correctly rejected (401)" || fail "expected 401, got $BADLOGIN"

echo "== unauthenticated request should 401 =="
NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/services")
[ "$NOAUTH" = "401" ] && pass "no-token request correctly rejected (401)" || fail "expected 401, got $NOAUTH"

echo "== create service =="
SVC=$(curl -s -X POST "$BASE/api/services" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"name\":\"tick-test\",\"command\":\"node $(pwd)/tests/fixtures/tick.js\",\"type\":\"node\"}")
SVC_ID=$(echo "$SVC" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).id))")
[ -n "$SVC_ID" ] && pass "service created, id=$SVC_ID" || fail "service creation failed: $SVC"

echo "== start service =="
START=$(curl -s -X POST "$BASE/api/services/$SVC_ID/start" -H "$AUTH")
echo "$START"
echo "$START" | grep -q '"ok":true' && pass "service started" || fail "start failed"
sleep 2

echo "== get service: expect status running, some stdout logs =="
GET1=$(curl -s "$BASE/api/services/$SVC_ID" -H "$AUTH")
echo "$GET1" | node -e "
  let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const s=JSON.parse(d);
    console.log('status:', s.status, '| pid:', s.runtime && s.runtime.pid, '| alive:', s.runtime && s.runtime.alive, '| logLines:', s.recentLogs.length);
  })"
echo "$GET1" | grep -q '"status":"running"' && pass "status is running" || fail "status not running"

echo "== test crash + auto-restart: kill the child pid directly =="
RAW_PID=$(echo "$GET1" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).runtime.pid))")
echo "killing pid $RAW_PID (simulating a crash)"
kill -9 "$RAW_PID" 2>/dev/null || echo "  (pid already gone)"
sleep 5

GET2=$(curl -s "$BASE/api/services/$SVC_ID" -H "$AUTH")
echo "$GET2" | node -e "
  let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const s=JSON.parse(d);
    console.log('after crash -> status:', s.status, '| new pid:', s.runtime && s.runtime.pid, '| restart_count:', s.restart_count);
  })"
NEW_PID=$(echo "$GET2" | node -e "process.stdin.on('data',d=>{const s=JSON.parse(d);console.log(s.runtime?s.runtime.pid:'')})")
if [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$RAW_PID" ]; then
  pass "auto-restart worked: new pid $NEW_PID (old was $RAW_PID)"
else
  fail "auto-restart did not produce a new pid"
fi

echo "== stop service =="
curl -s -X POST "$BASE/api/services/$SVC_ID/stop" -H "$AUTH" > /dev/null
sleep 1
GET3=$(curl -s "$BASE/api/services/$SVC_ID" -H "$AUTH")
echo "$GET3" | grep -q '"status":"stopped"' && pass "service stopped cleanly" || fail "service did not stop as expected: $GET3"

echo "== monitor overview =="
curl -s "$BASE/api/monitor/overview" -H "$AUTH" | node -e "
  let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const o=JSON.parse(d);
    console.log('cpu%:', o.snapshot.cpu.toFixed(1), '| mem%:', o.snapshot.mem.percent.toFixed(1), '| services:', o.services.total, '| db instances:', o.databases.total);
  })"

echo "== db engines availability =="
curl -s "$BASE/api/databases/engines" -H "$AUTH"
echo ""

echo "== settings default values =="
curl -s "$BASE/api/settings" -H "$AUTH"
echo ""

echo "== backups: prepare a file in the workspace =="
WORKDIR=$(echo "$GET1" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).working_directory))")
echo "conteudo-original" > "$WORKDIR/marcador.txt"
[ -f "$WORKDIR/marcador.txt" ] && pass "arquivo de teste criado no workspace" || fail "não criou arquivo de teste no workspace"

echo "== backups: create =="
BK=$(curl -s -X POST "$BASE/api/services/$SVC_ID/backups" -H "$AUTH" -H "Content-Type: application/json" -d '{"name":"teste-1"}')
echo "$BK"
BK_ID=$(echo "$BK" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).id))")
echo "$BK" | grep -q '"status":"ready"' && pass "backup criado e pronto" || fail "backup não ficou 'ready': $BK"

echo "== backups: list =="
LIST=$(curl -s "$BASE/api/services/$SVC_ID/backups" -H "$AUTH")
echo "$LIST" | grep -qE "\"id\":$BK_ID[,}]" && pass "backup aparece na listagem" || fail "backup sumiu da listagem: $LIST"

echo "== backups: limit is enforced =="
for i in $(seq 1 12); do
  curl -s -X POST "$BASE/api/services/$SVC_ID/backups" -H "$AUTH" -H "Content-Type: application/json" -d "{\"name\":\"extra-$i\"}" > /dev/null
done
OVERLIMIT_COUNT=$(curl -s "$BASE/api/services/$SVC_ID/backups" -H "$AUTH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")
[ "$OVERLIMIT_COUNT" -le 10 ] && pass "limite de backups por serviço respeitado ($OVERLIMIT_COUNT <= 10)" || fail "limite não foi respeitado: $OVERLIMIT_COUNT backups"

echo "== backups: download is a real zip =="
curl -s "$BASE/api/services/$SVC_ID/backups/$BK_ID/download" -H "$AUTH" -o "/tmp/pterodroid-backup-test-$$.zip"
FILETYPE=$(node -e "try { const b=require('fs').readFileSync('/tmp/pterodroid-backup-test-$$.zip'); console.log(b[0]===0x50&&b[1]===0x4B?'zip':'other') } catch(e){ console.log('error') }")
echo "$FILETYPE" | grep -qi "zip" && pass "download é um .zip válido ($FILETYPE)" || fail "download não parece um zip: $FILETYPE"
rm -f "/tmp/pterodroid-backup-test-$$.zip"

echo "== backups: restore brings the original content back =="
echo "modificado-depois-do-backup" > "$WORKDIR/marcador.txt"
RESTORE=$(curl -s -X POST "$BASE/api/services/$SVC_ID/backups/$BK_ID/restore" -H "$AUTH")
echo "$RESTORE"
CONTENT_AFTER=$(cat "$WORKDIR/marcador.txt" 2>/dev/null)
[ "$CONTENT_AFTER" = "conteudo-original" ] && pass "restauração trouxe o conteúdo original de volta" || fail "restauração não recuperou o conteúdo (leu: '$CONTENT_AFTER')"

echo "== backups: delete =="
DELBK=$(curl -s -X DELETE "$BASE/api/services/$SVC_ID/backups/$BK_ID" -H "$AUTH")
echo "$DELBK" | grep -q '"ok":true' && pass "backup removido" || fail "falha ao remover backup: $DELBK"
LIST2=$(curl -s "$BASE/api/services/$SVC_ID/backups" -H "$AUTH")
echo "$LIST2" | grep -qE "\"id\":$BK_ID[,}]" && fail "backup ainda aparece após remoção" || pass "backup não aparece mais na listagem"

echo "== delete service cleanup =="
DEL=$(curl -s -X DELETE "$BASE/api/services/$SVC_ID" -H "$AUTH")
echo "$DEL" | grep -q '"ok":true' && pass "service deleted" || fail "delete failed: $DEL"

echo "== backups: cleaned up after service deletion =="
if [ -d "$DATA_ROOT/backups/service-$SVC_ID" ]; then
  fail "pasta de backups do serviço não foi removida"
else
  pass "pasta de backups do serviço foi removida junto"
fi

kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
rm -rf "$DATA_ROOT"
if [ $FAILURES -eq 0 ]; then
  echo "== ALL DONE (throwaway db + port $PORT, your real panel was untouched) =="
else
  echo "== $FAILURES CHECK(S) FAILED (throwaway db + port $PORT, your real panel was untouched) =="
fi
exit $FAILURES
