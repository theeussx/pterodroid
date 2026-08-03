'use strict';
/**
 * serviceWorkspace — decide QUAL pasta um serviço usa e o que precisa
 * existir dentro dela antes do primeiro start.
 *
 * Fica propositalmente fino: toda a resolução de caminho é delegada ao
 * workspaceManager (fonte única de verdade, Etapa 2). Aqui mora só a
 * política específica de serviço: montar o bind padrão de container e
 * semear um projeto Node inicial quando faz sentido.
 */
const fs = require('fs');
const path = require('path');
const workspaces = require('./workspaceManager');
const terminals = require('./terminalManager');

function parseJSONArray(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Comando padrão de um container quando o usuário não informou nenhum.
 *
 * Mudança importante em relação à versão anterior: NÃO roda mais
 * `npm install` no start do container. Aquilo transformava uma falha de
 * rede momentânea em exit code != 0, que a RestartPolicy do Docker
 * traduzia num loop de reinicialização — exatamente o que a Etapa 3 pede
 * pra eliminar. Dependências se instalam uma vez, na criação do
 * workspace, não a cada boot do container.
 */
function inferDockerCommand(image, command) {
  const trimmed = (command || '').trim();
  if (trimmed) {
    // `bash` não existe em imagens alpine/slim; `sh` existe em praticamente todas.
    return trimmed.replace(/^bash\s+-lc\b/, 'sh -lc').replace(/^bash\s+-c\b/, 'sh -c');
  }

  const imageName = String(image || '').toLowerCase();
  if (imageName.includes('node') || imageName.includes('npm')) {
    return "sh -c 'cd /app && if [ -f dist/index.js ]; then node dist/index.js; elif [ -f index.js ]; then node index.js; elif [ -f server.js ]; then node server.js; else echo \"Nenhum entrypoint encontrado (dist/index.js, index.js ou server.js) em /app\"; exit 1; fi'";
  }
  return '';
}

/**
 * Semeia um projeto Node mínimo e utilizável: package.json, index.js que
 * sobe um servidor HTTP e um README. Só cria o que ainda não existe, então
 * é seguro chamar sobre uma pasta que o usuário já povoou.
 *
 * Sem `npm install` aqui: era `execFileSync` no meio do request HTTP, o
 * que travava o event loop inteiro do painel por minutos num aparelho
 * Android (P15). O starter não tem dependências, então não precisa.
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
        'start:prod': 'node dist/index.js'
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

  // Seed a minimal TypeScript source and tsconfig so users can opt into TS.
  const tsConfigPath = path.join(rootDir, 'tsconfig.json');
  if (!fs.existsSync(tsConfigPath)) {
    fs.writeFileSync(tsConfigPath, JSON.stringify({
      compilerOptions: {
        outDir: 'dist',
        rootDir: 'src',
        module: 'commonjs',
        target: 'es2020',
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        strict: true,
        skipLibCheck: true
      },
      include: ["src/**/*.ts"]
    }, null, 2) + '\n');
  }

  const srcDir = path.join(rootDir, 'src');
  try { fs.mkdirSync(srcDir, { recursive: true }); } catch {}
  const tsIndexPath = path.join(srcDir, 'index.ts');
  if (!fs.existsSync(tsIndexPath)) {
    fs.writeFileSync(tsIndexPath, [
      "import http from 'http';",
      "",
      "const port = Number(process.env.PORT || 3000);",
      "",
      "const server = http.createServer((req, res) => {",
      "  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });",
      "  res.end('Pterodroid: seu serviço TypeScript está no ar\\n');",
      "});",
      "",
      "server.listen(port, () => {",
      "  console.log('Servidor TS ouvindo na porta ' + port);",
      "});",
      "",
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
      'Se adicionar dependências, rode `npm install` pelo terminal do serviço.',
      '',
    ].join('\n'));
  }

  return true;
}

/**
 * Resolve tudo que depende do workspace na criação de um serviço.
 * Devolve o diretório final, se ele foi criado pelo painel (e portanto
 * pode ser removido junto com o serviço), os volumes e o comando.
 */
function resolveServiceWorkspace({ name, runtime_type, working_directory, volumes, image, command, startup_command,
  git_repo, git_branch, git_username, git_token,
  main_file, node_packages, unnode_packages, node_args, auto_update = 0, allow_file_uploads = 0 }) {
  const isDocker = runtime_type === 'docker';

  let finalWorkingDir = workspaces.normalize(working_directory);
  let scaffolded = 0;

  if (!finalWorkingDir) {
    // Sem diretório informado: o painel cria um exclusivo pro serviço e
    // passa a ser dono dele (pode apagar depois, se o usuário pedir).
    finalWorkingDir = workspaces.createForService(name);
    scaffolded = 1;
  } else {
    workspaces.ensureDir(finalWorkingDir);
  }

  let nextVolumes = volumes;
  let nextCommand = (startup_command || command || '').trim();

  if (isDocker) {
    // O workspace do serviço é sempre montado em /app — é isso que faz
    // "editar arquivo no painel" refletir dentro do container.
    const arr = parseJSONArray(volumes);
    const source = workspaces.toHostPath(finalWorkingDir);
    const hasAppMount = arr.some((v) => v?.target === '/app');
    if (!hasAppMount) arr.push({ source, target: '/app' });
    nextVolumes = JSON.stringify(arr);

    if (!nextCommand) nextCommand = inferDockerCommand(image, nextCommand);

    const imageName = String(image || '').toLowerCase();
    if (imageName.includes('node') || imageName.includes('npm')) {
      bootstrapNodeProject(finalWorkingDir, name);
    }
  }

  // Se o usuário especificou main_file, mas NÃO informou um Startup Command customizado,
  // inferimos o comando padrão a partir de main_file (Etapa 2).
  if (!nextCommand && main_file && main_file.trim()) {
    const mf = main_file.trim();
    const mfRel = mf.replace(/^\/+/, '');
    const looksLikeFullCommand = /\s/.test(mfRel);
    if (isDocker) {
      if (looksLikeFullCommand) {
        nextCommand = `sh -c 'cd /app && ${mfRel} ${node_args || ''}'`;
      } else if (mf.endsWith('.js')) {
        nextCommand = `sh -c 'cd /app && node "${mfRel}" ${node_args || ''}'`;
      } else if (mf.endsWith('.ts')) {
        nextCommand = `sh -c 'cd /app && ts-node --esm "${mfRel}" ${node_args || ''}'`;
      } else {
        nextCommand = `sh -c 'cd /app && node "${mfRel}" ${node_args || ''}'`;
      }
    } else {
      if (looksLikeFullCommand) {
        nextCommand = `sh -c '${mfRel} ${node_args || ''}'`;
      } else if (mf.endsWith('.js')) {
        nextCommand = `sh -c 'node "${mfRel}" ${node_args || ''}'`;
      } else if (mf.endsWith('.ts')) {
        nextCommand = `sh -c 'ts-node --esm "${mfRel}" ${node_args || ''}'`;
      } else {
        nextCommand = `sh -c 'node "${mfRel}" ${node_args || ''}'`;
      }
    }
  }

  return { finalWorkingDir, scaffolded, volumes: nextVolumes, command: nextCommand };
}

module.exports = {
  resolveServiceWorkspace,
  inferDockerCommand,
  bootstrapNodeProject,
  // Reexportado pra não quebrar quem já importava daqui.
  normalizeWorkingDirectory: workspaces.normalize,
};
