/**
 * DBInstanceManager — provision and run local database engines
 * (PostgreSQL, MySQL/MariaDB) as plain child processes.
 *
 * Deliberately different from ProcessManager in one important way: no
 * auto-restart on crash. Automatically respawning a database against a
 * data directory it just crashed out of can turn one bad shutdown into
 * data corruption. Crashes are surfaced as status 'error' and left for the
 * admin to inspect and restart manually.
 */
const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const { getDB } = require('../db');
const config = require('../config');
const drivers = require('./dbDrivers');
const { isPortAvailable } = require('./portFinder');

class DBInstanceManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<number, object>} instanceId -> runtime entry */
    this.procs = new Map();
  }

  driverFor(type) {
    const d = drivers[type];
    if (!d) throw new Error(`Unknown database type: ${type}`);
    return d;
  }

  checkAvailable(type) {
    return this.driverFor(type).checkAvailable();
  }

  dataDirFor(inst) {
    return inst.data_directory?.trim() || path.join(config.DATABASES_ROOT, inst.type, inst.name);
  }

  // ── Public API ────────────────────────────────────────────────────────

  async startInstance(instanceId) {
    const db = getDB();
    const inst = db.prepare('SELECT * FROM db_instances WHERE id = ?').get(instanceId);
    if (!inst) throw new Error(`Database instance ${instanceId} not found`);

    if (this.procs.has(instanceId)) await this._kill(instanceId);

    const driver = this.driverFor(inst.type);
    const dataDirectory = this.dataDirFor(inst);

    // Unlike a service's port (an implementation detail, fine to move
    // since it's normally reached through a tunnel/proxy anyway), a
    // database's port is a stable contract — connection strings and
    // other services hardcode it. Silently reassigning it here (like
    // services do) would leave anything already pointed at the original
    // port unable to connect, which looks exactly like "the database
    // broke". Fail clearly instead, so the admin can free the port or
    // change it deliberately (via the update endpoint) rather than have
    // it move under them.
    const portFree = await isPortAvailable(inst.port);
    if (!portFree) {
      const err = new Error(
        `Porta ${inst.port} já está em uso por outro processo. Pare o que está usando essa porta, ` +
        `ou edite esta instância para usar outra porta antes de iniciar.`
      );
      err.status = 409;
      db.prepare("UPDATE db_instances SET status='error' WHERE id=?").run(instanceId);
      this.emit('status', { instanceId, status: 'error', error: err.message });
      throw err;
    }

    if (!inst.provisioned) {
      this.emit('status', { instanceId, status: 'provisioning' });
      db.prepare("UPDATE db_instances SET status='provisioning' WHERE id=?").run(instanceId);
      try {
        await driver.provision({
          dataDirectory,
          dbUsername: inst.db_username,
          dbPassword: inst.db_password,
          port: inst.port,
        });
      } catch (err) {
        db.prepare("UPDATE db_instances SET status='error' WHERE id=?").run(instanceId);
        this.emit('status', { instanceId, status: 'error', error: err.message });
        throw err;
      }
      db.prepare('UPDATE db_instances SET provisioned=1, data_directory=? WHERE id=?')
        .run(dataDirectory, instanceId);
    }

    return this._spawn({ ...inst, data_directory: dataDirectory }, driver);
  }

  async stopInstance(instanceId) {
    if (!this.procs.has(instanceId)) return;
    await this._kill(instanceId);
  }

  async restartInstance(instanceId) {
    await this.stopInstance(instanceId);
    return this.startInstance(instanceId);
  }

  getLogs(instanceId, limit = 200) {
    const entry = this.procs.get(instanceId);
    return entry ? entry.logs.slice(-limit) : [];
  }

  getRuntimeInfo(instanceId) {
    const entry = this.procs.get(instanceId);
    if (!entry) return null;
    return {
      pid: entry.process.pid,
      uptime: Date.now() - entry.startedAt,
      alive: !entry.process.killed && entry.process.exitCode === null,
    };
  }

  async stopAll() {
    const ids = [...this.procs.keys()];
    await Promise.all(ids.map((id) => this._kill(id)));
  }

  // Note: unlike services, DB instances are NOT auto-resumed on panel boot.
  // They always come back up as 'stopped' and wait for the admin to start
  // them explicitly — see class doc comment for the reasoning.

  // ── Internal ──────────────────────────────────────────────────────────

  _spawn(inst, driver) {
    const db = getDB();
    let cmd, args;
    try {
      ({ cmd, args } = driver.buildStartCommand({ dataDirectory: inst.data_directory, port: inst.port }));
    } catch (err) {
      db.prepare("UPDATE db_instances SET status='error' WHERE id=?").run(inst.id);
      this.emit('status', { instanceId: inst.id, status: 'error', error: err.message });
      throw err;
    }

    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      db.prepare("UPDATE db_instances SET status='error' WHERE id=?").run(inst.id);
      this.emit('status', { instanceId: inst.id, status: 'error', error: err.message });
      throw err;
    }

    const entry = { process: child, logs: [], startedAt: Date.now(), stopped: false };
    this.procs.set(inst.id, entry);

    const handleData = (level) => (data) => {
      const message = data.toString();
      const log = { level, message, ts: Date.now() };
      entry.logs.push(log);
      if (entry.logs.length > config.LOG_MAX_MEMORY) entry.logs.shift();

      if (level === 'error') {
        db.prepare('INSERT INTO logs(db_instance_id, level, message) VALUES(?,?,?)')
          .run(inst.id, level, message.slice(0, 2000));
      }
      this.emit('log', { instanceId: inst.id, ...log });
    };
    child.stdout.on('data', handleData('info'));
    child.stderr.on('data', handleData('error'));

    child.on('exit', () => {
      const status = entry.stopped ? 'stopped' : 'error';
      db.prepare("UPDATE db_instances SET status=?, pid=NULL WHERE id=?").run(status, inst.id);
      this.emit('status', { instanceId: inst.id, status });
      this.procs.delete(inst.id);
    });

    child.on('error', (err) => {
      const log = { level: 'error', message: `spawn error: ${err.message}`, ts: Date.now() };
      entry.logs.push(log);
      this.emit('log', { instanceId: inst.id, ...log });
    });

    db.prepare("UPDATE db_instances SET status='running', pid=? WHERE id=?").run(child.pid, inst.id);
    this.emit('status', { instanceId: inst.id, status: 'running', pid: child.pid });

    // NOTE: databases are deliberately never tunneled. cloudflared Quick
    // Tunnels (`--url http://localhost:PORT`) only proxy HTTP traffic — a
    // Postgres/MySQL client speaking its own wire protocol can't get
    // through one. Making this "work" for real needs a Named Tunnel with
    // TCP ingress *and* cloudflared running on the connecting device too
    // (`cloudflared access tcp`), which is a fair bit of setup on both
    // ends — see the README if you actually need that. Showing a public
    // URL here that quietly can't accept a real DB connection would be
    // worse than not having the button at all.

    return child.pid;
  }

  async _kill(instanceId) {
    const entry = this.procs.get(instanceId);
    if (!entry) return;

    entry.stopped = true;

    const db = getDB();
    const inst = db.prepare('SELECT * FROM db_instances WHERE id=?').get(instanceId);
    const driver = this.driverFor(inst.type);

    const proc = entry.process;
    if (!proc.killed && proc.exitCode === null) {
      proc.kill(driver.stopSignal || 'SIGTERM');
      await new Promise((resolve) => {
        // Databases get double the grace period services get, so a
        // checkpoint/flush in progress has a real chance to finish.
        const t = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* already gone */ }
          resolve();
        }, config.SIGTERM_WAIT * 2);
        proc.once('exit', () => { clearTimeout(t); resolve(); });
      });
    }
    // The 'exit' listener registered in _spawn does the DB write, the
    // status emit, and the map cleanup — nothing left to do here.
  }
}

module.exports = new DBInstanceManager();
