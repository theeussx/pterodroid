const router = require('express').Router();
const { getDB } = require('../db');
const driver = require('../services/serviceDriverRegistry');
const { dockerDriver } = driver;
const { removeScaffoldedDir } = require('../services/projectScaffold');
const { resolveServiceWorkspace } = require('../services/serviceWorkspace');

const VALID_TYPES = ['node', 'python', 'shell', 'bot', 'api', 'web', 'other'];
const RUNTIME_TYPES = ['process', 'docker'];

function validate(body) {
  const { name, command, type, runtime_type = 'process' } = body;
  if (!name?.trim()) return 'Name is required';
  if (type && !VALID_TYPES.includes(type)) return `Invalid type. Valid: ${VALID_TYPES.join(', ')}`;
  if (!RUNTIME_TYPES.includes(runtime_type)) return `Invalid runtime_type. Valid: ${RUNTIME_TYPES.join(', ')}`;
  if (runtime_type === 'process' && !command?.trim()) return 'Command is required';
  if (runtime_type === 'docker' && !body.image?.trim()) return 'Image is required for docker services';
  if (runtime_type === 'docker' && !body.docker_host_id) return 'docker_host_id is required for docker services';
  return null;
}

function sanitizeEnv(raw) {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    if (typeof obj !== 'object' || Array.isArray(obj)) return '{}';
    delete obj.LD_PRELOAD;
    delete obj.LD_LIBRARY_PATH;
    return JSON.stringify(obj);
  } catch {
    return '{}';
  }
}

/** Mesma ideia do sanitizeEnv, pra volumes/docker_networks/docker_ports — sempre um array JSON válido, nunca lixo gravado no banco. */
function sanitizeJSONArray(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
    return Array.isArray(arr) ? JSON.stringify(arr) : '[]';
  } catch {
    return '[]';
  }
}

// GET /api/services
router.get('/', (req, res) => {
  const db = getDB();
  const services = db.prepare('SELECT * FROM services ORDER BY created_at DESC').all();
  const enriched = services.map((s) => ({ ...s, runtime: driver.getRuntimeInfo(s.id) }));
  return res.json(enriched);
});

// GET /api/services/:id
router.get('/:id', async (req, res) => {
  const db = getDB();
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });

  const dbLogs = db
    .prepare('SELECT * FROM logs WHERE service_id = ? ORDER BY timestamp DESC LIMIT 100')
    .all(svc.id);

  // Pra serviços docker isso é uma chamada de rede de verdade (ver
  // dockerServiceDriver.getLogs) — um host fora do ar não pode derrubar a
  // página do serviço inteira, só chega com recentLogs vazio.
  let recentLogs = [];
  try {
    recentLogs = await driver.getLogs(svc.id, 200);
  } catch {
    recentLogs = [];
  }

  return res.json({
    ...svc,
    runtime: driver.getRuntimeInfo(svc.id),
    recentLogs,
    persistedLogs: dbLogs,
  });
});

