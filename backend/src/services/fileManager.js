/**
 * FileManager — every filesystem operation the panel exposes goes through
 * resolveSafePath() first. That single function is the entire security
 * boundary for this feature: it resolves the requested path against
 * config.FILES_ROOT and refuses anything that lands outside it, whether
 * via '..' segments, an absolute-path override, or a symlink that points
 * out of bounds. No other function in this file touches fs.* with a path
 * that hasn't been through it.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

class PathError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const root = () => path.resolve(config.FILES_ROOT);

/** The one function every operation below funnels through. */
function resolveSafePath(relativePath = '') {
  if (typeof relativePath !== 'string') throw new PathError('Caminho inválido');

  const base = root();
  // An absolute-looking input ("/etc/passwd") would otherwise make
  // path.resolve discard our root entirely — strip leading slashes so it's
  // always treated as relative to FILES_ROOT.
  const relative = relativePath.replace(/^[/\\]+/, '');
  const target = path.resolve(base, relative);

  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new PathError('Caminho fora da área permitida');
  }

  // '..' segments are already caught by the check above (path.resolve
  // walks them before we compare). This second check catches the sneakier
  // case: a symlink that legitimately lives inside the root but points
  // outside it.
  if (fs.existsSync(target)) {
    const real = fs.realpathSync(target);
    if (real !== base && !real.startsWith(base + path.sep)) {
      throw new PathError('Esse caminho é um link simbólico que aponta para fora da área permitida');
    }
  }

  return target;
}

function toRelative(absolutePath) {
  const rel = path.relative(root(), absolutePath);
  return rel === '' ? '.' : rel.split(path.sep).join('/');
}

function validateName(name) {
  if (!name || typeof name !== 'string') throw new PathError('Nome inválido');
  if (name === '.' || name === '..') throw new PathError('Nome inválido');
  if (/[/\\\0]/.test(name)) throw new PathError('Nome não pode conter separadores de caminho');
  return name;
}

function statEntry(absolutePath, name) {
  const st = fs.statSync(absolutePath);
  return {
    name,
    type: st.isDirectory() ? 'dir' : 'file',
    size: st.size,
    mtime: st.mtimeMs,
    ext: st.isDirectory() ? null : path.extname(name).slice(1).toLowerCase(),
  };
}

function list(relativePath = '') {
  const dir = resolveSafePath(relativePath);
  const st = statOrNotFound(dir);
  if (!st.isDirectory()) throw new PathError('Não é uma pasta');

  const names = fs.readdirSync(dir);
  const entries = [];
  for (const name of names) {
    try {
      entries.push(statEntry(path.join(dir, name), name));
    } catch {
      // Unreadable entry (broken symlink, permission denied) — skip it
      // rather than failing the whole listing.
    }
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return { path: toRelative(dir), entries };
}

function statOrNotFound(target) {
  try {
    return fs.statSync(target);
  } catch (err) {
    if (err.code === 'ENOENT') {
      const notFound = new PathError('Arquivo ou pasta não encontrado');
      notFound.status = 404;
      throw notFound;
    }
    throw err;
  }
}

function read(relativePath) {
  const target = resolveSafePath(relativePath);
  const st = statOrNotFound(target);
  if (st.isDirectory()) throw new PathError('É uma pasta, não um arquivo');
  if (st.size > config.EDITOR_MAX_BYTES) {
    const err = new PathError(`Arquivo maior que ${(config.EDITOR_MAX_BYTES / 1024 / 1024).toFixed(0)}MB — abra fora do painel`);
    err.status = 413;
    throw err;
  }
  const buf = fs.readFileSync(target);
  // Cheap binary sniff: a null byte in the first 8KB almost always means
  // "not text" — refuse rather than mangling it in a text editor.
  if (buf.subarray(0, 8192).includes(0)) {
    throw new PathError('Arquivo parece ser binário — não é editável como texto');
  }
  return { path: toRelative(target), content: buf.toString('utf8'), size: st.size, mtime: st.mtimeMs };
}

function write(relativePath, content) {
  const target = resolveSafePath(relativePath);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) throw new PathError('É uma pasta, não um arquivo');
  fs.writeFileSync(target, content ?? '', 'utf8');
  return statEntry(target, path.basename(target));
}

function createFile(relativePath, name) {
  validateName(name);
  const dir = resolveSafePath(relativePath);
  const target = path.join(dir, name);
  if (fs.existsSync(target)) throw new PathError('Já existe um item com esse nome');
  fs.writeFileSync(target, '');
  return statEntry(target, name);
}

function createDir(relativePath, name) {
  validateName(name);
  const dir = resolveSafePath(relativePath);
  const target = path.join(dir, name);
  if (fs.existsSync(target)) throw new PathError('Já existe um item com esse nome');
  fs.mkdirSync(target, { recursive: true });
  return statEntry(target, name);
}

function rename(relativePath, newName) {
  validateName(newName);
  const target = resolveSafePath(relativePath);
  const dest = path.join(path.dirname(target), newName);
  if (fs.existsSync(dest)) throw new PathError('Já existe um item com esse nome');
  fs.renameSync(target, dest);
  return statEntry(dest, newName);
}

function move(relativeSource, relativeDestDir) {
  const source = resolveSafePath(relativeSource);
  const destDir = resolveSafePath(relativeDestDir);
  if (!statOrNotFound(destDir).isDirectory()) throw new PathError('Destino não é uma pasta');
  const dest = path.join(destDir, path.basename(source));
  if (dest === source) return statEntry(source, path.basename(source));
  if (fs.existsSync(dest)) throw new PathError('Já existe um item com esse nome na pasta de destino');
  try {
    fs.renameSync(source, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Crossing a mount-point boundary — rename() can't do that atomically.
      fs.cpSync(source, dest, { recursive: true });
      fs.rmSync(source, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  return statEntry(dest, path.basename(dest));
}

function copy(relativeSource, relativeDestDir) {
  const source = resolveSafePath(relativeSource);
  const destDir = resolveSafePath(relativeDestDir);
  if (!statOrNotFound(destDir).isDirectory()) throw new PathError('Destino não é uma pasta');

  let destName = path.basename(source);
  let dest = path.join(destDir, destName);
  if (dest === source || fs.existsSync(dest)) {
    const ext = path.extname(destName);
    const base = ext ? destName.slice(0, -ext.length) : destName;
    destName = `${base} (cópia)${ext}`;
    dest = path.join(destDir, destName);
  }
  fs.cpSync(source, dest, { recursive: true });
  return statEntry(dest, destName);
}

function remove(relativePath) {
  const target = resolveSafePath(relativePath);
  if (target === root()) throw new PathError('Não é possível excluir a raiz');
  fs.rmSync(target, { recursive: true, force: true });
}

/** Recursive filename search, bounded so a huge home directory can't hang the request. */
function search(relativePath, query, limit = 200) {
  const startDir = resolveSafePath(relativePath);
  const q = query.toLowerCase();
  const results = [];
  const stack = [startDir];
  let scanned = 0;

  while (stack.length && results.length < limit && scanned < 20000) {
    const dir = stack.pop();
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      scanned += 1;
      const full = path.join(dir, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (name.toLowerCase().includes(q)) {
        results.push({ ...statEntry(full, name), path: toRelative(full) });
        if (results.length >= limit) break;
      }
      if (st.isDirectory()) stack.push(full);
    }
  }
  return results;
}

module.exports = {
  PathError, resolveSafePath, toRelative, validateName, statOrNotFound,
  list, read, write, createFile, createDir, rename, move, copy, remove, search,
};
