#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const totp = require('../src/services/totp');

const PORT = 4010 + Math.floor(Math.random() * 8);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-terminal-policy-'));
let server;
let pass = 0;
let fail = 0;
const ok = (label, condition, detail = '') => {
  if (condition) pass += 1;
  else { fail += 1; console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};

function startServer(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env: { ...process.env, DATA_ROOT: path.join(TMP, 'data'), PORT: String(PORT), JWT_SECRET: 'policy-test', HOME: TMP, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes('Pterodroid ouvindo')) resolve();
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.once('exit', (code) => reject(new Error(`servidor saiu com ${code}:\n${output}`)));
    setTimeout(() => reject(new Error(`timeout ao subir servidor:\n${output}`)), 30000);
  });
}

async function stopServer() {
  if (!server) return;
  const current = server;
  server = null;
  await new Promise((resolve) => {
    current.once('exit', resolve);
    current.kill('SIGTERM');
    setTimeout(() => { try { current.kill('SIGKILL'); } catch {} resolve(); }, 5000);
  });
}

async function api(route, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${BASE}/api${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

(async () => {
  await startServer();
  let r = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin' } });
  let token = r.data.token;
  r = await api('/auth/change-password', { method: 'POST', token, body: { current: 'admin', next: 'policy-pass-123' } });
  ok('setup inicial concluído', r.status === 200);
  r = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'policy-pass-123' } });
  token = r.data.token;
  r = await api('/services', { method: 'POST', token, body: { name: 'Policy service', command: 'node index.js', type: 'node', runtime_type: 'process' } });
  const serviceId = r.data.id;
  r = await api(`/services/${serviceId}/terminal`, { method: 'POST', token });
  ok('terminal sem 2FA permanece compatível', r.status === 200 && !!r.data.id, JSON.stringify(r.data));
  if (r.status === 200) await api(`/services/${serviceId}/terminal/${r.data.id}`, { method: 'DELETE', token });

  r = await api('/auth/2fa/setup', { method: 'POST', token });
  const secret = r.data.secret;
  r = await api('/auth/2fa/enable', { method: 'POST', token, body: { token: totp.totpAt(secret) } });
  ok('2FA ativado', r.status === 200);
  r = await api(`/services/${serviceId}/terminal`, { method: 'POST', token });
  ok('token anterior à ativação não abre terminal', r.status === 403 && r.data.code === 'TOTP_REQUIRED', JSON.stringify(r.data));
  r = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'policy-pass-123' } });
  ok('login sem TOTP continua sendo recusado', r.status === 401 && r.data.code === 'TOTP_REQUIRED');
  r = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'policy-pass-123', totp: totp.totpAt(secret) } });
  const verifiedToken = r.data.token;
  ok('login com TOTP fornece sessão válida', r.status === 200 && !!verifiedToken);
  r = await api(`/services/${serviceId}/terminal`, { method: 'POST', token: verifiedToken });
  ok('sessão com TOTP abre terminal', r.status === 200 && !!r.data.id, JSON.stringify(r.data));

  await stopServer();
  await startServer({ WEB_TERMINAL_ENABLED: 'false' });
  r = await api('/auth/me', { token: verifiedToken });
  ok('desabilitar terminal não desabilita autenticação', r.status === 200);
  r = await api(`/services/${serviceId}/terminal`, { method: 'GET', token: verifiedToken });
  ok('terminal desabilitado não revela endpoint', r.status === 404 && r.data.error === 'Recurso não encontrado', JSON.stringify(r.data));

  await stopServer();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`Terminal policy: ${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch(async (error) => {
  console.error(error);
  await stopServer();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
});
