const router = require('express').Router();
const { getDB } = require('../db');
const driver = require('../services/serviceDriverRegistry');
const { dockerDriver } = driver;
const workspaces = require('../services/workspaceManager');
const { resolveServiceWorkspace } = require('../services/serviceWorkspace');
const recipes = require('../services/serviceRecipes');
const cipher = require('../services/secretCipher');
const setup = require('../services/setupManager');
const { forgetService } = require('./serviceFiles');
const backups = require('../services/backupManager');
const terminals = require('../services/terminalManager');

const VALID_TYPES = ['node', 'python', 'shell', 'bot', 'api', 'web', 'other'];
const RUNTIME_TYPES = ['process', 'docker'];

function validate(body) {
  const { name, type, runtime_type = 'process' } = body;
  if (!name?.trim()) return 'O nome é obrigatório';
  if (type && !VALID_TYPES.includes(type)) return `Tipo inválido. Válidos: ${VALID_TYPES.join(', ')}`;
  if (!RUNTIME_TYPES.includes(runtime_type)) return `runtime_type inválido. Válidos: ${RUNTIME_TYPES.join(', ')}`;
  // `command` NÃO é mais obrigatório para processos: se o usuário deixar
  // vazio, o setup o infere a partir de package.json/startup_command/
  // main_file. Validação fica por conta do startService, que exige comando
  // no momento de _spawn.
  if (runtime_type === 'docker' && !body.image?.trim()) return 'A imagem é obrigatória para serviços Docker';
  if (runtime_type === 'docker' && !body.docker_host_id) return 'Selecione um host Docker';
  return null;
}

function sanitizeEnv(raw) {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    if (typeof obj !== 'object' || Array.isArray(obj)) return '{}';
    delete obj.LD_PRELOAD;
    delete obj.LD_LIBRARY_PATH;
    // Segredos em repouso: o JSON vai cifrado pro banco. A API devolve
    // decifrado para o dono autenticado (cipher.decrypt na resposta).
    return cipher.encrypt(JSON.stringify(obj));
  } catch {
    return '{}';
  }
}

/** Decifra o environment salvo para devolver à UI (só o dono vê). */
function revealEnv(stored) {
  const plain = cipher.decrypt(stored || '{}');
  // Aceita tanto texto claro legado quanto o JSON cifrado; se não for JSON
  // válido, devolve o original para não perder dados na edição.
  try { JSON.parse(plain); return plain; } catch { return stored || '{}'; }
}

function envForResponse(svc) {
  if (!svc) return svc;
  return { ...svc, environment: revealEnv(svc.environment) };
}

function sanitizeJSONArray(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
    return Array.isArray(arr) ? JSON.stringify(arr) : '[]';
  } catch {
    return '[]';
  }
}

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

// GET /api/services/recipes — catálogo de receitas dedicadas para a UI.
// Precisa vir ANTES do GET /:id, senão "recipes" é interpretado como id.
router.get('/recipes', (req, res) => {
  return res.json(recipes.catalog());
});

/**
 * Remove o git_token do objeto antes de devolver ao cliente.
 *
 * Segurança: o token de acesso a repositórios privados NUNCA deve
 * transitar na resposta — o frontend não precisa dele pra nada além de
 * ser digitado no formulário, e só o backend usa para montar a URL de
 * clone.
 */
function redactService(svc) {
  if (!svc) return svc;
  const out = { ...svc };
  if (out.git_token) out.git_token = '__PTD_REDACTED__';
  return out;
}

/**
 * Cifra o git_token antes de persistir. Retorna null se não houver token.
 * O valor já cifrado (enc:) não é re-cifrado, para round-trips idempotentes.
 */
function encGitToken(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw === '__PTD_REDACTED__') return null; // placeholder -> continua o atual (tratado no chamador)
  return cipher.isEncrypted(raw) ? raw : cipher.encrypt(raw);
}

// GET /api/services
router.get('/', (req, res) => {
  const db = getDB();
  const services = db.prepare('SELECT * FROM services ORDER BY created_at DESC').all();
  const enriched = services.map((s) => ({
    ...envForResponse(redactService(s)),
    runtime: driver.getRuntimeInfo(s.id),
    setup: setup.getState(s.id),
    recipe: recipes.describeRow(s),
  }));
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

  let recentLogs = [];
  try {
    recentLogs = await driver.getLogs(svc.id, 200);
  } catch {
    recentLogs = [];
  }

  return res.json({
    ...envForResponse(redactService(svc)),
    runtime: driver.getRuntimeInfo(svc.id),
    setup: setup.getState(svc.id),
    recipe: recipes.describeRow(svc),
    recentLogs,
    persistedLogs,
  });
});

