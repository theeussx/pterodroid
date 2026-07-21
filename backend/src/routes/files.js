const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const fm = require('../services/fileManager');
const { getDB } = require('../db');
const config = require('../config');

function audit(req, action, target, detail = '') {
  try {
    getDB().prepare('INSERT INTO audit_log (action, target, detail, username) VALUES (?,?,?,?)')
      .run(action, target, detail, req.user?.username || '');
  } catch (err) {
    console.error('[audit] failed to record:', err.message);
  }
}

function handle(fn) {
  return (req, res) => {
    try {
      const result = fn(req, res);
      if (result !== undefined) res.json(result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[files] unexpected error:', err);
      res.status(status).json({ error: err.message || 'Erro interno' });
    }
  };
}

// GET /api/files/list?path=
router.get('/list', handle((req) => fm.list(req.query.path || '')));

// GET /api/files/read?path=
router.get('/read', handle((req) => fm.read(req.query.path || '')));

// PUT /api/files/write  { path, content }
router.put('/write', handle((req) => {
  const result = fm.write(req.body.path, req.body.content);
  audit(req, 'write', req.body.path);
  return result;
}));

// POST /api/files/mkdir  { path, name }
router.post('/mkdir', handle((req) => {
  const result = fm.createDir(req.body.path || '', req.body.name);
  audit(req, 'mkdir', path.posix.join(req.body.path || '', req.body.name));
  return result;
}));

// POST /api/files/touch  { path, name }
router.post('/touch', handle((req) => {
  const result = fm.createFile(req.body.path || '', req.body.name);
  audit(req, 'touch', path.posix.join(req.body.path || '', req.body.name));
  return result;
}));

// POST /api/files/rename  { path, name }
router.post('/rename', handle((req) => {
  const result = fm.rename(req.body.path, req.body.name);
  audit(req, 'rename', req.body.path, `→ ${req.body.name}`);
  return result;
}));

// POST /api/files/move  { source, destDir }
router.post('/move', handle((req) => {
  const result = fm.move(req.body.source, req.body.destDir);
  audit(req, 'move', req.body.source, `→ ${req.body.destDir}`);
  return result;
}));

// POST /api/files/copy  { source, destDir }
router.post('/copy', handle((req) => {
  const result = fm.copy(req.body.source, req.body.destDir);
  audit(req, 'copy', req.body.source, `→ ${req.body.destDir}`);
  return result;
}));

// DELETE /api/files  { paths: [...] }  — batch-capable
router.delete('/', handle((req) => {
  const targets = Array.isArray(req.body.paths) ? req.body.paths : [req.body.path].filter(Boolean);
  if (targets.length === 0) { const e = new Error('Nada para excluir'); e.status = 400; throw e; }
  const errors = [];
  for (const p of targets) {
    try {
      fm.remove(p);
      audit(req, 'delete', p);
    } catch (err) {
      errors.push({ path: p, error: err.message });
    }
  }
  return { ok: errors.length === 0, deleted: targets.length - errors.length, errors };
}));

// GET /api/files/search?path=&q=
router.get('/search', handle((req) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) { const e = new Error('Digite ao menos 2 caracteres'); e.status = 400; throw e; }
  return { results: fm.search(req.query.path || '', q) };
}));

// GET /api/files/download?path=
router.get('/download', (req, res) => {
  try {
    const target = fm.resolveSafePath(req.query.path || '');
    const st = fm.statOrNotFound(target);
    if (st.isDirectory()) return res.status(400).json({ error: 'Não é possível baixar uma pasta' });
    audit(req, 'download', req.query.path);
    res.download(target, path.basename(target));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/files/upload  (multipart, field "files", target dir in query.path)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        cb(null, fm.resolveSafePath(req.query.path || ''));
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      try {
        // Browsers send the original filename in latin1; fix to utf8 so
        // accented names survive intact.
        const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, fm.validateName(name));
      } catch (err) {
        cb(err);
      }
    },
  }),
  limits: { fileSize: config.UPLOAD_MAX_BYTES },
});

router.post('/upload', (req, res) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      const status = err instanceof multer.MulterError ? 400 : (err.status || 500);
      return res.status(status).json({ error: err.message });
    }
    const files = req.files || [];
    files.forEach((f) => audit(req, 'upload', path.posix.join(req.query.path || '', f.filename), `${f.size} bytes`));
    res.json({ ok: true, files: files.map((f) => ({ name: f.filename, size: f.size })) });
  });
});

// GET /api/files/audit — recent audit log entries, for the "atividade recente" panel
router.get('/audit', handle((req) => {
  const db = getDB();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  return db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?').all(limit);
}));

module.exports = router;
