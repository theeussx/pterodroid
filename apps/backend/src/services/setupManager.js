'use strict';
/**
 * SetupManager — orquestra o bootstrap inicial de um serviço.
 *
 * Cuida, em sequência e com controle de erro em cada etapa:
 *   1. clonar/atualizar o repositório Git (com token mascarado);
 *   2. detectar o gerenciador de pacotes (npm/pnpm/yarn/bun);
 *   3. instalar dependências;
 *   4. compilar TypeScript (se houver tsconfig.json e script "build");
 *   5. inferir o comando de inicialização (startup_command > main_file > heurística);
 *   6. (opcional) iniciar o serviço depois do setup.
 *
 * Estado de setup por serviço é persistido no SQLite e transmitido por
 * socket.io em tempo real (evento `service:setup`), pra UI poder mostrar
 * barra de progresso / etapa atual / logs.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getDB } = require('../db');
const cipher = require('./secretCipher');
const workspaces = require('./workspaceManager');
const recipes = require('./serviceRecipes');
const driver = require('./serviceDriverRegistry');
const io = require('../sockets/lazyIo');

const STEPS = [
  'idle',
  'cloning',        // clonando/atualizando Git
  'installing',     // instalando dependências
  'building',       // compilando TypeScript
  'starting',       // iniciando serviço
  'done',
  'failed',
];

const STEP_LABELS = {
  idle: 'Aguardando',
  cloning: 'Clonando repositório',
  installing: 'Instalando dependências',
  building: 'Compilando',
  starting: 'Iniciando serviço',
  done: 'Concluído',
  failed: 'Falhou',
};

/** Mapa em memória serviceId -> estado atual (bloqueia setups duplicados). */
const running = new Map();

function getState(serviceId) {
  const db = getDB();
  const row = db.prepare(
    'SELECT setup_status, setup_step, setup_progress, setup_error, setup_started_at, setup_finished_at FROM services WHERE id = ?',
  ).get(serviceId);
  if (!row) return null;
  return {
    status: row.setup_status || 'idle',
    step: row.setup_step || 'idle',
    progress: row.setup_progress || 0,
    error: row.setup_error || '',
    startedAt: row.setup_started_at || null,
    finishedAt: row.setup_finished_at || null,
    running: running.has(serviceId),
  };
}

function persistState(serviceId, patch) {
  const db = getDB();
  const current = db.prepare(
    'SELECT setup_status, setup_step, setup_progress, setup_error FROM services WHERE id = ?',
  ).get(serviceId) || {};
  const next = {
    setup_status: patch.status ?? current.setup_status ?? 'idle',
    setup_step: patch.step ?? current.setup_step ?? 'idle',
    setup_progress: patch.progress ?? current.setup_progress ?? 0,
    setup_error: patch.error ?? current.setup_error ?? '',
  };
  db.prepare(`
    UPDATE services
    SET setup_status = ?, setup_step = ?, setup_progress = ?, setup_error = ?
      , setup_started_at = COALESCE(?, setup_started_at)
      , setup_finished_at = ?
    WHERE id = ?
  `).run(
    next.setup_status, next.setup_step, next.setup_progress, next.setup_error,
    patch.startedAt ?? null,
    patch.finishedAt ?? null,
    serviceId,
  );
  io.emit?.('service:setup', { serviceId, ...next, running: running.has(serviceId) });
}

/**
 * Executa um comando externo capturando stdout+stderr em tempo real,
 * respeitando um timeout e devolvendo { code, stdout, stderr, timedOut }.
 *
 * Não usa terminalManager: as sessões de terminal são para USUÁRIO, e se
 * o usuário abrir uma enquanto o setup roda os dois disputariam o shell.
 */
