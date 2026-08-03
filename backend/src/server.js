const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const { initDB, getDB } = require('./db');
const { setupSockets } = require('./sockets');
const driver = require('./services/serviceDriverRegistry');
const dockerHostManager = require('./services/dockerHostManager');
const dbm = require('./services/dbInstanceManager');
const tm = require('./services/tunnelManager');
const ntm = require('./services/namedTunnelManager');
const { schedulePrune } = require('./services/auditLog');
const terminals = require('./services/terminalManager');

const authRoutes = require('./routes/auth');
const serviceRoutes = require('./routes/services');
const databaseRoutes = require('./routes/databases');
const monitorRoutes = require('./routes/monitor');
const settingsRoutes = require('./routes/settings');
const fileRoutes = require('./routes/files');
const serviceFileRoutes = require('./routes/serviceFiles');
const terminalRoutes = require('./routes/terminal');
const backupRoutes = require('./routes/backups');
const dockerRoutes = require('./routes/docker');
const { authMiddleware } = require('./middleware/auth');

/**
 * Se o painel morreu à força (OOM killer do Android, bateria acabando,
 * `kill -9`), o banco fica com serviços marcados como 'running' cujos
 * processos não existem mais. Sem essa reconciliação a UI mostra "rodando"
 * pra algo morto e o botão de parar não faz nada.
 *
 * Serviços em Docker ficam de fora de propósito: o container realmente
 * pode ter continuado de pé sem o painel, e o poll confirma o estado real
 * logo em seguida.
 */
function reconcileStaleState(db) {
  const stale = db.prepare(`
    SELECT id, name, pid FROM services
    WHERE status = 'running' AND COALESCE(runtime_type, 'process') = 'process'
  `).all();

  let cleaned = 0;
  for (const svc of stale) {
    let alive = false;
    if (svc.pid) {
      // signal 0 não envia nada: só testa se o processo existe.
      try { process.kill(svc.pid, 0); alive = true; } catch { alive = false; }
    }
    if (!alive) {
      db.prepare("UPDATE services SET pid = NULL WHERE id = ?").run(svc.id);
      cleaned += 1;
    }
  }
  if (cleaned) console.log(`🧹 ${cleaned} serviço(s) com PID obsoleto — serão reiniciados se estavam ativos`);

  // Instâncias de banco nunca voltam sozinhas (ver dbInstanceManager), então
  // qualquer 'running' remanescente é resíduo de um desligamento sujo.
  db.prepare("UPDATE db_instances SET status = 'stopped', pid = NULL WHERE status = 'running'").run();
}

async function main() {
  await initDB();
  const db = getDB();

  reconcileStaleState(db);
  dockerHostManager.ensureDefaultHost?.();
  const stopPrune = schedulePrune(db);

  const app = express();
  app.use(cors());
  // O limite default do Express (100kb) é menor que o arquivo máximo que o
  // editor do painel aceita abrir (2MB), então salvar um arquivo grande
  // falhava com um 500 sem explicação (P29).
  app.use(express.json({ limit: config.JSON_BODY_LIMIT }));

  app.get('/api/health', (req, res) => res.json({
    ok: true,
    uptime: process.uptime(),
    version: require('../package.json').version,
  }));

  app.use('/api/auth', authRoutes);
  app.use('/api/services/:id/files', authMiddleware, serviceFileRoutes);
  app.use('/api/services/:id/terminal', authMiddleware, terminalRoutes);
  app.use('/api/services/:id/backups', authMiddleware, backupRoutes);
  app.use('/api/services', authMiddleware, serviceRoutes);
  app.use('/api/databases', authMiddleware, databaseRoutes);
  app.use('/api/monitor', authMiddleware, monitorRoutes);
  app.use('/api/settings', authMiddleware, settingsRoutes);
  app.use('/api/files', authMiddleware, fileRoutes);
  app.use('/api/docker', authMiddleware, dockerRoutes);

  // 404 para rotas de API não encontradas — precisa vir antes do fallback
  // do SPA, senão /api/inexistente devolveria o index.html.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint não encontrado' }));

  // Serve the built frontend (frontend/dist) if present, so a single
  // `node src/server.js` can serve the whole panel on one port.
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  const indexHtml = path.join(frontendDist, 'index.html');
  const hasFrontend = fs.existsSync(indexHtml);

  if (hasFrontend) {
    app.use(express.static(frontendDist, {
      // Os assets do Vite têm hash no nome, então podem ser cacheados
      // agressivamente; o index.html nunca, senão o navegador serve uma
      // versão velha do painel após uma atualização.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    app.get('*', (req, res) => res.sendFile(indexHtml));
  } else {
    console.warn('⚠️  frontend/dist não encontrado — rode `npm run build` em frontend/ para servir a interface.');
    app.get('*', (req, res) =>
      res.status(200).send('Pterodroid backend está rodando. Gere o build do frontend para ver o painel aqui.'));
  }

  // Basic error handler so a thrown error never kills the whole process
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error('Erro não tratado:', err);
    if (res.headersSent) return;
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: status >= 500 ? 'Erro interno do servidor' : err.message });
  });

  const httpServer = http.createServer(app);
  setupSockets(httpServer);

  httpServer.listen(config.PORT, () => {
    console.log(`\n🚀 Pterodroid ouvindo em http://0.0.0.0:${config.PORT}`);
    console.log(`📁 Workspaces: ${config.WORKSPACES_ROOT}`);
    console.log(`💾 Dados:      ${config.DATA_ROOT}\n`);
  });

  // Resume services that were running before the panel last stopped.
  await driver.restoreAll();

  // ── Graceful shutdown ────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} recebido — parando serviços e gravando o banco...`);

    // Para de aceitar conexões novas antes de derrubar os serviços, pra não
    // atender uma requisição contra um estado que já está sendo desmontado.
    httpServer.close();
    stopPrune();

    try {
      terminals.closeAll();
      await Promise.allSettled([driver.stopAll(), dbm.stopAll(), tm.stopAll(), ntm.stop()]);
    } catch (e) {
      console.error('Erro durante o desligamento:', e.message);
    }

    try { getDB().flush(); } catch (e) { console.error('Erro ao gravar o banco:', e.message); }
    console.log('Até logo.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Uma promise rejeitada sem catch derruba o processo no Node 15+. Num
  // painel que precisa ficar de pé o dia inteiro num celular, registrar e
  // continuar é muito melhor do que morrer por causa de uma chamada
  // isolada ao Docker que falhou.
  process.on('unhandledRejection', (reason) => {
    console.error('Promise rejeitada sem tratamento:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('Exceção não capturada:', err);
  });
}

main().catch((err) => {
  console.error('Erro fatal na inicialização:', err);
  process.exit(1);
});
