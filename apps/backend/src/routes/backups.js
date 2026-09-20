'use strict';
/**
 * Backups por serviço — POST cria, GET lista, GET /:id/download baixa,
 * POST /:id/restore restaura, DELETE /:id apaga.
 *
 * Reaproveita o resolveContext de serviceFiles.js: mesma normalização de
 * working_directory (incluindo o fallback pra recriar a pasta se ela foi
 * apagada por fora) que já é usada pela aba "Arquivos", pra garantir que
 * as duas abas concordem sobre qual pasta é o workspace do serviço.
 */
const path = require('path');
const router = require('express').Router({ mergeParams: true });
const { resolveContext } = require('./serviceFiles');
const backups = require('../services/backupManager');
const { recordAudit } = require('../services/auditLog');
const jobs = require('../services/jobQueue');
const { getDB } = require('../db');

function sendError(res, err, label = 'backups') {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[${label}] erro inesperado:`, err);
  res.status(status).json({ error: err.message || 'Erro interno' });
}

const audit = (req, action, service, detail = '') => {
  try {
    recordAudit(getDB(), {
      action,
      target: `[${service.name}] backup`,
      detail,
      username: req.user?.username,
      ip: req.ip,
      });
  } catch (err) {
    console.error('[backups] falha ao registrar auditoria:', err.message);
  }
};

router.get('/', async (req, res) => {
  try {
    const { service } = await resolveContext(req);
    res.json(backups.listForService(service.id));
  } catch (err) {
    sendError(res, err);
  }
});

// POST cria: o trabalho em si roda NA FILA (jobQueue), não dentro deste
// request — um painel que reinicia no meio de um zip deixava o backup
// com status 'creating' para sempre e bloqueava os próximos. Quem pediu
// acompanha o progresso por socket (job:update) e a lista de backups
// atualiza quando o job termina. A auditoria sai do handler, com a
// identidade de quem enfileirou (payload.by/ip preservadas no job).
router.post('/', async (req, res) => {
  try {
    const { service } = await resolveContext(req);
    // Validações baratas que merecem resposta síncrona ao usuário:
    const existing = backups.listForService(service.id);
    if (existing.some((b) => b.status === 'creating' || b.status === 'restoring')) {
      return res.status(409).json({ error: 'Já existe uma operação de backup em andamento para este serviço.' });
    }
    const job = jobs.enqueue('backup.create', {
      subject: `[${service.name}] backup`,
      payload: { serviceId: service.id, name: req.body?.name, by: req.user?.username || '', ip: req.ip || '' },
    });
    return res.status(202).json({ ok: true, job });
  } catch (err) {
    return sendError(res, err);
  }
});

router.get('/:backupId/download', async (req, res) => {
  try {
    const { service } = await resolveContext(req);
    const backupId = parseInt(req.params.backupId, 10);
    const backup = backups.getOne(service.id, backupId);
    if (backup.status !== 'ready') {
      return res.status(409).json({ error: 'Este backup ainda não está pronto para download.' });
    }
    audit(req, 'backup_baixado', service, backup.name);
    const abs = backups.absolutePath(service.id, backup);
    return res.download(abs, backup.filename, (err) => {
      if (err && !res.headersSent) sendError(res, err);
    });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/:backupId/restore', async (req, res) => {
  try {
    const { service } = await resolveContext(req);
    const backupId = parseInt(req.params.backupId, 10);
    // Valida cedo (404/409 síncronos quando o backup não existe ou o
    // serviço já tem operação em andamento) — o resto é trabalho de fila.
    const backup = backups.getOne(service.id, backupId);
    if (backup.status === 'restoring') {
      return res.status(409).json({ error: 'Este backup já está sendo restaurado.' });
    }
    const job = jobs.enqueue('backup.restore', {
      subject: `[${service.name}] restaurar "${backup.name}"`,
      payload: { serviceId: service.id, backupId, by: req.user?.username || '', ip: req.ip || '' },
    });
    return res.status(202).json({ ok: true, job });
  } catch (err) {
    return sendError(res, err);
  }
});

router.delete('/:backupId', async (req, res) => {
  try {
    const { service } = await resolveContext(req);
    const backupId = parseInt(req.params.backupId, 10);
    const backup = backups.getOne(service.id, backupId);
    backups.deleteBackup(service.id, backupId);
    audit(req, 'backup_removido', service, backup.name);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
