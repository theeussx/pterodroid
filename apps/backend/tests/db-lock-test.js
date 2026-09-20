'use strict';
/**
 * Testa o lock exclusivo do panel.db (src/db/dbLock.js):
 *  1. pidAlive distingue PID vivo de morto;
 *  2. aquisição dupla no mesmo processo falha com mensagem acionável;
 *  3. lock com PID morto é recuperado (painel caiu de SIGKILL);
 *  4. release remove o arquivo;
 *  5. integração: um SEGUNDO servidor contra o mesmo DB_PATH morre no boot
 *     com erro claro, em vez de sobrescrever os dados do primeiro;
 *  6. ao parar o servidor com SIGTERM o lock é liberado (desligamento limpo
 *     não deixa lock obsoleto para o próximo boot).
 *
 * Roda num DATA_ROOT temporário: nunca toca no painel real.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ptero-db-lock-'));
const DB_PATH = path.join(ROOT, 'panel.db');
const LOCK_PATH = `${DB_PATH}.lock`;
const BACKEND_DIR = path.join(__dirname, '..');

const baseEnv = () => ({
  ...process.env,
  DATA_ROOT: ROOT,
  DB_PATH,
  WORKSPACES_ROOT: path.join(ROOT, 'workspaces'),
  FILES_ROOT: path.join(ROOT, 'workspaces'),
  JWT_SECRET: 'db-lock-test',
});

const { acquireDbLock, pidAlive } = require('../src/db/dbLock');

function waitHttpOk(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      function retry() {
        if (Date.now() - start > timeoutMs) return reject(new Error(`timeout esperando ${url}`));
        setTimeout(attempt, 300);
      }
    };
    attempt();
  });
}

async function main() {
  // 1) pidAlive
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  assert.strictEqual(pidAlive(process.pid), true, 'PID próprio deveria estar vivo');
  assert.strictEqual(pidAlive(dead), false, 'PID já finalizado deveria estar morto');
  assert.strictEqual(pidAlive('lixo'), false, 'conteúdo inválido de lock é tratado como morto');
  console.log('  PASS: pidAlive distingue vivo/morto/inválido');

  // 2) aquisição dupla
  const release1 = acquireDbLock(DB_PATH);
  assert.ok(fs.existsSync(LOCK_PATH), 'lock deveria estar no disco');
  assert.throws(() => acquireDbLock(DB_PATH), /já está em uso/, 'segunda aquisição deveria falhar com erro claro');
  console.log('  PASS: lock duplo rejeitado com mensagem acionável');

  // 3) release libera
  release1();
  assert.ok(!fs.existsSync(LOCK_PATH), 'release deveria remover o lock');
  console.log('  PASS: release remove o arquivo de lock');

  // 4) lock obsoleto (PID morto) é recuperado
  fs.writeFileSync(LOCK_PATH, `${dead}:2026-01-01T00:00:00Z\n`);
  const release2 = acquireDbLock(DB_PATH);
  assert.ok(fs.existsSync(LOCK_PATH));
  release2();
  console.log('  PASS: lock obsoleto de PID morto é recuperado');

  // 5) integração: segundo servidor sobre o mesmo banco morre cedo e claro
  const portA = 38271;
  const serverA = spawn(process.execPath, ['src/server.js'], {
    cwd: BACKEND_DIR,
    env: { ...baseEnv(), PORT: String(portA) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let outA = '';
  serverA.stdout.on('data', (d) => { outA += d; });
  serverA.stderr.on('data', (d) => { outA += d; });

  try {
    await waitHttpOk(`http://127.0.0.1:${portA}/api/health`, 20000);
    assert.ok(fs.existsSync(LOCK_PATH), 'servidor A deveria segurar o lock');

    const result = await new Promise((resolve, reject) => {
      const serverB = spawn(process.execPath, ['src/server.js'], {
        cwd: BACKEND_DIR,
        env: { ...baseEnv(), PORT: '38272' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let outB = '';
      serverB.stdout.on('data', (d) => { outB += d; });
      serverB.stderr.on('data', (d) => { outB += d; });
      const guard = setTimeout(() => {
        serverB.kill('SIGKILL');
        reject(new Error(`servidor B não morreu sozinho em 15s. Saída:\n${outB}`));
      }, 15000);
      serverB.on('exit', (code) => {
        clearTimeout(guard);
        resolve({ code, outB });
      });
    });

    assert.strictEqual(result.code, 1, `servidor B deveria sair com código 1 (saiu ${result.code})\n${result.outB}`);
    assert.match(result.outB, /já está em uso por outro processo/, `erro claro ausente:\n${result.outB}`);
    assert.match(result.outB, /panelctl\.sh stop/, `remediação ausente na mensagem:\n${result.outB}`);
    console.log('  PASS: segundo painel sobre o mesmo banco morre no boot com causa e remediação');
  } finally {
    serverA.kill('SIGTERM');
    await new Promise((resolve) => {
      const t = setTimeout(() => { serverA.kill('SIGKILL'); resolve(); }, 10000);
      serverA.on('exit', () => { clearTimeout(t); resolve(); });
    });
  }

  // 6) desligamento gracioso liberou o lock para o próximo boot
  assert.ok(!fs.existsSync(LOCK_PATH), `lock deveria ter sido liberado no SIGTERM. Log do A:\n${outA}`);
  console.log('  PASS: SIGTERM libera o lock (próximo boot não herda lock obsoleto)');

  console.log('lock exclusivo do banco: unidade + integração passaram');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
