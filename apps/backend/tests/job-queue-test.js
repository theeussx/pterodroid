#!/usr/bin/env node
'use strict';
/**
 * Fila de jobs persistente — teste unitário (in-process) + integração HTTP.
 *
 * O que a fila precisa provar (Fase 1, "fila de jobs e estados persistentes"):
 *  - executa EM ORDEM, um por vez, mantendo tudo no SQLite;
 *  - handler que explode vira 'failed' com a mensagem, não derruba a fila;
 *  - cancelar funciona só para o que ainda está esperando ('queued');
 *  - reiniciar no meio deixa coisas óbvias, não zumbis: jobs parados viram
 *    'failed' com explicação, backups em 'creating'/'restoring' e setups em
 *    'running' são reconciliados junto (esses eram o ponto cego original);
 *  - o fluxo HTTP de backup/restore responde 202 com o job e o resultado
 *    final aparece na listagem — sem request pendurado no zip.
 *
 *   node tests/job-queue-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UNIT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-jobs-unit-'));
process.env.DATA_ROOT = path.join(UNIT_TMP, 'data');
process.env.JWT_SECRET = 'jobs-test';

let pass = 0;
let fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 8000, step = 60) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) return null;
    await sleep(step);
  }
}

(async () => {
  const { initDB, getDB, closeDB } = require('../src/db');
  const jobs = require('../src/services/jobQueue');
  await initDB();

  console.log('Unidade — ordem FIFO, um por vez:');
  const order = [];
  let releaseGate = null;
  jobs.registerHandler('t.step', async (job) => {
    order.push(job.payload.step);
    if (job.payload.step === 1) await new Promise((r) => { releaseGate = r; }); // segura o cronômetro da fila
  });
  jobs.enqueue('t.step', { subject: 'primeiro', payload: { step: 1 } });
  await waitFor(() => getDB().prepare("SELECT status FROM jobs WHERE subject = ? ").get('primeiro')?.status === 'running');
  const j2 = jobs.enqueue('t.step', { subject: 'segundo', payload: { step: 2 } });
  const j3 = jobs.enqueue('t.step', { subject: 'terceiro', payload: { step: 3 } });
  ok('externo à fila: 1º executando, 2º/3º esperando',
    getDB().prepare("SELECT status FROM jobs WHERE id = ?").get(j2.id).status === 'queued'
    && getDB().prepare("SELECT status FROM jobs WHERE id = ?").get(j3.id).status === 'queued');
  releaseGate();
  ok('ordem rigorosa FIFO', (await waitFor(() => order.length === 3 && order, 8000, 50))?.join(',') === '1,2,3',
    order.join(','));
  await waitFor(() => jobs.rowById(j3.id).status === 'done');
  ok('tudo termina em done', jobs.rowById(j3.id).status === 'done');

  console.log('\nUnidade — handler que falha vira failed:');
  jobs.registerHandler('t.boom', async () => { throw new Error('explosão simulada'); });
  const boom = jobs.enqueue('t.boom', { subject: 'vai falhar' });
  await waitFor(() => jobs.rowById(boom.id).status !== 'queued' && jobs.rowById(boom.id).status !== 'running');
  const boomRow = jobs.rowById(boom.id);
  ok('status failed', boomRow.status === 'failed', boomRow.status);
  ok('mensagem do erro guardada', boomRow.result.includes('explosão simulada'), boomRow.result);
  // A fila segue viva — um job vem DEPOIS da falha e roda normal:
  const after = jobs.enqueue('t.step', { subject: 'depois', payload: { step: 9 } });
  await waitFor(() => jobs.rowById(after.id).status === 'done');
  ok('fila continua após falha', jobs.rowById(after.id).status === 'done');

  console.log('\nUnidade — cancelamento só do que está na fila:');
  let release2 = null;
  let gatesRun = 0;
  jobs.registerHandler('t.gate', async () => {
    gatesRun += 1;
    await new Promise((r) => { release2 = r; });
  });
  const g1 = jobs.enqueue('t.gate', { subject: 'portão' });
  await waitFor(() => gatesRun === 1, 4000, 50);
  const g2 = jobs.enqueue('t.gate', { subject: 'que espera' });
  const cancelled = jobs.cancel(g2.id);
  ok('queued vira cancelled', cancelled.status === 'cancelled');
  let cancelRunningOk = false;
  try { jobs.cancel(g1.id); } catch (e) { cancelRunningOk = e.status === 409; }
  ok('running recusa com 409', cancelRunningOk);
  release2();
  await waitFor(() => jobs.rowById(g1.id).status === 'done');
  ok('cancelado nunca executa (o worker o ignora)', gatesRun === 1);

  console.log('\nUnidade — reconciliação de boot mata zumbis:');
  const db2 = getDB();
  db2.prepare("INSERT INTO jobs (id, type, subject, payload, status, started_at) VALUES ('z-1', 't.step', 'zumbi', '{}', 'running', CURRENT_TIMESTAMP)").run();
  db2.prepare("INSERT INTO jobs (id, type, subject, payload, status) VALUES ('z-2', 't.step', 'zumbi-fila', '{}', 'queued')").run();
  db2.prepare("INSERT INTO backups (service_id, name, filename, status) VALUES (1, 'bz', 'b.zip', 'creating')").run();
  db2.prepare("INSERT INTO services (name, command, setup_status) VALUES ('svc-zumbi', 'echo x', 'running')").run();
  jobs.reconcileBoot();
  ok('job running → failed com explicação',
    db2.prepare("SELECT status, result FROM jobs WHERE id = 'z-1'").get().result.includes('reinício'));
  ok('job queued → failed também', db2.prepare("SELECT status FROM jobs WHERE id = 'z-2'").get().status === 'failed');
  ok('backup creating → failed', db2.prepare("SELECT status FROM backups WHERE filename = 'b.zip'").get().status === 'failed');
  ok('setup running → failed', db2.prepare("SELECT setup_status FROM services WHERE name = 'svc-zumbi'").get().setup_status === 'failed');
  const listed = jobs.listJobs({ limit: 100 });
  ok('listJobs conta ativas', typeof listed.active === 'number' && listed.active === 0);

  closeDB();

  // ── Integração HTTP: backup criar/restaurar passa pela fila ────────────
  console.log('\nIntegração HTTP — backup via fila (202 + job + resultado na lista):');
  const PORT = 4260 + Math.floor(Math.random() * 6);
  const B = `http://127.0.0.1:${PORT}`;
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-jobs-http-'));
  let server;
  await new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env: { ...process.env, DATA_ROOT: path.join(TMP, 'data'), PORT: String(PORT), JWT_SECRET: 'test', HOME: TMP },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (d) => { out += d.toString(); if (out.includes('Pterodroid ouvindo')) resolve(); };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('exit', (c) => reject(new Error(`servidor saiu com ${c}:\n${out}`)));
    setTimeout(() => reject(new Error(`timeout:\n${out}`)), 30000);
  });

  const call = async (method, p, { token, body } = {}) => {
    const res = await fetch(`${B}${p}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };

  let r = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin' } });
  const token = r.data.token;
  // Sair da trava de setup — as rotas de negócio só abrem depois da senha trocada.
  r = await call('POST', '/api/auth/change-password', { token, body: { current: 'admin', next: 'senha-forte-para-testes' } });
  ok('destrava o setup (senha trocada)', r.status === 200, JSON.stringify(r.data));

  r = await call('GET', '/api/jobs');
  ok('fila exige autenticação', r.status === 401, `status ${r.status}`);

  r = await call('POST', '/api/services', {
    token,
    body: { name: 'svc-backup-teste', type: 'node', command: 'node app.js', run_setup: false, auto_start: false },
  });
  ok('cria serviço para o backup', r.status === 201, `${r.status}: ${JSON.stringify(r.data)}`);
  const svcId = r.data?.id;

  // Resolve o workspace e já deixa conteúdo dentro (o backup exige pasta não vazia).
  r = await call('POST', `/api/services/${svcId}/files/touch`, { token, body: { path: '', name: 'app.js' } });
  ok('workspace do serviço criado', [200, 201].includes(r.status), `${r.status}`);

  r = await call('POST', `/api/services/${svcId}/backups`, { token, body: { name: 'v1' } });
  ok('criar backup responde 202 com job', r.status === 202 && r.data?.job?.type === 'backup.create',
    `${r.status}: ${JSON.stringify(r.data)}`);
  const createJob = r.data?.job?.id;

  const doneJob = await waitFor(async () => {
    const found = await call('GET', `/api/jobs/${createJob}`, { token });
    return ['done', 'failed'].includes(found.data?.status) ? found.data : null;
  }, 20000, 250);
  ok('job de backup termina como done', doneJob?.status === 'done', JSON.stringify(doneJob));

  r = await call('GET', `/api/services/${svcId}/backups`, { token });
  ok('backup aparece pronto na listagem', r.data?.some?.((b) => b.status === 'ready' && b.name === 'v1'),
    JSON.stringify(r.data));
  const backupId = r.data?.find((b) => b.status === 'ready')?.id;

  r = await call('POST', `/api/services/${svcId}/backups/${backupId}/restore`, { token });
  ok('restaurar responde 202 com job', r.status === 202 && r.data?.job?.type === 'backup.restore',
    `${r.status}: ${JSON.stringify(r.data)}`);
  const restoreJob = r.data?.job?.id;
  const doneRestore = await waitFor(async () => {
    const found = await call('GET', `/api/jobs/${restoreJob}`, { token });
    return ['done', 'failed'].includes(found.data?.status) ? found.data : null;
  }, 20000, 250);
  ok('restauração termina como done', doneRestore?.status === 'done', JSON.stringify(doneRestore));

  r = await call('GET', '/api/jobs?type=backup.create', { token });
  ok('GET /api/jobs filtra por tipo', r.status === 200 && r.data.items.every((i) => i.type === 'backup.create'));

  r = await call('GET', '/api/audit?action=backup_criado', { token });
  ok('auditoria registra o backup feito pela fila', r.status === 200 && r.data.items.length >= 1,
    `items=${r.data?.items?.length}`);

  try { server?.kill('SIGKILL'); } catch { /* já morreu */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ok */ }
  try { fs.rmSync(UNIT_TMP, { recursive: true, force: true }); } catch { /* ok */ }

  console.log(`\n  Resultado: ${pass} ok, ${fail} falha(s)`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('  FALHA GRAVE:', err);
  try { fs.rmSync(UNIT_TMP, { recursive: true, force: true }); } catch { /* ok */ }
  process.exit(1);
});
