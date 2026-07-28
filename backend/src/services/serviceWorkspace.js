'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../config');
const { scaffoldProjectDir } = require('./projectScaffold');

function parseJSONArray(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function slugifyName(name) {
  return String(name || 'app')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app';
}

function normalizeWorkingDirectory(dir) {
  if (!dir || typeof dir !== 'string') return '';
  const trimmed = dir.trim();
  if (!trimmed) return '';

  const sharedRoot = process.env.PROJECTS_ROOT || config.PROJECTS_ROOT;
  const legacyPrefix = '/home/appuser/projects';
  if (trimmed === legacyPrefix) return sharedRoot;
  if (trimmed.startsWith(`${legacyPrefix}/`)) {
    const suffix = trimmed.slice(legacyPrefix.length).replace(/^\/+/, '');
    return suffix ? path.join(sharedRoot, suffix) : sharedRoot;
  }
  return trimmed;
}

function inferDockerCommand(image, command) {
  const trimmed = (command || '').trim();
  if (trimmed) {
    return trimmed.replace(/^bash\s+-lc\b/, 'sh -lc').replace(/^bash\s+\-c\b/, 'sh -c');
  }

  const imageName = String(image || '').toLowerCase();
  if (imageName.includes('node') || imageName.includes('npm')) {
    return "sh -c 'cd /app && if [ -f package.json ]; then npm install >/dev/null 2>&1 || true; fi; if [ -f index.js ]; then node index.js; elif [ -f server.js ]; then node server.js; else echo \"No entrypoint found\"; fi'";
  }
  return '';
}

function bootstrapNodeProject(rootDir, name) {
  if (!rootDir) return false;
  fs.mkdirSync(rootDir, { recursive: true });

  const packagePath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    const packageJson = {
      name: slugifyName(name),
      version: '1.0.0',
      private: true,
      description: `Starter app for ${name}`,
      main: 'index.js',
      scripts: { start: 'node index.js' },
    };
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }

  const indexPath = path.join(rootDir, 'index.js');
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, `const http = require('http');\n\nconst port = Number(process.env.PORT || 3000);\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });\n  res.end('Pterodroid starter app is running\\n');\n});\n\nserver.listen(port, () => {\n  console.log('Server listening on port ' + port);\n});\n`);
  }

  const readmePath = path.join(rootDir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, `# ${name}\n\nProjeto inicial criado automaticamente pelo Pterodroid.\n`);
  }

  try {
    execFileSync('npm', ['install'], { cwd: rootDir, stdio: 'pipe' });
    return true;
  } catch (err) {
    return false;
  }
}

function resolveServiceWorkspace({ name, runtime_type, working_directory, volumes, image, command }) {
  const isDocker = runtime_type === 'docker';
  let finalWorkingDir = normalizeWorkingDirectory(working_directory);
  let scaffolded = 0;
  let nextVolumes = volumes;
  let nextCommand = (command || '').trim();

  if (!isDocker && !finalWorkingDir) {
    finalWorkingDir = scaffoldProjectDir(name);
    scaffolded = 1;
  }

  if (isDocker) {
    if (!finalWorkingDir) {
      finalWorkingDir = scaffoldProjectDir(name);
      scaffolded = 1;
    }

    const arr = parseJSONArray(volumes);
    const defaultBind = { source: finalWorkingDir, target: '/app' };
    const hasDefaultBind = arr.some((v) => v?.source === defaultBind.source && v?.target === defaultBind.target);
    if (!hasDefaultBind) {
      arr.push(defaultBind);
    }
    nextVolumes = JSON.stringify(arr);

    if (!nextCommand) {
      nextCommand = inferDockerCommand(image, nextCommand);
    }

    const imageName = String(image || '').toLowerCase();
    if (imageName.includes('node') || imageName.includes('npm')) {
      bootstrapNodeProject(finalWorkingDir, name);
    }
  }

  return {
    finalWorkingDir,
    scaffolded,
    volumes: nextVolumes,
    command: nextCommand,
  };
}

module.exports = { resolveServiceWorkspace, inferDockerCommand, normalizeWorkingDirectory };
