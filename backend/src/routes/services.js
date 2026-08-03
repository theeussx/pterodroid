const router = require('express').Router();
const { getDB } = require('../db');
const driver = require('../services/serviceDriverRegistry');
const { dockerDriver } = driver;
const workspaces = require('../services/workspaceManager');
const { resolveServiceWorkspace } = require('../services/serviceWorkspace');
const { forgetService } = require('./serviceFiles');
const backups = require('../services/backupManager');
const terminals = require('../services/terminalManager');
const setupManager = require('../services/serviceSetupManager');
const secretCrypto = require('../services/secretCrypto');

const VALID_TYPES = ['node', 'python', 'shell', 'bot', 'api', 'web', 'other'];
const RUNTIME_TYPES = ['process', 'docker'];

function validate(body) {
  const { name, command, startup_command, type, runtime_type = 'process', git_repo, main_file } = body;
  if (!name?.trim()) return 'O nome é obrigatório';
  if (type && !VALID_TYPES.includes(type)) return `Tipo inválido. Válidos: ${VALID_TYPES.join(', ')}`;
  if (!RUNTIME_TYPES.includes(runtime_type)) return `runtime_type inválido. Válidos: ${RUNTIME_TYPES.join(', ')}`;
  // Permitimos criar sem command se um repositório Git, arquivo principal ou Startup Command for informado (Etapa 2 e Objetivo Geral)
  const hasCmd = Boolean(command?.trim() || startup_command?.trim() || git_repo?.trim() || main_file?.trim());
  if (runtime_type === 'process' && !hasCmd) {
    return 'Informe um Comando de inicialização, Repositório Git ou Arquivo Principal';
  }
  if (runtime_type === 'docker' && !body.image?.trim()) return 'A imagem é obrigatória para serviços Docker';
  if (runtime_type === 'docker' && !body.docker_host_id) return 'Selecione um host Docker';
  return null;
}

function sanitizeServiceForAPI(svc) {
  if (!svc) return svc;
  const { git_token, setup_logs, ...rest } = svc;
  let parsedLogs = [];
  try {
    parsedLogs = typeof setup_logs === 'string' ? JSON.parse(setup_logs || '[]') : (setup_logs || []);
    if (!Array.isArray(parsedLogs)) parsedLogs = [];
  } catch {
    parsedLogs = [];
  }
  return {
    ...rest,
    has_git_token: Boolean(git_token),
    git_token: null, // Etapa 5: nunca retornado pela API
    setup_logs: parsedLogs,
    setupRunning: setupManager.isRunning(svc.id),
  };
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
  return res.json(enriched.map(sanitizeServiceForAPI));
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

  let recentLogs = [];
  try {
    recentLogs = await driver.getLogs(svc.id, 200);
  } catch {
    recentLogs = [];
  }

  return res.json(sanitizeServiceForAPI({
    ...svc,
    runtime: driver.getRuntimeInfo(svc.id),
    recentLogs,
    persistedLogs,
  }));
});

// GET /api/services/:id/setup — estado completo da configuração inicial em tempo real
router.get('/:id/setup', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;
  const status = setupManager.getStatus(id);
  if (!status) return res.status(404).json({ error: 'Serviço não encontrado' });
  return res.json(status);
});

