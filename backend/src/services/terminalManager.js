'use strict';
/**
 * TerminalManager — terminal do serviço, pelo painel.
 *
 * DECISÃO DE ARQUITETURA: por que não é um PTY de verdade
 * ────────────────────────────────────────────────────────
 * Um terminal "completo" (vim, htop, cores dinâmicas) exige um
 * pseudo-terminal, e em Node isso significa `node-pty` — um módulo nativo
 * que precisa de node-gyp/toolchain C++ para compilar. É exatamente o que
 * o projeto evita em toda parte (ver a escolha de sql.js no lugar do
 * better-sqlite3): em Termux essa instalação simplesmente falha.
 *
 * Então implementamos um terminal **orientado a comando**, que é o que
 * cobre o uso real de um painel: rodar `npm install`, `ls`, `git pull`,
 * `cat`, `node -v`. O que se ganha em troca:
 *  - funciona em Termux, proot, Docker e Linux sem compilar nada;
 *  - stdout e stderr chegam separados (num PTY viram um stream só);
 *  - o código-fonte inteiro cabe num arquivo e é auditável.
 *
 * O que NÃO funciona, e a UI diz isso claramente: programas de tela cheia
 * (vim, htop, top) e prompts interativos que exigem TTY.
 *
 * COMO A SESSÃO FUNCIONA
 * ──────────────────────
 * Não há um shell de longa duração. Cada comando roda como um filho
 * próprio, e a sessão guarda o estado (diretório atual + variáveis
 * exportadas) do lado do Node. Isso foi medido: com um shell persistente
 * sobre pipes, o Ctrl+C precisa sinalizar o grupo de processos, o que
 * mata o próprio shell junto e derruba a sessão. Com um filho por
 * comando, `detached: true` põe cada comando no seu próprio grupo e o
 * SIGINT atinge só ele — a sessão sobrevive, que é o comportamento que o
 * usuário espera de um Ctrl+C.
 *
 * O `cd` continua funcionando porque, depois do comando do usuário,
 * anexamos uma linha que imprime o `$PWD` final num marcador; o backend
 * lê esse marcador, guarda o novo diretório e o remove da saída.
 */
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const workspaces = require('./workspaceManager');

/** Marcadores internos: precisam ser improváveis numa saída real. */
const CWD_MARK = '__PTD_CWD_9f3a__';
const ENV_MARK = '__PTD_ENV_9f3a__';

const MAX_OUTPUT_BYTES = 256 * 1024;   // teto por comando, evita estourar a memória
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_SESSION_MS = 30 * 60 * 1000;
const MAX_SCROLLBACK = 500;

/** Variáveis que fazem o processo do painel ser sequestrado — nunca repassar. */
const BLOCKED_ENV = new Set(['LD_PRELOAD', 'LD_LIBRARY_PATH', 'NODE_OPTIONS']);

function sanitizeEnv(base) {
  const out = { ...base };
  for (const key of BLOCKED_ENV) delete out[key];
  return out;
}

class TerminalSession extends EventEmitter {
  constructor({ id, serviceId, serviceName, cwd, env = {} }) {
    super();
    this.id = id;
    this.serviceId = serviceId;
    this.serviceName = serviceName;
    this.cwd = cwd;
    this.env = env;
    this.scrollback = [];
    this.current = null;      // { child, startedAt, command }
    this.lastUsedAt = Date.now();
    this.closed = false;
  }

  get busy() {
    return this.current !== null;
  }

  _push(chunk) {
    this.scrollback.push(chunk);
    if (this.scrollback.length > MAX_SCROLLBACK) this.scrollback.shift();
    this.emit('data', { sessionId: this.id, ...chunk });
  }

