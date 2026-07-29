/**
 * Real-time layer. Single-user panel, so every event is broadcast to every
 * connected socket — no per-user rooms needed. The frontend filters by
 * serviceId/instanceId client-side.
 */
const { Server } = require('socket.io');
const { verifySocketToken } = require('../middleware/auth');
const { getSnapshot } = require('../services/systemMonitor');
const pm = require('../services/processManager');
const dockerDriver = require('../services/dockerServiceDriver');
const dbm = require('../services/dbInstanceManager');
const tm = require('../services/tunnelManager');
const ntm = require('../services/namedTunnelManager');
const terminals = require('../services/terminalManager');

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

  // ── Forward process/db/tunnel manager events to all clients ──────────
  // processManager (local) e dockerServiceDriver (containers) emitem no
  // mesmo formato de propósito — o frontend recebe 'service:log'/
  // 'service:status' pra qualquer serviço, sem saber (nem precisar saber)
  // qual dos dois driver está por trás.
  pm.on('log', (payload) => io.emit('service:log', payload));
  pm.on('status', (payload) => io.emit('service:status', payload));
  dockerDriver.on('log', (payload) => io.emit('service:log', payload));
  dockerDriver.on('status', (payload) => io.emit('service:status', payload));
  dbm.on('log', (payload) => io.emit('db:log', payload));
  dbm.on('status', (payload) => io.emit('db:status', payload));
  tm.on('status', (payload) => io.emit('tunnel:status', payload));
  tm.on('url', (payload) => io.emit('tunnel:url', payload));
  ntm.on('status', (payload) => io.emit('domains:status', payload));
  ntm.on('log', (payload) => io.emit('domains:log', payload));
  // Saída do terminal: mesmo caminho dos logs, para o comando ir
  // aparecendo enquanto roda em vez de só no fim.
  terminals.on('data', (payload) => io.emit('terminal:data', payload));
  terminals.on('exit', (payload) => io.emit('terminal:exit', payload));

  // ── Periodic system snapshot, only while someone's listening ─────────
  let snapshotTimer = null;
  let collecting = false;

  const startSnapshotLoop = () => {
    if (snapshotTimer) return;
    snapshotTimer = setInterval(async () => {
      // getSnapshot é assíncrono; sem essa trava, um tick lento faria os
      // seguintes se empilharem em cima dele.
      if (collecting) return;
      collecting = true;
      try {
        const snapshot = await getSnapshot();
        if (io.engine.clientsCount > 0) io.emit('monitor:snapshot', snapshot);
      } catch (err) {
        console.error('[monitor] falha ao coletar snapshot:', err.message);
      } finally {
        collecting = false;
      }
    }, SNAPSHOT_INTERVAL_MS);
    snapshotTimer.unref?.();
  };

  const stopSnapshotLoopIfIdle = () => {
    // O handler de 'disconnect' roda ANTES de o socket sair da contagem, então
    // ler clientsCount aqui podia devolver 1 com ninguém mais conectado e
    // deixar o timer rodando pra sempre (P31). Um tick de atraso resolve.
    setImmediate(() => {
      if (io.engine.clientsCount === 0 && snapshotTimer) {
        clearInterval(snapshotTimer);
        snapshotTimer = null;
      }
    });
  };

  io.on('connection', (socket) => {
    startSnapshotLoop();
    // Manda um snapshot imediato pra tela não ficar vazia até o próximo tick.
    getSnapshot().then((s) => socket.emit('monitor:snapshot', s)).catch(() => {});
    socket.on('disconnect', stopSnapshotLoopIfIdle);
  });

  return io;
}

module.exports = { setupSockets };
