'use strict';
/**
 * DockerFileManager — mesma forma que fileManager.js (list/read/write/
 * createFile/createDir/rename/move/remove), mas por trás fala com o
 * filesystem DENTRO de um container em vez do disco local.
 *
 * Sem "raiz segura" como o fileManager.js local: o container inteiro já É
 * o limite (é um filesystem isolado, não o Termux compartilhado), então
 * aqui só normalizamos o caminho, não restringimos.
 *
 * Duas famílias de operação:
 *  - metadado (list/mkdir/rm/mv) → via exec, sempre com o comando como
 *    array (argv) — nunca uma string de shell montada com o path do
 *    usuário dentro. Quando precisa de glob (`list`), o path variável vai
 *    em `$1`, nunca colado no texto do script.
 *  - conteúdo de arquivo (read/write) → via /containers/{id}/archive
 *    (tar, ver miniTar.js) — não depende de shell nenhum no container.
 */
const { buildSingleFileTar, parseTar } = require('./miniTar');

const MAX_READ_BYTES = 2 * 1024 * 1024;

class DockerFileError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function normalizePath(p = '/') {
  if (typeof p !== 'string') throw new DockerFileError('Caminho inválido');
  if (p.includes('\0')) throw new DockerFileError('Caminho inválido');
  const parts = [];
  for (const seg of p.trim().split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return `/${parts.join('/')}`;
}

function joinPath(dir, name) {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

function isRegularFile(entry) {
  return entry.typeflag === '0' || entry.typeflag === '\0' || entry.typeflag === '';
}

function createDockerFileManager(engine, containerId) {
  async function runOrThrow(cmd, actionLabel) {
    const { exitCode, stderr } = await engine.execRun(containerId, { cmd });
    if (exitCode !== 0) {
      throw new DockerFileError(`Falha ao ${actionLabel}: ${stderr.trim() || `código ${exitCode}`}`, 500);
    }
  }

  async function list(relativePath = '/') {
    const dir = normalizePath(relativePath);
    // Script fixo — o único valor variável (dir) vai como argv separado
    // ($1), nunca interpolado no texto do script.
    const script = [
      'cd "$1" 2>/dev/null || exit 2',
      'for f in * .*; do',
      '  [ "$f" = "." ] && continue',
      '  [ "$f" = ".." ] && continue',
      '  [ -e "$f" ] || continue',
      '  type=file; [ -d "$f" ] && type=dir',
      '  size=$(stat -c %s "$f" 2>/dev/null || echo 0)',
      '  mtime=$(stat -c %Y "$f" 2>/dev/null || echo 0)',
      '  printf "%s\\t%s\\t%s\\t%s\\n" "$type" "$size" "$mtime" "$f"',
      'done',
    ].join('\n');

    const { exitCode, stdout, stderr } = await engine.execRun(containerId, { cmd: ['sh', '-c', script, '--', dir] });
    if (exitCode === 2) throw new DockerFileError('Pasta não encontrada no container', 404);
    if (exitCode !== 0 && !stdout.trim()) {
      throw new DockerFileError(`Não foi possível listar — esse container pode não ter um shell (sh): ${stderr.trim()}`, 500);
    }

    const entries = stdout.split('\n').filter(Boolean).map((line) => {
      const [type, size, mtime, ...nameParts] = line.split('\t');
      const name = nameParts.join('\t');
      return {
        name,
        type: type === 'dir' ? 'dir' : 'file',
        size: parseInt(size, 10) || 0,
        mtime: (parseInt(mtime, 10) || 0) * 1000,
        ext: type === 'dir' || !name.includes('.') ? null : name.split('.').pop().toLowerCase(),
      };
    });
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return { path: dir, entries };
  }

  async function _readEntry(relativePath) {
    const target = normalizePath(relativePath);
    let tar;
    try {
      tar = await engine.getArchive(containerId, target);
    } catch (err) {
      // getArchive lança o erro da engine como veio (statusCode, não
      // status) — normaliza o "não existe" pro mesmo formato do resto
      // deste módulo; outros erros (host fora do ar etc.) sobem como
      // estão, a rota também sabe ler .statusCode.
      if (err.statusCode === 404) throw new DockerFileError('Arquivo não encontrado no container', 404);
      throw err;
    }
    const entries = parseTar(tar);
    const entry = entries.find(isRegularFile);
    if (!entry) throw new DockerFileError('Arquivo não encontrado ou é uma pasta', 404);
    return { target, entry };
  }

  async function read(relativePath) {
    const { target, entry } = await _readEntry(relativePath);
    if (entry.size > MAX_READ_BYTES) {
      throw new DockerFileError(`Arquivo maior que ${(MAX_READ_BYTES / 1024 / 1024).toFixed(0)}MB — baixe em vez de editar`, 413);
    }
    if (entry.content.subarray(0, 8192).includes(0)) {
      throw new DockerFileError('Arquivo parece ser binário — não é editável como texto', 400);
    }
    return { path: target, content: entry.content.toString('utf8'), size: entry.size, mtime: entry.mtime };
  }

  /** Sem sniff/limite de texto — pro download bruto. */
  async function readRaw(relativePath) {
    const { entry } = await _readEntry(relativePath);
    return entry;
  }

  async function write(relativePath, content) {
    const target = normalizePath(relativePath);
    const dir = target.slice(0, target.lastIndexOf('/')) || '/';
    const name = target.slice(target.lastIndexOf('/') + 1);
    if (!name) throw new DockerFileError('Caminho inválido');
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content ?? '', 'utf8');
    await engine.putArchive(containerId, dir, buildSingleFileTar(name, buf));
    return { name, type: 'file', size: buf.length, mtime: Date.now() };
  }

  async function createFile(relativePath, name) {
    if (!name || /[/\0]/.test(name)) throw new DockerFileError('Nome inválido');
    return write(joinPath(normalizePath(relativePath), name), '');
  }

  async function createDir(relativePath, name) {
    if (!name || /[/\0]/.test(name)) throw new DockerFileError('Nome inválido');
    const target = joinPath(normalizePath(relativePath), name);
    await runOrThrow(['mkdir', '-p', '--', target], 'criar a pasta');
    return { name, type: 'dir', size: 0, mtime: Date.now() };
  }

  async function rename(relativePath, newName) {
    if (!newName || /[/\0]/.test(newName)) throw new DockerFileError('Nome inválido');
    const target = normalizePath(relativePath);
    const dir = target.slice(0, target.lastIndexOf('/')) || '/';
    await runOrThrow(['mv', '--', target, joinPath(dir, newName)], 'renomear');
    return { name: newName, mtime: Date.now() };
  }

  async function move(relativeSource, relativeDestDir) {
    const source = normalizePath(relativeSource);
    const destDir = normalizePath(relativeDestDir);
    const name = source.slice(source.lastIndexOf('/') + 1);
    await runOrThrow(['mv', '--', source, joinPath(destDir, name)], 'mover');
    return { name, mtime: Date.now() };
  }

  async function remove(relativePath) {
    const target = normalizePath(relativePath);
    if (target === '/') throw new DockerFileError('Não é possível excluir a raiz');
    await runOrThrow(['rm', '-rf', '--', target], 'excluir');
  }

  return { list, read, readRaw, write, createFile, createDir, rename, move, remove, normalizePath };
}

module.exports = { createDockerFileManager, DockerFileError };
