'use strict';
/**
 * DockerServiceDriver — trata serviços com runtime_type='docker'.
 *
 * Espelha de propósito a superfície pública do processManager.js
 * (startService/stopService/restartService/sendInput/getLogs/
 * getRuntimeInfo/restoreAll/stopAll + eventos 'log'/'status' no mesmo
 * formato) — é isso que permite o serviceDriverRegistry.js escolher entre
 * os dois sem que rotas, sockets ou o frontend precisem saber qual dos
 * dois está por trás de um serviço.
 *
 * Diferenças de propósito em relação ao processManager:
 *  - Não reimplementa watchdog/backoff: quem cuida de reiniciar um
 *    container que caiu é a RestartPolicy nativa do Docker
 *    (HostConfig.RestartPolicy), configurada a partir de auto_restart/
 *    max_restarts do serviço. Menos lógica pra manter, e o comportamento
 *    já é correto mesmo se o painel estiver fora do ar quando o restart
 *    acontece (o que é bem provável quando o host Docker é remoto).
 *  - status/stats não vêm de um processo vigiado em memória, e sim de
 *    poll periódico na Docker Engine API (ver _pollAll). Isso alimenta um
 *    cache em memória que getRuntimeInfo lê de forma síncrona, do mesmo
 *    jeito que o processManager — assim GET /api/services (que itera
 *    todos os serviços de uma vez) continua uma leitura local, em vez de
 *    1 chamada de rede por serviço a cada listagem.
 *  - stopAll() de propósito NÃO para containers: eles podem estar rodando
 *    num host remoto (VPS, NAS...) e continuam existindo mesmo com o
 *    painel fechado. Só o processManager precisa derrubar processos junto
 *    com o painel, porque só ele os "possui" de verdade.
 */
const EventEmitter = require('events');
const { getDB } = require('../db');
const hosts = require('./dockerHostManager');
const tunnelManager = require('./tunnelManager');

const POLL_INTERVAL_MS = 3000;

/** Mesmo tokenizer (simplificado) que o processManager usa pro campo `command` —
 * aqui vira `Cmd` do container quando o serviço pede um override do
 * ENTRYPOINT/CMD padrão da imagem. Duplicado de propósito: são ~15 linhas,
 * e não vale a pena arriscar mexer no processManager (já testado, já
 * rodando em produção) só pra extrair isso num util compartilhado.
 */
function splitCommand(cmd) {
  const parts = [];
  let cur = '';
  let inQ = false;
  let qChar = '';
  for (const ch of (cmd || '').trim()) {
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

function slugify(name) {
  return (name || 'svc').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').slice(0, 40) || 'svc';
}

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json || '');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/** Monta o spec de POST /containers/create a partir da linha de `services`. */
function buildContainerSpec(svc) {
  const env = safeParse(svc.environment, {});
  const volumes = safeParse(svc.volumes, []);
  const networks = safeParse(svc.docker_networks, []);
  let ports = safeParse(svc.docker_ports, []);
  if (!ports.length && svc.port) {
    ports = [{ containerPort: svc.port, hostPort: svc.port, protocol: 'tcp' }];
  }

  const exposedPorts = {};
  const portBindings = {};
  for (const p of ports) {
    const key = `${p.containerPort}/${p.protocol || 'tcp'}`;
    exposedPorts[key] = {};
    portBindings[key] = [{ HostPort: String(p.hostPort ?? p.containerPort) }];
  }

  const binds = volumes.map((v) => `${v.source}:${v.target}${v.readOnly ? ':ro' : ''}`);

  const spec = {
    Image: svc.image,
    Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
      Binds: binds,
      NetworkMode: networks[0] || undefined,
      RestartPolicy: svc.auto_restart
        ? { Name: 'on-failure', MaximumRetryCount: svc.max_restarts || 10 }
        : { Name: 'no' },
    },
  };

  if (svc.cpu_limit) spec.HostConfig.NanoCpus = Math.round(svc.cpu_limit * 1e9);
  if (svc.memory_limit) spec.HostConfig.Memory = svc.memory_limit * 1024 * 1024;

  const cmd = splitCommand(svc.command);
  if (cmd.length) spec.Cmd = cmd;

  return { spec, extraNetworks: networks.slice(1) };
}

/** Fórmula padrão do Docker CLI pra CPU% a partir de um snapshot de /stats. */
function computeCpuPercent(stats) {
  try {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const onlineCpus = stats.cpu_stats.online_cpus || (stats.cpu_stats.cpu_usage.percpu_usage || []).length || 1;
    if (systemDelta <= 0 || cpuDelta < 0) return 0;
    return Math.round((cpuDelta / systemDelta) * onlineCpus * 1000) / 10;
  } catch {
    return null;
  }
}

