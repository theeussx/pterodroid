/**
 * ProcessManager — spawn, watch and auto-restart user services.
 * No systemd. Works identically in Termux and Ubuntu-proot: everything
 * is a plain child_process kept alive by our own watchdog logic.
 */
const { spawn } = require('child_process');
const EventEmitter = require('events');
const { getDB } = require('../db');
const config = require('../config');
const cipher = require('./secretCipher');
const alert = require('./alertNotifier');
const { findAvailablePort } = require('./portFinder');
const tunnelManager = require('./tunnelManager');
const workspaces = require('./workspaceManager');
const { classifyLogLevel } = require('./logLevel');
const { parseCommand } = require('./commandParser');

/**
 * Faz um GET com timeout controlado e devolve true se a URL respondeu
 * 2xx/3xx. Usado pelo healthcheck por serviço.
 */
async function httpOk(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

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
      // O environment pode estar cifrado em repouso (segredos). Decifra
      // antes de montar o ambiente do processo.
      explicitEnvironment = JSON.parse(cipher.decrypt(svc.environment || '{}'));
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
          // Importante: reflete a porta real no objeto local, senão o
          // healthcheck (e o túnel) apontariam para a porta antiga.
          svc.port = activePort;
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
      healthcheckTimer: null,
      stopped: false, // true = intentionally stopped, suppress auto-restart
      exited: false,
    };
    this.procs.set(svc.id, entry);

    // ── Limites de recurso para processos ───────────────────────────────
    // Container tem limites nativos; processo local depende do `prlimit`
    // (presente no Termux via util-linux e nos builds Linux). Aplicamos de
    // forma best-effort: se o binário não existir, apenas avisamos — o
    // serviço segue rodando sem o limite.
    if (svc.process_memory_limit || svc.process_cpu_limit) {
      const rl = [];
      if (svc.process_memory_limit) rl.push(`--as=${Math.round(svc.process_memory_limit) * 1024 * 1024}`);
      if (svc.process_cpu_limit) rl.push(`--cpu=${Math.round((parseFloat(svc.process_cpu_limit) || 1) * 100)}`);
      if (rl.length) {
        const pr = spawn('prlimit', [...rl, '--pid=' + child.pid], { stdio: 'ignore' });
        pr.on('exit', (code) => {
          if (code !== 0) console.log(`[SVC] prlimit indisponível para ${svc.name} (código ${code}) — limite de recurso não aplicado`);
        });
        pr.on('error', () => { /* prlimit não existe neste sistema; ignorar */ });
      }
    }

    // ── Healthcheck por serviço ─────────────────────────────────────────
    // O watchdog de processo cuida do "processo morreu". Este de cima cuida
    // do "processo está vivo mas não responde" (servidor travado), que é o
    // caso que um painel de hospedagem precisa pegar. Quando a URL falha por
    // `healthcheck_enabled` e há auto_restart, matamos o processo e deixamos
    // o finalize() cuidar do restart/alerta como um crash normal.
    if (svc.healthcheck_enabled) {
      const interval = Math.max(5, parseInt(svc.healthcheck_interval, 10) || 30) * 1000;
      const timeout = Math.max(1, parseInt(svc.healthcheck_timeout, 10) || 5) * 1000;
      // URL vazia (ou só um path) vira http://127.0.0.1:PORTA/. Usa a porta
      // real do processo (a porta pode ter sido realocada por findAvailablePort).
      let hcUrl = (svc.healthcheck_url || '/').trim();
      if (!hcUrl.includes('://')) {
        const hostPort = svc.port || env.PORT || '';
        hcUrl = `http://127.0.0.1:${hostPort}${hcUrl.startsWith('/') ? hcUrl : `/${hcUrl}`}`;
      }
      const check = async () => {
        if (entry.exited || entry.stopped) return;
        if (!this.procs.has(svc.id) || this.procs.get(svc.id) !== entry) return;
        const ok = await httpOk(hcUrl, timeout);
        if (ok) return;
        if (entry.exited || entry.stopped || this.procs.get(svc.id) !== entry) return;
        const msg = `healthcheck falhou (${hcUrl}) — reiniciando`;
        this.emit('log', { serviceId: svc.id, level: 'error', message: msg, ts: Date.now() });
        try {
          db.prepare('INSERT INTO logs(service_id, level, message) VALUES(?,?,?)')
            .run(svc.id, 'error', msg.slice(0, 2000));
        } catch { /* ignore */ }
        // Mata o processo; o exit dispara finalize() → crash → restart/alerta.
        try { child.kill('SIGKILL'); } catch { /* já morreu */ }
      };
      entry.healthcheckTimer = setInterval(check, interval);
      entry.healthcheckTimer.unref?.();
    }

    const handleData = (level) => (data) => {
      const message = data.toString();
      // stdout/stderr pode conter várias linhas no mesmo chunk. Classificar o
      // chunk inteiro faria um WARNING e um ERROR compartilharem uma só cor.
      const messages = message.match(/[^\n]*\n|[^\n]+/g) || [message];
      for (const line of messages) {
        const classifiedLevel = classifyLogLevel(level, line);
        const log = { level: classifiedLevel, message: line, ts: Date.now() };

        entry.logs.push(log);
        if (entry.logs.length > config.LOG_MAX_MEMORY) entry.logs.shift();

        // Persiste todos os níveis para que o histórico do painel preserve as
        // cores corretas mesmo depois que o processo termina ou é reiniciado.
        try {
          db.prepare('INSERT INTO logs(service_id, level, message) VALUES(?,?,?)')
            .run(svc.id, classifiedLevel, line.slice(0, 2000));
        } catch (err) {
          console.error('[SVC] falha ao persistir log:', err.message);
        }

        this.emit('log', { serviceId: svc.id, ...log });
      }
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

      // Limpa o timer de healthcheck quando o processo morre; respawn cria um novo.
      if (entry.healthcheckTimer) {
        clearInterval(entry.healthcheckTimer);
        entry.healthcheckTimer = null;
      }

      if (crashed && !entry.stopped) {
        alert.onCrash({ serviceId: svc.id, name: svc.name, reason: spawnError?.message || `código ${code}` })
          .catch(() => {});
      }

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
        alert.onCrashLoop({ serviceId: svc.id, name: svc.name, restarts: entry.restartCount }).catch(() => {});
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
    if (entry.healthcheckTimer) {
      clearInterval(entry.healthcheckTimer);
      entry.healthcheckTimer = null;
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
