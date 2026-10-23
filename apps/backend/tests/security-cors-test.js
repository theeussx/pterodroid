#!/usr/bin/env node
'use strict';
/**
 * Integração de fronteira HTTP/WebSocket em produção.
 * Sobe o servidor real com dados descartáveis e uma allowlist explícita;
 * não usa credenciais reais nem grava artefatos no repositório.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 4070 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const ALLOWED = 'https://allowed.example.test';
const REJECTED = 'https://rejected.example.test';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-cors-'));
let server;
let pass = 0;
let fail = 0;

function ok(label, condition, detail = '') {
  if (condition) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}

function cleanup() {
  try { server?.kill('SIGTERM'); } catch { /* já encerrou */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ok */ }
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        CORS_ORIGINS: ALLOWED,
        DATA_ROOT: path.join(TMP, 'data'),
        DB_PATH: path.join(TMP, 'data', 'panel.db'),
        PORT: String(PORT),
        JWT_SECRET: 'integration-only-fixture',
        HOME: TMP,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes('Pterodroid ouvindo')) resolve();
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('exit', (code) => reject(new Error(`servidor saiu com ${code}: ${output}`)));
    setTimeout(() => reject(new Error(`timeout ao subir servidor: ${output}`)), 30000).unref();
  });
}

async function request(pathname, origin, extraHeaders = {}) {
  return fetch(`${BASE}${pathname}`, {
    headers: { Origin: origin, ...extraHeaders },
  });
}

function connectSocket(origin, token) {
  return new Promise((resolve) => {
    const socket = io(BASE, {
      transports: ['websocket'],
      auth: { token },
      extraHeaders: { Origin: origin },
      reconnection: false,
      timeout: 3000,
    });
    const timer = setTimeout(() => {
      socket.close();
      resolve({ connected: false, error: 'timeout' });
    }, 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.close();
      resolve({ connected: true });
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      resolve({ connected: false, error: error.message });
    });
  });
}

(async () => {
  await startServer();

  const allowedHealth = await request('/api/health', ALLOWED);
  const rejectedHealth = await request('/api/health', REJECTED);
  const forwardedHttps = await request('/api/health', ALLOWED, { 'X-Forwarded-Proto': 'https' });

  ok('CORS HTTP permite origem cadastrada', allowedHealth.headers.get('access-control-allow-origin') === ALLOWED);
  ok('CORS HTTP rejeita origem não cadastrada', !rejectedHealth.headers.get('access-control-allow-origin'));
  ok('Permissions-Policy é enviado', !!allowedHealth.headers.get('permissions-policy'));
  ok('CSP inclui frame-ancestors e WebSocket', /frame-ancestors 'self'/.test(allowedHealth.headers.get('content-security-policy') || '') && /connect-src[^;]*\bws:/.test(allowedHealth.headers.get('content-security-policy') || ''));
  ok('HSTS não é enviado em HTTP', !allowedHealth.headers.get('strict-transport-security'));
  ok('HSTS é enviado quando proxy informa HTTPS', /max-age=/.test(forwardedHttps.headers.get('strict-transport-security') || ''));

  const loginResponse = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { Origin: ALLOWED, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  });
  const login = await loginResponse.json();
  ok('login de fixture fornece token para o handshake', loginResponse.ok && typeof login.token === 'string');

  const accepted = await connectSocket(ALLOWED, login.token);
  const refused = await connectSocket(REJECTED, login.token);
  ok('handshake Socket.IO aceita origem permitida', accepted.connected, accepted.error);
  ok('handshake Socket.IO rejeita origem não permitida', !refused.connected, refused.error);

  cleanup();
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error('erro no teste:', error.message);
  cleanup();
  process.exit(1);
});
