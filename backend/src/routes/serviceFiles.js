const router = require('express').Router({ mergeParams: true });
const path = require('path');
const multer = require('multer');
const { getDB } = require('../db');
const config = require('../config');
const { createFileManager, PathError } = require('../services/fileManager');
const { normalizeWorkingDirectory } = require('../services/serviceWorkspace');
const hosts = require('../services/dockerHostManager');

function audit(req, service, action, target, detail = '') {
  try {
    getDB().prepare('INSERT INTO audit_log (action, target, detail, username) VALUES (?,?,?,?)')
      .run(action, `[${service.name}] ${target}`, detail, req.user?.username || '');
  } catch (err) {
    console.error('[audit] failed to record:', err.message);
  }
}

/** Resolve o serviço e devolve um file manager (local ou docker) com a MESMA forma pros dois casos. */
function loadManager(req) {
  const db = getDB();
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!service) { const e = new Error('Serviço não encontrado'); e.status = 404; throw e; }

  if (service.runtime_type === 'docker') {
    const normalizedDir = normalizeWorkingDirectory(service.working_directory);
    if (!normalizedDir) {
      const e = new Error('Esse serviço não tem um diretório de trabalho definido');
      e.status = 409;
      throw e;
    }
    if (normalizedDir !== service.working_directory) {
      getDB().prepare('UPDATE services SET working_directory = ? WHERE id = ?').run(normalizedDir, service.id);
      service.working_directory = normalizedDir;
    }
    return { service, fm: createFileManager(normalizedDir), isDocker: false };
  }

  if (!service.working_directory) {
    const e = new Error('Esse serviço não tem um diretório de trabalho definido');
    e.status = 409;
    throw e;
  }
  return { service, fm: createFileManager(service.working_directory), isDocker: false };
}

function handle(fn) {
  return async (req, res) => {
    try {
      const { service, fm } = loadManager(req);
      const result = await fn(req, res, fm, service);
      if (result !== undefined) res.json(result);
    } catch (err) {
      const status = err.status || err.statusCode || 500;
      if (status >= 500) console.error('[serviceFiles] unexpected error:', err);
      res.status(status).json({ error: err.message || 'Erro interno' });
    }
  };
}

// GET /api/services/:id/files/list?path=
router.get('/list', handle((req, res, fm) => fm.list(req.query.path || '/')));

// GET /api/services/:id/files/read?path=
router.get('/read', handle((req, res, fm) => fm.read(req.query.path || '')));

// PUT /api/services/:id/files/write  { path, content }
router.put('/write', handle(async (req, res, fm, service) => {
  const result = await fm.write(req.body.path, req.body.content);
  audit(req, service, 'write', req.body.path);
  return result;
}));

// POST /api/services/:id/files/mkdir  { path, name }
router.post('/mkdir', handle(async (req, res, fm, service) => {
  const result = await fm.createDir(req.body.path || '', req.body.name);
  audit(req, service, 'mkdir', path.posix.join(req.body.path || '', req.body.name));
  return result;
}));

// POST /api/services/:id/files/touch  { path, name }
router.post('/touch', handle(async (req, res, fm, service) => {
  const result = await fm.createFile(req.body.path || '', req.body.name);
  audit(req, service, 'touch', path.posix.join(req.body.path || '', req.body.name));
  return result;
}));

// POST /api/services/:id/files/rename  { path, name }
router.post('/rename', handle(async (req, res, fm, service) => {
  const result = await fm.rename(req.body.path, req.body.name);
  audit(req, service, 'rename', req.body.path, `→ ${req.body.name}`);
  return result;
}));

// POST /api/services/:id/files/move  { source, destDir }
router.post('/move', handle(async (req, res, fm, service) => {
  const result = await fm.move(req.body.source, req.body.destDir);
  audit(req, service, 'move', req.body.source, `→ ${req.body.destDir}`);
  return result;
}));

// DELETE /api/services/:id/files  { paths: [...] }
router.delete('/', handle(async (req, res, fm, service) => {
  const targets = Array.isArray(req.body.paths) ? req.body.paths : [req.body.path].filter(Boolean);
  if (targets.length === 0) { const e = new Error('Nada para excluir'); e.status = 400; throw e; }
  const errors = [];
  for (const p of targets) {
    try {
      await fm.remove(p);
      audit(req, service, 'delete', p);
    } catch (err) {
      errors.push({ path: p, error: err.message });
    }
  }
  return { ok: errors.length === 0, deleted: targets.length - errors.length, errors };
}));

// GET /api/services/:id/files/download?path=
router.get('/download', async (req, res) => {
  try {
    const { fm, isDocker, service } = loadManager(req);
    if (isDocker) {
      const entry = await fm.readRaw(req.query.path || '');
      audit(req, service, 'download', req.query.path);
      const name = path.posix.basename(fm.normalizePath(req.query.path || ''));
      res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(entry.content);
    }
    const target = fm.resolveSafePath(req.query.path || '');
    const st = fm.statOrNotFound(target);
    if (st.isDirectory()) return res.status(400).json({ error: 'Não é possível baixar uma pasta' });
    audit(req, service, 'download', req.query.path);
    return res.download(target, path.basename(target));
  } catch (err) {
    res.status(err.status || err.statusCode || 500).json({ error: err.message });
  }
});

// POST /api/services/:id/files/upload  (multipart, field "files", target dir em query.path)
router.post('/upload', async (req, res) => {
  let ctx;
  try {
    ctx = loadManager(req);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
  const { service, fm } = ctx;

  const upload = multer({
    storage: multer.diskStorage({
      destination: (r, file, cb) => {
        try {
          cb(null, fm.resolveSafePath(req.query.path || ''));
        } catch (e) {
          cb(e);
        }
      },
      filename: (r, file, cb) => {
        try {
          const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
          cb(null, fm.validateName(name));
        } catch (e) { cb(e); }
      },
    }),
    limits: { fileSize: config.UPLOAD_MAX_BYTES },
  });

  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      const status = err instanceof multer.MulterError ? 400 : (err.status || 500);
      return res.status(status).json({ error: err.message });
    }
    const files = req.files || [];
    files.forEach((f) => audit(req, service, 'upload', path.posix.join(req.query.path || '', f.filename), `${f.size} bytes`));
    res.json({ ok: true, files: files.map((f) => ({ name: f.filename, size: f.size })) });
  });
});

module.exports = router;
