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

router.post('/', async (req, res) => {
  try {
    const { service } = await resolveContext(req);
    const created = await backups.createBackup(service, { name: req.body?.name });
    audit(req, 'backup_criado', service, `${created.name} (${created.size_bytes} bytes)`);
    res.json(created);
  } catch (err) {
    sendError(res, err);
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
    const result = await backups.restoreBackup(service, backupId);
    audit(req, 'backup_restaurado', service, `${result.extracted} arquivo(s) restaurado(s)`);
    res.json({ ok: true, ...result });
  } catch (err) {
    sendError(res, err);
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
