const router = require('express').Router();
const { getDB } = require('../db');
const tm = require('../services/tunnelManager');
const ntm = require('../services/namedTunnelManager');
const config = require('../config');

const EDITABLE_KEYS = ['panel_name', 'panel_color', 'log_retention_days'];
const PANEL_TUNNEL_ID = 'main';

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

// GET /api/settings/cloudflared — is cloudflared installed and usable?
// Shared by the remote-access panel and any service/database form that
// wants to warn upfront, same idea as the /api/databases/engines check.
router.get('/cloudflared', (req, res) => {
  return res.json(tm.checkAvailable());
});

// GET /api/settings/remote-access — current state of the panel's OWN tunnel
// (separate from per-service/per-database tunnels, which are tied to that
// resource's own start/stop lifecycle instead).
router.get('/remote-access', (req, res) => {
  const availability = tm.checkAvailable();
  const info = tm.getTunnelInfo('panel', PANEL_TUNNEL_ID);
  return res.json({
    ...availability,
    active: !!info,
    status: info?.status || 'stopped',
    url: info?.url || null,
  });
});

// POST /api/settings/remote-access/start
router.post('/remote-access/start', async (req, res) => {
  try {
    await tm.startTunnel('panel', PANEL_TUNNEL_ID, config.PORT);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/settings/remote-access/stop
router.post('/remote-access/stop', async (req, res) => {
  await tm.stopTunnel('panel', PANEL_TUNNEL_ID);
  return res.json({ ok: true });
});

// ── Domínio personalizado (Named Tunnel) ──────────────────────────────

// GET /api/settings/domains — full status: auth, tunnel, running, hostnames
router.get('/domains', (req, res) => {
  return res.json(ntm.status());
});

// PUT /api/settings/domains — set base domain and/or the panel's own hostname
router.put('/domains', (req, res) => {
  const { base_domain, panel_tunnel_hostname } = req.body || {};
  if (base_domain !== undefined) ntm.setSetting('base_domain', base_domain.trim());
  if (panel_tunnel_hostname !== undefined) ntm.setSetting('panel_tunnel_hostname', panel_tunnel_hostname.trim());
  return res.json(ntm.status());
});

// POST /api/settings/domains/tunnel — one-time: create the named tunnel
router.post('/domains/tunnel', async (req, res) => {
  try {
    const name = (req.body?.name || 'pterodroid').trim();
    const result = await ntm.createTunnel(name);
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/settings/domains/apply — regenerate config, route DNS, restart
router.post('/domains/apply', async (req, res) => {
  try {
    const result = await ntm.applyConfig();
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/settings/domains/stop
router.post('/domains/stop', async (req, res) => {
  await ntm.stop();
  return res.json({ ok: true });
});

module.exports = router;
