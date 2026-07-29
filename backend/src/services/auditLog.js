'use strict';
/**
 * auditLog — registro de atividades e poda das tabelas que crescem.
 *
 * Duas responsabilidades relacionadas, num lugar só:
 *
 *  1. `recordAudit` — a função que as rotas de arquivo chamam. Antes esse
 *     mesmo try/catch estava copiado em dois arquivos de rota.
 *
 *  2. `prune` — corta `logs` e `audit_log` pro tamanho configurado. Isso
 *     não existia: `LOG_MAX_DB` e a configuração "retenção de logs (dias)"
 *     eram lidos da UI mas nunca aplicados, então a tabela `logs` crescia
 *     indefinidamente. Como o banco inteiro é mantido em memória pelo
 *     sql.js e serializado a cada flush, uma tabela grande custa RAM E I/O
 *     — exatamente o que um aparelho Android não tem sobrando.
 */
const config = require('../config');

const MAX_MESSAGE_LENGTH = 2000;
const MAX_AUDIT_ROWS = 500;

function recordAudit(db, { action, target, detail = '', username = '' }) {
  try {
    db.prepare('INSERT INTO audit_log (action, target, detail, username) VALUES (?,?,?,?)')
      .run(action, String(target ?? ''), String(detail ?? '').slice(0, 500), username || '');
  } catch (err) {
    // Auditoria nunca pode derrubar a operação que ela está registrando.
    console.error('[audit] falha ao registrar:', err.message);
  }
}

function listAudit(db, limit = 50) {
  return db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?').all(limit);
}

function retentionDays(db) {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'log_retention_days'").get();
    const days = parseInt(row?.value, 10);
    return Number.isFinite(days) && days > 0 ? days : 0;
  } catch {
    return 0;
  }
}

/**
 * Poda em duas frentes complementares:
 *  - por idade, respeitando a configuração "retenção de logs (dias)";
 *  - por quantidade, garantindo o teto de LOG_MAX_DB linhas por serviço,
 *    porque um serviço muito verboso estoura o limite bem antes do prazo.
 */
function prune(db) {
  let removed = 0;
  try {
    const days = retentionDays(db);
    if (days > 0) {
      const before = db.prepare('SELECT COUNT(*) AS n FROM logs').get()?.n ?? 0;
      db.prepare(`DELETE FROM logs WHERE timestamp < datetime('now', ?)`).run(`-${days} days`);
      const after = db.prepare('SELECT COUNT(*) AS n FROM logs').get()?.n ?? 0;
      removed += before - after;
    }

    // Teto por serviço: mantém apenas as N linhas mais recentes de cada um.
    db.prepare(`
      DELETE FROM logs
      WHERE id NOT IN (
        SELECT id FROM logs l2
        WHERE COALESCE(l2.service_id, -1) = COALESCE(logs.service_id, -1)
          AND COALESCE(l2.db_instance_id, -1) = COALESCE(logs.db_instance_id, -1)
        ORDER BY l2.timestamp DESC, l2.id DESC
        LIMIT ?
      )
    `).run(config.LOG_MAX_DB);

    db.prepare(`
      DELETE FROM audit_log
      WHERE id NOT IN (SELECT id FROM audit_log ORDER BY timestamp DESC, id DESC LIMIT ?)
    `).run(MAX_AUDIT_ROWS);
  } catch (err) {
    console.error('[audit] falha ao podar logs antigos:', err.message);
  }
  return removed;
}

/** Agenda a poda periódica. Devolve uma função pra cancelar (usada no shutdown). */
function schedulePrune(db) {
  prune(db); // uma passada no boot limpa o acúmulo de instalações antigas
  const timer = setInterval(() => prune(db), config.LOG_PRUNE_INTERVAL_MS);
  timer.unref?.(); // nunca segura o processo vivo sozinho
  return () => clearInterval(timer);
}

module.exports = { recordAudit, listAudit, prune, schedulePrune, MAX_MESSAGE_LENGTH };