  /** Executa um comando. Rejeita se já houver um rodando (um por sessão). */
  run(command, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (this.closed) throw Object.assign(new Error('Sessão encerrada'), { status: 409 });
    if (this.busy) throw Object.assign(new Error('Já existe um comando em execução nesta sessão'), { status: 409 });

    const trimmed = String(command || '').trim();
    if (!trimmed) throw Object.assign(new Error('Comando vazio'), { status: 400 });

    this.lastUsedAt = Date.now();

    // O diretório pode ter sido apagado pelo gerenciador de arquivos desde
    // o último comando; voltar pra raiz do workspace é melhor que falhar.
    if (!fs.existsSync(this.cwd)) {
      this.cwd = workspaces.ensureDir(this.cwd);
      this._push({ stream: 'system', text: `(diretório recriado: ${this.cwd})\n`, ts: Date.now() });
    }

    this._push({ stream: 'input', text: `$ ${trimmed}\n`, ts: Date.now() });

    // Depois do comando, imprime cwd e env finais para a sessão "lembrar".
    // `__ptd_code` preserva o código de saída real do comando do usuário.
    const wrapped = [
      trimmed,
      `__ptd_code=$?`,
      `printf '\\n${CWD_MARK}%s\\n' "$PWD"`,
      `export -p 2>/dev/null | sed 's/^/${ENV_MARK}/' || true`,
      `exit $__ptd_code`,
    ].join('\n');

    let child;
    try {
      child = spawn('sh', ['-c', wrapped], {
        cwd: this.cwd,
        env: sanitizeEnv({ ...process.env, ...this.env }),
        stdio: ['pipe', 'pipe', 'pipe'],
        // Grupo de processos próprio: permite interromper o comando (e os
        // filhos dele) sem afetar o painel nem a sessão.
        detached: true,
      });
    } catch (err) {
      this._push({ stream: 'stderr', text: `não foi possível executar: ${err.message}\n`, ts: Date.now() });
      this.emit('exit', { sessionId: this.id, code: 127 });
      return null;
    }

    const startedAt = Date.now();
    this.current = { child, startedAt, command: trimmed };

    let pendingOut = '';
    let bytes = 0;
    let truncated = false;

    const handle = (streamName) => (data) => {
      let text = data.toString();

      if (streamName === 'stdout') {
        // Os marcadores podem chegar partidos entre dois chunks, então
        // acumulamos até fechar a linha antes de decidir o que é marcador.
        pendingOut += text;
        const lines = pendingOut.split('\n');
        pendingOut = lines.pop();
        const keep = [];
        for (const line of lines) {
          if (line.startsWith(CWD_MARK)) {
            const next = line.slice(CWD_MARK.length).trim();
            if (next) this.cwd = next;
          } else if (line.startsWith(ENV_MARK)) {
            this._absorbEnvLine(line.slice(ENV_MARK.length));
          } else {
            keep.push(line);
          }
        }
        if (!keep.length) return;
        text = `${keep.join('\n')}\n`;
      }

      bytes += Buffer.byteLength(text);
      if (bytes > MAX_OUTPUT_BYTES) {
        if (!truncated) {
          truncated = true;
          this._push({ stream: 'system', text: '\n(saída muito longa — truncada)\n', ts: Date.now() });
          this.interrupt();
        }
        return;
      }
      this._push({ stream: streamName, text, ts: Date.now() });
    };

    child.stdout.on('data', handle('stdout'));
    child.stderr.on('data', handle('stderr'));

    const timer = setTimeout(() => {
      this._push({ stream: 'system', text: `\n(tempo limite de ${Math.round(timeoutMs / 60000)} min atingido)\n`, ts: Date.now() });
      this.interrupt('SIGKILL');
    }, timeoutMs);
    timer.unref?.();

    const finish = (code, signal) => {
      if (this.current?.child !== child) return;
      clearTimeout(timer);
      // Restante sem quebra de linha final.
      if (pendingOut && !pendingOut.startsWith(CWD_MARK) && !pendingOut.startsWith(ENV_MARK)) {
        this._push({ stream: 'stdout', text: pendingOut, ts: Date.now() });
      }
      pendingOut = '';
      this.current = null;
      this.lastUsedAt = Date.now();
      const durationMs = Date.now() - startedAt;
      this._push({ stream: 'exit', text: '', code, signal, durationMs, cwd: this.cwd, ts: Date.now() });
      this.emit('exit', { sessionId: this.id, code, signal, durationMs, cwd: this.cwd });
    };

    child.on('exit', finish);
    child.on('error', (err) => {
      this._push({ stream: 'stderr', text: `${err.message}\n`, ts: Date.now() });
      finish(127, null);
    });

    return { pid: child.pid };
  }

