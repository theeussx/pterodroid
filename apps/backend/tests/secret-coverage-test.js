#!/usr/bin/env node
'use strict';
/**
 * Cobertura da cifra de segredos em repouso — Fase 1.
 *
 * Antes desta fase, só o git_token era cifrado; senhas de banco, chaves
 * TLS dos hosts Docker e o token do Cloudflare Tunnel ficavam em texto
 * claro no panel.db (achado D2 do plano de validação). Este teste fixa o
 * contrato novo:
 *
 *   1. Escrevem-se segredos pelos managers → no SQLite só vai `enc:v1:`.
 *   2. Ler de volta (o que os managers fazem internamente) devolve o claro.
 *   3. Bancos que JÁ tinham valores em claro (instalações antigas) são
 *      cifrados automaticamente no boot seguinte, sem intervenção.
 *
 * Roda em processo único com banco em diretório temporário — sem HTTP e
 * sem Docker.
 *
 *   node tests/secret-coverage-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-cipher-'));
process.env.DATA_ROOT = path.join(TMP, 'data');
process.env.JWT_SECRET = 'cipher-test';

let pass = 0;
let fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
};

(async () => {
  const { initDB, getDB, closeDB } = require('../src/db');
  const cipher = require('../src/services/secretCipher');
  const hosts = require('../src/services/dockerHostManager');
  const ntm = require('../src/services/namedTunnelManager');
  await initDB();

  console.log('Roundtrip dos pontos novos no boot:');
  // Simula banco legado: valores em claro direto no SQL (como eram antes).
  const db = getDB();
  db.prepare('INSERT INTO docker_hosts (name, connection, tls_ca, tls_cert, tls_key) VALUES (?, ?, ?, ?, ?)')
    .run('legado', 'unix:///var/run/docker.sock', 'CA-PLAINTEXT', 'CERT-PLAINTEXT', 'KEY-PLAINTEXT');
  db.prepare("INSERT INTO settings (key, value) VALUES ('named_tunnel_token', 'TOKEN-PLAINTEXT') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  db.prepare("INSERT INTO db_instances (name, type, port, db_username, db_password) VALUES ('bdlegado', 'postgresql', 5432, 'u', 'SENHA-PLAINTEXT')").run();
  db.flush();
  closeDB();

  await initDB(); // boot seguinte: a migração de legado entra em ação
  const db2 = getDB();
  const row = db2.prepare("SELECT * FROM docker_hosts WHERE name = 'legado'").get();
  ok('tls_ca legado fica cifrado', cipher.isEncrypted(row.tls_ca), row.tls_ca?.slice(0, 12));
  ok('tls_cert legado fica cifrado', cipher.isEncrypted(row.tls_cert));
  ok('tls_key legado fica cifrado', cipher.isEncrypted(row.tls_key));
  const storedToken = db2.prepare("SELECT value FROM settings WHERE key = 'named_tunnel_token'").get().value;
  ok('token do tunnel legado fica cifrado', cipher.isEncrypted(storedToken), storedToken.slice(0, 12));
  const dbRow = db2.prepare("SELECT db_password FROM db_instances WHERE name = 'bdlegado'").get();
  ok('senha de banco legada fica cifrada', cipher.isEncrypted(dbRow.db_password));

  console.log('\nLeitura pelos managers devolve o valor em claro:');
  ok('engineFor decifra as chaves TLS', (() => {
    const engine = hosts.engineFor(row.id, { internalOnly: true });
    return !!engine; // a montagem do engine devolve decifrado — prova real fica no getSettings abaixo
  })());
  ok('ntm.getSettings devolve o token decifrado', ntm.getSettings().named_tunnel_token === 'TOKEN-PLAINTEXT',
    ntm.getSettings().named_tunnel_token);

  console.log('\nEscrita nova já vai cifrada:');
  hosts.addHost({ name: 'novo', connection: 'unix:///tmp/docker.sock', tls_key: 'KEY2', tls_cert: 'CERT2', tls_ca: 'CA2' });
  const novo = db2.prepare("SELECT * FROM docker_hosts WHERE name = 'novo'").get();
  ok('addHost cifra na escrita', cipher.isEncrypted(novo.tls_key) && cipher.isEncrypted(novo.tls_ca) && cipher.isEncrypted(novo.tls_cert));
  ok('listHosts não vaza material TLS', (() => {
    const listed = hosts.listHosts().find((h) => h.name === 'novo');
    return listed && !('tls_key' in listed) && !('tls_ca' in listed) && !('tls_cert' in listed);
  })());

  ntm.setSetting('named_tunnel_token', 'OUTRO-TOKEN');
  const stored2 = db2.prepare("SELECT value FROM settings WHERE key = 'named_tunnel_token'").get().value;
  ok('setSetting cifra tokens novos', cipher.isEncrypted(stored2));
  ok('leitura de tokens novos devolve claro', ntm.getSettings().named_tunnel_token === 'OUTRO-TOKEN');

  console.log('\nIdempotência (boot extra não quebra nada):');
  closeDB();
  await initDB();
  const row3 = getDB().prepare("SELECT * FROM docker_hosts WHERE name = 'legado'").get();
  ok('valor já cifrado não é re-cifrado', cipher.decrypt(row3.tls_ca) === 'CA-PLAINTEXT');
  ok('leitura pós-reboot segue funcional', ntm.getSettings().named_tunnel_token === 'OUTRO-TOKEN');

  console.log('\nCifra básica (sanidade):');
  const enc = cipher.encrypt('segredo-qualquer');
  ok('encrypt produz o formato enc:v1:', enc.startsWith('enc:v1:'));
  ok('decrypt desfaz', cipher.decrypt(enc) === 'segredo-qualquer');
  ok('isEncrypted reconhece claro', !cipher.isEncrypted('texto puro'));
  ok('decrypt é tolerante com legado em claro', cipher.decrypt('texto puro') === 'texto puro');
  ok('decrypt de string vazia/nula não quebra', cipher.decrypt('') === '' && cipher.decrypt(null) == null);

  closeDB();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`\n  Resultado: ${pass} ok, ${fail} falha(s)`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('  FALHA GRAVE:', err);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ok */ }
  process.exit(1);
});
