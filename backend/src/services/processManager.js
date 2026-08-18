/**
 * ProcessManager — spawn, watch and auto-restart user services.
 * No systemd. Works identically in Termux and Ubuntu-proot: everything
 * is a plain child_process kept alive by our own watchdog logic.
 */
const { spawn } = require('child_process');
const EventEmitter = require('events');
const { getDB } = require('../db');
const config = require('../config');
const { findAvailablePort } = require('./portFinder');
const tunnelManager = require('./tunnelManager');
const workspaces = require('./workspaceManager');
const { parseCommand } = require('./commandParser');

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<number, object>} serviceId -> runtime entry */
    this.procs = new Map();
  }

  // ── Public API ────────────────────────────────────────────────────────

  async startService(serviceId) {
    const db = getDB();
    const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
    if (!svc) throw new Error(`Serviço ${serviceId} não encontrado`);

    if (this.procs.has(serviceId)) {
      await this._kill(serviceId, false);
    }

    // A user-initiated start is a fresh beginning — clear any restart
    // history left over from a previous crash-loop, so max_restarts has
    // a full budget again instead of picking up where an old loop left off.
    // desired_state='running' registra a INTENÇÃO: é isso que faz o serviço
    // voltar sozinho no próximo boot do painel, mesmo após um desligamento
    // gracioso (que grava status='stopped').
    db.prepare("UPDATE services SET restart_count = 0, desired_state = 'running' WHERE id = ?").run(serviceId);
    svc.restart_count = 0;

    return this._spawn(svc);
  }

  async stopService(serviceId) {
    const db = getDB();
    // Parar é sempre explícito: some da intenção de rodar, então o painel
    // não vai ressuscitar este serviço no próximo boot.
    db.prepare("UPDATE services SET desired_state = 'stopped' WHERE id = ?").run(serviceId);

    if (!this.procs.has(serviceId)) {
      // Já não há processo — mas o banco pode ter ficado marcado como
      // 'running' (ex.: painel morto à força). Reconcilia o estado em vez
      // de devolver sucesso deixando a UI mostrando "rodando" pra sempre.
      db.prepare("UPDATE services SET status='stopped', pid=NULL WHERE id=? AND status='running'").run(serviceId);
      return;
    }
    await this._kill(serviceId, true);
  }

  /** restart NÃO deve limpar a intenção de rodar — só reinicia o processo. */
  async restartService(serviceId) {
    await this._kill(serviceId, false);
    return this.startService(serviceId);
  }

  sendInput(serviceId, text) {
    const entry = this.procs.get(serviceId);
    if (!entry?.process?.stdin?.writable) return false;
    entry.process.stdin.write(text + '\n');
    return true;
  }

  getLogs(serviceId, limit = 200) {
    const entry = this.procs.get(serviceId);
    if (!entry) return [];
    return entry.logs.slice(-limit);
  }

  getRuntimeInfo(serviceId) {
    const entry = this.procs.get(serviceId);
    if (!entry) return null;
    return {
      pid: entry.process.pid,
      uptime: Date.now() - entry.startedAt,
      restartCount: entry.restartCount,
      alive: !entry.process.killed && entry.process.exitCode === null,
    };
  }

  /** Called once at panel boot — resume services that were running before. */
  async restoreAll() {
    const db = getDB();
    // Retoma pelo que o usuário PEDIU (desired_state), não pelo último
    // status observado: o desligamento gracioso grava status='stopped' em
    // todo mundo, então filtrar por status fazia o auto-resume nunca
    // acontecer justamente no caso mais comum.
    //
    // O filtro por runtime_type também importa: sem ele um serviço Docker
    // era "restaurado" aqui como processo local, e o painel tentava
    // executar o nome da imagem como se fosse um binário (P12).
    const running = db.prepare(`
      SELECT * FROM services
      WHERE COALESCE(runtime_type, 'process') = 'process'
        AND (desired_state = 'running' OR (desired_state IS NULL AND status = 'running'))
    `).all();

    for (const svc of running) {
      try {
        await this._spawn(svc);
        console.log(`↺  Serviço restaurado: ${svc.name}`);
      } catch (e) {
        console.error(`✗  Falha ao restaurar ${svc.name}: ${e.message}`);
        db.prepare("UPDATE services SET status='error', pid=NULL WHERE id=?").run(svc.id);
      }
    }
  }

  /**
   * Chamado no desligamento do painel. Usa updateDB=false de propósito:
   * o processo realmente morre, mas a INTENÇÃO de estar rodando é
   * preservada, e é ela que faz o serviço voltar no próximo boot.
   */
  async stopAll() {
    const ids = [...this.procs.keys()];
    await Promise.all(ids.map((id) => this._kill(id, false)));
    const db = getDB();
    db.prepare("UPDATE services SET status = 'stopped', pid = NULL WHERE status = 'running'").run();
  }

  // ── Internal ──────────────────────────────────────────────────────────

  async _spawn(svc) {
    const db = getDB();

    const { cmd, args } = parseCommand(svc.command);
    if (!cmd) {
      const err = new Error('Comando de inicialização vazio');
      db.prepare("UPDATE services SET status='error', pid=NULL WHERE id=?").run(svc.id);
      this.emit('status', { serviceId: svc.id, status: 'error', error: err.message });
      throw err;
    }

    // O workspace precisa existir antes do spawn: se o usuário apagou a
    // pasta, recriar é muito melhor do que falhar com um ENOENT cru.
    const cwd = workspaces.ensureDir(
      workspaces.normalize(svc.working_directory) || workspaces.createForService(svc.name),
    );
    if (cwd !== svc.working_directory) {
      db.prepare('UPDATE services SET working_directory=? WHERE id=?').run(cwd, svc.id);
    }

    let env = { ...process.env };
    let explicitEnvironment = {};
    try {
      explicitEnvironment = JSON.parse(svc.environment || '{}');
      env = { ...env, ...explicitEnvironment };
    } catch { /* keep base env */ }
    // O painel costuma definir PORT para si mesmo. Nunca repasse essa porta
    // para um serviço que não escolheu uma porta explicitamente, pois o
    // processo scaffoldado pode tentar escutar na mesma porta do painel.
    if (!svc.port && !Object.prototype.hasOwnProperty.call(explicitEnvironment, 'PORT')) {
      delete env.PORT;
    }

    if (svc.port) {
      try {
        const activePort = await findAvailablePort(svc.port);
        if (activePort !== svc.port) {
          console.log(`[SVC] Porta ${svc.port} ocupada, usando ${activePort} para ${svc.name}`);
          db.prepare('UPDATE services SET port=? WHERE id=?').run(activePort, svc.id);
        }
        env.PORT = String(activePort);
      } catch (err) {
        console.error(`[SVC] Não foi possível achar porta livre para ${svc.name}: ${err.message}`);
      }
    }

    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      db.prepare("UPDATE services SET status='error', pid=NULL WHERE id=?").run(svc.id);
      this.emit('status', { serviceId: svc.id, status: 'error', error: err.message });
      throw err;
    }

    const entry = {
      process: child,
      logs: [],
      startedAt: Date.now(),
      restartCount: svc.restart_count || 0,
      watchdog: null,
      stopped: false, // true = intentionally stopped, suppress auto-restart
      exited: false,
    };
    this.procs.set(svc.id, entry);

    const handleData = (level) => (data) => {
      const message = data.toString();
      const log = { level, message, ts: Date.now() };

      entry.logs.push(log);
      if (entry.logs.length > config.LOG_MAX_MEMORY) entry.logs.shift();

      // Only persist error-level lines to SQLite — keeps the DB small and
      // avoids serializing the whole in-memory file on every stdout chunk.
      if (level === 'error') {
        try {
          db.prepare('INSERT INTO logs(service_id, level, message) VALUES(?,?,?)')
            .run(svc.id, level, message.slice(0, 2000));
        } catch (err) {
          console.error('[SVC] falha ao persistir log:', err.message);
        }
      }

      this.emit('log', { serviceId: svc.id, ...log });
    };

    child.stdout.on('data', handleData('info'));
    child.stderr.on('data', handleData('error'));

    /**
     * Um único caminho de saída, usado tanto pelo evento 'exit' quanto pelo
     * 'error'. Isso importa porque quando o binário não existe o Node emite
     * SÓ 'error' e nunca 'exit' — a versão anterior tratava apenas 'exit',
     * então a entrada ficava órfã no mapa e o serviço aparecia como
     * "rodando" pra sempre (P13, confirmado em teste isolado).
     */
    const finalize = (code, spawnError) => {
      if (entry.exited) return;
      entry.exited = true;

      const crashed = !entry.stopped && (spawnError != null || code !== 0);
      const status = entry.stopped ? 'stopped' : (crashed ? 'error' : 'stopped');

      db.prepare('UPDATE services SET status=?, pid=NULL, last_stopped=CURRENT_TIMESTAMP WHERE id=?')
        .run(status, svc.id);
      this.emit('status', { serviceId: svc.id, status, error: spawnError?.message });

      if (crashed && svc.auto_restart) {
        // Um serviço que ficou de pé bastante tempo antes de cair não está
        // num crash-loop: zera o orçamento de tentativas, senão quedas
        // esporádicas ao longo de semanas acabam esgotando max_restarts.
        const ranLongEnough = Date.now() - entry.startedAt >= config.RESTART_STABLE_MS;
        if (ranLongEnough && entry.restartCount > 0) {
          entry.restartCount = 0;
          db.prepare('UPDATE services SET restart_count=0 WHERE id=?').run(svc.id);
        }

        const max = svc.max_restarts ?? config.RESTART_MAX;
        if (entry.restartCount < max) {
          const delay = (svc.restart_delay ?? config.RESTART_DELAY) * 1000;
          entry.restartCount += 1;
          db.prepare('UPDATE services SET restart_count=? WHERE id=?').run(entry.restartCount, svc.id);

          entry.watchdog = setTimeout(() => {
            // Só respawna se ESTA entrada ainda for a atual do serviço —
            // se alguém já iniciou de novo pela UI, não duplica processo.
            if (this.procs.get(svc.id) !== entry || entry.stopped) return;
            const fresh = db.prepare('SELECT * FROM services WHERE id=?').get(svc.id);
            if (!fresh) return;
            fresh.restart_count = entry.restartCount;
            this._spawn(fresh).catch((err) => {
              console.error(`✗  Auto-restart falhou para ${svc.name}: ${err.message}`);
            });
          }, delay);
          return; // a entrada será substituída pelo respawn
        }

        db.prepare("UPDATE services SET status='error' WHERE id=?").run(svc.id);
        this.emit('status', { serviceId: svc.id, status: 'error', reason: 'max_restarts_exceeded' });
      }

      // Nenhum restart pendente: limpa a entrada se ela ainda for a atual.
      if (this.procs.get(svc.id) === entry) this.procs.delete(svc.id);
    };

    child.on('exit', (code) => finalize(code, null));

    child.on('error', (err) => {
      const log = { level: 'error', message: `erro ao executar: ${err.message}`, ts: Date.now() };
      entry.logs.push(log);
      this.emit('log', { serviceId: svc.id, ...log });
      finalize(null, err);
    });

    db.prepare('UPDATE services SET status=?, pid=?, restart_count=?, last_started=CURRENT_TIMESTAMP WHERE id=?')
      .run('running', child.pid, entry.restartCount, svc.id);
    this.emit('status', { serviceId: svc.id, status: 'running', pid: child.pid });

    // Quick Tunnel only when the service has a port but no custom domain —
    // if tunnel_hostname is set, the Named Tunnel's ingress config already
    // routes that hostname to this port (see namedTunnelManager.js), so
    // starting a Quick Tunnel too would be redundant.
    if (svc.port && !svc.tunnel_hostname) {
      tunnelManager.startTunnel('service', svc.id, env.PORT || svc.port).catch((err) => {
        console.error(`[SVC] Falha ao iniciar túnel para ${svc.name}: ${err.message}`);
      });
    }

    return child.pid;
  }

  async _kill(serviceId, updateDB) {
    const entry = this.procs.get(serviceId);
    if (!entry) return;

    tunnelManager.stopTunnel('service', serviceId).catch(() => {});

    entry.stopped = true;
    if (entry.watchdog) {
      clearTimeout(entry.watchdog);
      entry.watchdog = null;
    }

    const proc = entry.process;
    if (!proc.killed && proc.exitCode === null) {
      try { proc.kill('SIGTERM'); } catch { /* já morreu */ }
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* already gone */ }
          resolve();
        }, config.SIGTERM_WAIT);
        proc.once('exit', () => { clearTimeout(timer); resolve(); });
        // Se o processo nunca chegou a existir (erro de spawn), 'exit'
        // jamais vem — o timeout acima é a rede de segurança.
      });
    }

    this.procs.delete(serviceId);

    if (updateDB) {
      const db = getDB();
      db.prepare('UPDATE services SET status=?, pid=NULL, last_stopped=CURRENT_TIMESTAMP WHERE id=?')
        .run('stopped', serviceId);
      this.emit('status', { serviceId, status: 'stopped' });
    }
  }
}

module.exports = new ProcessManager();