  /** Lê uma linha de `export -p` e guarda a variável para os próximos comandos. */
  _absorbEnvLine(line) {
    // Formatos possíveis: `export FOO="bar"`, `export FOO='bar'`, `FOO=bar`
    const match = line.match(/^(?:export\s+|declare\s+-x\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return;
    const [, key, rawValue] = match;
    if (BLOCKED_ENV.has(key)) return;
    // Não guardamos o ambiente herdado inteiro — só o que difere dele, que
    // é o que o usuário exportou de fato.
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === value) return;
    if (key === 'PWD' || key === 'OLDPWD' || key === 'SHLVL' || key === '_') return;
    this.env[key] = value;
  }

  /** Ctrl+C: sinaliza o grupo do comando atual, não o painel nem a sessão. */
  interrupt(signal = 'SIGINT') {
    if (!this.current) return false;
    const { child } = this.current;
    try {
      // O negativo é o que atinge o grupo inteiro (o comando e os filhos
      // que ele tenha criado) — possível porque usamos detached: true.
      process.kill(-child.pid, signal);
    } catch {
      try { child.kill(signal); } catch { /* já morreu */ }
    }
    return true;
  }

  close() {
    this.closed = true;
    if (this.current) this.interrupt('SIGKILL');
    this.removeAllListeners();
  }
}

/**
 * Sessão de terminal dentro de um container. Mesma superfície pública da
 * sessão local, mas cada comando vira um `docker exec` — o Docker já
 * isola o processo, então não há grupo pra gerenciar.
 */
class DockerTerminalSession extends EventEmitter {
  constructor({ id, serviceId, serviceName, engine, containerId, cwd = '/app' }) {
    super();
    this.id = id;
    this.serviceId = serviceId;
    this.serviceName = serviceName;
    this.engine = engine;
    this.containerId = containerId;
    this.cwd = cwd;
    this.scrollback = [];
    this.lastUsedAt = Date.now();
    this.closed = false;
    this._running = false;
  }

  get busy() { return this._running; }

  _push(chunk) {
    this.scrollback.push(chunk);
    if (this.scrollback.length > MAX_SCROLLBACK) this.scrollback.shift();
    this.emit('data', { sessionId: this.id, ...chunk });
  }

  run(command) {
    if (this.closed) throw Object.assign(new Error('Sessão encerrada'), { status: 409 });
    if (this._running) throw Object.assign(new Error('Já existe um comando em execução nesta sessão'), { status: 409 });
    const trimmed = String(command || '').trim();
    if (!trimmed) throw Object.assign(new Error('Comando vazio'), { status: 400 });

    this._running = true;
    this.lastUsedAt = Date.now();
    this._push({ stream: 'input', text: `$ ${trimmed}\n`, ts: Date.now() });

    const startedAt = Date.now();
    const wrapped = `cd "$1" 2>/dev/null || cd /; ${trimmed}\n__c=$?; printf '\\n${CWD_MARK}%s\\n' "$PWD"; exit $__c`;

    this.engine.execRun(this.containerId, { cmd: ['sh', '-c', wrapped, '--', this.cwd] })
      .then(({ exitCode, stdout, stderr }) => {
        let out = stdout;
        const match = out.match(new RegExp(`${CWD_MARK}(.*)`));
        if (match) {
          const next = match[1].trim();
          if (next) this.cwd = next;
          out = out.replace(new RegExp(`\\n?${CWD_MARK}.*\\n?`), '');
        }
        if (out) this._push({ stream: 'stdout', text: out, ts: Date.now() });
        if (stderr) this._push({ stream: 'stderr', text: stderr, ts: Date.now() });
        this._finish(exitCode, startedAt);
      })
      .catch((err) => {
        this._push({ stream: 'stderr', text: `${err.message}\n`, ts: Date.now() });
        this._finish(127, startedAt);
      });

    return { pid: null };
  }

