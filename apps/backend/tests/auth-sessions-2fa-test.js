#!/usr/bin/env node
'use strict';
/**
 * Sessões revogáveis + 2FA TOTP — teste de integração (Fase 1).
 *
 * O que este teste protege (e por que precisa existir):
 *  - Todo token emitido carrega um jti que aponta para uma linha em
 *    `sessions`; revogar a linha derruba o token na próxima requisição —
 *    sem essa garantia, "encerrar sessões à distância" seria cosmético.
 *  - Tokens antigos (sem jti, emitidos por versões anteriores) NÃO podem
 *    continuar valendo em silêncio: ganham 401 com código claro para a UI
 *    pedir re-login.
 *  - O 2FA só fica ativo depois que o código certo foi apresentado ao
 *    endpoint de ativação; um segredo pendente não protege nem atrapalha
 *    o login. Códigos de recuperação são de uso único.
 *
 *   node tests/auth-sessions-2fa-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4110 + Math.floor(Math.random() * 8);
const B = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-sec-'));
const totp = require('../src/services/totp'); // gera códigos válidos pro fluxo
const jwt = require('jsonwebtoken');

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

const call = async (method, urlPath, { token, body, userAgent = 'sessoes-test/1.0' } = {}) => {
  const res = await fetch(`${B}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'user-agent': userAgent,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
};

const login = (password = 'admin', extra = {}) =>
  call('POST', '/api/auth/login', { body: { username: 'admin', password, ...extra } });

(async () => {
  await startServer();

  console.log('Sessões: emissão, listagem e revogação imediata');
  let r = await login('admin');
  ok('login emite token', r.status === 200 && !!r.data?.token, `status ${r.status}`);
  const tokenA = r.data.token;

  r = await call('GET', '/api/auth/sessions', { token: tokenA });
  ok('lista de sessões tem a sessão atual', r.status === 200 && r.data.count === 1 && r.data.items[0].current,
    JSON.stringify(r.data));

  // Segundo dispositivo (outro user-agent) → segunda sessão.
  const second = await fetch(`${B}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'celular/1.0' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  });
  const tokenB = (await second.json()).token;
  ok('segundo login cria segunda sessão', !!tokenB);

  r = await call('GET', '/api/auth/sessions', { token: tokenB, userAgent: 'celular/1.0' });
  ok('agora são duas sessões', r.data.count === 2, `count=${r.data.count}`);
  const jtiA = r.data.items.find((s) => !s.current).jti;

  r = await call('DELETE', `/api/auth/sessions/${jtiA}`, { token: tokenB, userAgent: 'celular/1.0' });
  ok('revogação pela lista responde 200', r.status === 200);
  r = await call('GET', '/api/auth/me', { token: tokenA });
  ok('token revogado morre na hora (401)', r.status === 401, `status ${r.status}`);
  ok('código de erro explica que a sessão foi encerrada', r.data?.code === 'SESSION_REVOKED', r.data?.code);

  console.log('\nTokens antigos (sem jti) não passam:');
  const legacy = jwt.sign({ id: 1, username: 'admin' }, 'test', { expiresIn: '1h' });
  r = await call('GET', '/api/auth/me', { token: legacy });
  ok('token legado → 401', r.status === 401, `status ${r.status}`);
  ok('código orienta relogin', r.data?.code === 'SESSION_UPGRADE_REQUIRED', r.data?.code);

  console.log('\nEncerrar todas as outras sessões + troca de senha:');
  const tokenC = (await login()).data.token;
  r = await call('POST', '/api/auth/sessions/revoke-others', { token: tokenC });
  ok('revoke-others encerra as demais', r.status === 200 && r.data.revoked >= 1, JSON.stringify(r.data));
  r = await call('GET', '/api/auth/me', { token: tokenB, userAgent: 'celular/1.0' });
  ok('sessão encerrada pelo revoke-others cai', r.status === 401, `status ${r.status}`);
  r = await call('GET', '/api/auth/me', { token: tokenC });
  ok('a sessão que pediu continua viva', r.status === 200);

  // Outra sessão viva no momento da troca de senha deve morrer.
  const tokenD = (await login('admin')).data.token;
  r = await call('POST', '/api/auth/change-password', {
    token: tokenC,
    body: { current: 'admin', next: 'outrasenha-forte-1' },
  });
  ok('troca de senha bem-sucedida', r.status === 200, `status ${r.status} ${JSON.stringify(r.data)}`);
  r = await call('GET', '/api/auth/me', { token: tokenD });
  ok('sessões anteriores à troca caem', r.status === 401, `status ${r.status}`);

  console.log('\n2FA: ativação, obrigatoriedade e uso:');
  r = await call('GET', '/api/auth/2fa/status', { token: tokenC });
  ok('status inicial: 2FA desativado', r.status === 200 && r.data.enabled === false);
  ok('login sem código ainda passa (2FA inativo)', (await login('outrasenha-forte-1')).status === 200);

  r = await call('POST', '/api/auth/2fa/setup', { token: tokenC });
  ok('setup devolve segredo e URI otpauth', r.status === 200 && !!r.data.secret && r.data.uri.startsWith('otpauth://'),
    JSON.stringify(r.data));
  const secret = r.data.secret;

  // Só gerar o segredo NÃO pode ativar o 2FA:
  r = await login('outrasenha-forte-1');
  ok('segredo pendente não exige código no login', r.status === 200, `status ${r.status}`);
  const tokenE = r.data.token;

  r = await call('POST', '/api/auth/2fa/enable', { token: tokenE, body: { token: '000000' } });
  ok('código errado não ativa', r.status === 400, `status ${r.status}`);

  // Gera o código do instante com o próprio serviço (mesmo relógio do servidor).
  const codeNow = totp.totpAt(secret);
  r = await call('POST', '/api/auth/2fa/enable', { token: tokenE, body: { token: codeNow } });
  ok('código certo ativa e devolve 8 códigos de recuperação', r.status === 200 && r.data.recoveryCodes?.length === 8,
    JSON.stringify(Object.keys(r.data || {})));
  const recovery = r.data.recoveryCodes || [];

  r = await login('outrasenha-forte-1');
  ok('login sem código agora é barrado', r.status === 401 && r.data?.code === 'TOTP_REQUIRED', `status ${r.status}`);

  r = await login('outrasenha-forte-1', { totp: '000000' });
  ok('código errado é recusado', r.status === 401, `status ${r.status}`);

  // O verify aceita a janela atual e vizinhas (tolerância de relógio);
  // gerar o código "agora" neste momento do teste sempre está coberto.
  r = await login('outrasenha-forte-1', { totp: totp.totpAt(secret) });
  ok('código certo entra', r.status === 200, `status ${r.status}`);
  const tokenF = r.data?.token;

  console.log('\n2FA: códigos de recuperação de uso único:');
  ok('recuperação em formato XXXX-XXXX', recovery.every((c) => /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(c)));
  r = await login('outrasenha-forte-1', { totp: recovery[0] });
  ok('código de recuperação entra', r.status === 200, `status ${r.status}`);
  r = await login('outrasenha-forte-1', { totp: recovery[0] });
  ok('o MESMO código de recuperação não entra de novo', r.status === 401, `status ${r.status}`);

  console.log('\n2FA: regenerar e desativar pedem a senha:');
  r = await call('POST', '/api/auth/2fa/recovery-codes', { token: tokenF, body: { current: 'senha-errada' } });
  ok('regenerar com senha errada é recusado', r.status === 401, `status ${r.status}`);
  r = await call('POST', '/api/auth/2fa/recovery-codes', { token: tokenF, body: { current: 'outrasenha-forte-1' } });
  ok('regenerar devolve lote novo', r.status === 200 && r.data.recoveryCodes?.length === 8);
  const novoLatch = r.data.recoveryCodes[0];
  r = await login('outrasenha-forte-1', { totp: recovery[1] });
  ok('lote antigo perde a validade', r.status === 401, `status ${r.status}`);
  r = await login('outrasenha-forte-1', { totp: novoLatch });
  ok('lote novo funciona', r.status === 200, `status ${r.status}`);

  r = await call('POST', '/api/auth/2fa/disable', { token: tokenF, body: { current: 'outrasenha-forte-1' } });
  ok('desativar com a senha funciona', r.status === 200, `status ${r.status}`);
  r = await login('outrasenha-forte-1');
  ok('desativado, o login volta a não pedir código', r.status === 200, `status ${r.status}`);

  console.log('\nAuditoria central:');
  const tokenG = (await login('outrasenha-forte-1')).data.token;
  r = await call('GET', '/api/audit?action=login_sucesso&limit=50', { token: tokenG });
  ok('consulta por ação responde itens', r.status === 200 && r.data.items.length > 0, `status ${r.status}`);
  ok('registros carregam usuário e ip', r.data.items.every((i) => 'username' in i && 'ip' in i));
  ok('a lista de ações distintas acompanha', Array.isArray(r.data.actions) && r.data.actions.includes('login_sucesso'));
  r = await call('GET', `/api/audit?q=${encodeURIComponent('recuperação')}&limit=10`, { token: tokenG });
  ok('busca textual alcança o rastro de 2FA', r.status === 200 && r.data.items.length > 0, `total=${r.data?.total}`);
  r = await call('GET', '/api/audit', { token: 'lixo' });
  ok('auditoria exige autenticação', r.status === 401, `status ${r.status}`);

  console.log(`\n  Resultado: ${pass} ok, ${fail} falha(s)`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('  FALHA GRAVE:', err);
  cleanup();
  process.exit(1);
});
