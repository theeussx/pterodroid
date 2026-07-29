'use strict';

const fs = require('fs');
const path = require('path');
const { getDB } = require('../db');
const config = require('../config');
const { DockerEngine, parseDockerHost } = require('./dockerEngine');

// Uma instância DockerEngine por host cadastrado, reaproveitada entre
// requests — abrir uma conexão HTTP nova a cada chamada seria desperdício,
// e pro caso TCP remoto pode ser bem mais lento.
const clients = new Map();

function rowToClient(row) {
  const cached = clients.get(row.id);
  // A conexão do host pode ter sido editada — reaproveitar um client
  // apontando pro endereço antigo faria o painel falar com a máquina
  // errada em silêncio.
  if (cached && cached.connection === row.connection) return cached.engine;

  const conn = parseDockerHost(row.connection);
  const tls = row.tls_ca ? { ca: row.tls_ca, cert: row.tls_cert, key: row.tls_key } : null;
  // apiVersion vinha do default do client e ignorava a configuração —
  // DOCKER_API_VERSION existia no config.js sem nenhum efeito (P19).
  const engine = new DockerEngine({ ...conn, tls, apiVersion: config.DOCKER_API_VERSION });
  clients.set(row.id, { connection: row.connection, engine });
  return engine;
}

function invalidate(hostId) {
  clients.delete(hostId);
}

function listHosts() {
  const db = getDB();
  return db.prepare('SELECT id, name, connection, is_default, last_ping_ok, last_ping_at, created_at FROM docker_hosts ORDER BY created_at ASC').all();
}

function ensureDefaultHost() {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM docker_hosts WHERE is_default = 1 LIMIT 1').get();
  if (existing) return existing.id;

  const candidates = [];
  const envHost = process.env.DOCKER_HOST || process.env.DOCKER_DEFAULT_HOST;
  if (envHost) candidates.push(envHost);

  const socketCandidates = [
    '/var/run/docker.sock',
    path.join(process.env.HOME || '', '.docker', 'docker.sock'),
    '/run/docker.sock',
  ];
  for (const socketPath of socketCandidates) {
    if (fs.existsSync(socketPath)) {
      candidates.push(`unix://${socketPath}`);
      break;
    }
  }

  const connection = candidates[0] || 'unix:///var/run/docker.sock';
  try {
    parseDockerHost(connection);
  } catch (err) {
    return null;
  }

  const result = db.prepare(`
    INSERT INTO docker_hosts (name, connection, is_default, last_ping_ok)
    VALUES (?, ?, 1, 0)
  `).run('Local Docker', connection);
  return result.lastInsertRowid;
}

function getHostRow(id) {
  const db = getDB();
  return db.prepare('SELECT * FROM docker_hosts WHERE id = ?').get(id);
}

function addHost({ name, connection, tls_ca = null, tls_cert = null, tls_key = null, is_default = false }) {
  if (!name?.trim()) throw new Error('Nome é obrigatório');
  if (!connection?.trim()) throw new Error('Endereço de conexão é obrigatório');
  parseDockerHost(connection); // valida o formato cedo, antes de gravar algo inválido

  const db = getDB();
  if (is_default) db.prepare('UPDATE docker_hosts SET is_default = 0').run();
  const result = db.prepare(`
    INSERT INTO docker_hosts (name, connection, tls_ca, tls_cert, tls_key, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name.trim(), connection.trim(), tls_ca, tls_cert, tls_key, is_default ? 1 : 0);

  return getHostRow(result.lastInsertRowid);
}

function removeHost(id) {
  invalidate(id);
  const db = getDB();
  db.prepare('DELETE FROM docker_hosts WHERE id = ?').run(id);
}

/** Testa a conexão de verdade e atualiza o status salvo — é o que dá pra "tela amigável" do brief em vez de um erro cru. */
async function pingHost(id) {
  const row = getHostRow(id);
  if (!row) throw new Error('Host não encontrado');
  const db = getDB();
  const engine = rowToClient(row);
  try {
    const info = await engine.version();
    db.prepare('UPDATE docker_hosts SET last_ping_ok = 1, last_ping_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return { ok: true, info };
  } catch (err) {
    db.prepare('UPDATE docker_hosts SET last_ping_ok = 0, last_ping_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return { ok: false, error: err.message };
  }
}

function engineFor(id) {
  const row = getHostRow(id);
  if (!row) throw new Error('Host não encontrado');
  return rowToClient(row);
}

module.exports = { listHosts, getHostRow, addHost, removeHost, pingHost, engineFor, invalidate, ensureDefaultHost };
