const router = require('express').Router();
const { getDB } = require('../db');
const { getSnapshot, readProcessList } = require('../services/systemMonitor');
const pm = require('../services/processManager');
const dbm = require('../services/dbInstanceManager');

// GET /api/monitor/snapshot — CPU/RAM/disk/uptime, once
router.get('/snapshot', async (req, res) => {
  const snapshot = await getSnapshot();
  return res.json(snapshot);
});

// GET /api/monitor/processes — top OS processes by CPU
router.get('/processes', (req, res) => {
  return res.json(readProcessList());
});

// GET /api/monitor/overview — whole-panel state in one call, for the dashboard
router.get('/overview', async (req, res) => {
  const db = getDB();
  const services = db.prepare('SELECT id, name, status, type FROM services').all();
  const instances = db.prepare('SELECT id, name, status, type FROM db_instances').all();
  const snapshot = await getSnapshot();

  const servicesRunning = services.filter((s) => s.status === 'running').length;
  const instancesRunning = instances.filter((i) => i.status === 'running').length;

  return res.json({
    snapshot,
    services: {
      total: services.length,
      running: servicesRunning,
      stopped: services.filter((s) => s.status === 'stopped').length,
      error: services.filter((s) => s.status === 'error').length,
      list: services,
    },
    databases: {
      total: instances.length,
      running: instancesRunning,
      list: instances,
    },
  });
});

module.exports = router;
