#!/usr/bin/env node
'use strict';
/**
 * Segurança da autenticação — teste de integração.
 *
 * Antes de existir o freio de login, foi medido neste projeto: ~12
 * tentativas de senha por segundo (~45 mil por hora), sem nenhum bloqueio.
 * Com o terminal embutido no painel, adivinhar a senha passou a significar
 * execução de comandos no dispositivo — então este teste existe para
 * garantir que o freio não seja removido por acidente numa refatoração.
 *
 *   node tests/auth-security-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3970 + Math.floor(Math.random() * 8);
const B = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-auth-'));

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

async function login(password, username = 'admin') {
  const res = await fetch(`${B}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, retryAfter: res.headers.get('retry-after') };
}

(async () => {
  await startServer();

  console.log('Login básico:');
  let r = await login('admin');
  ok('senha correta autentica', r.status === 200 && !!r.data.token);
  const token = r.data.token;

  r = await login('errada');
  ok('senha errada dá 401', r.status === 401, `status ${r.status}`);
  ok('mensagem não revela se o usuário existe', !/usuário não|not found|inexistente/i.test(r.data.error || ''),
    r.data?.error);

  const inexistente = await login('x', 'usuario-que-nao-existe');
  ok('usuário inexistente responde igual', inexistente.data?.error === r.data?.error,
    `${inexistente.data?.error} vs ${r.data?.error}`);

  console.log('\nFreio de força bruta:');
  // Chave é IP+usuário, então um usuário diferente tem contador próprio.
  const alvo = 'vitima-bruteforce';
  let blocked = null;
  let attempts = 0;
  for (let i = 0; i < 15; i += 1) {
    const res = await login(`tentativa-${i}`, alvo);
    attempts += 1;
    if (res.status === 429) { blocked = res; break; }
  }
  ok('bloqueia após tentativas repetidas', blocked !== null, `${attempts} tentativas sem bloqueio`);
  ok('bloqueio acontece antes de 15 tentativas', attempts <= 12, `precisou de ${attempts}`);
  ok('responde 429 (limite de requisições)', blocked?.status === 429);
  ok('envia cabeçalho Retry-After', !!blocked?.retryAfter, `retry-after: ${blocked?.retryAfter}`);
  ok('mensagem explica a espera', /minuto/i.test(blocked?.data?.error || ''), blocked?.data?.error);

  // Mesmo com a senha CERTA o bloqueio vale — senão o atacante saberia que
  // acertou justamente porque a resposta mudaria.
  const durante = await login('admin', alvo);
  ok('bloqueio vale mesmo para a senha certa', durante.status === 429, `status ${durante.status}`);

  console.log('\nO bloqueio é isolado (não derruba o dono do painel):');
  const dono = await login('admin');
  ok('outro usuário continua entrando', dono.status === 200, `status ${dono.status}`);

  console.log('\nAtraso progressivo (antes do bloqueio):');
  const alvo2 = 'alvo-lento';
  const tempos = [];
  for (let i = 0; i < 6; i += 1) {
    const t0 = Date.now();
    await login(`p${i}`, alvo2);
    tempos.push(Date.now() - t0);
  }
  // As primeiras têm franquia; as últimas devem custar visivelmente mais.
  const primeiras = (tempos[0] + tempos[1]) / 2;
  const ultimas = (tempos[4] + tempos[5]) / 2;
  ok('tentativas erradas ficam progressivamente mais lentas', ultimas > primeiras + 200,
    `início ~${Math.round(primeiras)}ms, depois ~${Math.round(ultimas)}ms`);

  console.log('\nTroca de senha:');
  const chg = async (current, next) => {
    const res = await fetch(`${B}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ current, next }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  let c = await chg('admin', 'curta');
  ok('recusa senha com menos de 8 caracteres', c.status === 400, `status ${c.status}`);
  c = await chg('admin', 'admin');
  ok('recusa nova senha igual à atual', c.status === 400, `status ${c.status}`);
  c = await chg('senha-errada', 'senha-nova-forte');
  ok('recusa senha atual incorreta', c.status === 401, `status ${c.status}`);

  const me1 = await (await fetch(`${B}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  ok('configuração pendente enquanto a senha é a padrão', me1.setupDone === false, JSON.stringify(me1));

  c = await chg('admin', 'senha-nova-forte');
  ok('aceita senha válida', c.status === 200, JSON.stringify(c.data));

  const me2 = await (await fetch(`${B}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  ok('trocar a senha conclui a configuração', me2.setupDone === true, JSON.stringify(me2));

  r = await login('senha-nova-forte');
  ok('entra com a senha nova', r.status === 200);
  r = await login('admin');
  ok('senha antiga deixa de funcionar', r.status === 401, `status ${r.status}`);

  console.log('\nNão há atalho para silenciar o aviso de senha padrão:');
  const atalho = await fetch(`${B}/api/settings/complete-setup`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  ok('rota /complete-setup não existe mais', atalho.status === 404, `status ${atalho.status}`);

  console.log('\nToken:');
  const semToken = await fetch(`${B}/api/services`);
  ok('rota protegida exige token', semToken.status === 401);
  const tokenFalso = await fetch(`${B}/api/services`, { headers: { Authorization: 'Bearer inventado.abc.123' } });
  ok('token inválido é rejeitado', tokenFalso.status === 401);

  cleanup();
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('erro no teste:', e); cleanup(); process.exit(1); });
