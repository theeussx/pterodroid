/**
 * Real-time layer. Single-user panel, so every event is broadcast to every
 * connected socket — no per-user rooms needed. The frontend filters by
 * serviceId/instanceId client-side.
 */
const { Server } = require('socket.io');
const { verifySocketToken } = require('../middleware/auth');
const { getSnapshot } = require('../services/systemMonitor');
const pm = require('../services/processManager');
const dbm = require('../services/dbInstanceManager');

const SNAPSHOT_INTERVAL_MS = 2000;

function setupSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' }, // LAN-only personal panel; tighten if ever exposed publicly
  });

  // ── Auth ────────────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const user = token && verifySocketToken(token);
    if (!user) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  });

  // ── Forward process/db manager events to all clients ─────────────────
  pm.on('log', (payload) => io.emit('service:log', payload));
  pm.on('status', (payload) => io.emit('service:status', payload));
  dbm.on('log', (payload) => io.emit('db:log', payload));
  dbm.on('status', (payload) => io.emit('db:status', payload));

  // ── Periodic system snapshot, only while someone's listening ─────────
  let snapshotTimer = null;
  const startSnapshotLoop = () => {
    if (snapshotTimer) return;
    snapshotTimer = setInterval(async () => {
      io.emit('monitor:snapshot', await getSnapshot());
    }, SNAPSHOT_INTERVAL_MS);
  };
  const stopSnapshotLoopIfIdle = () => {
    if (io.engine.clientsCount === 0 && snapshotTimer) {
      clearInterval(snapshotTimer);
      snapshotTimer = null;
    }
  };

  io.on('connection', (socket) => {
    startSnapshotLoop();

    socket.on('disconnect', stopSnapshotLoopIfIdle);
  });

  return io;
}

module.exports = { setupSockets };
