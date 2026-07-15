const router = require('express').Router();
const { getDB } = require('../db');
const dbm = require('../services/dbInstanceManager');
const drivers = require('../services/dbDrivers');

const VALID_TYPES = Object.keys(drivers); // ['postgresql', 'mysql']

function validate(body) {
  const { name, type, port } = body;
  if (!name?.trim()) return 'Name is required';
  if (!type || !VALID_TYPES.includes(type)) return `Type must be one of: ${VALID_TYPES.join(', ')}`;
  if (!port || isNaN(parseInt(port, 10))) return 'A numeric port is required';
  return null;
}

// GET /api/databases — includes an availability check per engine, so the
// UI can warn upfront if e.g. postgresql isn't installed yet.
router.get('/', (req, res) => {
  const db = getDB();
  const instances = db.prepare('SELECT * FROM db_instances ORDER BY created_at DESC').all();
  const enriched = instances.map((i) => {
    const { db_password, ...safe } = i;
    return { ...safe, hasPassword: !!db_password, runtime: dbm.getRuntimeInfo(i.id) };
  });
  return res.json(enriched);
});

// GET /api/databases/engines — which engines are actually usable right now
router.get('/engines', (req, res) => {
  const engines = VALID_TYPES.map((type) => ({
    type,
    label: drivers[type].label,
    defaultPort: drivers[type].defaultPort,
    ...dbm.checkAvailable(type),
  }));
  return res.json(engines);
});

// GET /api/databases/:id
router.get('/:id', (req, res) => {
  const db = getDB();
  const inst = db.prepare('SELECT * FROM db_instances WHERE id = ?').get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Database instance not found' });

  const { db_password, ...safe } = inst;
  const dbLogs = db
    .prepare('SELECT * FROM logs WHERE db_instance_id = ? ORDER BY timestamp DESC LIMIT 100')
    .all(inst.id);

  return res.json({
    ...safe,
    hasPassword: !!db_password,
    runtime: dbm.getRuntimeInfo(inst.id),
    recentLogs: dbm.getLogs(inst.id, 200),
    persistedLogs: dbLogs,
  });
});

// POST /api/databases
router.post('/', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });

  const db = getDB();
  const { name, type, port, db_username = 'root', db_password = '' } = req.body;

  const password = db_password || Math.random().toString(36).slice(2, 12);

  const result = db.prepare(`
    INSERT INTO db_instances (name, type, port, db_username, db_password)
    VALUES (?, ?, ?, ?, ?)
  `).run(name.trim(), type, parseInt(port, 10), db_username.trim() || 'root', password);

  const created = db.prepare('SELECT * FROM db_instances WHERE id = ?').get(result.lastInsertRowid);
  const { db_password: _pw, ...safe } = created;
  return res.status(201).json({ ...safe, generatedPassword: db_password ? undefined : password });
});

// DELETE /api/databases/:id
router.delete('/:id', async (req, res) => {
  const db = getDB();
  const inst = db.prepare('SELECT * FROM db_instances WHERE id = ?').get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Database instance not found' });

  try { await dbm.stopInstance(inst.id); } catch { /* already stopped */ }

  db.prepare('DELETE FROM db_instances WHERE id = ?').run(inst.id);
  db.prepare('DELETE FROM logs WHERE db_instance_id = ?').run(inst.id);
  return res.json({ ok: true, note: 'Data directory on disk was left untouched — delete it manually if you want to reclaim space.' });
});

// POST /api/databases/:id/start — provisions on first start
router.post('/:id/start', async (req, res) => {
  try {
    const pid = await dbm.startInstance(parseInt(req.params.id, 10));
    return res.json({ ok: true, pid });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/databases/:id/stop
router.post('/:id/stop', async (req, res) => {
  try {
    await dbm.stopInstance(parseInt(req.params.id, 10));
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/databases/:id/restart
router.post('/:id/restart', async (req, res) => {
  try {
    const pid = await dbm.restartInstance(parseInt(req.params.id, 10));
    return res.json({ ok: true, pid });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/databases/:id/logs
router.get('/:id/logs', (req, res) => {
  const db = getDB();
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const logs = db
    .prepare('SELECT * FROM logs WHERE db_instance_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(req.params.id, limit);
  return res.json(logs.reverse());
});

module.exports = router;
