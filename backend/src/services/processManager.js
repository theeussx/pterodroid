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
    if (!svc) throw new Error(`Service ${serviceId} not found`);

    if (this.procs.has(serviceId)) {
      await this._kill(serviceId, false);
    }

    // A user-initiated start is a fresh beginning — clear any restart
    // history left over from a previous crash-loop, so max_restarts has
    // a full budget again instead of picking up where an old loop left off.
    db.prepare('UPDATE services SET restart_count = 0 WHERE id = ?').run(serviceId);
    svc.restart_count = 0;

    return this._spawn(svc);
  }

  async stopService(serviceId) {
    if (!this.procs.has(serviceId)) return;
    await this._kill(serviceId, true);
  }

  async restartService(serviceId) {
    await this.stopService(serviceId);
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
    const running = db.prepare("SELECT * FROM services WHERE status = 'running'").all();
    for (const svc of running) {
      try {
        await this._spawn(svc);
        console.log(`↺  Restored service: ${svc.name}`);
      } catch (e) {
        console.error(`✗  Failed to restore ${svc.name}:`, e.message);
        db.prepare("UPDATE services SET status='error' WHERE id=?").run(svc.id);
      }
    }
  }

  /** Called on panel shutdown — stop everything cleanly. */
  async stopAll() {
    const ids = [...this.procs.keys()];
    await Promise.all(ids.map((id) => this._kill(id, true)));
  }

  // ── Internal ──────────────────────────────────────────────────────────

  async _spawn(svc) {
    const db = getDB();

    const [cmd, ...args] = this._parseCommand(svc.command);
    const cwd = svc.working_directory?.trim() || process.env.HOME || '/tmp';

    // Dynamic port allocation if service has a port defined
    let env = { ...process.env };
    try { env = { ...env, ...JSON.parse(svc.environment || '{}') }; } catch { /* keep base env */ }

    if (svc.port) {
      try {
        const activePort = await findAvailablePort(svc.port);
        if (activePort !== svc.port) {
          console.log(`[SVC] Port ${svc.port} busy, using ${activePort} for ${svc.name}`);
          db.prepare('UPDATE services SET port=? WHERE id=?').run(activePort, svc.id);
        }
        env.PORT = activePort.toString();
      } catch (err) {
        console.error(`[SVC] Failed to find available port for ${svc.name}:`, err.message);
      }
    }

    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      db.prepare("UPDATE services SET status='error' WHERE id=?").run(svc.id);
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
        db.prepare('INSERT INTO logs(service_id, level, message) VALUES(?,?,?)')
          .run(svc.id, level, message.slice(0, 2000));
      }

      this.emit('log', { serviceId: svc.id, ...log });
    };

    child.stdout.on('data', handleData('info'));
    child.stderr.on('data', handleData('error'));

    child.on('exit', (code) => {
      // "Failure" = died on its own with a non-zero/unknown code. A clean
      // code-0 exit is treated as intentional even if nobody called stop()
      // — e.g. a one-shot script that finished its work — and is not
      // auto-restarted (spec: restart "em caso de falha", not on any exit).
      const crashed = !entry.stopped && code !== 0;
      const status = entry.stopped ? 'stopped' : (code === 0 ? 'stopped' : 'error');

      db.prepare('UPDATE services SET status=?, pid=NULL, last_stopped=CURRENT_TIMESTAMP WHERE id=?')
        .run(status, svc.id);
      this.emit('status', { serviceId: svc.id, status });

      if (crashed && svc.auto_restart) {
        const max = svc.max_restarts ?? config.RESTART_MAX;
        if (entry.restartCount < max) {
          const delay = (svc.restart_delay ?? config.RESTART_DELAY) * 1000;
          entry.restartCount++;
          db.prepare('UPDATE services SET restart_count=? WHERE id=?').run(entry.restartCount, svc.id);

          entry.watchdog = setTimeout(() => {
            const fresh = db.prepare('SELECT * FROM services WHERE id=?').get(svc.id);
            if (fresh && !entry.stopped) {
              this._spawn(fresh).catch((err) => {
                console.error(`✗  Auto-restart failed for ${svc.name}:`, err.message);
              });
            }
          }, delay);
          return; // this entry will be replaced by the respawn's own .set()
        }
        db.prepare("UPDATE services SET status='error' WHERE id=?").run(svc.id);
        this.emit('status', { serviceId: svc.id, status: 'error', reason: 'max_restarts_exceeded' });
      }

      // No restart is pending for this entry. If _kill() is the one
      // handling this exit it will clean up the map itself after this
      // listener runs; otherwise (unattended crash / clean self-exit)
      // nobody else will, so we do it here to avoid leaking dead entries.
      if (!entry.stopped) this.procs.delete(svc.id);
    });

    child.on('error', (err) => {
      const log = { level: 'error', message: `spawn error: ${err.message}`, ts: Date.now() };
      entry.logs.push(log);
      this.emit('log', { serviceId: svc.id, ...log });
    });

    db.prepare('UPDATE services SET status=?, pid=?, restart_count=?, last_started=CURRENT_TIMESTAMP WHERE id=?')
      .run('running', child.pid, entry.restartCount, svc.id);
    this.emit('status', { serviceId: svc.id, status: 'running', pid: child.pid });

    // Quick Tunnel only when the service has a port but no custom domain —
    // if tunnel_hostname is set, the Named Tunnel's ingress config already
    // routes that hostname to this port (see namedTunnelManager.js), so
    // starting a Quick Tunnel too would be redundant.
    if (svc.port && !svc.tunnel_hostname) {
      tunnelManager.startTunnel('service', svc.id, env.PORT || svc.port).catch(err => {
        console.error(`[SVC] Failed to start tunnel for ${svc.name}:`, err.message);
      });
    }

    return child.pid;
  }

  async _kill(serviceId, updateDB) {
    const entry = this.procs.get(serviceId);
    if (!entry) return;

    // Stop tunnel
    tunnelManager.stopTunnel('service', serviceId).catch(() => {});

    entry.stopped = true;
    if (entry.watchdog) clearTimeout(entry.watchdog);

    const proc = entry.process;
    if (!proc.killed && proc.exitCode === null) {
      proc.kill('SIGTERM');
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* already gone */ }
          resolve();
        }, config.SIGTERM_WAIT);
        proc.once('exit', () => { clearTimeout(t); resolve(); });
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

  /** Minimal shell-style word split — handles single/double-quoted segments. */
  _parseCommand(cmd) {
    const parts = [];
    let cur = '';
    let inQ = false;
    let qChar = '';

    for (const ch of cmd.trim()) {
      if (inQ) {
        if (ch === qChar) inQ = false;
        else cur += ch;
      } else if (ch === '"' || ch === "'") {
        inQ = true; qChar = ch;
      } else if (ch === ' ' || ch === '\t') {
        if (cur) { parts.push(cur); cur = ''; }
      } else {
        cur += ch;
      }
    }
    if (cur) parts.push(cur);
    return parts;
  }
}

module.exports = new ProcessManager();