// POST /api/services
router.post('/', (req, res) => {
  const db = getDB();
  const {
    name, description = '', type = 'node', command = '',
    working_directory = '', environment = '{}',
    auto_restart = 1, restart_delay = 3, max_restarts = 10, port = null, tunnel_hostname = null,
    runtime_type = 'process',
    docker_host_id = null, image = null, volumes = '[]', docker_networks = '[]', docker_ports = '[]',
    cpu_limit = null, memory_limit = null,
    git_repo = null, git_branch = null, git_username = null, git_token = null,
    startup_command = null,
    main_file = null, node_packages = null, unnode_packages = null, node_args = null,
    auto_update = 0, allow_file_uploads = 0,
    recipe = null, use_template = false,
    run_setup = true,
    auto_start = false,
    healthcheck_url = null, healthcheck_interval = 30, healthcheck_timeout = 5, healthcheck_enabled = 0,
    process_memory_limit = null, process_cpu_limit = null,
  } = req.body;

  // Validação roda DEPOIS dos defaults de receita: escolher a receita
  // "docker" pode forçar runtime_type='docker', e aí a validação precisa
  // saber disso pra exigir imagem/host — se rodasse antes, aprovaria um
  // serviço docker sem imagem e quebraria no start.
  const recipeErr = recipes.validateRecipe && recipe ? recipes.validateRecipe(recipe, req.body) : null;
  if (recipeErr) return res.status(400).json({ error: recipeErr });

  // Aplica os defaults da receita dedicada SEM sobrescrever o que o usuário
  // já preencheu (tipo, porta, comando, runtime). É o que dá a experiência
  // "dedicada": escolheu "Servidor Minecraft"? já vem com porta 25565 e o
  // comando Java; escolheu "Site estático"? já vem com o http.server.
  const defaults = recipe ? recipes.applyDefaults(recipe, req.body) : {};
  const finalType = defaults.type || type || 'node';
  const finalRuntime = defaults.runtime_type || runtime_type || 'process';
  const finalPort = (port === undefined || port === '' || port === null) ? (defaults.port ?? port) : port;
  const cmd = (command || '').trim() || (defaults.command || '');
  const isDocker = finalRuntime === 'docker';
  const wantedRecipe = recipe && recipes.get(recipe)?.id ? recipe : finalType;

  // Valida o corpo EFETIVO (aplicados os defaults), não o cru.
  const effectiveBody = {
    ...req.body,
    ...defaults,
    type: finalType,
    runtime_type: finalRuntime,
  };
  const err = validate(effectiveBody);
  if (err) return res.status(400).json({ error: err });

  let workspace;
  try {
    workspace = resolveServiceWorkspace({
      name, runtime_type: finalRuntime, working_directory, volumes, image, command: cmd,
      git_repo, git_branch, git_username, git_token,
      main_file, node_packages, unnode_packages, node_args, auto_update, allow_file_uploads,
      startup_command,
      recipe: wantedRecipe,
      useTemplate: !!use_template && !isDocker,
    });
  } catch (e) {
    console.error('[services] falha ao preparar o workspace:', e);
    return res.status(500).json({ error: `Não foi possível preparar a pasta do serviço: ${e.message}` });
  }

  const result = db.prepare(`
    INSERT INTO services
      (name, description, type, command, working_directory, environment,
       auto_restart, restart_delay, max_restarts, port, scaffolded_directory, tunnel_hostname,
       runtime_type, docker_host_id, image, volumes, docker_networks, docker_ports,
       cpu_limit, memory_limit, recipe, healthcheck_url, healthcheck_interval, healthcheck_timeout,
       healthcheck_enabled, process_memory_limit, process_cpu_limit,
       git_repo, git_branch, git_username, git_token, startup_command,
       main_file, node_packages, unnode_packages, node_args, auto_update, allow_file_uploads)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(), String(description ?? '').trim(), finalType, workspace.command.trim(),
    workspace.finalWorkingDir, sanitizeEnv(environment),
    auto_restart ? 1 : 0, parseInt(restart_delay, 10) || 3, parseInt(max_restarts, 10) || 10,
    finalPort ? parseInt(finalPort, 10) : null, workspace.scaffolded, tunnel_hostname?.trim() || null,
    finalRuntime, isDocker ? docker_host_id : null, isDocker ? image?.trim() : null,
    sanitizeJSONArray(workspace.volumes), sanitizeJSONArray(docker_networks), sanitizeJSONArray(docker_ports),
    isDocker ? (cpu_limit || null) : null, isDocker ? (memory_limit || null) : null,
    wantedRecipe,
    healthcheck_url?.trim() || null,
    parseInt(healthcheck_interval, 10) || 30,
    parseInt(healthcheck_timeout, 10) || 5,
    healthcheck_enabled ? 1 : 0,
    isDocker ? null : (process_memory_limit ? parseInt(process_memory_limit, 10) : null),
    isDocker ? null : (process_cpu_limit ? parseFloat(process_cpu_limit) : null),
    git_repo?.trim() || null, git_branch?.trim() || null,
    // Segurança: se o cliente mandar o placeholder de redacted de volta
    // (que é o que a UI devolve quando não alterou o campo), mantemos o
    // token anterior; caso contrário atualizamos com o novo valor (que
    // pode ser null/"string vazia" para limpar). O token é CIFRADO antes
    // de ir para o banco.
    git_username?.trim() || null,
    (git_token === '__PTD_REDACTED__' ? null : encGitToken(git_token)),
    startup_command?.trim() || null,
    main_file?.trim() || null, node_packages?.trim() || null, unnode_packages?.trim() || null, node_args?.trim() || null,
    auto_update ? 1 : 0, allow_file_uploads ? 1 : 0,
  );

  const created = db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid);
  console.log(`[services] criado "${created.name}" (${created.runtime_type}, recipe=${created.recipe || 'n/a'}) em ${created.working_directory}`);

  // Semeia o projeto inicial da receita escolhida (só quando é um template
  // de verdade e não há repo pra clonar por cima).
  if (use_template && !isDocker && !(git_repo?.trim()) && recipes.hasScaffold(wantedRecipe)) {
    try {
      recipes.scaffoldService(wantedRecipe, created.working_directory, created.name);
    } catch (e) {
      console.error(`[services] falha ao aplicar template da receita ${wantedRecipe}: ${e.message}`);
    }
  }

  // Dispara o setup em background SOMENTE se há trabalho real a fazer
  // (repositório pra clonar ou pacotes pra instalar). Se é só o scaffold
  // inicial sem nada de especial, não vale a pena rodar npm install sobre
  // um package.json que não tem dependência nenhuma.
  const hasSetupWork = git_repo?.trim() || node_packages?.trim() || unnode_packages?.trim();
  if (run_setup && hasSetupWork) {
    setup.runSetup(created.id, { autoStart: !!auto_start }).catch((e) => {
      console.error(`[services] setup falhou ao disparar para ${created.name}:`, e.message);
    });
  }

  return res.status(201).json({ ...envForResponse(redactService(created)), recipe: recipes.describeRow(created) });
});

// PUT /api/services/:id — aceita update parcial
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
    git_repo, git_branch, git_username, git_token, startup_command, main_file, node_packages, unnode_packages, node_args,
    auto_update, allow_file_uploads, recipe,
    healthcheck_url, healthcheck_interval, healthcheck_timeout, healthcheck_enabled,
    process_memory_limit, process_cpu_limit,
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

  // Recomputa comando quando campos de config inicial mudarem.
  const needsRecompute = (
    (git_repo !== undefined && String(git_repo ?? '').trim() !== String(existing.git_repo ?? '').trim()) ||
    (git_branch !== undefined && String(git_branch ?? '').trim() !== String(existing.git_branch ?? '').trim()) ||
    (main_file !== undefined && String(main_file ?? '').trim() !== String(existing.main_file ?? '').trim()) ||
    (startup_command !== undefined && String(startup_command ?? '').trim() !== String(existing.startup_command ?? '').trim()) ||
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
        command: command !== undefined ? command : existing.command,
        git_repo: git_repo !== undefined ? git_repo : existing.git_repo,
        git_branch: git_branch !== undefined ? git_branch : existing.git_branch,
        git_username: git_username !== undefined ? git_username : existing.git_username,
        git_token: git_token !== undefined ? git_token : existing.git_token,
        main_file: main_file !== undefined ? main_file : existing.main_file,
        startup_command: startup_command !== undefined ? startup_command : existing.startup_command,
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

  // Tratamento seguro do token: se o cliente devolveu o placeholder
  // __PTD_REDACTED__, quer dizer que ele não foi alterado; mantemos o
  // valor atual. Se veio string vazia/null, limpamos. Se veio um token
  // novo, atualizamos. O novo valor é CIFRADO antes de gravar.
  let nextGitToken = existing.git_token;
  if (git_token !== undefined) {
    if (git_token === '__PTD_REDACTED__') {
      nextGitToken = existing.git_token;
    } else if (git_token === '' || git_token === null) {
      nextGitToken = null;
    } else {
      nextGitToken = encGitToken(git_token);
    }
  }

  const nextCommand = (command !== undefined
    ? pickText(command, existing.command ?? '')
    : (recomputed ? recomputed.command.trim() : existing.command));

  db.prepare(`
    UPDATE services SET
      name=?, description=?, type=?, command=?, working_directory=?,
      environment=?, auto_restart=?, restart_delay=?, max_restarts=?, port=?, tunnel_hostname=?,
      docker_host_id=?, image=?, volumes=?, docker_networks=?, docker_ports=?, cpu_limit=?, memory_limit=?,
      git_repo=?, git_branch=?, git_username=?, git_token=?, startup_command=?,
      main_file=?, node_packages=?, unnode_packages=?, node_args=?, auto_update=?, allow_file_uploads=?,
      recipe=?, healthcheck_url=?, healthcheck_interval=?, healthcheck_timeout=?, healthcheck_enabled=?,
      process_memory_limit=?, process_cpu_limit=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    pickText(name, existing.name),
    pickText(description, existing.description),
    type ?? existing.type,
    nextCommand,
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
    nextGitToken,
    startup_command !== undefined ? (startup_command?.trim() || null) : existing.startup_command,
    main_file !== undefined ? (main_file?.trim() || null) : existing.main_file,
    node_packages !== undefined ? (node_packages?.trim() || null) : existing.node_packages,
    unnode_packages !== undefined ? (unnode_packages?.trim() || null) : existing.unnode_packages,
    node_args !== undefined ? (node_args?.trim() || null) : existing.node_args,
    auto_update !== undefined ? (auto_update ? 1 : 0) : existing.auto_update,
    allow_file_uploads !== undefined ? (allow_file_uploads ? 1 : 0) : existing.allow_file_uploads,
    recipe !== undefined ? recipe : existing.recipe,
    healthcheck_url !== undefined ? (healthcheck_url?.trim() || null) : existing.healthcheck_url,
    healthcheck_interval !== undefined ? (parseInt(healthcheck_interval, 10) || 30) : existing.healthcheck_interval,
    healthcheck_timeout !== undefined ? (parseInt(healthcheck_timeout, 10) || 5) : existing.healthcheck_timeout,
    healthcheck_enabled !== undefined ? (healthcheck_enabled ? 1 : 0) : existing.healthcheck_enabled,
    process_memory_limit !== undefined
      ? (process_memory_limit ? parseInt(process_memory_limit, 10) : null)
      : existing.process_memory_limit,
    process_cpu_limit !== undefined
      ? (process_cpu_limit ? parseFloat(process_cpu_limit) : null)
      : existing.process_cpu_limit,
    existing.id,
  );

  const updated = db.prepare('SELECT * FROM services WHERE id = ?').get(existing.id);
  return res.json({ ...envForResponse(redactService(updated)), recipe: recipes.describeRow(updated) });
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
      if (!forceRemove) {
        return res.status(502).json({
          error: `Não foi possível remover o container no host Docker (${err.message}). O serviço não foi apagado — repita com force=true para apagar mesmo assim (o container pode continuar existindo no host).`,
        });
      }
    }
  }

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
  db.prepare('DELETE FROM setup_logs WHERE service_id = ?').run(svc.id);
  forgetService(svc.id);
  backups.forgetService(svc.id);
  terminals.closeForService(svc.id);

  console.log(`[services] removido "${svc.name}"${filesRemoved ? ' (workspace apagado)' : ''}`);
  return res.json({ ok: true, filesRemoved });
});

