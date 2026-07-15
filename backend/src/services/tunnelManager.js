const { spawn } = require('child_process');
const EventEmitter = require('events');
const { getDB } = require('../db');

class TunnelManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, object>} key (service_1 or db_1) -> runtime entry */
    this.tunnels = new Map();
  }

  async startTunnel(type, id, port) {
    const key = `${type}_${id}`;
    if (this.tunnels.has(key)) {
      await this.stopTunnel(type, id);
    }

    console.log(`[Tunnel] Starting cloudflared tunnel for ${key} on port ${port}...`);
    
    // Usamos cloudflared tunnel --url http://localhost:PORT
    // Isso gera um subdomínio temporário .trycloudflare.com
    const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const entry = {
      process: child,
      url: null,
      startedAt: Date.now()
    };
    this.tunnels.set(key, entry);

    child.stderr.on('data', (data) => {
      const line = data.toString();
      // Procurar pela URL do túnel na saída do cloudflared
      // Exemplo: |  https://some-name.trycloudflare.com  |
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !entry.url) {
        entry.url = match[0];
        console.log(`[Tunnel] ${key} is now public at: ${entry.url}`);
        this._updatePublicUrl(type, id, entry.url);
        this.emit('url', { type, id, url: entry.url });
      }
    });

    child.on('exit', () => {
      console.log(`[Tunnel] ${key} stopped.`);
      this._updatePublicUrl(type, id, null);
      this.tunnels.delete(key);
      this.emit('status', { type, id, status: 'stopped' });
    });

    return true;
  }

  async stopTunnel(type, id) {
    const key = `${type}_${id}`;
    const entry = this.tunnels.get(key);
    if (!entry) return;

    entry.process.kill();
    this.tunnels.delete(key);
    this._updatePublicUrl(type, id, null);
  }

  _updatePublicUrl(type, id, url) {
    const db = getDB();
    const table = type === 'service' ? 'services' : 'db_instances';
    db.prepare(`UPDATE ${table} SET public_url = ? WHERE id = ?`).run(url, id);
  }

  async stopAll() {
    for (const [key, entry] of this.tunnels) {
      entry.process.kill();
    }
    this.tunnels.clear();
  }
}

module.exports = new TunnelManager();
