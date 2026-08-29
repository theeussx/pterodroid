#!/usr/bin/env node
'use strict';
/**
 * Segurança das instâncias de banco — teste de integração.
 *
 * MOTIVAÇÃO CONCRETA: o nome da instância vira nome de PASTA em disco, e
 * esse caminho era interpolado dentro de uma string de shell nos drivers
 * (`execSync(\`initdb -D "${dataDirectory}" ...\`)`). Um nome como
 *   x"; touch /tmp/arquivo; echo "
 * fazia o shell enxergar três comandos em vez de um — reproduzido na
 * prática antes da correção.
 *
 * A correção tem duas camadas, e este teste cobre as duas:
 *  1. os drivers não usam mais shell (execFileSync com array de argumentos);
 *  2. o nome é validado na API antes de chegar ao disco.
 *
 *   node tests/database-security-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3960 + Math.floor(Math.random() * 8);
const B = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-dbsec-'));
const CANARY = path.join(TMP, 'INJETADO');

let pass = 0;
let fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
};

let server;
function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env: { ...process.env, DATA_ROOT: path.join(TMP, 'data'), PORT: String(PORT), JWT_SECRET: 'test', HOME: TMP },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (d) => { out += d.toString(); if (out.includes('Pterodroid ouvindo')) resolve(); };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('exit', (c) => reject(new Error(`servidor saiu com ${c}:\n${out}`)));
    setTimeout(() => reject(new Error(`timeout ao subir:\n${out}`)), 30000);
  });
}
function cleanup() {
  try { server?.kill('SIGKILL'); } catch { /* já morreu */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ok */ }
}

(async () => {
  await startServer();

  let login = await fetch(`${B}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  }).then((r) => r.json());
  // Com o setup obrigatório, trocar a senha libera as rotas de negócio.
  await fetch(`${B}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ current: 'admin', next: 'teste-db-12345' }),
  });
  login = await fetch(`${B}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'teste-db-12345' }),
  }).then((r) => r.json());
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };

  const create = (body) => fetch(`${B}/api/databases`, { method: 'POST', headers: auth, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

  console.log('Injeção de comando pelo nome da instância:');
  const payloads = [
    ['aspas + ponto e vírgula', `x"; touch ${CANARY}; echo "`],
    ['substituição de comando', `x$(touch ${CANARY})`],
    ['crase', `x\`touch ${CANARY}\``],
    ['pipe', `x | touch ${CANARY}`],
    ['nova linha', `x\ntouch ${CANARY}`],
  ];
  for (const [label, name] of payloads) {
    const r = await create({ name, type: 'postgresql', port: 5432 });
    ok(`rejeita ${label}`, r.status === 400, `status ${r.status}`);
  }
  ok('nenhum comando injetado foi executado', !fs.existsSync(CANARY));

  console.log('\nTravessia de caminho pelo nome:');
  for (const [label, name] of [['../', '../../etc/cron.d/x'], ['ponto-ponto', '..'], ['barra', 'a/b']]) {
    const r = await create({ name, type: 'postgresql', port: 5433 });
    ok(`rejeita ${label}`, r.status === 400, `status ${r.status}`);
  }

  console.log('\nValidação de porta:');
  ok('rejeita porta privilegiada (<1024)', (await create({ name: 'db1', type: 'postgresql', port: 80 })).status === 400);
  ok('rejeita porta fora da faixa', (await create({ name: 'db1', type: 'postgresql', port: 99999 })).status === 400);
  ok('rejeita porta não numérica', (await create({ name: 'db1', type: 'postgresql', port: 'abc' })).status === 400);

  console.log('\nValidação do usuário do banco:');
  const badUser = await create({ name: 'db-user', type: 'postgresql', port: 5440, db_username: "root'; DROP TABLE x;--" });
  ok('rejeita usuário com caracteres de SQL', badUser.status === 400, `status ${badUser.status}`);

  console.log('\nNomes legítimos continuam funcionando:');
  const bom = await create({ name: 'Meu Banco 1', type: 'postgresql', port: 5445 });
  ok('aceita nome com espaço e número', bom.status === 201, JSON.stringify(bom.data));
  ok('aceita ponto e hífen', (await create({ name: 'app-prod.v2', type: 'postgresql', port: 5446 })).status === 201);

  console.log('\nSenha gerada:');
  ok('senha gerada é longa o suficiente', (bom.data?.generatedPassword || '').length >= 20,
    `${(bom.data?.generatedPassword || '').length} caracteres`);
  const outra = await create({ name: 'outro banco', type: 'postgresql', port: 5447 });
  ok('senhas geradas são diferentes entre si',
    bom.data?.generatedPassword !== outra.data?.generatedPassword);

  console.log('\nSenha nunca é devolvida em listagens:');
  const lista = await fetch(`${B}/api/databases`, { headers: auth }).then((r) => r.json());
  ok('listagem não expõe db_password', lista.every((i) => i.db_password === undefined));
  ok('listagem informa apenas se há senha', lista.every((i) => typeof i.hasPassword === 'boolean'));
  const detalhe = await fetch(`${B}/api/databases/${bom.data.id}`, { headers: auth }).then((r) => r.json());
  ok('detalhe não expõe db_password', detalhe.db_password === undefined);

  console.log('\nConflito de porta:');
  ok('recusa porta já usada por outra instância',
    (await create({ name: 'conflito', type: 'postgresql', port: 5445 })).status === 409);

  console.log('\nEdição valida da mesma forma:');
  const put = await fetch(`${B}/api/databases/${bom.data.id}`, {
    method: 'PUT', headers: auth, body: JSON.stringify({ name: `y"; touch ${CANARY}; echo "` }),
  });
  ok('PUT rejeita nome malicioso', put.status === 400, `status ${put.status}`);
  ok('canário continua ausente após o PUT', !fs.existsSync(CANARY));

  console.log('\nDiretório de dados derivado com segurança:');
  const workspaces = require('../src/services/workspaceManager');
  const derivado = workspaces.slugify('Meu Banco 1', 'instancia');
  ok('nome com espaço vira slug seguro', derivado === 'meu-banco-1', derivado);
  ok('slug nunca contém separador de caminho', !derivado.includes('/') && !derivado.includes('\\'));

  cleanup();
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('erro no teste:', e); cleanup(); process.exit(1); });
