/**
 * NamedTunnelManager — the "bring your own domain" counterpart to the
 * Quick Tunnels in tunnelManager.js.
 *
 * Unlike a Quick Tunnel (one ephemeral process per exposed port, random
 * URL), a Named Tunnel is ONE persistent cloudflared process that reads a
 * config.yml full of ingress rules ("this hostname → this local port")
 * and proxies all of them at once. Getting here requires the admin to
 * have a Cloudflare account with a domain already added as a zone, and to
 * have run `cloudflared tunnel login` themselves once (an interactive
 * browser OAuth step this module cannot do on your behalf).
 *
 * Flow:
 *   1. checkAuth()      — is cert.pem present from a prior `tunnel login`?
 *   2. createTunnel()   — one-time: registers a tunnel with Cloudflare,
 *                         writes a credentials JSON we keep in our own
 *                         data dir (not ~/.cloudflared) for tidiness.
 *   3. applyConfig()    — regenerates config.yml from whatever hostnames
 *                         are currently configured on the panel + its
 *                         services/databases, runs `route dns` for each,
 *                         and (re)starts the single tunnel process.
 *
 * Because ingress rules all live in one config for one process, adding or
 * changing a hostname means restarting that one process — briefly
 * interrupting every hostname it serves, not just the one that changed.
 * Acceptable for a personal panel; called out in the UI regardless.
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { getDB } = require('../db');
const config = require('../config');

const CERT_PATHS = [
  path.join(process.env.HOME || '', '.cloudflared', 'cert.pem'),
];

function hostnameFor(rawHostname, baseDomain) {
  const trimmed = (rawHostname || '').trim().toLowerCase();
  if (!trimmed) return null;
  // A bare label with no dot ("site1") gets the base domain appended.
  // Anything that already looks like a full hostname ("site1.outro.com")
  // is used exactly as typed.
  if (!trimmed.includes('.') && baseDomain) return `${trimmed}.${baseDomain}`;
  return trimmed;
}

function isValidHostname(host) {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host);
}

class NamedTunnelManager extends EventEmitter {
  constructor() {
    super();
    this.entry = null; // { process, stopped } for the single running tunnel
  }

  get configPath() { return path.join(config.CLOUDFLARED_DIR, 'config.yml'); }
  get credentialsPath() { return path.join(config.CLOUDFLARED_DIR, 'credentials.json'); }

  checkAuth() {
    const found = CERT_PATHS.find((p) => fs.existsSync(p));
    return {
      ok: !!found,
      message: found ? null :
        "cloudflared ainda não está autenticado. Rode 'cloudflared tunnel login' em um terminal " +
        "(abre o navegador para você entrar na sua conta Cloudflare) e tente de novo.",
    };
  }

  getSettings() {
    const db = getDB();
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key IN ('base_domain','panel_tunnel_hostname','named_tunnel_name','named_tunnel_id')"
    ).all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  setSetting(key, value) {
    const db = getDB();
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
  }

  isRunning() {
    return !!(this.entry && !this.entry.stopped);
  }

  /** One-time: registers a new named tunnel with Cloudflare. */
  async createTunnel(name) {
    const auth = this.checkAuth();
    if (!auth.ok) throw new Error(auth.message);

    if (!fs.existsSync(config.CLOUDFLARED_DIR)) fs.mkdirSync(config.CLOUDFLARED_DIR, { recursive: true });

    let raw;
    try {
      raw = execFileSync(config.CLOUDFLARED_BIN, [
        'tunnel', 'create', name,
        '--credentials-file', this.credentialsPath,
        '-o', 'json',
      ], { encoding: 'utf8', timeout: 30000 });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString() : err.message;
      throw new Error(`Falha ao criar o túnel: ${stderr.split('\n')[0]}`);
    }

    let tunnelId;
    try {
      const parsed = JSON.parse(raw);
      tunnelId = parsed.id || parsed.Id;
    } catch {
      // Fallback: some cloudflared versions print a human line before the
      // JSON, or the JSON shape differs. Try to salvage a UUID from the text.
      const match = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      tunnelId = match ? match[0] : null;
    }
    if (!tunnelId) throw new Error('Túnel criado, mas não consegui identificar o ID retornado pelo cloudflared.');

    this.setSetting('named_tunnel_name', name);
    this.setSetting('named_tunnel_id', tunnelId);
    return { name, id: tunnelId };
  }

  /** Rebuilds config.yml from current DB state, routes DNS for every
   * configured hostname, and (re)starts the tunnel process. */
  async applyConfig() {
    const settings = this.getSettings();
    if (!settings.named_tunnel_id) throw new Error('Nenhum túnel nomeado foi criado ainda.');

    const db = getDB();
    const baseDomain = settings.base_domain || '';
    const ingress = [];
    const hostnames = [];

    if (settings.panel_tunnel_hostname) {
      const host = hostnameFor(settings.panel_tunnel_hostname, baseDomain);
      if (host && isValidHostname(host)) {
        ingress.push({ hostname: host, service: `http://localhost:${config.PORT}` });
        hostnames.push(host);
      }
    }

    const services = db.prepare("SELECT * FROM services WHERE tunnel_hostname IS NOT NULL AND tunnel_hostname != '' AND port IS NOT NULL").all();
    for (const svc of services) {
      const host = hostnameFor(svc.tunnel_hostname, baseDomain);
      if (host && isValidHostname(host)) {
        ingress.push({ hostname: host, service: `http://localhost:${svc.port}` });
        hostnames.push(host);
      }
    }

    const instances = db.prepare("SELECT * FROM db_instances WHERE tunnel_hostname IS NOT NULL AND tunnel_hostname != ''").all();
    for (const inst of instances) {
      const host = hostnameFor(inst.tunnel_hostname, baseDomain);
      if (host && isValidHostname(host)) {
        ingress.push({ hostname: host, service: `tcp://localhost:${inst.port}` });
        hostnames.push(host);
      }
    }

    if (ingress.length === 0) {
      throw new Error('Nenhum hostname configurado ainda — defina o domínio do painel ou de algum serviço primeiro.');
    }

    if (!fs.existsSync(config.CLOUDFLARED_DIR)) fs.mkdirSync(config.CLOUDFLARED_DIR, { recursive: true });

    const yaml = this._buildConfigYaml(settings.named_tunnel_id, ingress);
    fs.writeFileSync(this.configPath, yaml);

    for (const host of hostnames) {
      try {
        execFileSync(config.CLOUDFLARED_BIN, [
          'tunnel', 'route', 'dns', '--overwrite-dns', settings.named_tunnel_name, host,
        ], { encoding: 'utf8', timeout: 20000 });
      } catch (err) {
        const stderr = err.stderr ? err.stderr.toString().split('\n')[0] : err.message;
        console.error(`[NamedTunnel] route dns falhou para ${host}: ${stderr}`);
        // Keep going — one bad hostname shouldn't block the others.
      }
    }

    await this._restart();
    return { hostnames };
  }

  _buildConfigYaml(tunnelId, ingress) {
    const lines = [
      `tunnel: ${tunnelId}`,
      `credentials-file: ${this.credentialsPath}`,
      'ingress:',
      ...ingress.map((r) => `  - hostname: ${r.hostname}\n    service: ${r.service}`),
      '  - service: http_status:404',
    ];
    return lines.join('\n') + '\n';
  }

  async _restart() {
    await this.stop();

    const settings = this.getSettings();
    const child = spawn(config.CLOUDFLARED_BIN, [
      'tunnel', '--config', this.configPath, 'run', settings.named_tunnel_name,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const entry = { process: child, stopped: false };
    this.entry = entry;
    this.emit('status', { status: 'starting' });

    child.on('error', (err) => {
      console.error('[NamedTunnel] failed to start:', err.message);
      if (this.entry === entry) {
        entry.stopped = true;
        this.entry = null;
        this.emit('status', { status: 'error', error: err.message });
      }
    });

    const handleOutput = (data) => {
      const line = data.toString();
      this.emit('log', { level: /\bERR\b/.test(line) ? 'error' : 'info', message: line });
    };
    child.stdout.on('data', handleOutput);
    child.stderr.on('data', handleOutput);

    child.on('exit', () => {
      if (this.entry === entry) {
        this.entry = null;
        this.emit('status', { status: entry.stopped ? 'stopped' : 'error' });
      }
    });
  }

  async stop() {
    if (!this.entry) return;
    const entry = this.entry;
    entry.stopped = true;
    this.entry = null;
    const proc = entry.process;
    if (proc && !proc.killed && proc.exitCode === null) {
      proc.kill('SIGTERM');
      await new Promise((resolve) => {
        const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} resolve(); }, 5000);
        proc.once('exit', () => { clearTimeout(t); resolve(); });
      });
    }
    this.emit('status', { status: 'stopped' });
  }

  status() {
    const settings = this.getSettings();
    return {
      authenticated: this.checkAuth().ok,
      tunnelCreated: !!settings.named_tunnel_id,
      tunnelName: settings.named_tunnel_name || null,
      running: this.isRunning(),
      baseDomain: settings.base_domain || null,
      panelHostname: settings.panel_tunnel_hostname
        ? hostnameFor(settings.panel_tunnel_hostname, settings.base_domain)
        : null,
    };
  }
}

module.exports = new NamedTunnelManager();
module.exports.hostnameFor = hostnameFor;
module.exports.isValidHostname = isValidHostname;
