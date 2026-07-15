const router = require('express').Router();
const { getDB } = require('../db');

const EDITABLE_KEYS = ['panel_name', 'panel_color', 'log_retention_days'];

// GET /api/settings
router.get('/', (req, res) => {
  const db = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return res.json(settings);
});

// PUT /api/settings
router.put('/', (req, res) => {
  const db = getDB();
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);

  for (const key of EDITABLE_KEYS) {
    if (req.body[key] !== undefined) upsert.run(key, String(req.body[key]));
  }

  const rows = db.prepare('SELECT key, value FROM settings').all();
  return res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

// POST /api/settings/complete-setup — marks first-run wizard as done
router.post('/complete-setup', (req, res) => {
  const db = getDB();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('setup_done', 'true')
    ON CONFLICT(key) DO UPDATE SET value = 'true'
  `).run();
  return res.json({ ok: true });
});

module.exports = router;
