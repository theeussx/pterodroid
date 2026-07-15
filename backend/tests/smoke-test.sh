#!/bin/bash
# smoke-test.sh — exercises the real backend end-to-end against a throwaway
# database on a separate port, so it's safe to run even if your real panel
# (with your real services configured) is already up.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

export DB_PATH="/tmp/termuxpanel-smoketest-$$.db"
export PORT=3099
BASE="http://localhost:$PORT"
rm -f "$DB_PATH"

node src/server.js > /tmp/smoketest-server.log 2>&1 &
SERVER_PID=$!
sleep 2

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; }

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

echo "== delete service cleanup =="
DEL=$(curl -s -X DELETE "$BASE/api/services/$SVC_ID" -H "$AUTH")
echo "$DEL" | grep -q '"ok":true' && pass "service deleted" || fail "delete failed: $DEL"

kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
rm -f "$DB_PATH"
echo "== ALL DONE (throwaway db + port $PORT, your real panel was untouched) =="
