const router = require('express').Router();
const { getDB } = require('../db');
const pm = require('../services/processManager');

const VALID_TYPES = ['node', 'python', 'shell', 'bot', 'api', 'web', 'other'];

function validate(body) {
  const { name, command, type } = body;
  if (!name?.trim()) return 'Name is required';
  if (!command?.trim()) return 'Command is required';
  if (type && !VALID_TYPES.includes(type)) return `Invalid type. Valid: ${VALID_TYPES.join(', ')}`;
  return null;
}

function sanitizeEnv(raw) {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    if (typeof obj !== 'object' || Array.isArray(obj)) return '{}';
    delete obj.LD_PRELOAD;
    delete obj.LD_LIBRARY_PATH;
    return JSON.stringify(obj);
  } catch {
    return '{}';
  }
}

// GET /api/services
router.get('/', (req, res) => {
  const db = getDB();
  const services = db.prepare('SELECT * FROM services ORDER BY created_at DESC').all();
  const enriched = services.map((s) => ({ ...s, runtime: pm.getRuntimeInfo(s.id) }));
  return res.json(enriched);
});

// GET /api/services/:id
router.get('/:id', (req, res) => {
  const db = getDB();
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });

  const dbLogs = db
    .prepare('SELECT * FROM logs WHERE service_id = ? ORDER BY timestamp DESC LIMIT 100')
    .all(svc.id);

  return res.json({
    ...svc,
    runtime: pm.getRuntimeInfo(svc.id),
    recentLogs: pm.getLogs(svc.id, 200),
    persistedLogs: dbLogs,
  });
});

// POST /api/services
router.post('/', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });

  const db = getDB();
  const {
    name, description = '', type = 'node', command,
    working_directory = '', environment = '{}',
    auto_restart = 1, restart_delay = 3, max_restarts = 10,
  } = req.body;

  const result = db.prepare(`
    INSERT INTO services
      (name, description, type, command, working_directory, environment,
       auto_restart, restart_delay, max_restarts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(), description.trim(), type, command.trim(),
    working_directory.trim(), sanitizeEnv(environment),
    auto_restart ? 1 : 0, parseInt(restart_delay, 10) || 3, parseInt(max_restarts, 10) || 10,
  );

  const created = db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(created);
});

// PUT /api/services/:id
router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Service not found' });

  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });

  const {
    name, description, type, command, working_directory,
    environment, auto_restart, restart_delay, max_restarts,
  } = req.body;

  db.prepare(`
    UPDATE services SET
      name=?, description=?, type=?, command=?, working_directory=?,
      environment=?, auto_restart=?, restart_delay=?, max_restarts=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    name.trim(),
    (description ?? existing.description).trim(),
    type ?? existing.type,
    command.trim(),
    (working_directory ?? existing.working_directory).trim(),
    sanitizeEnv(environment ?? existing.environment),
    auto_restart != null ? (auto_restart ? 1 : 0) : existing.auto_restart,
    parseInt(restart_delay, 10) || existing.restart_delay,
    parseInt(max_restarts, 10) || existing.max_restarts,
    existing.id,
  );

  return res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(existing.id));
});

// DELETE /api/services/:id
router.delete('/:id', async (req, res) => {
  const db = getDB();
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });

  try { await pm.stopService(svc.id); } catch { /* already stopped */ }

  db.prepare('DELETE FROM services WHERE id = ?').run(svc.id);
  db.prepare('DELETE FROM logs WHERE service_id = ?').run(svc.id);
  return res.json({ ok: true });
});

// POST /api/services/:id/start
router.post('/:id/start', async (req, res) => {
  try {
    const pid = await pm.startService(parseInt(req.params.id, 10));
    return res.json({ ok: true, pid });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/services/:id/stop
router.post('/:id/stop', async (req, res) => {
  try {
    await pm.stopService(parseInt(req.params.id, 10));
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/services/:id/restart
router.post('/:id/restart', async (req, res) => {
  try {
    const pid = await pm.restartService(parseInt(req.params.id, 10));
    return res.json({ ok: true, pid });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/services/:id/input — write to the process's stdin
router.post('/:id/input', (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const ok = pm.sendInput(parseInt(req.params.id, 10), text);
  return res.json({ ok });
});

// GET /api/services/:id/logs — persisted (error-level) logs
router.get('/:id/logs', (req, res) => {
  const db = getDB();
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const logs = db
    .prepare('SELECT * FROM logs WHERE service_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(req.params.id, limit);
  return res.json(logs.reverse());
});

module.exports = router;
