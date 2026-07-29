const router = require('express').Router();
const { getDB } = require('../db');
const driver = require('../services/serviceDriverRegistry');
const { dockerDriver } = driver;
const workspaces = require('../services/workspaceManager');
const { resolveServiceWorkspace } = require('../services/serviceWorkspace');
const { forgetService } = require('./serviceFiles');
const terminals = require('../services/terminalManager');

const VALID_TYPES = ['node', 'python', 'shell', 'bot', 'api', 'web', 'other'];
const RUNTIME_TYPES = ['process', 'docker'];

function validate(body) {
  const { name, command, type, runtime_type = 'process' } = body;
  if (!name?.trim()) return 'O nome é obrigatório';
  if (type && !VALID_TYPES.includes(type)) return `Tipo inválido. Válidos: ${VALID_TYPES.join(', ')}`;
  if (!RUNTIME_TYPES.includes(runtime_type)) return `runtime_type inválido. Válidos: ${RUNTIME_TYPES.join(', ')}`;
  if (runtime_type === 'process' && !command?.trim()) return 'O comando de inicialização é obrigatório';
  if (runtime_type === 'docker' && !body.image?.trim()) return 'A imagem é obrigatória para serviços Docker';
  if (runtime_type === 'docker' && !body.docker_host_id) return 'Selecione um host Docker';
  return null;
}

function sanitizeEnv(raw) {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    if (typeof obj !== 'object' || Array.isArray(obj)) return '{}';
    // Essas duas permitem injetar código em qualquer processo filho.
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

/**
 * Lê um campo de um update PARCIAL.
 *
 * A versão anterior fazia `name.trim()` direto sobre `req.body.name`, então
 * qualquer PUT que não mandasse TODOS os campos derrubava a rota com
 * "Cannot read properties of undefined (reading 'trim')" → HTTP 500 (P14,
 * reproduzido com `{"description":"x"}`). Estes helpers deixam explícito
 * que campo ausente significa "não mudou".
 */
const pickText = (value, current) => (value === undefined ? current : String(value ?? '').trim());
const pickInt = (value, current) => {
  if (value === undefined) return current;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : current;
};

function parseId(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'ID de serviço inválido' });
    return null;
  }
  return id;
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
  const id = parseId(req, res);
  if (id === null) return undefined;

  const db = getDB();
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!svc) return res.status(404).json({ error: 'Serviço não encontrado' });

  const persistedLogs = db
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
    persistedLogs,
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

  let workspace;
  try {
    workspace = resolveServiceWorkspace({ name, runtime_type, working_directory, volumes, image, command });
  } catch (e) {
    console.error('[services] falha ao preparar o workspace:', e);
    return res.status(500).json({ error: `Não foi possível preparar a pasta do serviço: ${e.message}` });
  }

  const result = db.prepare(`
    INSERT INTO services
      (name, description, type, command, working_directory, environment,
       auto_restart, restart_delay, max_restarts, port, scaffolded_directory, tunnel_hostname,
       runtime_type, docker_host_id, image, volumes, docker_networks, docker_ports,
       cpu_limit, memory_limit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(), String(description ?? '').trim(), type, workspace.command.trim(),
    workspace.finalWorkingDir, sanitizeEnv(environment),
    auto_restart ? 1 : 0, parseInt(restart_delay, 10) || 3, parseInt(max_restarts, 10) || 10,
    port ? parseInt(port, 10) : null, workspace.scaffolded, tunnel_hostname?.trim() || null,
    runtime_type, isDocker ? docker_host_id : null, isDocker ? image?.trim() : null,
    sanitizeJSONArray(workspace.volumes), sanitizeJSONArray(docker_networks), sanitizeJSONArray(docker_ports),
    isDocker ? (cpu_limit || null) : null, isDocker ? (memory_limit || null) : null,
  );

  const created = db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid);
  console.log(`[services] criado "${created.name}" (${created.runtime_type}) em ${created.working_directory}`);
  return res.status(201).json(created);
});

// PUT /api/services/:id — aceita update parcial (só os campos enviados mudam)
router.put('/:id', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;

  const db = getDB();
  const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Serviço não encontrado' });

  const merged = { ...existing, ...req.body };
  const err = validate(merged);
  if (err) return res.status(400).json({ error: err });

  const {
    name, description, type, command, working_directory,
    environment, auto_restart, restart_delay, max_restarts, port, tunnel_hostname,
    docker_host_id, image, volumes, docker_networks, docker_ports, cpu_limit, memory_limit,
  } = req.body;

  // Container já existe → imagem/host/volumes/redes/portas/limites viram
  // só metadado histórico, não dá pra "editar" um container já criado por
  // essas colunas. Recriar (remover + criar de novo) é o caminho pra isso.
  const changed = (value, current) => value !== undefined && String(value ?? '') !== String(current ?? '');
  const changingDockerConfig = Boolean(existing.runtime_type === 'docker' && existing.container_id && (
    changed(image, existing.image) ||
    changed(docker_host_id, existing.docker_host_id) ||
    changed(volumes, existing.volumes) ||
    changed(docker_networks, existing.docker_networks) ||
    changed(docker_ports, existing.docker_ports) ||
    changed(cpu_limit, existing.cpu_limit) ||
    changed(memory_limit, existing.memory_limit) ||
    (port !== undefined && (parseInt(port, 10) || null) !== existing.port)
  ));
  if (changingDockerConfig) {
    return res.status(409).json({
      error: 'Este serviço já tem um container criado — imagem, host, volumes, redes, portas e limites não podem ser editados depois. Remova e recrie o serviço para mudar isso.',
    });
  }

  // Mudar o diretório de trabalho: normaliza e garante que exista, senão o
  // próximo start falharia com ENOENT.
  let nextWorkingDir = existing.working_directory;
  if (working_directory !== undefined) {
    nextWorkingDir = workspaces.normalize(working_directory) || existing.working_directory;
    try {
      workspaces.ensureDir(nextWorkingDir);
    } catch (e) {
      return res.status(400).json({ error: `Não foi possível usar esse diretório: ${e.message}` });
    }
  }

  let nextPort = existing.port;
  if (port !== undefined) nextPort = port === '' || port === null ? null : (parseInt(port, 10) || null);

  db.prepare(`
    UPDATE services SET
      name=?, description=?, type=?, command=?, working_directory=?,
      environment=?, auto_restart=?, restart_delay=?, max_restarts=?, port=?, tunnel_hostname=?,
      docker_host_id=?, image=?, volumes=?, docker_networks=?, docker_ports=?, cpu_limit=?, memory_limit=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    pickText(name, existing.name),
    pickText(description, existing.description),
    type ?? existing.type,
    pickText(command, existing.command ?? ''),
    nextWorkingDir,
    environment !== undefined ? sanitizeEnv(environment) : existing.environment,
    auto_restart !== undefined ? (auto_restart ? 1 : 0) : existing.auto_restart,
    pickInt(restart_delay, existing.restart_delay),
    pickInt(max_restarts, existing.max_restarts),
    nextPort,
    tunnel_hostname !== undefined ? (tunnel_hostname?.trim() || null) : existing.tunnel_hostname,
    docker_host_id !== undefined ? docker_host_id : existing.docker_host_id,
    image !== undefined ? (image?.trim() || null) : existing.image,
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
  const id = parseId(req, res);
  if (id === null) return undefined;

  const db = getDB();
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!svc) return res.status(404).json({ error: 'Serviço não encontrado' });

  try { await driver.stopService(svc.id); } catch { /* já parado */ }

  const deleteFiles = req.query.deleteFiles === 'true' || req.body?.deleteFiles === true;
  const forceRemove = req.query.force === 'true' || req.body?.force === true;

  if (svc.runtime_type === 'docker' && svc.container_id) {
    try {
      await dockerDriver.removeContainer(svc.id, { removeVolumes: deleteFiles });
    } catch (err) {
      // Um erro de rede aqui (host fora do ar etc.) não pode virar um
      // "ok:true" silencioso — isso deixaria um container órfão rodando
      // sem nenhuma linha correspondente no painel.
      if (!forceRemove) {
        return res.status(502).json({
          error: `Não foi possível remover o container no host Docker (${err.message}). O serviço não foi apagado — repita com force=true para apagar mesmo assim (o container pode continuar existindo no host).`,
        });
      }
    }
  }

  // Apagar arquivos é sempre explícito e só acontece dentro da raiz de
  // workspaces — um diretório apontado à mão pelo usuário nunca é removido
  // pelo painel (workspaceManager.remove garante isso).
  let filesRemoved = false;
  if (deleteFiles) {
    try {
      filesRemoved = workspaces.remove(svc.working_directory);
    } catch (e) {
      console.error(`[services] falha ao remover o workspace de ${svc.name}: ${e.message}`);
    }
  }

  db.prepare('DELETE FROM services WHERE id = ?').run(svc.id);
  db.prepare('DELETE FROM logs WHERE service_id = ?').run(svc.id);
  forgetService(svc.id);
  terminals.closeForService(svc.id);

  console.log(`[services] removido "${svc.name}"${filesRemoved ? ' (workspace apagado)' : ''}`);
  return res.json({ ok: true, filesRemoved });
});

