const router = require('express').Router();
const jobs = require('../services/jobQueue');

/**
 * Fila de operações longas (Fase 1) — leitura e cancelamento.
 *
 *   GET  /api/jobs?status=&type=&limit=&offset=  → { items, total, active }
 *   GET  /api/jobs/:id                            → linha do job
 *   POST /api/jobs/:id/cancel                     → cancela se ainda 'queued'
 *
 * O andamento em si chega por socket (evento `job:update`); estas rotas
 * existem para hidratar a tela e aceitar comandos.
 */

router.get('/', (req, res) => {
  res.json(jobs.listJobs({
    status: req.query.status || undefined,
    type: req.query.type || undefined,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
});

router.get('/:id', (req, res) => {
  const job = jobs.rowById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  return res.json(jobs.toPublic(job));
});

router.post('/:id/cancel', (req, res) => {
  try {
    const job = jobs.cancel(req.params.id);
    return res.json({ ok: true, job });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
