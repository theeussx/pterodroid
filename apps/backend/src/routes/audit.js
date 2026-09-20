const router = require('express').Router();
const { getDB } = require('../db');

/**
 * Auditoria central (Fase 1): uma única listagem para TODAS as ações
 * registradas (autenticação, arquivos, serviços, bancos, backups, Docker,
 * configurações), com filtros. A rota de arquivos (/api/files/audit)
 * continua existindo por compatibilidade — esta é a visão unificada que a
 * tela de Logs consome.
 *
 * GET /api/audit?action=&username=&q=&from=&to=&limit=&offset=
 *   action   prefixo exato da ação (ex.: login_sucesso, arquivo_write)
 *   username usuário executor
 *   q        trecho livre em target+detail (case-insensitive)
 *   from/to  ISO date ou "YYYY-MM-DD" (limites do período, inclusive)
 *   limit    máx. 200 (padrão 50) · offset para paginação
 */
router.get('/', (req, res) => {
  const db = getDB();
  const { action, username, q, from, to } = req.query || {};
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  const where = [];
  const params = [];
  if (action) { where.push('action = ?'); params.push(String(action)); }
  if (username) { where.push('username = ?'); params.push(String(username)); }
  if (q) {
    where.push('(target LIKE ? OR detail LIKE ?)');
    const like = `%${String(q)}%`;
    params.push(like, like);
  }
  if (from) { where.push("timestamp >= datetime(?)"); params.push(String(from)); }
  if (to) { where.push("timestamp <= datetime(?)"); params.push(String(to)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${whereSql}`).get(...params).n;
  const items = db.prepare(
    `SELECT id, action, target, detail, username, ip, timestamp
     FROM audit_log ${whereSql}
     ORDER BY timestamp DESC, id DESC
     LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);

  // Ações distintas já registradas — a UI monta o seletor com o que existe
  // de verdade em vez de uma lista hardcoded que envelhece.
  const actions = db.prepare(
    'SELECT DISTINCT action FROM audit_log ORDER BY action ASC',
  ).all().map((r) => r.action);

  return res.json({ items, total, limit, offset, actions });
});

module.exports = router;
