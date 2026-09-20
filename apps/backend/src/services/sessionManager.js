'use strict';
/**
 * sessionManager — sessões JWT revogáveis.
 *
 * O QUE MUDA EM RELAÇÃO AO JWT PURO
 * ─────────────────────────────────
 * Um JWT assinado vale até expirar: roubado, não há o que fazer senão
 * esperar 7 dias. Com sessões, cada token carrega um `jti` (UUID) que
 * aponta para uma linha na tabela `sessions` — revogar a linha mata o
 * token na próxima requisição, em qualquer dispositivo.
 *
 * DECISÕES
 * ────────
 *  - **Estado no SQLite do próprio painel.** Painel single-user: meia
 *    dúzia de sessões por instalação. Nada de Redis.
 *  - **Verificação síncrona e barata.** O sql.js responde o SELECT do jti
 *    em microssegundos; o custo por requisição é desprezível.
 *  - **`touch` com folga de 60s.** Atualizar last_seen a cada request
 *    transformaria leitura em escrita (e em flush do banco inteiro).
 *  - **Tokens antigos, sem jti, morrem na virada.** É uma decisão
 *    deliberada: após o upgrade quem estava logado faz login uma vez. A
 *    alternativa (aceitar legado 7 dias) manteria tokens não revogáveis
 *    circulando — exatamente o que se quer eliminar.
 *  - **Troca de senha revoga as OUTRAS sessões.** O dispositivo que provou
 *    a senha atual continua; todo o resto precisa entrar de novo.
 */
const crypto = require('crypto');
const { getDB } = require('../db');

const TOUCH_INTERVAL_MS = 60 * 1000;
const MAX_SESSIONS_PER_USER = 25;

function createSession(userId, { ip = '', userAgent = '' } = {}) {
  const db = getDB();
  const jti = crypto.randomUUID();
  db.prepare(
    'INSERT INTO sessions (id, user_id, ip, user_agent) VALUES (?, ?, ?, ?)',
  ).run(jti, userId, ip.slice(0, 64), String(userAgent).slice(0, 256));

  // Higiene: sessões antigas se acumulariam para sempre num painel que vive
  // ligado. Manter só as mais recentes por usuário basta — a validade
  // real continua sendo a expiração do próprio JWT.
  db.prepare(
    `DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
       SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
     )`,
  ).run(userId, userId, MAX_SESSIONS_PER_USER);
  return jti;
}

function isSessionActive(jti) {
  if (!jti) return false;
  try {
    const row = getDB().prepare('SELECT revoked FROM sessions WHERE id = ?').get(jti);
    return !!row && row.revoked === 0;
  } catch {
    // Banco indisponível no meio do boot: falhar FECHADO (nega o acesso) é
    // a única opção honesta para uma verificação de autorização.
    return false;
  }
}

/** Atualiza last_seen no máximo 1x/minuto por sessão. */
function touchSession(jti) {
  try {
    getDB()
      .prepare(
        `UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP
         WHERE id = ? AND last_seen_at < datetime('now', '-60 seconds')`,
      )
      .run(jti);
  } catch {
    /* tocar sessão nunca pode derrubar a requisição */
  }
}

function revokeSession(jti) {
  if (!jti) return;
  getDB().prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(jti);
}

/** Revoga todas as sessões do usuário, exceto (opcionalmente) a atual. */
function revokeAllForUser(userId, { exceptJti = null } = {}) {
  const db = getDB();
  const res = exceptJti
    ? db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND id != ?').run(userId, exceptJti)
    : db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(userId);
  return res.changes;
}

function listSessions(userId) {
  return getDB()
    .prepare(
      `SELECT id, created_at, last_seen_at, ip, user_agent, revoked
       FROM sessions WHERE user_id = ? ORDER BY revoked ASC, last_seen_at DESC`,
    )
    .all(userId);
}

module.exports = {
  createSession,
  isSessionActive,
  touchSession,
  revokeSession,
  revokeAllForUser,
  listSessions,
};