// ── Ciclo de vida ────────────────────────────────────────────────────────
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

router.post('/:id/start', lifecycle('startService', 'iniciar'));
router.post('/:id/stop', lifecycle('stopService', 'parar'));
router.post('/:id/restart', lifecycle('restartService', 'reiniciar'));

// POST /api/services/:id/input
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

// GET /api/services/:id/logs
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

// GET /api/services/:id/setup — estado atual do setup + logs recentes
router.get('/:id/setup', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;
  const db = getDB();
  const svc = db.prepare('SELECT id FROM services WHERE id = ?').get(id);
  if (!svc) return res.status(404).json({ error: 'Serviço não encontrado' });
  return res.json({
    ...setup.getState(id),
    logs: setup.getSetupLogs(id, 500),
  });
});

// POST /api/services/:id/setup — dispara setup (com trava contra duplicatas)
router.post('/:id/setup', async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;
  const db = getDB();
  const svc = db.prepare('SELECT id FROM services WHERE id = ?').get(id);
  if (!svc) return res.status(404).json({ error: 'Serviço não encontrado' });
  if (setup.isRunning(id)) {
    return res.status(409).json({ error: 'Setup já está em execução para este serviço' });
  }
  const autoStart = req.body?.auto_start !== false; // default true
  // Resposta volta imediatamente; progresso via socket.
  setup.runSetup(id, { autoStart }).catch((e) => {
    console.error(`[services] setup falhou ao disparar para ${id}:`, e.message);
  });
  return res.json({ ok: true, running: true, state: setup.getState(id) });
});

// GET /api/services/:id/disk-usage
const diskUsageCache = new Map();
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