function runCmd({ cwd, command, args = [], env, timeoutMs = 10 * 60 * 1000, onLog }) {
  return new Promise((resolve) => {
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...(env || {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ code: 127, stdout: '', stderr: err.message, timedOut: false });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout.push(text);
      onLog?.({ stream: 'stdout', text });
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr.push(text);
      onLog?.({ stream: 'stderr', text });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      stderr.push(err.message);
      onLog?.({ stream: 'stderr', text: `${err.message}\n` });
      resolve({ code: 127, stdout: stdout.join(''), stderr: stderr.join(''), timedOut: false });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: stdout.join(''), stderr: stderr.join(''), timedOut });
    });
  });
}

/**
 * Monta a URL de clone SEM expor o token no comando (evita vazamento via ps).
 * O token é fornecido separadamente via GIT_ASKPASS para autenticação segura.
 */
function buildCloneUrl(repo, username, token) {
  try {
    const u = new URL(repo);
    // Sempre inclui username (real ou oauth2) para que git solicite
    // apenas senha (token), permitindo usar GIT_ASKPASS de forma segura.
    if (username && String(username).trim()) {
      u.username = encodeURIComponent(String(username).trim());
    } else if (token && String(token).trim()) {
      u.username = encodeURIComponent('oauth2');
    } else {
      u.username = '';
    }
    // NUNCA embute token na URL — protege contra exposição em ps / logs / erros.
    u.password = '';
    return u.toString();
  } catch {
    return repo;
  }
}

/** Cria um script temporário GIT_ASKPASS que responde apenas o token. */
function createAskPass(rootDir, token) {
  const askPath = path.join(rootDir, '.git-askpass');
  const safeToken = String(token || '').trim();
  const script = `#!/bin/sh\necho "${safeToken}"\n`;
  try {
    fs.writeFileSync(askPath, script);
    fs.chmodSync(askPath, 0o700);
  } catch {
    // Se não conseguir escrever, o clone pode falhar — mas não bloqueia.
  }
  return askPath;
}

/** Substitui ocorrências do token em qualquer texto que vá pro log. */
function maskToken(text, token) {
  if (!token) return text;
  const t = String(token);
  if (t.length < 4) return text;
  return String(text).split(t).join('***');
}

/**
 * Detecta qual gerenciador de pacotes deve ser usado.
 * Prioridade: bun.lockb → pnpm-lock.yaml → yarn.lock → package-lock.json → package.json (npm).
 */
