/**
 * TunnelManager — exposes a local port to the internet via a Cloudflare
 * Quick Tunnel (`cloudflared tunnel --url http://localhost:PORT`).
 *
 * Quick Tunnels need no Cloudflare account and no domain: cloudflared
 * connects out to Cloudflare's edge and gets back a random
 * `*.trycloudflare.com` hostname, which it prints to stderr a few seconds
 * after starting. We spawn it like any other supervised child process and
 * scrape that hostname out of its log output.
 *
 * Tradeoff worth knowing: that hostname is NOT stable — it changes every
 * time the tunnel restarts. For a fixed, branded hostname you need a Named
 * Tunnel against a domain you control in Cloudflare (see README).
 */
const { spawn, execFileSync } = require('child_process');
const EventEmitter = require('events');
const { getDB } = require('../db');
const config = require('../config');

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

class TunnelManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, object>} key ("service_1", "db_1", "panel") -> runtime entry */
    this.tunnels = new Map();
    this._availabilityCache = null;
  }

  /** Checked once and cached — cloudflared's presence doesn't change while the panel is running. */
  checkAvailable() {
    if (this._availabilityCache) return this._availabilityCache;
    try {
      execFileSync(config.CLOUDFLARED_BIN, ['--version'], { stdio: 'pipe', timeout: 5000 });
      this._availabilityCache = { ok: true };
    } catch {
      this._availabilityCache = {
        ok: false,
        message:
          "cloudflared não encontrado. Instale com 'pkg install cloudflared' (Termux) ou veja " +
          "o README para instalação via apt/binário direto (Ubuntu proot).",
      };
    }
    return this._availabilityCache;
  }

  /** Current state for a given tunnel key, or null if none is running. */
  getTunnelInfo(type, id) {
    const entry = this.tunnels.get(`${type}_${id}`);
    if (!entry) return null;
    return { url: entry.url, status: entry.url ? 'connected' : 'connecting', startedAt: entry.startedAt };
  }

  async startTunnel(type, id, port) {
    const key = `${type}_${id}`;

    const check = this.checkAvailable();
    if (!check.ok) {
      this.emit('status', { type, id, status: 'error', error: check.message });
      throw new Error(check.message);
    }

    if (this.tunnels.has(key)) {
      await this.stopTunnel(type, id);
    }

    console.log(`[Tunnel] Starting cloudflared tunnel for ${key} on port ${port}...`);

    const entry = { process: null, url: null, startedAt: Date.now(), stopped: false };
    this.tunnels.set(key, entry);
    this.emit('status', { type, id, status: 'connecting' });

    let child;
    try {
      child = spawn(config.CLOUDFLARED_BIN, ['tunnel', '--url', `http://localhost:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.tunnels.delete(key);
      this.emit('status', { type, id, status: 'error', error: err.message });
      throw err;
    }
    entry.process = child;

    // Without this, a missing/broken cloudflared binary crashes the WHOLE
    // panel process (Node re-throws unhandled 'error' events on emitters).
    child.on('error', (err) => {
      console.error(`[Tunnel] ${key} failed to start:`, err.message);
      if (!entry.stopped) {
        entry.stopped = true;
        this.tunnels.delete(key);
        this._updatePublicUrl(type, id, null);
        this.emit('status', { type, id, status: 'error', error: err.message });
      }
    });

    const handleOutput = (data) => {
      const line = data.toString();
      const match = line.match(URL_RE);
      if (match && !entry.url) {
        entry.url = match[0];
        console.log(`[Tunnel] ${key} is now public at: ${entry.url}`);
        this._updatePublicUrl(type, id, entry.url);
        this.emit('url', { type, id, url: entry.url });
        this.emit('status', { type, id, status: 'connected', url: entry.url });
      }
    };
    child.stdout.on('data', handleOutput);
    child.stderr.on('data', handleOutput); // cloudflared logs its banner (incl. the URL) to stderr

    child.on('exit', () => {
      console.log(`[Tunnel] ${key} stopped.`);
      this._updatePublicUrl(type, id, null);
      // Only touch the map/emit if nothing newer has already replaced this
      // entry under the same key (stopTunnel()+startTunnel() in quick
      // succession would otherwise let this stale handler clobber it).
      if (this.tunnels.get(key) === entry) {
        this.tunnels.delete(key);
        this.emit('status', { type, id, status: 'stopped' });
      }
    });

    return true;
  }

  async stopTunnel(type, id) {
    const key = `${type}_${id}`;
    const entry = this.tunnels.get(key);
    if (!entry) return;

    entry.stopped = true;
    this.tunnels.delete(key);
    this._updatePublicUrl(type, id, null);

    if (entry.process && !entry.process.killed && entry.process.exitCode === null) {
      entry.process.kill('SIGTERM');
    }
  }

  _updatePublicUrl(type, id, url) {
    if (type === 'panel') return; // panel's own tunnel has no DB row to update
    try {
      const db = getDB();
      const table = type === 'service' ? 'services' : 'db_instances';
      db.prepare(`UPDATE ${table} SET public_url = ? WHERE id = ?`).run(url, id);
    } catch (err) {
      console.error('[Tunnel] failed to persist public_url:', err.message);
    }
  }

  async stopAll() {
    const keys = [...this.tunnels.keys()];
    await Promise.all(keys.map((key) => {
      const [type, id] = key.split(/_(.+)/); // split on first underscore only
      return this.stopTunnel(type, id);
    }));
  }
}

module.exports = new TunnelManager();