class DockerServiceDriver extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<number, object>} serviceId -> snapshot normalizado */
    this.cache = new Map();
    /** @type {Map<number, {stop: Function}>} serviceId -> handle do streamLogs ao vivo */
    this.logStreams = new Map();
    this.pollTimer = null;
  }

  // ── Public API — mesma forma que processManager ──────────────────────

  async startService(serviceId) {
    const db = getDB();
    const svc = this._getRow(db, serviceId);
    const engine = hosts.engineFor(svc.docker_host_id);

    if (!svc.container_id) {
      await this._createContainer(svc, engine);
    } else {
      try {
        await engine.startContainer(svc.container_id);
      } catch (err) {
        // Container sumiu por fora (docker rm manual, host recriado...) —
        // recria em vez de deixar o serviço travado num erro permanente.
        if (err.statusCode === 404) {
          db.prepare('UPDATE services SET container_id = NULL WHERE id = ?').run(serviceId);
          svc.container_id = null;
          await this._createContainer(svc, engine);
        } else {
          throw err;
        }
      }
    }

    db.prepare("UPDATE services SET status='running', last_started=CURRENT_TIMESTAMP WHERE id=?").run(serviceId);
    this.cache.delete(serviceId); // força um poll fresco na próxima leitura, em vez de mostrar o snapshot velho até o próximo tick
    this.emit('status', { serviceId, status: 'running' });
    this._ensurePolling();

    const fresh = this._getRow(db, serviceId);
    this._startLogStream(serviceId, fresh.container_id, engine);
    if (fresh.port && !fresh.tunnel_hostname) {
      tunnelManager.startTunnel('service', serviceId, fresh.port).catch((err) => {
        console.error(`[DOCKER] Falha ao iniciar tunnel pra ${fresh.name}:`, err.message);
      });
    }

    return fresh.container_id;
  }

  async stopService(serviceId) {
    const db = getDB();
    const svc = this._getRow(db, serviceId);
    if (!svc.container_id) return;
    const engine = hosts.engineFor(svc.docker_host_id);

    tunnelManager.stopTunnel('service', serviceId).catch(() => {});
    this._stopLogStream(serviceId);

    try {
      await engine.stopContainer(svc.container_id);
    } catch (err) {
      if (err.statusCode !== 404) throw err; // 404 = já não existe, trata como já parado
    }

    this.cache.delete(serviceId);
    db.prepare("UPDATE services SET status='stopped', pid=NULL, last_stopped=CURRENT_TIMESTAMP WHERE id=?").run(serviceId);
    this.emit('status', { serviceId, status: 'stopped' });
  }

  async restartService(serviceId) {
    const db = getDB();
    const svc = this._getRow(db, serviceId);
    if (!svc.container_id) return this.startService(serviceId);

    const engine = hosts.engineFor(svc.docker_host_id);
    await engine.restartContainer(svc.container_id);
    this.cache.delete(serviceId);
    db.prepare("UPDATE services SET status='running', last_started=CURRENT_TIMESTAMP WHERE id=?").run(serviceId);
    this.emit('status', { serviceId, status: 'running' });
    return svc.container_id;
  }

  /** Remove o container de verdade — usado pelo DELETE /api/services/:id, não tem equivalente direto no processManager. */
  async removeContainer(serviceId, { removeVolumes = false } = {}) {
    const db = getDB();
    const svc = this._getRow(db, serviceId);
    if (!svc.container_id) return;
    const engine = hosts.engineFor(svc.docker_host_id);
    try {
      await engine.removeContainer(svc.container_id, { force: true, volumes: removeVolumes });
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }
    this.cache.delete(serviceId);
  }

  /** Entrada interativa em container é via exec (sessão de terminal), não stdin do PID 1 — fica pra fase do terminal web. */
  sendInput() {
    return false;
  }

  async getLogs(serviceId, limit = 200) {
    const db = getDB();
    const svc = this._getRow(db, serviceId);
    if (!svc.container_id) return [];
    const engine = hosts.engineFor(svc.docker_host_id);
    const lines = await engine.getLogs(svc.container_id, { tail: limit });
    return lines.map((l) => ({
      level: l.stream === 'stderr' ? 'error' : 'info',
      message: l.text,
      ts: Date.now(),
    }));
  }

  /** Síncrono de propósito — lê do cache alimentado por _pollAll, não bate na rede. */
  getRuntimeInfo(serviceId) {
    return this.cache.get(serviceId) || null;
  }

  /** Chamado uma vez no boot do painel — containers com RestartPolicy própria não precisam ser "respawnados", só confirma que estão de pé. */
  async restoreAll() {
    const db = getDB();
    const running = db.prepare("SELECT * FROM services WHERE runtime_type = 'docker' AND status = 'running'").all();
    for (const svc of running) {
      if (!svc.container_id) continue;
      try {
        const engine = hosts.engineFor(svc.docker_host_id);
        await engine.startContainer(svc.container_id); // no-op se já estiver rodando
        this._startLogStream(svc.id, svc.container_id, engine);
      } catch (e) {
        console.error(`✗  Falha ao restaurar container de ${svc.name}:`, e.message);
        db.prepare("UPDATE services SET status='error' WHERE id=?").run(svc.id);
      }
    }
    if (running.length) this._ensurePolling();
  }

  /** Ver nota no topo do arquivo: containers remotos sobrevivem ao painel de propósito. Só para o poll local e os streams de log (essas conexões são do painel, não do container). */
  async stopAll() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const serviceId of [...this.logStreams.keys()]) this._stopLogStream(serviceId);
  }

  // ── Internos ──────────────────────────────────────────────────────────

  _getRow(db, serviceId) {
    const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
    if (!svc) throw new Error(`Service ${serviceId} not found`);
    return svc;
  }

  async _createContainer(svc, engine) {
    const db = getDB();
    const { spec, extraNetworks } = buildContainerSpec(svc);
    const created = await engine.createContainer(spec, { name: `pterodroid_${svc.id}_${slugify(svc.name)}` });

    for (const net of extraNetworks) {
      await engine.connectNetwork(net, created.Id).catch((err) => {
        console.error(`[DOCKER] Falha ao conectar container ${created.Id} na rede ${net}:`, err.message);
      });
    }

    db.prepare('UPDATE services SET container_id = ? WHERE id = ?').run(created.Id, svc.id);
    svc.container_id = created.Id;
    await engine.startContainer(created.Id);
    return created.Id;
  }

  _ensurePolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this._pollAll().catch(() => {}), POLL_INTERVAL_MS);
  }

  /**
   * Liga o follow=1 de logs pro container e emite 'log' por linha completa,
   * no mesmo formato {serviceId, level, message, ts} que o processManager
   * usa — é isso que faz sockets/index.js e o LogViewer não precisarem
   * saber se um serviço é processo local ou container.
   */
  async _startLogStream(serviceId, containerId, engine) {
    if (this.logStreams.has(serviceId)) return; // já tem um stream ligado pra esse serviço
    let partial = '';
    try {
      const handle = await engine.streamLogs(containerId, {
        tail: 0, // histórico já vem de getLogs() quando a tela abre; aqui é só o que acontecer daqui pra frente
        onLine: (text, stream) => {
          partial += text;
          const lines = partial.split('\n');
          partial = lines.pop(); // pedaço sem quebra de linha ainda — guarda pro próximo chunk
          for (const line of lines) {
            if (!line) continue;
            this.emit('log', { serviceId, level: stream === 'stderr' ? 'error' : 'info', message: line, ts: Date.now() });
          }
        },
        onError: () => {
          // Conexão do stream caiu (host reiniciou, rede oscilou...) — não é
          // erro fatal do serviço em si, só para de acompanhar ao vivo; o
          // próximo poll de status ainda funciona normalmente.
          this.logStreams.delete(serviceId);
        },
      });
      this.logStreams.set(serviceId, handle);
    } catch {
      // Container pode não existir mais, host pode estar fora do ar — sem
      // stream ao vivo por enquanto, tudo bem, getLogs() sob demanda continua funcionando.
    }
  }

  _stopLogStream(serviceId) {
    const handle = this.logStreams.get(serviceId);
    if (handle) {
      handle.stop();
      this.logStreams.delete(serviceId);
    }
  }

  async _pollAll() {
    const db = getDB();
    const rows = db.prepare(
      "SELECT id, docker_host_id, container_id FROM services WHERE runtime_type = 'docker' AND container_id IS NOT NULL"
    ).all();
    if (!rows.length) return;
    await Promise.all(rows.map((row) => this._pollOne(row).catch(() => {})));
  }

  async _pollOne({ id, docker_host_id, container_id }) {
    const engine = hosts.engineFor(docker_host_id);
    const info = await engine.inspectContainer(container_id);
    const stats = await engine.statsOnce(container_id).catch(() => null);

    const prev = this.cache.get(id);
    const status = info.State?.Running ? 'running' : (info.State?.Status || 'stopped');
    const startedAtMs = info.State?.StartedAt ? new Date(info.State.StartedAt).getTime() : null;

    const snapshot = {
      status,
      containerId: container_id,
      pid: info.State?.Pid || null,
      uptime: startedAtMs && info.State?.Running ? Date.now() - startedAtMs : 0,
      restartCount: info.RestartCount ?? 0,
      alive: !!info.State?.Running,
      health: info.State?.Health?.Status || null,
      cpuPercent: stats ? computeCpuPercent(stats) : null,
      memUsageMB: stats?.memory_stats?.usage ? Math.round(stats.memory_stats.usage / 1048576) : null,
      memLimitMB: stats?.memory_stats?.limit ? Math.round(stats.memory_stats.limit / 1048576) : null,
    };
    this.cache.set(id, snapshot);

    // Só emite/persiste em cima de MUDANÇA de status — do contrário cada
    // tick de poll (a cada 3s, pra cada serviço docker) viraria um evento
    // idêntico no socket.io e uma escrita no SQLite à toa.
    if (!prev || prev.status !== snapshot.status) {
      db.prepare('UPDATE services SET status=?, pid=? WHERE id=?')
        .run(status === 'running' ? 'running' : 'stopped', snapshot.pid, id);
      this.emit('status', { serviceId: id, status: snapshot.status, pid: snapshot.pid });
    }
  }
}

module.exports = new DockerServiceDriver();
