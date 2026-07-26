const router = require('express').Router();
const hosts = require('../services/dockerHostManager');
const { DockerEngineError } = require('../services/dockerEngine');

// Encapsula o padrão "chama o Docker, devolve 502 com a mensagem dele se falhar"
// que toda rota abaixo de /hosts/:id/* precisa repetir.
function withEngine(handler) {
  return async (req, res) => {
    let engine;
    try {
      engine = hosts.engineFor(parseInt(req.params.id, 10));
    } catch {
      return res.status(404).json({ error: 'Host não encontrado' });
    }
    try {
      return await handler(engine, req, res);
    } catch (err) {
      const status = err instanceof DockerEngineError ? 502 : 500;
      return res.status(status).json({ error: err.message });
    }
  };
}

// GET /api/docker/hosts
router.get('/hosts', (req, res) => res.json(hosts.listHosts()));

// POST /api/docker/hosts
router.post('/hosts', (req, res) => {
  try {
    const host = hosts.addHost(req.body || {});
    return res.status(201).json(host);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// DELETE /api/docker/hosts/:id
router.delete('/hosts/:id', (req, res) => {
  hosts.removeHost(parseInt(req.params.id, 10));
  return res.json({ ok: true });
});

// POST /api/docker/hosts/:id/ping — testa a conexão; nunca lança, sempre responde ok:true/false
router.post('/hosts/:id/ping', async (req, res) => {
  const result = await hosts.pingHost(parseInt(req.params.id, 10));
  return res.json(result);
});

router.get('/hosts/:id/containers', withEngine(async (engine, req, res) => {
  res.json(await engine.listContainers({ all: true }));
}));

router.get('/hosts/:id/images', withEngine(async (engine, req, res) => {
  res.json(await engine.listImages());
}));

router.get('/hosts/:id/volumes', withEngine(async (engine, req, res) => {
  res.json(await engine.listVolumes());
}));

router.get('/hosts/:id/networks', withEngine(async (engine, req, res) => {
  res.json(await engine.listNetworks());
}));

// ── Containers (escrita) ────────────────────────────────────────────────
// Gerenciamento "cru" de containers direto num host, fora do conceito de
// Services do painel — pra telas de Docker avançado / Marketplace, que
// falam com a engine diretamente em vez de passar por um serviço cadastrado.

router.post('/hosts/:id/containers', withEngine(async (engine, req, res) => {
  if (!req.body?.Image) return res.status(400).json({ error: 'Image é obrigatório' });
  const created = await engine.createContainer(req.body, { name: req.query.name });
  res.status(201).json(created);
}));

router.post('/hosts/:id/containers/:containerId/start', withEngine(async (engine, req, res) => {
  await engine.startContainer(req.params.containerId);
  res.json({ ok: true });
}));

router.post('/hosts/:id/containers/:containerId/stop', withEngine(async (engine, req, res) => {
  await engine.stopContainer(req.params.containerId);
  res.json({ ok: true });
}));

router.post('/hosts/:id/containers/:containerId/restart', withEngine(async (engine, req, res) => {
  await engine.restartContainer(req.params.containerId);
  res.json({ ok: true });
}));

router.delete('/hosts/:id/containers/:containerId', withEngine(async (engine, req, res) => {
  await engine.removeContainer(req.params.containerId, {
    force: req.query.force === 'true',
    volumes: req.query.volumes === 'true',
  });
  res.json({ ok: true });
}));

router.get('/hosts/:id/containers/:containerId/logs', withEngine(async (engine, req, res) => {
  const tail = parseInt(req.query.tail, 10) || 200;
  res.json(await engine.getLogs(req.params.containerId, { tail }));
}));

router.get('/hosts/:id/containers/:containerId/stats', withEngine(async (engine, req, res) => {
  res.json(await engine.statsOnce(req.params.containerId));
}));

// ── Imagens (escrita) ────────────────────────────────────────────────────

router.post('/hosts/:id/images/pull', withEngine(async (engine, req, res) => {
  if (!req.body?.fromImage) return res.status(400).json({ error: 'fromImage é obrigatório' });
  await engine.pullImage(req.body.fromImage);
  res.json({ ok: true });
}));

router.delete('/hosts/:id/images/:imageId', withEngine(async (engine, req, res) => {
  await engine.removeImage(req.params.imageId, { force: req.query.force === 'true' });
  res.json({ ok: true });
}));

// ── Volumes (escrita) ────────────────────────────────────────────────────

router.post('/hosts/:id/volumes', withEngine(async (engine, req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: 'name é obrigatório' });
  res.status(201).json(await engine.createVolume(req.body));
}));

router.delete('/hosts/:id/volumes/:name', withEngine(async (engine, req, res) => {
  await engine.removeVolume(req.params.name, { force: req.query.force === 'true' });
  res.json({ ok: true });
}));

// ── Redes (escrita) ──────────────────────────────────────────────────────

router.post('/hosts/:id/networks', withEngine(async (engine, req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: 'name é obrigatório' });
  res.status(201).json(await engine.createNetwork(req.body));
}));

router.delete('/hosts/:id/networks/:networkId', withEngine(async (engine, req, res) => {
  await engine.removeNetwork(req.params.networkId);
  res.json({ ok: true });
}));

router.post('/hosts/:id/networks/:networkId/connect', withEngine(async (engine, req, res) => {
  if (!req.body?.containerId) return res.status(400).json({ error: 'containerId é obrigatório' });
  await engine.connectNetwork(req.params.networkId, req.body.containerId);
  res.json({ ok: true });
}));

router.post('/hosts/:id/networks/:networkId/disconnect', withEngine(async (engine, req, res) => {
  if (!req.body?.containerId) return res.status(400).json({ error: 'containerId é obrigatório' });
  await engine.disconnectNetwork(req.params.networkId, req.body.containerId);
  res.json({ ok: true });
}));

module.exports = router;
