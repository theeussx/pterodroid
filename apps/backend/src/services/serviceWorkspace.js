'use strict';
/**
 * serviceWorkspace — decide QUAL pasta um serviço usa e o que precisa
 * existir dentro dela ANTES do setup/start.
 *
 * Responsabilidade: preparar a ESTRUTURA de diretórios e o comando
 * inicial (heurístico). O bootstrap pesado (git clone, npm install,
 * build TypeScript) roda pelo setupManager.js, invocado por rota/trigger
 * explícito ou depois da criação, com estado observável.
 */
const fs = require('fs');
const path = require('path');
const workspaces = require('./workspaceManager');

function parseJSONArray(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Comando de container quando o usuário não informou nenhum. Agora fica
 * de: detecta dist/index.js (TS compilado) → index.js → server.js → erro.
 *
 * NOTA: esta heurística é substituída em tempo de setup por
 * setupManager.resolveStartupCommand, que considera package.json, scripts
 * e o resultado real do build. O valor daqui é apenas um fallback seguro
 * para quando o container for iniciado sem setup ter rodado.
 */
function inferDockerCommand(image, command) {
  const trimmed = (command || '').trim();
  if (trimmed) {
    return trimmed.replace(/^bash\s+-lc\b/, 'sh -lc').replace(/^bash\s+-c\b/, 'sh -c');
  }

  const imageName = String(image || '').toLowerCase();
  if (imageName.includes('node') || imageName.includes('npm')) {
    return "sh -c 'cd /app && if [ -f dist/index.js ]; then node dist/index.js; elif [ -f index.js ]; then node index.js; elif [ -f server.js ]; then node server.js; else echo \"Nenhum entrypoint encontrado (dist/index.js, index.js ou server.js) em /app\"; exit 1; fi'";
  }
  return '';
}

/**
 * Semeia um projeto Node mínimo e utilizável.
 *
 * Não roda `npm install` aqui: o starter não tem dependências e não
 * precisa travar o request HTTP. Instalação de dependências reais é
 * tarefa do setupManager.
 */
function bootstrapNodeProject(rootDir, name) {
  if (!rootDir) return false;
  workspaces.ensureDir(rootDir);

  const packagePath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    const packageJson = {
      name: workspaces.slugify(name),
      version: '1.0.0',
      private: true,
      description: `Projeto inicial de ${name}`,
      main: 'index.js',
      scripts: {
        start: 'node index.js',
        build: 'tsc',
        'start:prod': 'node dist/index.js',
      },
    };
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }

  const indexPath = path.join(rootDir, 'index.js');
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, [
      "const http = require('http');",
      '',
      'const port = Number(process.env.PORT || 3000);',
      '',
      'const server = http.createServer((req, res) => {',
      "  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });",
      "  res.end('Pterodroid: seu serviço está no ar\\n');",
      '});',
      '',
      'server.listen(port, () => {',
      "  console.log('Servidor ouvindo na porta ' + port);",
      '});',
      '',
    ].join('\n'));
  }

  const tsConfigPath = path.join(rootDir, 'tsconfig.json');
  if (!fs.existsSync(tsConfigPath)) {
    fs.writeFileSync(tsConfigPath, JSON.stringify({
      compilerOptions: {
        outDir: 'dist',
        module: 'commonjs',
        target: 'es2020',
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    }, null, 2) + '\n');
  }

  const srcDir = path.join(rootDir, 'src');
  try { fs.mkdirSync(srcDir, { recursive: true }); } catch {}
  const tsIndexPath = path.join(srcDir, 'index.ts');
  if (!fs.existsSync(tsIndexPath)) {
    fs.writeFileSync(tsIndexPath, [
      "import http from 'http';",
      '',
      'const port = Number(process.env.PORT || 3000);',
      '',
      'const server = http.createServer((req, res) => {',
      "  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });",
      "  res.end('Pterodroid: seu serviço TypeScript está no ar\\n');",
      "});",
      '',
      'server.listen(port, () => {',
      "  console.log('Servidor TS ouvindo na porta ' + port);",
      "});",
      '',
    ].join('\n'));
  }

  const readmePath = path.join(rootDir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, [
      `# ${name}`,
      '',
      'Projeto criado automaticamente pelo Pterodroid.',
      '',
      'Edite os arquivos por esta pasta ou pela aba **Arquivos** do painel.',
      'Use o botão **Executar Setup** para clonar repositórios, instalar dependências e iniciar.',
      '',
    ].join('\n'));
  }

  return true;
}