// ── Ciclo de vida ────────────────────────────────────────────────────────
// Um único handler para start/stop/restart: o tratamento de erro e a forma
// da resposta eram idênticos nos três, copiados três vezes.
const lifecycle = (action, verb) => async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;
  try {
    const result = await driver[action](id);
    return res.json({ ok: true, pid: result ?? null });
  } catch (e) {
    console.error(`[services] falha ao ${verb} serviço ${id}: ${e.message}`);
    return res.status(e.status || 500).json({ error: e.message });
  }
};

// Para container, `pid` traz o container_id (string) em vez de um PID.
router.post('/:id/start', lifecycle('startService', 'iniciar'));
router.post('/:id/stop', lifecycle('stopService', 'parar'));
router.post('/:id/restart', lifecycle('restartService', 'reiniciar'));

// POST /api/services/:id/input — escreve no stdin do processo
router.post('/:id/input', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;
  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.length) return res.status(400).json({ error: 'text é obrigatório' });
  const ok = driver.sendInput(id, text);
  if (!ok) {
    return res.status(409).json({
      ok: false,
      error: 'Não foi possível enviar: o serviço não está rodando ou não aceita entrada interativa.',
    });
  }
  return res.json({ ok });
});

// GET /api/services/:id/logs — logs persistidos (nível error)
router.get('/:id/logs', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;
  const db = getDB();
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const logs = db
    .prepare('SELECT * FROM logs WHERE service_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(id, limit);
  return res.json(logs.reverse());
});

module.exports = router;
