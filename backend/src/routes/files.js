/**
 * Gerenciador de arquivos global — enraizado em config.FILES_ROOT.
 *
 * Toda a lógica de rota vive no fileRoutesFactory; aqui só dizemos QUAL
 * file manager usar e COMO registrar a auditoria. As rotas por serviço
 * (serviceFiles.js) usam exatamente a mesma fábrica, então as duas telas
 * têm sempre o mesmo conjunto de operações e o mesmo comportamento.
 */
const express = require('express');
const fm = require('../services/fileManager');
const { getDB } = require('../db');
const { createFileRoutes } = require('./fileRoutesFactory');
const { recordAudit, listAudit } = require('../services/auditLog');

const router = express.Router();

// GET /api/files/audit — precisa vir antes das rotas da fábrica, senão
// "/audit" seria interpretado como um caminho de arquivo por outra rota.
router.get('/audit', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json(listAudit(getDB(), limit));
});

router.use(createFileRoutes({
  label: 'files',
  resolveContext: () => ({ fm, scope: 'global' }),
  onAudit: (req, action, target, detail) =>
    recordAudit(getDB(), { action, target, detail, username: req.user?.username }),
}));

module.exports = router;