/**
 * Resolve o workspace e o comando inicial heurístico.
 *
 * IMPORTANTE: esta função NÃO faz mais clone/install em background "fogo e
 * esquecimento". Isso era a fonte principal de bugs — rodava sem
 * observabilidade, engolia erros (`|| true`) e não conversava com o estado
 * do serviço. O bootstrap pesado agora é responsabilidade do
 * setupManager, que é acionado sob demanda (POST /setup) e devolve
 * progresso em tempo real.
 */
function resolveServiceWorkspace({ name, runtime_type, working_directory, volumes, image, command,
  git_repo, git_branch, git_username, git_token,
  main_file, node_packages, unnode_packages, node_args, auto_update = 0, allow_file_uploads = 0,
  startup_command }) {
  const isDocker = runtime_type === 'docker';
  const hasGit = !!(git_repo && String(git_repo).trim());

  let finalWorkingDir = workspaces.normalize(working_directory);
  let scaffolded = 0;

  if (!finalWorkingDir) {
    finalWorkingDir = workspaces.createForService(name);
    scaffolded = 1;
  } else {
    workspaces.ensureDir(finalWorkingDir);
  }

  let nextVolumes = volumes;
  let nextCommand = (command || '').trim();

  if (isDocker) {
    const arr = parseJSONArray(volumes);
    const source = workspaces.toHostPath(finalWorkingDir);
    const hasAppMount = arr.some((v) => v?.target === '/app');
    if (!hasAppMount) arr.push({ source, target: '/app' });
    nextVolumes = JSON.stringify(arr);

    if (!nextCommand) nextCommand = inferDockerCommand(image, nextCommand);

    // Só semeia o starter node se NÃO há repositório (com repo o clone
    // trará os arquivos do usuário; semear antes só atrapalha).
    const imageName = String(image || '').toLowerCase();
    if ((imageName.includes('node') || imageName.includes('npm')) && !hasGit) {
      bootstrapNodeProject(finalWorkingDir, name);
    }
  } else if (!hasGit) {
    // Processo local sem repo: garante um starter mínimo.
    bootstrapNodeProject(finalWorkingDir, name);
  }

  const args = (node_args || '').trim();
  const shellQuote = (inner) => `sh -c '${inner}'`;
  const joinArgs = (...parts) => parts.filter(Boolean).join(' ');

  // startup_command tem prioridade absoluta, se fornecido.
  const sc = (startup_command || '').trim();
  if (sc) {
    const inner = isDocker
      ? joinArgs('cd /app &&', sc, args)
      : joinArgs(sc, args);
    nextCommand = shellQuote(inner);
  } else if (main_file && main_file.trim()) {
    const mf = main_file.trim();
    const mfRel = mf.replace(/^\/+/, '');
    const looksLikeFullCommand = /\s/.test(mfRel);
    let inner;
    if (looksLikeFullCommand) {
      inner = isDocker
        ? joinArgs('cd /app &&', mfRel, args)
        : joinArgs(mfRel, args);
    } else if (mf.endsWith('.js')) {
      inner = isDocker
        ? joinArgs('cd /app && node', `"${mfRel}"`, args)
        : joinArgs('node', `"${mfRel}"`, args);
    } else if (mf.endsWith('.ts')) {
      inner = isDocker
        ? joinArgs('cd /app && ts-node --esm', `"${mfRel}"`, args)
        : joinArgs('ts-node --esm', `"${mfRel}"`, args);
    } else {
      inner = isDocker
        ? joinArgs('cd /app && node', `"${mfRel}"`, args)
        : joinArgs('node', `"${mfRel}"`, args);
    }
    nextCommand = shellQuote(inner);
  }

  return { finalWorkingDir, scaffolded, volumes: nextVolumes, command: nextCommand };
}

module.exports = {
  resolveServiceWorkspace,
  inferDockerCommand,
  bootstrapNodeProject,
  normalizeWorkingDirectory: workspaces.normalize,
};
