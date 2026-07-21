const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');

const config = require('./config');
const { initDB, getDB } = require('./db');
const { setupSockets } = require('./sockets');
const pm = require('./services/processManager');
const dbm = require('./services/dbInstanceManager');
const tm = require('./services/tunnelManager');
const ntm = require('./services/namedTunnelManager');

const authRoutes = require('./routes/auth');
const serviceRoutes = require('./routes/services');
const databaseRoutes = require('./routes/databases');
const monitorRoutes = require('./routes/monitor');
const settingsRoutes = require('./routes/settings');
const fileRoutes = require('./routes/files');
const { authMiddleware } = require('./middleware/auth');

async function main() {
  await initDB();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/services', authMiddleware, serviceRoutes);
  app.use('/api/databases', authMiddleware, databaseRoutes);
  app.use('/api/monitor', authMiddleware, monitorRoutes);
  app.use('/api/settings', authMiddleware, settingsRoutes);
  app.use('/api/files', authMiddleware, fileRoutes);

  // Serve the built frontend (frontend/dist) if present, so a single
  // `node src/server.js` can serve the whole panel on one port.
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
      if (err) res.status(200).send('Pterodroid backend is running. Build the frontend to serve the UI here.');
    });
  });

  // 404 for unmatched API routes
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Basic error handler so a thrown error never kills the whole process
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const httpServer = http.createServer(app);
  setupSockets(httpServer);

  httpServer.listen(config.PORT, () => {
    console.log(`\n🚀 Pterodroid backend listening on http://0.0.0.0:${config.PORT}\n`);
  });

  // Resume services that were running before the panel last stopped.
  await pm.restoreAll();

  // ── Graceful shutdown ────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — stopping services and flushing database...`);
    try {
      await pm.stopAll();
      await dbm.stopAll();
      await tm.stopAll();
      await ntm.stop();
    } catch (e) {
      console.error('Error during shutdown:', e.message);
    }
    getDB().flush();
    httpServer.close(() => process.exit(0));
    // Safety net in case something keeps the event loop alive
    setTimeout(() => process.exit(0), 8000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
