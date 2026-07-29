/**
 * FileManager — every filesystem operation the panel exposes goes through
 * resolveSafePath() first. That single function is the entire security
 * boundary for this feature: it resolves the requested path against the
 * manager's root and refuses anything that lands outside it, whether via
 * '..' segments, an absolute-path override, or a symlink that points out
 * of bounds. No other function here touches fs.* with a caller-supplied
 * path that hasn't been through it.
 *
 * createFileManager(root) builds one scoped to any directory — a service's
 * workspace gets one rooted at its own folder, and the global Files page
 * uses one rooted at config.FILES_ROOT. Same behaviour and same guarantees
 * either way; only the root differs.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

class PathError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Caracteres proibidos em nome de arquivo, incluindo os do Windows (para não gerar nomes impossíveis de baixar). */
const INVALID_NAME_CHARS = /[/\\\0:*?"<>|]/;
const RESERVED_NAMES = new Set(['.', '..', '']);

function createFileManager(rootDir) {
  const root = () => path.resolve(rootDir);

  /**
   * Garante que a raiz exista. Chamado no começo de toda operação: o
   * workspace de um serviço pode ter sido apagado por fora, e o certo é
   * recriá-lo em vez de devolver ENOENT pro usuário (Etapa 3/4).
   */
  function ensureRoot() {
    const base = root();
    fs.mkdirSync(base, { recursive: true });
    return base;
  }

  /** The one function every operation below funnels through. */
  function resolveSafePath(relativePath = '', { mustExist = false } = {}) {
    if (typeof relativePath !== 'string') throw new PathError('Caminho inválido');
    if (relativePath.includes('\0')) throw new PathError('Caminho inválido');

    const base = ensureRoot();
    // An absolute-looking input ("/etc/passwd") would otherwise make
    // path.resolve discard our root entirely — strip leading slashes so it's
    // always treated as relative to the root.
    const relative = relativePath.replace(/^[/\\]+/, '');
    const target = path.resolve(base, relative);

    if (target !== base && !target.startsWith(base + path.sep)) {
      throw new PathError('Caminho fora da área permitida');
    }

    // '..' segments are already caught by the check above (path.resolve
    // walks them before we compare). This second check catches the sneakier
    // case: a symlink that legitimately lives inside the root but points
    // outside it.
    const realBase = fs.realpathSync(base);
    if (fs.existsSync(target)) {
      const real = fs.realpathSync(target);
      if (real !== realBase && !real.startsWith(realBase + path.sep)) {
        throw new PathError('Esse caminho é um link simbólico que aponta para fora da área permitida');
      }
    } else {
      if (mustExist) throw new PathError('Arquivo ou pasta não encontrado', 404);
      // O alvo ainda não existe: valida o ancestral mais próximo que
      // existe, senão um symlink no meio do caminho ("uploads" → /etc)
      // deixaria a escrita cair fora da raiz.
      let parent = path.dirname(target);
      while (parent !== base && parent.startsWith(base + path.sep) && !fs.existsSync(parent)) {
        parent = path.dirname(parent);
      }
      if (fs.existsSync(parent)) {
        const realParent = fs.realpathSync(parent);
        if (realParent !== realBase && !realParent.startsWith(realBase + path.sep)) {
          throw new PathError('Esse caminho passa por um link simbólico que aponta para fora da área permitida');
        }
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
    const trimmed = name.trim();
    if (RESERVED_NAMES.has(trimmed)) throw new PathError('Nome inválido');
    if (INVALID_NAME_CHARS.test(trimmed)) {
      throw new PathError('O nome não pode conter / \\ : * ? " < > | nem caracteres nulos');
    }
    if (trimmed.length > 255) throw new PathError('Nome muito longo (máx. 255 caracteres)');
    return trimmed;
  }

  /**
   * Aceita um nome vindo do navegador e devolve algo gravável, em vez de
   * recusar o upload inteiro. Nomes vindos de outros sistemas
   * frequentemente têm caracteres que o filesystem local não aceita.
   */
  function sanitizeName(name, fallback = 'arquivo') {
    // Alguns navegadores mandam o caminho relativo inteiro no nome do
    // arquivo (upload de pasta), e um cliente malicioso pode mandar
    // "../../etc/passwd" de propósito. Aqui achatamos isso num nome único
    // e seguro: descarta os segmentos de navegação e junta o resto.
    const segments = String(name || '')
      .split(/[/\\]/)
      .filter((seg) => seg && seg !== '.' && seg !== '..');

    const cleaned = segments.join('_')
      .replace(/[\0:*?"<>|]/g, '_')
      .replace(/^\.+/, '')  // nada de arquivo oculto por acidente
      .trim()
      .slice(0, 255);

    return cleaned || fallback;
  }

  /** Acrescenta " (2)", " (3)"... até achar um nome livre na pasta. */
  function uniqueName(dir, name) {
    let candidate = name;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;

    const ext = path.extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    for (let n = 2; n < 1000; n += 1) {
      candidate = `${stem} (${n})${ext}`;
      if (!fs.existsSync(path.join(dir, candidate))) return candidate;
    }
    return `${stem}-${Date.now()}${ext}`;
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

  function statOrNotFound(target) {
    try {
      return fs.statSync(target);
    } catch (err) {
      if (err.code === 'ENOENT') throw new PathError('Arquivo ou pasta não encontrado', 404);
      if (err.code === 'EACCES') throw new PathError('Sem permissão para acessar esse caminho', 403);
      throw err;
    }
  }

  /**
   * Escrita atômica: grava num temporário no MESMO diretório e renomeia por
   * cima. rename() é atômico dentro do mesmo filesystem, então o arquivo
   * nunca é visto truncado — nem se o processo morrer no meio (Etapa 5).
   */
  function atomicWrite(target, data) {
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, target);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* nada a limpar */ }
      throw err;
    }
  }

  function list(relativePath = '') {
    const dir = resolveSafePath(relativePath);
    // A raiz é criada sob demanda; uma subpasta inexistente continua 404.
    if (dir === root() && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

  function read(relativePath) {
    const target = resolveSafePath(relativePath, { mustExist: true });
    const st = statOrNotFound(target);
    if (st.isDirectory()) throw new PathError('É uma pasta, não um arquivo');
    if (st.size > config.EDITOR_MAX_BYTES) {
      throw new PathError(
        `Arquivo maior que ${(config.EDITOR_MAX_BYTES / 1024 / 1024).toFixed(0)}MB — baixe em vez de editar`,
        413,
      );
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
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      throw new PathError('É uma pasta, não um arquivo');
    }
    // Criar a árvore de diretórios faz parte de "salvar": pedir pro usuário
    // criar cada pasta na mão antes de salvar um arquivo aninhado seria uma
    // limitação artificial do painel, não do filesystem.
    atomicWrite(target, content ?? '');
    return statEntry(target, path.basename(target));
  }

  function createFile(relativePath, name) {
    const safeName = validateName(name);
    const dir = resolveSafePath(relativePath);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, safeName);
    if (fs.existsSync(target)) throw new PathError('Já existe um item com esse nome', 409);
    atomicWrite(target, '');
    return statEntry(target, safeName);
  }

  function createDir(relativePath, name) {
    const safeName = validateName(name);
    const dir = resolveSafePath(relativePath);
    const target = path.join(dir, safeName);
    if (fs.existsSync(target)) throw new PathError('Já existe um item com esse nome', 409);
    fs.mkdirSync(target, { recursive: true });
    return statEntry(target, safeName);
  }

  function rename(relativePath, newName) {
    const safeName = validateName(newName);
    const target = resolveSafePath(relativePath, { mustExist: true });
    if (target === root()) throw new PathError('Não é possível renomear a raiz');
    const dest = path.join(path.dirname(target), safeName);
    if (dest === target) return statEntry(target, safeName);
    if (fs.existsSync(dest)) throw new PathError('Já existe um item com esse nome', 409);
    fs.renameSync(target, dest);
    return statEntry(dest, safeName);
  }

  /** rename() entre filesystems diferentes falha com EXDEV — copia e apaga nesse caso. */
  function relocate(source, dest) {
    try {
      fs.renameSync(source, dest);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      fs.cpSync(source, dest, { recursive: true });
      fs.rmSync(source, { recursive: true, force: true });
    }
  }

  function move(relativeSource, relativeDestDir) {
    const source = resolveSafePath(relativeSource, { mustExist: true });
    if (source === root()) throw new PathError('Não é possível mover a raiz');
    const destDir = resolveSafePath(relativeDestDir);
    fs.mkdirSync(destDir, { recursive: true });
    if (!statOrNotFound(destDir).isDirectory()) throw new PathError('Destino não é uma pasta');

    // Mover uma pasta pra dentro dela mesma cria um loop infinito no
    // filesystem — fs.renameSync devolveria EINVAL, mas a mensagem crua não
    // explica nada pro usuário.
    if (destDir === source || destDir.startsWith(source + path.sep)) {
      throw new PathError('Não é possível mover uma pasta para dentro dela mesma');
    }

    const dest = path.join(destDir, path.basename(source));
    if (dest === source) return statEntry(source, path.basename(source));
    if (fs.existsSync(dest)) throw new PathError('Já existe um item com esse nome na pasta de destino', 409);
    relocate(source, dest);
    return statEntry(dest, path.basename(dest));
  }

  function copy(relativeSource, relativeDestDir) {
    const source = resolveSafePath(relativeSource, { mustExist: true });
    const destDir = resolveSafePath(relativeDestDir);
    fs.mkdirSync(destDir, { recursive: true });
    if (!statOrNotFound(destDir).isDirectory()) throw new PathError('Destino não é uma pasta');
    if (destDir === source || destDir.startsWith(source + path.sep)) {
      throw new PathError('Não é possível copiar uma pasta para dentro dela mesma');
    }

    const destName = uniqueName(destDir, path.basename(source));
    const dest = path.join(destDir, destName);
    fs.cpSync(source, dest, { recursive: true });
    return statEntry(dest, destName);
  }

  function remove(relativePath) {
    const target = resolveSafePath(relativePath, { mustExist: true });
    if (target === root()) throw new PathError('Não é possível excluir a raiz');
    fs.rmSync(target, { recursive: true, force: true });
    return { path: toRelative(target) };
  }

  /** Recursive filename search, bounded so a huge directory can't hang the request. */
  function search(relativePath, query, limit = 200) {
    const startDir = resolveSafePath(relativePath);
    const q = String(query || '').toLowerCase();
    if (q.length < 2) throw new PathError('Digite ao menos 2 caracteres');

    const results = [];
    const stack = [startDir];
    let scanned = 0;

    while (stack.length && results.length < limit && scanned < 20000) {
      const dir = stack.pop();
      let names;
      try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const dirent of names) {
        scanned += 1;
        const full = path.join(dir, dirent.name);
        if (dirent.name.toLowerCase().includes(q)) {
          try {
            results.push({ ...statEntry(full, dirent.name), path: toRelative(full) });
          } catch { continue; }
          if (results.length >= limit) break;
        }
        // Symlink de diretório não entra na varredura: evita loop infinito
        // e evita listar coisa de fora da raiz.
        if (dirent.isDirectory()) stack.push(full);
      }
    }
    return results;
  }

  return {
    root,
    ensureRoot,
    resolveSafePath,
    toRelative,
    validateName,
    sanitizeName,
    uniqueName,
    statOrNotFound,
    statEntry,
    atomicWrite,
    list,
    read,
    write,
    createFile,
    createDir,
    rename,
    move,
    copy,
    remove,
    search,
  };
}

module.exports = { ...createFileManager(config.FILES_ROOT), PathError, createFileManager };