  _finish(code, startedAt) {
    this._running = false;
    this.lastUsedAt = Date.now();
    const durationMs = Date.now() - startedAt;
    this._push({ stream: 'exit', text: '', code, durationMs, cwd: this.cwd, ts: Date.now() });
    this.emit('exit', { sessionId: this.id, code, durationMs, cwd: this.cwd });
  }

  /** docker exec não dá um grupo de processos pra sinalizar; ver mensagem. */
  interrupt() {
    if (!this._running) return false;
    this._push({
      stream: 'system',
      text: '\n(não é possível interromper um comando dentro do container por aqui — aguarde o tempo limite)\n',
      ts: Date.now(),
    });
    return false;
  }

  close() {
    this.closed = true;
    this.removeAllListeners();
  }
}

class TerminalManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, TerminalSession|DockerTerminalSession>} */
    this.sessions = new Map();
    this._counter = 0;
    this._reaper = null;
  }

  _ensureReaper() {
    if (this._reaper) return;
    // Uma aba fechada sem "encerrar sessão" deixaria a sessão viva pra
    // sempre; o reaper limpa as ociosas.
    this._reaper = setInterval(() => this.reapIdle(), 5 * 60 * 1000);
    this._reaper.unref?.();
  }

  create({ serviceId, serviceName, cwd, engine = null, containerId = null }) {
    this._counter += 1;
    const id = `t${Date.now().toString(36)}${this._counter}`;

    const session = containerId
      ? new DockerTerminalSession({ id, serviceId, serviceName, engine, containerId })
      : new TerminalSession({ id, serviceId, serviceName, cwd: workspaces.ensureDir(cwd) });

    // Reemite no manager para o socket.io não precisar assinar cada sessão.
    session.on('data', (payload) => this.emit('data', { serviceId, ...payload }));
    session.on('exit', (payload) => this.emit('exit', { serviceId, ...payload }));

    this.sessions.set(id, session);
    this._ensureReaper();
    console.log(`[terminal] sessão ${id} aberta para "${serviceName}"`);
    return session;
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  /** Sessões de um serviço, no formato que a API devolve. */
  listFor(serviceId) {
    return [...this.sessions.values()]
      .filter((s) => s.serviceId === serviceId)
      .map((s) => this.describe(s));
  }

  describe(session) {
    return {
      id: session.id,
      serviceId: session.serviceId,
      cwd: session.cwd,
      busy: session.busy,
      kind: session instanceof DockerTerminalSession ? 'docker' : 'process',
      lastUsedAt: session.lastUsedAt,
    };
  }

  close(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.close();
    this.sessions.delete(id);
    console.log(`[terminal] sessão ${id} encerrada`);
    return true;
  }

  /** Chamado quando um serviço é removido — não deixa sessão órfã. */
  closeForService(serviceId) {
    for (const [id, session] of this.sessions) {
      if (session.serviceId === serviceId) {
        session.close();
        this.sessions.delete(id);
      }
    }
  }

  reapIdle(maxIdleMs = IDLE_SESSION_MS) {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (!session.busy && now - session.lastUsedAt > maxIdleMs) {
        session.close();
        this.sessions.delete(id);
        console.log(`[terminal] sessão ${id} encerrada por inatividade`);
      }
    }
  }

  closeAll() {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
    if (this._reaper) {
      clearInterval(this._reaper);
      this._reaper = null;
    }
  }
}

module.exports = new TerminalManager();
module.exports.TerminalSession = TerminalSession;
module.exports.DockerTerminalSession = DockerTerminalSession;