function detectPackageManager(rootDir) {
  if (fs.existsSync(path.join(rootDir, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(rootDir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(rootDir, 'package-lock.json'))) return 'npm';
  return 'npm';
}

/** Resolve qual binário usar pro package manager, dando fallbacks seguros. */
function pmBinary(pm) {
  switch (pm) {
    case 'pnpm': return 'pnpm';
    case 'yarn': return 'yarn';
    case 'bun': return 'bun';
    default: return 'npm';
  }
}

function readJSON(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Constrói o comando final de inicialização, respeitando a prioridade:
 *   startup_command explícito > main_file > inferência por package.json/scripts
 *   > heurística de arquivos presentes.
 */
function withArgs(cmd, nodeArgs) {
  const a = (nodeArgs || '').trim();
  return a ? `${cmd} ${a}` : cmd;
}

function resolveStartupCommand({ startup_command, main_file, rootDir, isDocker, node_args = '', recipe = null }) {
  const dockerPrefix = isDocker ? 'cd /app && ' : '';
  const cwdPrefix = isDocker ? '/app/' : '';
  const sc = (startup_command || '').trim();
  if (sc) {
    const inner = withArgs(sc, node_args);
    if (isDocker) return `sh -c 'cd /app && ${inner}'`;
    return `sh -c '${inner}'`;
  }

  const mf = (main_file || '').trim();

  if (mf) {
    const mfRel = mf.replace(/^\/+/, '');
    const looksLikeFullCommand = /\s/.test(mfRel);
    if (looksLikeFullCommand) {
      return `sh -c '${dockerPrefix}${withArgs(mfRel, node_args)}'`;
    }
    if (mf.endsWith('.ts')) {
      const distCandidate = mfRel
        .replace(/^src\//, 'dist/')
        .replace(/\.ts$/, '.js');
      const distFull = path.join(rootDir, distCandidate);
      if (fs.existsSync(distFull)) {
        return `sh -c '${dockerPrefix}node "${cwdPrefix}${distCandidate}" ${withArgs('', node_args)}'`.replace(/\s*'$/, "'");
      }
      return `sh -c '${dockerPrefix}ts-node --esm "${cwdPrefix}${mfRel}" ${withArgs('', node_args)}'`.replace(/\s*'$/, "'");
    }
    return `sh -c '${dockerPrefix}node "${cwdPrefix}${mfRel}" ${withArgs('', node_args)}'`.replace(/\s*'$/, "'");
  }

  const pkg = readJSON(path.join(rootDir, 'package.json'), null);
  if (pkg) {
    const distIndex = path.join(rootDir, 'dist', 'index.js');
    if (fs.existsSync(distIndex)) {
      return `sh -c '${dockerPrefix}node "${cwdPrefix}dist/index.js" ${withArgs('', node_args)}'`.replace(/\s*'$/, "'");
    }
    if (pkg.scripts?.start) {
      const inner = withArgs('npm start', node_args ? `-- ${node_args}` : '');
      return `sh -c '${dockerPrefix}${inner}'`;
    }
    if (pkg.main) {
      const main = pkg.main.replace(/^\/+/, '');
      return `sh -c '${dockerPrefix}node "${cwdPrefix}${main}" ${withArgs('', node_args)}'`.replace(/\s*'$/, "'");
    }
  }
  for (const f of ['index.js', 'server.js', 'app.js', 'main.js']) {
    if (fs.existsSync(path.join(rootDir, f))) {
      return `sh -c '${dockerPrefix}node "${cwdPrefix}${f}" ${withArgs('', node_args)}'`.replace(/\s*'$/, "'");
    }
  }

  // Fallbacks dedicados por receita: Python e site estático não têm
  // package.json, mas não devem precisar de comando explícito pra subir.
  const recipeLang = recipe?.language;
  if (recipeLang === 'python') {
    for (const f of ['app.py', 'main.py', 'server.py']) {
      if (fs.existsSync(path.join(rootDir, f))) {
        const inner = `python3 "${cwdPrefix}${f}" ${withArgs('', node_args)}`;
        return `sh -c '${dockerPrefix}${inner}'`.replace(/\s*'$/, "'");
      }
    }
  }
  if (recipeLang === 'static' || (fs.existsSync(path.join(rootDir, 'index.html')) && !pkg)) {
    return `sh -c '${dockerPrefix}python3 -m http.server 8080 --directory .'`;
  }
  return '';
}

/**
 * Guarda um pedaço do log de setup em memória + tabela setup_logs, para
 * que a UI possa reabrir o serviço depois e ver o que aconteceu.
 */
function appendSetupLog(serviceId, stream, text) {
  const db = getDB();
  try {
    db.prepare('INSERT INTO setup_logs(service_id, stream, message) VALUES (?, ?, ?)')
      .run(serviceId, stream || 'info', String(text).slice(0, 4000));
  } catch {
    // Tabela pode ainda não existir em DBs legados; não bloqueia o setup.
  }
}

function getSetupLogs(serviceId, limit = 500) {
  const db = getDB();
  try {
    return db.prepare(
      'SELECT stream, message, timestamp FROM setup_logs WHERE service_id = ? ORDER BY id DESC LIMIT ?',
    ).all(serviceId, limit).reverse();
  } catch {
    return [];
  }
}

function clearSetupLogs(serviceId) {
  const db = getDB();
  try { db.prepare('DELETE FROM setup_logs WHERE service_id = ?').run(serviceId); } catch { /* ignore */ }
}

/**
 * Executa o setup de um serviço. Bloqueia se já houver um setup rodando.
 *
 * @param {number} serviceId
 * @param {object} [opts]
 * @param {boolean} [opts.autoStart=false]  - inicia o serviço ao final se der certo
 * @returns {Promise<{ok: boolean, error?: string, command?: string}>}
 */
async function runSetup(serviceId, opts = {}) {
  const db = getDB();
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!service) throw Object.assign(new Error('Serviço não encontrado'), { status: 404 });
  if (running.has(serviceId)) {
    throw Object.assign(new Error('Já existe um setup em execução para este serviço'), { status: 409 });
  }

  // Proteção contra sessões anteriores após reinício do painel (stale state)
  const currentDB = db.prepare('SELECT setup_status, setup_started_at FROM services WHERE id = ?').get(serviceId);
  if (currentDB && currentDB.setup_status === 'running') {
    const started = currentDB.setup_started_at ? new Date(currentDB.setup_started_at) : null;
    const now = new Date();
    if (started && (now - started) < 5 * 60 * 1000) {
      throw Object.assign(new Error('Setup parece ainda estar em andamento (sessão anterior) — aguarde ou reinicie o serviço'), { status: 409 });
    } else {
      // Stale state — reseta para permitir nova tentativa sem corromper workspace
      db.prepare("UPDATE services SET setup_status = 'idle', setup_step = 'idle', setup_progress = 0, setup_error = '' WHERE id = ?").run(serviceId);
    }
  }

  // O git_token é armazenado cifrado (segredos em repouso). Decifra aqui,
  // no único ponto em que ele é necessário — autenticação do clone.
  const decryptedToken = cipher.decrypt(service.git_token);
  service.git_token = decryptedToken;

  running.set(serviceId, { startedAt: Date.now() });
  const isDocker = service.runtime_type === 'docker';
  const rootDir = workspaces.normalize(service.working_directory)
    || workspaces.createForService(service.name);
  workspaces.ensureDir(rootDir);

  // Se o working_directory mudou por normalização, persiste.
  if (rootDir !== service.working_directory) {
    db.prepare('UPDATE services SET working_directory = ? WHERE id = ?').run(rootDir, serviceId);
    service.working_directory = rootDir;
  }

  clearSetupLogs(serviceId);
  persistState(serviceId, {
    status: 'running',
    step: 'idle',
    progress: 0,
    error: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  const emitLog = (stream, text) => {
    const safe = maskToken(text, service.git_token);
    appendSetupLog(serviceId, stream, safe);
    io.emit?.('service:setup-log', { serviceId, stream, text: safe });
  };

  const setStep = (step, progress) => {
    persistState(serviceId, { step, progress });
  };

  const markFailed = (errMsg) => {
    persistState(serviceId, {
      status: 'failed',
      step: 'failed',
      error: errMsg,
      finishedAt: new Date().toISOString(),
    });
    running.delete(serviceId);
    io.emit?.('service:setup', { serviceId, status: 'failed', step: 'failed', error: errMsg, progress: 100, running: false });
  };

  try {
    // ── ETAPA 1: Git clone / pull ──────────────────────────────────────
    const repo = (service.git_repo || '').trim();
    if (repo) {
      setStep('cloning', 5);
      const gitDir = path.join(rootDir, '.git');
      const branch = (service.git_branch || '').trim();

      // Segurança: prepara script de autenticação quando há token (nunca expõe na URL)
      let askPassPath = null;
      if (service.git_token && String(service.git_token).trim()) {
        askPassPath = createAskPass(rootDir, service.git_token);
      }

      if (fs.existsSync(gitDir)) {
        emitLog('info', `↻ Atualizando repositório em ${rootDir}…\n`);
        if (branch) {
          emitLog('info', `→ checkout ${branch}\n`);
          const r = await runCmd({
            cwd: rootDir,
            command: 'git',
            args: ['checkout', branch],
            env: askPassPath ? { GIT_ASKPASS: askPassPath } : {},
            onLog: (l) => emitLog(l.stream, l.text),
            timeoutMs: 60_000,
          });
          if (r.code !== 0) {
            throw new Error(`git checkout falhou (código ${r.code})`);
          }
        }
        if (service.auto_update) {
          // `git pull` SEM `--rebase` e SEM `|| true` — precisa falhar se
          // não der, pra podermos avisar o usuário e tentar de novo.
          // Antes era `|| true` e engolia falhas silenciosamente.
          emitLog('info', '→ git pull\n');
          const r = await runCmd({
            cwd: rootDir,
            command: 'git',
            args: ['pull', '--ff-only'],
            env: askPassPath ? { GIT_ASKPASS: askPassPath } : {},
            onLog: (l) => emitLog(l.stream, l.text),
            timeoutMs: 2 * 60_000,
          });
          if (r.code !== 0) {
            throw new Error(`git pull falhou (código ${r.code}) — resolva os conflitos ou limpe a pasta antes de tentar de novo`);
          }
        }
      } else {
        // Clone limpo. Se a pasta não estiver vazia (ex.: resto de um
        // clone interrompido), movemos o lixo pra .partial-clone-<ts>
        // antes de tentar de novo — evita o erro "destination path '.'
        // already exists" que deixava o workspace travado.
        const entries = fs.readdirSync(rootDir).filter((e) => e !== '.gitkeep');
        if (entries.length > 0) {
          const quarantine = path.join(rootDir, `..partial-clone-${Date.now()}`);
          try { fs.renameSync(rootDir, quarantine); } catch { /* melhor esforço */ }
          workspaces.ensureDir(rootDir);
          emitLog('warn', '(pasta não vazia — conteúdo movido para lado antes de clonar)\n');
        }

        const cloneUrl = buildCloneUrl(repo, service.git_username, service.git_token);
        emitLog('info', `→ git clone ${maskToken(repo, service.git_token)}\n`);

        const args = ['clone', '--progress'];
        if (branch) args.push('--branch', branch);
        args.push(cloneUrl, '.');

        const gitEnv = askPassPath ? { GIT_ASKPASS: askPassPath } : {};

        const r = await runCmd({
          cwd: rootDir,
          command: 'git',
          args,
          env: gitEnv,
          onLog: (l) => emitLog(l.stream, l.text),
          timeoutMs: 5 * 60_000,
        });
        if (r.code !== 0) {
          // Falha de clone: aponta a pasta com o que quer que tenha
          // sobrado, para a próxima tentativa começar de limpo.
          try { fs.rmSync(path.join(rootDir, '.git'), { recursive: true, force: true }); } catch { /* ignore */ }
          const msg = r.timedOut
            ? 'git clone excedeu o tempo limite'
            : `git clone falhou (código ${r.code}) — verifique a URL, as credenciais e sua conexão`;
          throw new Error(msg);
        }
        emitLog('info', '✓ repositório clonado\n');
      }
    }
    setStep('cloning', 100);

    // ── ETAPA 2: Detecção + instalação de dependências ─────────────────
    const pkgPath = path.join(rootDir, 'package.json');
    const hasPkg = fs.existsSync(pkgPath);

    // node_modules existente e com conteúdo = não precisamos rodar install
    // de novo, a menos que o usuário tenha pedido pacotes explícitos
    // (add/remove) ou que não haja node_modules.
    const nodeModulesDir = path.join(rootDir, 'node_modules');
    const nodeModulesExists = fs.existsSync(nodeModulesDir)
      && fs.readdirSync(nodeModulesDir).length > 0;

    const extraAdd = (service.node_packages || '').trim();
    const extraRemove = (service.unnode_packages || '').trim();

    if (hasPkg || extraAdd || extraRemove) {
      setStep('installing', 5);
      const pm = detectPackageManager(rootDir);
      const bin = pmBinary(pm);
      emitLog('info', `→ gerenciador de pacotes detectado: ${pm}\n`);

      // Remoções primeiro — pra não instalar algo que o usuário já marcou
      // pra remover, numa única rodada.
      if (extraRemove) {
        emitLog('info', `→ ${pm} remove ${extraRemove}\n`);
        const args = pm === 'npm' ? ['uninstall', ...extraRemove.split(/\s+/)]
          : pm === 'pnpm' ? ['remove', ...extraRemove.split(/\s+/)]
          : pm === 'yarn' ? ['remove', ...extraRemove.split(/\s+/)]
          : ['remove', ...extraRemove.split(/\s+/)];
        const r = await runCmd({
          cwd: rootDir,
          command: bin,
          args,
          onLog: (l) => emitLog(l.stream, l.text),
          timeoutMs: 10 * 60_000,
        });
        if (r.code !== 0) {
          throw new Error(`${pm} remove falhou (código ${r.code})`);
        }
      }

      const installArgs = extraAdd
        ? (pm === 'npm' ? ['install', ...extraAdd.split(/\s+/)]
          : pm === 'pnpm' ? ['add', ...extraAdd.split(/\s+/)]
          : pm === 'yarn' ? ['add', ...extraAdd.split(/\s+/)]
          : ['add', ...extraAdd.split(/\s+/)])
        : ['install'];

      // Se não há nada novo pra adicionar e node_modules já existe, pula
      // pra proteger de execução duplicada de install em restarts.
      const skipInstall = !extraAdd && nodeModulesExists;
      if (skipInstall) {
        emitLog('info', '✓ dependências já instaladas (node_modules presente), pulando install\n');
      } else {
        emitLog('info', `→ ${pm} ${installArgs.join(' ')}\n`);
        const r = await runCmd({
          cwd: rootDir,
          command: bin,
          args: installArgs,
          onLog: (l) => emitLog(l.stream, l.text),
          timeoutMs: 10 * 60_000,
        });
        if (r.code !== 0) {
          const msg = r.timedOut
            ? `${pm} install excedeu o tempo limite`
            : `${pm} install falhou (código ${r.code}) — verifique conflitos de dependências`;
          throw new Error(msg);
        }
        emitLog('info', '✓ dependências instaladas\n');
      }
    }
    // Receitas Python (ou projetos com requirements.txt) instalam via pip,
    // independente de haver package.json — é o equivalente dedicado ao
    // `npm install` do Node.
    const recipeForService = recipes.get(service.recipe) || recipes.forType(service.type);
    const requirementsPath = path.join(rootDir, 'requirements.txt');
    if ((recipeForService.language === 'python' || fs.existsSync(requirementsPath)) && fs.existsSync(requirementsPath)) {
      setStep('installing', 30);
      emitLog('info', '→ requirements.txt detectado; instalando dependências Python (pip)\\n');
      const r = await runCmd({
        cwd: rootDir,
        command: 'python3',
        args: ['-m', 'pip', 'install', '-r', 'requirements.txt'],
        onLog: (l) => emitLog(l.stream, l.text),
        timeoutMs: 10 * 60_000,
      });
      if (r.code !== 0) {
        const msg = r.timedOut
          ? 'pip install excedeu o tempo limite'
          : `pip install falhou (código ${r.code}) — verifique as dependências em requirements.txt`;
        throw new Error(msg);
      }
      emitLog('info', '✓ dependências Python instaladas\\n');
    }
    setStep('installing', 100);

    // ── ETAPA 3: Build TypeScript ───────────────────────────────────────
    const tsConfigPath = path.join(rootDir, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      const pkg = readJSON(pkgPath, {});
      const hasBuildScript = !!pkg?.scripts?.build;
      const distDir = path.join(rootDir, 'dist');
      const distReady = fs.existsSync(distDir) && fs.readdirSync(distDir).length > 0;
      const tscAvailable = fs.existsSync(path.join(rootDir, 'node_modules', '.bin', 'tsc')) || fs.existsSync(path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc'));

      if (hasBuildScript) {
        setStep('building', 5);
        emitLog('info', '→ tsconfig.json detectado; rodando build via script\n');
        const pm = detectPackageManager(rootDir);
        const bin = pmBinary(pm);

        // Determina a forma de invocar o script "build" conforme o PM.
        let buildArgs;
        if (pm === 'npm') buildArgs = ['run', 'build'];
        else if (pm === 'pnpm') buildArgs = ['run', 'build'];
        else if (pm === 'yarn') buildArgs = ['build'];
        else buildArgs = ['run', 'build'];

        const r = await runCmd({
          cwd: rootDir,
          command: bin,
          args: buildArgs,
          onLog: (l) => emitLog(l.stream, l.text),
          timeoutMs: 5 * 60_000,
        });
        if (r.code !== 0) {
          throw new Error(`build TypeScript falhou (código ${r.code}) — corrija os erros de compilação antes de iniciar`);
        }
        if (!fs.existsSync(distDir) || fs.readdirSync(distDir).length === 0) {
          emitLog('warn', '(build concluído mas nenhum arquivo foi gerado em dist/ — seguindo assim mesmo)\n');
        } else {
          emitLog('info', '✓ build concluído\n');
        }
      } else if (tscAvailable) {
        setStep('building', 5);
        emitLog('info', '→ tsconfig.json detectado (sem script "build"); executando compile direto (tsc)\n');
        const r = await runCmd({
          cwd: rootDir,
          command: 'npx',
          args: ['tsc'],
          onLog: (l) => emitLog(l.stream, l.text),
          timeoutMs: 5 * 60_000,
        });
        if (r.code !== 0) {
          throw new Error(`compilação TypeScript direta falhou (código ${r.code}) — corrija os erros antes de iniciar`);
        }
        if (!fs.existsSync(distDir) || fs.readdirSync(distDir).length === 0) {
          emitLog('warn', '(tsc concluído mas nenhum arquivo foi gerado em dist/ — seguindo assim mesmo)\n');
        } else {
          emitLog('info', '✓ compilação TypeScript concluída\n');
        }
      } else {
        emitLog('info', '• tsconfig.json presente mas não há script "build" nem typescript instalado — pulando compilação\n');
      }
    }
    setStep('building', 100);

    // ── ETAPA 4: Resolver comando final ────────────────────────────────
    const finalCommand = resolveStartupCommand({
      startup_command: service.startup_command,
      main_file: service.main_file,
      rootDir,
      isDocker,
      node_args: service.node_args,
      recipe: recipes.get(service.recipe) || recipes.forType(service.type),
    });

    if (finalCommand && finalCommand.trim() !== String(service.command || '').trim()) {
      db.prepare('UPDATE services SET command = ? WHERE id = ?').run(finalCommand.trim(), serviceId);
      emitLog('info', `→ comando de inicialização: ${finalCommand.trim()}\n`);
    }

    // ── ETAPA 5: Iniciar o serviço (se pedido) ─────────────────────────
    if (opts.autoStart) {
      setStep('starting', 10);
      emitLog('info', '→ iniciando serviço…\n');
      try {
        await driver.startService(serviceId);
        emitLog('info', '✓ serviço iniciado\n');
      } catch (err) {
        throw new Error(`setup concluído mas o serviço falhou ao iniciar: ${err.message}`);
      }
    }

    setStep('done', 100);
    persistState(serviceId, {
      status: 'done',
      step: 'done',
      progress: 100,
      error: '',
      finishedAt: new Date().toISOString(),
    });
    running.delete(serviceId);
    io.emit?.('service:setup', {
      serviceId, status: 'done', step: 'done', progress: 100, error: '', running: false,
      command: finalCommand,
    });
    return { ok: true, command: finalCommand };
  } catch (err) {
    emitLog('stderr', `✗ ${err.message}\n`);
    markFailed(err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  STEPS,
  STEP_LABELS,
  getState,
  getSetupLogs,
  runSetup,
  resolveStartupCommand,
  detectPackageManager,
  isRunning: (serviceId) => running.has(serviceId),
};
