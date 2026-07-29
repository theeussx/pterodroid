#!/usr/bin/env node
'use strict';
/**
 * Terminal do serviço — teste de integração ponta a ponta.
 *
 * Sobe o backend real numa porta separada com dados descartáveis e exercita
 * o terminal do jeito que o frontend faz: comandos por HTTP, saída chegando
 * por socket.io. Cobre o que é fácil quebrar sem perceber — persistência de
 * cwd/env entre comandos, separação de stdout/stderr, Ctrl+C atingindo só o
 * comando (e não a sessão) e o teto de saída.
 *
 *   node tests/terminal-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3990 + Math.floor(Math.random() * 8);
const B = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-term-'));

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
    setTimeout(() => reject(new Error(`timeout ao subir o servidor:\n${out}`)), 30000);
  });
}
function cleanup() {
  try { server?.kill('SIGKILL'); } catch { /* já morreu */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ok */ }
}



let pass = 0, fail = 0;
const ok = (l, c, d = '') => { c ? (pass++, console.log(`  ✅ ${l}`)) : (fail++, console.log(`  ❌ ${l}${d ? ` — ${d}` : ''}`)); };

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${B}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

(async () => {
  await startServer();

  const { data: login } = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin' } });
  const token = login.token;

  const { data: svc } = await api('/services', {
    method: 'POST', token,
    body: { name: 'Terminal Demo', command: 'node index.js', type: 'node', runtime_type: 'process' },
  });
  console.log(`serviço #${svc.id} em ${svc.working_directory}\n`);

  const socket = io(B, { auth: { token } });
  const chunks = [];
  socket.on('terminal:data', (p) => chunks.push(p));
  const exits = [];
  socket.on('terminal:exit', (p) => exits.push(p));
  await new Promise((r) => socket.on('connect', r));

  console.log('Abertura de sessão:');
  const { data: session, status } = await api(`/services/${svc.id}/terminal`, { method: 'POST', token });
  ok('sessão criada', status === 200 && !!session.id, JSON.stringify(session));
  ok('cwd é o workspace do serviço', session.cwd === svc.working_directory, session.cwd);
  const sid = session.id;

  const runAndWait = async (command, ms = 1500) => {
    chunks.length = 0; exits.length = 0;
    const r = await api(`/services/${svc.id}/terminal/${sid}/exec`, { method: 'POST', token, body: { command } });
    if (r.status !== 200) return { error: r.data?.error, text: '', exit: null };
    await new Promise((res) => {
      const t = setInterval(() => { if (exits.length) { clearInterval(t); res(); } }, 50);
      setTimeout(() => { clearInterval(t); res(); }, ms);
    });
    return {
      text: chunks.filter((c) => c.stream === 'stdout' || c.stream === 'stderr').map((c) => c.text).join(''),
      exit: exits[0] || null,
      chunks: [...chunks],
    };
  };

  console.log('\nExecução básica:');
  let r = await runAndWait('echo ola mundo');
  ok('saída chega pelo socket', r.text.includes('ola mundo'), JSON.stringify(r.text));
  ok('código de saída 0', r.exit?.code === 0, JSON.stringify(r.exit));
  ok('eco do comando digitado', r.chunks.some((c) => c.stream === 'input' && c.text.includes('echo ola mundo')));

  r = await runAndWait('pwd');
  ok('roda dentro do workspace', r.text.trim() === svc.working_directory, r.text.trim());

  console.log('\nstderr separado de stdout:');
  r = await runAndWait('echo saida; echo erro >&2');
  ok('stdout capturado', r.chunks.some((c) => c.stream === 'stdout' && c.text.includes('saida')));
  ok('stderr capturado à parte', r.chunks.some((c) => c.stream === 'stderr' && c.text.includes('erro')));

  console.log('\nCódigo de erro:');
  r = await runAndWait('comando-que-nao-existe-xyz');
  ok('código != 0 em falha', r.exit && r.exit.code !== 0, JSON.stringify(r.exit));
  ok('mensagem do shell aparece', /not found|não encontrado/i.test(r.text), JSON.stringify(r.text));

  console.log('\nEstado persiste entre comandos:');
  await runAndWait('mkdir -p sub/dir');
  r = await runAndWait('cd sub/dir');
  ok('cd muda o cwd da sessão', r.exit?.cwd.endsWith('sub/dir'), r.exit?.cwd);
  r = await runAndWait('pwd');
  ok('próximo comando herda o cwd', r.text.trim().endsWith('sub/dir'), r.text.trim());
  await runAndWait('cd ../..');
  r = await runAndWait('export MINHA_VAR=abc123');
  r = await runAndWait('echo $MINHA_VAR');
  ok('variável exportada persiste', r.text.includes('abc123'), JSON.stringify(r.text));

  console.log('\nCtrl+C interrompe só o comando:');
  chunks.length = 0; exits.length = 0;
  await api(`/services/${svc.id}/terminal/${sid}/exec`, { method: 'POST', token, body: { command: 'echo iniciou; sleep 20; echo NAO_DEVERIA' } });
  await new Promise((r2) => setTimeout(r2, 600));
  const { data: intr } = await api(`/services/${svc.id}/terminal/${sid}/interrupt`, { method: 'POST', token });
  ok('interrupt aceito', intr.ok === true);
  await new Promise((r2) => setTimeout(r2, 600));
  // Só stdout: o eco do comando ('input') naturalmente contém a string.
  const stdoutOnly = chunks.filter((c) => c.stream === 'stdout').map((c) => c.text).join('');
  ok('comando foi interrompido', stdoutOnly.includes('iniciou') && !stdoutOnly.includes('NAO_DEVERIA'),
    JSON.stringify(stdoutOnly));
  r = await runAndWait('echo sessao_viva');
  ok('sessão sobrevive ao Ctrl+C', r.text.includes('sessao_viva'), JSON.stringify(r.text));

  console.log('\nUm comando por vez:');
  await api(`/services/${svc.id}/terminal/${sid}/exec`, { method: 'POST', token, body: { command: 'sleep 3' } });
  const busy = await api(`/services/${svc.id}/terminal/${sid}/exec`, { method: 'POST', token, body: { command: 'echo x' } });
  ok('segundo comando é recusado com 409', busy.status === 409, `status ${busy.status}`);
  await api(`/services/${svc.id}/terminal/${sid}/interrupt`, { method: 'POST', token });
  await new Promise((r2) => setTimeout(r2, 400));

  console.log('\nHistórico e isolamento:');
  const { data: state } = await api(`/services/${svc.id}/terminal/${sid}`, { token });
  ok('scrollback preservado', Array.isArray(state.scrollback) && state.scrollback.length > 5, `${state.scrollback?.length} linhas`);
  const outra = await api(`/services/999/terminal/${sid}`, { token });
  ok('sessão de outro serviço dá 404', outra.status === 404, `status ${outra.status}`);
  const semToken = await fetch(`${B}/api/services/${svc.id}/terminal`, { method: 'POST' });
  ok('exige autenticação', semToken.status === 401, `status ${semToken.status}`);

  console.log('\nSaída longa é truncada (proteção de memória):');
  r = await runAndWait('for i in $(seq 1 200000); do echo "linha muito longa de preenchimento $i"; done', 6000);
  ok('truncou em vez de estourar', r.chunks.some((c) => c.stream === 'system' && c.text.includes('truncada')));

  console.log('\nEncerramento:');
  const { data: closed } = await api(`/services/${svc.id}/terminal/${sid}`, { method: 'DELETE', token });
  ok('sessão encerrada', closed.ok === true);
  const gone = await api(`/services/${svc.id}/terminal/${sid}`, { token });
  ok('sessão some depois de fechada', gone.status === 404);

  socket.close();
  cleanup();
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('erro no teste:', e); cleanup(); process.exit(1); });