// POST /api/services/:id/setup — dispara execução explícita do setup / retry
router.post('/:id/setup', async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;
  if (setupManager.isRunning(id)) {
    return res.status(409).json({ error: 'O setup já está em andamento para este serviço.' });
  }
  try {
    setupManager.runSetup(id, { startService: true }).catch((err) => {
      console.error(`[services] erro no setup para serviço ${id}:`, err.message);
    });
    return res.json({ ok: true, message: 'Setup iniciado', serviceId: id });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/services
router.post('/', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });

  const db = getDB();
  const {
    name, description = '', type = 'node', command = '', startup_command = '',
    working_directory = '', environment = '{}',
    auto_restart = 1, restart_delay = 3, max_restarts = 10, port = null, tunnel_hostname = null,
    runtime_type = 'process',
    docker_host_id = null, image = null, volumes = '[]', docker_networks = '[]', docker_ports = '[]',
    cpu_limit = null, memory_limit = null,
    git_repo = null, git_branch = null, git_username = null, git_token = null,
    main_file = null, node_packages = null, unnode_packages = null, node_args = null,
    auto_update = 0, allow_file_uploads = 0,
  } = req.body;

  const isDocker = runtime_type === 'docker';
  const effectiveStartupCmd = (startup_command || command || '').trim();

  let workspace;
  try {
    workspace = resolveServiceWorkspace({
      name, runtime_type, working_directory, volumes, image, command: effectiveStartupCmd, startup_command: effectiveStartupCmd,
      git_repo, git_branch, git_username, git_token,
      main_file, node_packages, unnode_packages, node_args, auto_update, allow_file_uploads,
    });
  } catch (e) {
    console.error('[services] falha ao preparar o workspace:', e);
    return res.status(500).json({ error: `Não foi possível preparar a pasta do serviço: ${e.message}` });
  }

  const encryptedToken = git_token ? secretCrypto.encryptSecret(String(git_token).trim()) : null;

  const result = db.prepare(`
    INSERT INTO services
      (name, description, type, command, startup_command, working_directory, environment,
       auto_restart, restart_delay, max_restarts, port, scaffolded_directory, tunnel_hostname,
       runtime_type, docker_host_id, image, volumes, docker_networks, docker_ports,
       cpu_limit, memory_limit,
       git_repo, git_branch, git_username, git_token,
       main_file, node_packages, unnode_packages, node_args, auto_update, allow_file_uploads,
       setup_status, setup_progress)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(), String(description ?? '').trim(), type, (workspace.command || '').trim(), effectiveStartupCmd,
    workspace.finalWorkingDir, sanitizeEnv(environment),
    auto_restart ? 1 : 0, parseInt(restart_delay, 10) || 3, parseInt(max_restarts, 10) || 10,
    port ? parseInt(port, 10) : null, workspace.scaffolded, tunnel_hostname?.trim() || null,
    runtime_type, isDocker ? docker_host_id : null, isDocker ? image?.trim() : null,
    sanitizeJSONArray(workspace.volumes), sanitizeJSONArray(docker_networks), sanitizeJSONArray(docker_ports),
    isDocker ? (cpu_limit || null) : null, isDocker ? (memory_limit || null) : null,
    git_repo?.trim() || null, git_branch?.trim() || null, git_username?.trim() || null, encryptedToken,
    main_file?.trim() || null, node_packages?.trim() || null, unnode_packages?.trim() || null, node_args?.trim() || null,
    auto_update ? 1 : 0, allow_file_uploads ? 1 : 0,
    'Aguardando', 0,
  );

  const createdId = result.lastInsertRowid;
  const created = db.prepare('SELECT * FROM services WHERE id = ?').get(createdId);
  console.log(`[services] criado "${created.name}" (${created.runtime_type}) em ${created.working_directory}`);

  const needsSetup = Boolean(
    git_repo?.trim() || node_packages?.trim() || unnode_packages?.trim() || main_file?.trim() || !effectiveStartupCmd
  );
  if (needsSetup) {
    setupManager.runSetup(createdId, { startService: false }).catch((err) => {
      console.error(`[services] erro em background setup para ${createdId}:`, err.message);
    });
  } else {
    db.prepare("UPDATE services SET setup_status = 'Concluído', setup_progress = 100 WHERE id = ?").run(createdId);
  }

  return res.status(201).json(sanitizeServiceForAPI(created));
});

// PUT /api/services/:id — update parcial (com preservação de token e suporte a Startup Command)
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
    name, description, type, command, startup_command, working_directory,
    environment, auto_restart, restart_delay, max_restarts, port, tunnel_hostname,
    docker_host_id, image, volumes, docker_networks, docker_ports, cpu_limit, memory_limit,
    git_repo, git_branch, git_username, git_token, clear_git_token, main_file, node_packages, unnode_packages, node_args, auto_update, allow_file_uploads,
    run_setup, trigger_setup,
  } = req.body;

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

  let nextToken = existing.git_token;
  if (clear_git_token === true) {
    nextToken = null;
  } else if (typeof git_token === 'string' && git_token.trim() !== '' && git_token !== '***') {
    nextToken = secretCrypto.encryptSecret(git_token.trim());
  }

  const nextStartupCmd = startup_command !== undefined
    ? pickText(startup_command, existing.startup_command ?? '')
    : (command !== undefined ? pickText(command, existing.startup_command ?? '') : existing.startup_command);

  const needsRecompute = (
    (git_repo !== undefined && String(git_repo ?? '').trim() !== String(existing.git_repo ?? '').trim()) ||
    (git_branch !== undefined && String(git_branch ?? '').trim() !== String(existing.git_branch ?? '').trim()) ||
    (main_file !== undefined && String(main_file ?? '').trim() !== String(existing.main_file ?? '').trim()) ||
    (node_packages !== undefined && String(node_packages ?? '').trim() !== String(existing.node_packages ?? '').trim()) ||
    (unnode_packages !== undefined && String(unnode_packages ?? '').trim() !== String(existing.unnode_packages ?? '').trim()) ||
    (node_args !== undefined && String(node_args ?? '').trim() !== String(existing.node_args ?? '').trim())
  );

  let recomputed = null;
  if (needsRecompute) {
    try {
      recomputed = resolveServiceWorkspace({
        name: pickText(name, existing.name),
        runtime_type: existing.runtime_type,
        working_directory: nextWorkingDir,
        volumes: volumes !== undefined ? volumes : existing.volumes,
        image: image !== undefined ? image : existing.image,
        command: nextStartupCmd || command,
        startup_command: nextStartupCmd,
        git_repo: git_repo !== undefined ? git_repo : existing.git_repo,
        git_branch: git_branch !== undefined ? git_branch : existing.git_branch,
        git_username: git_username !== undefined ? git_username : existing.git_username,
        git_token: nextToken,
        main_file: main_file !== undefined ? main_file : existing.main_file,
        node_packages: node_packages !== undefined ? node_packages : existing.node_packages,
        unnode_packages: unnode_packages !== undefined ? unnode_packages : existing.unnode_packages,
        node_args: node_args !== undefined ? node_args : existing.node_args,
        auto_update: auto_update !== undefined ? auto_update : existing.auto_update,
        allow_file_uploads: allow_file_uploads !== undefined ? allow_file_uploads : existing.allow_file_uploads,
      });
    } catch (e) {
      console.error('[services] falha ao recomputar workspace:', e.message);
      recomputed = null;
    }
  }

  const effectiveCommand = nextStartupCmd
    ? nextStartupCmd
    : (command !== undefined ? pickText(command, existing.command ?? '') : (recomputed ? recomputed.command.trim() : pickText(command, existing.command ?? '')));

  db.prepare(`
    UPDATE services SET
      name=?, description=?, type=?, command=?, startup_command=?, working_directory=?,
      environment=?, auto_restart=?, restart_delay=?, max_restarts=?, port=?, tunnel_hostname=?,
      docker_host_id=?, image=?, volumes=?, docker_networks=?, docker_ports=?, cpu_limit=?, memory_limit=?,
      git_repo=?, git_branch=?, git_username=?, git_token=?,
      main_file=?, node_packages=?, unnode_packages=?, node_args=?, auto_update=?, allow_file_uploads=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    pickText(name, existing.name),
    pickText(description, existing.description),
    type ?? existing.type,
    effectiveCommand,
    nextStartupCmd,
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
    git_repo !== undefined ? (git_repo?.trim() || null) : existing.git_repo,
    git_branch !== undefined ? (git_branch?.trim() || null) : existing.git_branch,
    git_username !== undefined ? (git_username?.trim() || null) : existing.git_username,
    nextToken,
    main_file !== undefined ? (main_file?.trim() || null) : existing.main_file,
    node_packages !== undefined ? (node_packages?.trim() || null) : existing.node_packages,
    unnode_packages !== undefined ? (unnode_packages?.trim() || null) : existing.unnode_packages,
    node_args !== undefined ? (node_args?.trim() || null) : existing.node_args,
    auto_update !== undefined ? (auto_update ? 1 : 0) : existing.auto_update,
    allow_file_uploads !== undefined ? (allow_file_uploads ? 1 : 0) : existing.allow_file_uploads,
    existing.id,
  );

  if (run_setup || trigger_setup) {
    setupManager.runSetup(existing.id, { startService: false }).catch(() => {});
  }

  const updated = db.prepare('SELECT * FROM services WHERE id = ?').get(existing.id);
  return res.json(sanitizeServiceForAPI(updated));
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
  backups.forgetService(svc.id);
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

// GET /api/services/:id/disk-usage — tamanho aproximado do workspace.
// Fica de fora do GET /:id (que é chamado com frequência) de propósito:
// a varredura é síncrona, então uma cache curta evita reler o disco toda
// vez que a aba "Visão Geral" é reaberta.
const diskUsageCache = new Map(); // id -> { at, data }
const DISK_USAGE_TTL_MS = 20_000;

router.get('/:id/disk-usage', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;

  const cached = diskUsageCache.get(id);
  if (cached && Date.now() - cached.at < DISK_USAGE_TTL_MS) {
    return res.json(cached.data);
  }

  const db = getDB();
  const svc = db.prepare('SELECT working_directory FROM services WHERE id = ?').get(id);
  if (!svc) return res.status(404).json({ error: 'Serviço não encontrado' });
  if (!svc.working_directory) return res.json({ bytes: 0, files: 0, truncated: false });

  const data = workspaces.usage(svc.working_directory);
  diskUsageCache.set(id, { at: Date.now(), data });
  return res.json(data);
});

module.exports = router;