// POST /api/services
router.post('/', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });

  const db = getDB();
  const {
    name, description = '', type = 'node', command = '',
    working_directory = '', environment = '{}',
    auto_restart = 1, restart_delay = 3, max_restarts = 10, port = null, tunnel_hostname = null,
    runtime_type = 'process',
    docker_host_id = null, image = null, volumes = '[]', docker_networks = '[]', docker_ports = '[]',
    cpu_limit = null, memory_limit = null,
  } = req.body;

  const isDocker = runtime_type === 'docker';

  const workspace = resolveServiceWorkspace({
    name,
    runtime_type,
    working_directory,
    volumes,
    image,
    command,
  });
  const finalWorkingDir = workspace.finalWorkingDir;
  const scaffolded = workspace.scaffolded;
  const resolvedVolumes = workspace.volumes;
  const resolvedCommand = workspace.command;

  const result = db.prepare(`
    INSERT INTO services
      (name, description, type, command, working_directory, environment,
       auto_restart, restart_delay, max_restarts, port, scaffolded_directory, tunnel_hostname,
       runtime_type, docker_host_id, image, volumes, docker_networks, docker_ports,
       cpu_limit, memory_limit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(), description.trim(), type, resolvedCommand.trim(),
    finalWorkingDir, sanitizeEnv(environment),
    auto_restart ? 1 : 0, parseInt(restart_delay, 10) || 3, parseInt(max_restarts, 10) || 10,
    port ? parseInt(port, 10) : null, scaffolded, tunnel_hostname?.trim() || null,
    runtime_type, isDocker ? docker_host_id : null, isDocker ? image?.trim() : null,
    sanitizeJSONArray(resolvedVolumes), sanitizeJSONArray(docker_networks), sanitizeJSONArray(docker_ports),
    isDocker ? (cpu_limit || null) : null, isDocker ? (memory_limit || null) : null,
  );

  const created = db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(created);
});

// PUT /api/services/:id
router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Service not found' });

  const err = validate({ ...existing, ...req.body });
  if (err) return res.status(400).json({ error: err });

  const {
    name, description, type, command, working_directory,
    environment, auto_restart, restart_delay, max_restarts, port, tunnel_hostname,
    docker_host_id, image, volumes, docker_networks, docker_ports, cpu_limit, memory_limit,
  } = req.body;

  // Container já existe → imagem/host/volumes/redes/portas/limites viram
  // só metadado histórico, não dá pra "editar" um container já criado por
  // essas colunas. Recriar (remover + criar de novo) é o caminho pra isso.
  // `port` entra aqui também: pra docker ele é a origem do mapeamento
  // quando docker_ports está vazio (ver buildContainerSpec), então mudar
  // só o valor salvo deixaria o banco dizendo uma porta diferente da que
  // o container já criado realmente está usando.
  const changingDockerConfig = Boolean(existing.runtime_type === 'docker' && existing.container_id && (
    (image !== undefined && image !== existing.image) ||
    (docker_host_id !== undefined && docker_host_id !== existing.docker_host_id) ||
    volumes !== undefined || docker_networks !== undefined || docker_ports !== undefined ||
    (cpu_limit !== undefined && cpu_limit !== existing.cpu_limit) ||
    (memory_limit !== undefined && memory_limit !== existing.memory_limit) ||
    (port !== undefined && parseInt(port, 10) !== existing.port)
  ));
  if (changingDockerConfig) {
    return res.status(409).json({
      error: 'Este serviço já tem um container criado — imagem, host, volumes, redes, portas e limites não dá pra editar depois de criado. Remova e recrie o serviço pra mudar isso.',
    });
  }

  db.prepare(`
    UPDATE services SET
      name=?, description=?, type=?, command=?, working_directory=?,
      environment=?, auto_restart=?, restart_delay=?, max_restarts=?, port=?, tunnel_hostname=?,
      docker_host_id=?, image=?, volumes=?, docker_networks=?, docker_ports=?, cpu_limit=?, memory_limit=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    name.trim(),
    (description ?? existing.description).trim(),
    type ?? existing.type,
    (command ?? existing.command ?? '').trim(),
    (working_directory ?? existing.working_directory).trim(),
    sanitizeEnv(environment ?? existing.environment),
    auto_restart != null ? (auto_restart ? 1 : 0) : existing.auto_restart,
    parseInt(restart_delay, 10) || existing.restart_delay,
    parseInt(max_restarts, 10) || existing.max_restarts,
    port ? parseInt(port, 10) : (port === '' ? null : existing.port),
    tunnel_hostname !== undefined ? (tunnel_hostname?.trim() || null) : existing.tunnel_hostname,
    docker_host_id !== undefined ? docker_host_id : existing.docker_host_id,
    image !== undefined ? image?.trim() : existing.image,
    volumes !== undefined ? sanitizeJSONArray(volumes) : existing.volumes,
    docker_networks !== undefined ? sanitizeJSONArray(docker_networks) : existing.docker_networks,
    docker_ports !== undefined ? sanitizeJSONArray(docker_ports) : existing.docker_ports,
    cpu_limit !== undefined ? cpu_limit : existing.cpu_limit,
    memory_limit !== undefined ? memory_limit : existing.memory_limit,
    existing.id,
  );

  return res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(existing.id));
});

// DELETE /api/services/:id
router.delete('/:id', async (req, res) => {
  const db = getDB();
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });

  try { await driver.stopService(svc.id); } catch { /* already stopped */ }

  const deleteFiles = req.query.deleteFiles === 'true' || req.body?.deleteFiles === true;
  const forceRemove = req.query.force === 'true' || req.body?.force === true;

  if (svc.runtime_type === 'docker' && svc.container_id) {
    try {
      await dockerDriver.removeContainer(svc.id, { removeVolumes: deleteFiles });
    } catch (err) {
      // Um erro de rede aqui (host fora do ar etc.) não pode virar um
      // "ok:true" silencioso — isso deixaria um container órfão rodando
      // sem nenhuma linha correspondente no painel, e o usuário nem
      // ficaria sabendo. force=true é o jeito explícito de aceitar isso.
      if (!forceRemove) {
        return res.status(502).json({
          error: `Não deu pra remover o container no host Docker (${err.message}). O serviço não foi apagado — repita com force=true pra apagar mesmo assim (o container pode continuar existindo no host).`,
        });
      }
    }
  } else if (deleteFiles && svc.scaffolded_directory) {
    removeScaffoldedDir(svc.working_directory);
  }

  db.prepare('DELETE FROM services WHERE id = ?').run(svc.id);
  db.prepare('DELETE FROM logs WHERE service_id = ?').run(svc.id);
  return res.json({ ok: true });
});

// POST /api/services/:id/start
router.post('/:id/start', async (req, res) => {
  try {
    // Pra container isto devolve o container_id (string), não um PID —
    // mantido no campo `pid` pra não quebrar o frontend atual.
    const pid = await driver.startService(parseInt(req.params.id, 10));
    return res.json({ ok: true, pid });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/services/:id/stop
router.post('/:id/stop', async (req, res) => {
  try {
    await driver.stopService(parseInt(req.params.id, 10));
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/services/:id/restart
router.post('/:id/restart', async (req, res) => {
  try {
    const pid = await driver.restartService(parseInt(req.params.id, 10));
    return res.json({ ok: true, pid });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/services/:id/input — write to the process's stdin (serviços docker: sempre ok:false, ver dockerServiceDriver.sendInput)
router.post('/:id/input', (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const ok = driver.sendInput(parseInt(req.params.id, 10), text);
  return res.json({ ok });
});

// GET /api/services/:id/logs — persisted (error-level) logs
router.get('/:id/logs', (req, res) => {
  const db = getDB();
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const logs = db
    .prepare('SELECT * FROM logs WHERE service_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(req.params.id, limit);
  return res.json(logs.reverse());
});

module.exports = router;
