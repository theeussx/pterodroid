'use strict';

const { EventEmitter } = require('events');
const { DockerEngineClient, DockerEngineError } = require('./dockerEngineClient');

/**
 * Separa o stream multiplexado de logs/attach do Docker em stdout/stderr.
 * Cada frame é um header de 8 bytes — [streamType, 0,0,0, tamanho(uint32 BE)]
 * — seguido de `tamanho` bytes de payload. Só se aplica a containers criados
 * SEM tty; com tty o stream já vem em bytes puros (não tem o que separar,
 * porque o Docker só tem um stream pra mandar).
 */
function demuxDockerStream(readable, { onStdout, onStderr } = {}) {
  let buffer = Buffer.alloc(0);
  readable.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const size = buffer.readUInt32BE(4);
      if (buffer.length < 8 + size) break; // espera o resto do frame chegar
      const streamType = buffer.readUInt8(0);
      const payload = buffer.subarray(8, 8 + size);
      if (streamType === 2 && onStderr) onStderr(payload);
      else if (onStdout) onStdout(payload);
      buffer = buffer.subarray(8 + size);
    }
  });
  return readable;
}

/**
 * Os endpoints de stats/pull do Docker mandam um objeto JSON por linha, mas
 * TCP não respeita essas quebras de linha — um objeto pode chegar partido
 * em dois eventos `data`, ou dois objetos podem chegar num só. Isso guarda
 * um buffer por quebra de linha e só faz parse de linhas completas.
 */
function parseNDJSON(readable, onObject, onError) {
  let buffer = '';
  readable.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try { onObject(JSON.parse(line)); }
      catch (err) { if (onError) onError(err, line); }
    }
  });
  return readable;
}

/** Aceita um caminho de socket puro, ou uma URL no estilo docker (`unix://`, `tcp://`). */
function parseDockerHost(value) {
  if (!value) return null;
  if (value.startsWith('unix://')) return { socketPath: value.slice('unix://'.length) };
  if (value.startsWith('tcp://') || value.startsWith('http://') || value.startsWith('https://')) {
    const url = new URL(value.replace(/^tcp:\/\//, 'http://'));
    return { host: url.hostname, port: url.port ? parseInt(url.port, 10) : 2375 };
  }
  if (value.startsWith('/')) return { socketPath: value };
  throw new Error(`Endereço de Docker Engine não reconhecido: ${value}`);
}

/**
 * Wrapper amigável sobre o DockerEngineClient — uma instância por endpoint
 * de Docker Engine (socket local, ou um host remoto). Este é o módulo que
 * o resto do app deve importar; nada fora daqui devia precisar saber de
 * framing HTTP ou demux de stream.
 */
class DockerEngine extends EventEmitter {
  constructor(connectionOpts) {
    super();
    this.client = new DockerEngineClient(connectionOpts);
  }

  get label() { return this.client.label; }

  // ── Host ────────────────────────────────────────────────────────────
  async ping() {
    // /_ping não leva prefixo de versão no Docker de verdade, e nosso
    // client sempre prefixa com /v1.43/ — então usamos /version, que serve
    // tanto de teste de vida quanto já traz info útil (versão, SO, arch)
    // pra exatamente o que o brief pede na detecção de host.
    return this.version();
  }
  async version() { return this.client.request('GET', '/version'); }
  async info() { return this.client.request('GET', '/info'); }

  // ── Containers ──────────────────────────────────────────────────────
  async listContainers({ all = true } = {}) {
    return this.client.request('GET', '/containers/json', { query: { all: all ? 1 : 0 } });
  }
  async inspectContainer(id) { return this.client.request('GET', `/containers/${id}/json`); }
  async createContainer(spec, { name } = {}) {
    return this.client.request('POST', '/containers/create', { query: { name }, body: spec });
  }
  async startContainer(id) { return this.client.request('POST', `/containers/${id}/start`); }
  async stopContainer(id, { t = 10 } = {}) { return this.client.request('POST', `/containers/${id}/stop`, { query: { t } }); }
  async restartContainer(id, { t = 10 } = {}) { return this.client.request('POST', `/containers/${id}/restart`, { query: { t } }); }
  async removeContainer(id, { force = false, volumes = false } = {}) {
    return this.client.request('DELETE', `/containers/${id}`, { query: { force: force ? 1 : 0, v: volumes ? 1 : 0 } });
  }

  /** Logs com buffer (não follow) — já vem separado em stdout/stderr quando o container não usa tty. */
  async getLogs(id, { tail = 200, timestamps = false, stdout = true, stderr = true } = {}) {
    const info = await this.inspectContainer(id);
    const res = await this.client.requestStream('GET', `/containers/${id}/logs`, {
      query: { stdout: stdout ? 1 : 0, stderr: stderr ? 1 : 0, tail, timestamps: timestamps ? 1 : 0 },
    });
    return new Promise((resolve, reject) => {
      res.on('error', reject);
      if (info.Config && info.Config.Tty) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve([{ stream: 'tty', text: Buffer.concat(chunks).toString('utf8') }]));
        return;
      }
      const lines = [];
      demuxDockerStream(res, {
        onStdout: (buf) => lines.push({ stream: 'stdout', text: buf.toString('utf8') }),
        onStderr: (buf) => lines.push({ stream: 'stderr', text: buf.toString('utf8') }),
      });
      res.on('end', () => resolve(lines));
    });
  }

  /** Stats ao vivo — chama `onStats` a cada snapshot que o Docker manda, até `stop()` ser chamado. */
  async streamStats(id, onStats, onError) {
    const res = await this.client.requestStream('GET', `/containers/${id}/stats`, { query: { stream: 1 } });
    parseNDJSON(res, onStats, onError);
    return { stop: () => res.destroy() };
  }
  async statsOnce(id) {
    return this.client.request('GET', `/containers/${id}/stats`, { query: { stream: 0 } });
  }

  /**
   * Logs ao vivo (follow=1) — chama onLine(text, stream) a cada pedaço que
   * chega, até stop() ser chamado. Não promete que `text` termina em
   * quebra de linha (TCP não respeita isso); quem consome (ver
   * dockerServiceDriver) já sabe bufferizar até fechar uma linha.
   */
  async streamLogs(id, { onLine, onError, tail = 0 } = {}) {
    const info = await this.inspectContainer(id);
    const res = await this.client.requestStream('GET', `/containers/${id}/logs`, {
      query: { stdout: 1, stderr: 1, follow: 1, tail, timestamps: 0 },
    });
    res.on('error', (err) => onError?.(err));
    if (info.Config && info.Config.Tty) {
      res.on('data', (chunk) => onLine(chunk.toString('utf8'), 'tty'));
    } else {
      demuxDockerStream(res, {
        onStdout: (buf) => onLine(buf.toString('utf8'), 'stdout'),
        onStderr: (buf) => onLine(buf.toString('utf8'), 'stderr'),
      });
    }
    return { stop: () => res.destroy() };
  }

  // ── Exec (base pro terminal web — ver nota no smoke test) ────────────
  async execCreate(id, { cmd, tty = true, env } = {}) {
    return this.client.request('POST', `/containers/${id}/exec`, {
      body: { Cmd: cmd, AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: tty, Env: env },
    });
  }
  /** Devolve o socket cru já "sequestrado" — quem chamar escreve teclas do usuário nele e lê a saída do terminal dele. */
  async execStart(execId, { tty = true } = {}) {
    return this.client.hijack('POST', `/exec/${execId}/start`, { body: { Detach: false, Tty: tty } });
  }

  /**
   * Roda um comando não-interativo até ele sair e devolve stdout/stderr já
   * separados + o exit code — base do gerenciador de arquivos por container
   * (ls/mkdir/rm/mv). Sempre `tty: false`: com tty ligado o Docker mistura
   * stdout+stderr num stream só e não dá pra demultiplexar depois.
   * `cmd` é um array (argv), nunca uma string de shell montada por nós —
   * quando precisa de glob (`*`) o caller usa `['sh', '-c', script, '--', arg]`
   * com o valor variável indo em `arg`, nunca colado dentro de `script`.
   */
  async execRun(id, { cmd, env } = {}) {
    const { Id: execId } = await this.execCreate(id, { cmd, tty: false, env });
    const res = await this.client.requestStream('POST', `/exec/${execId}/start`, {
      body: { Detach: false, Tty: false },
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    await new Promise((resolve, reject) => {
      res.on('error', reject);
      demuxDockerStream(res, {
        onStdout: (buf) => stdoutChunks.push(buf),
        onStderr: (buf) => stderrChunks.push(buf),
      });
      res.on('end', resolve);
    });
    const { ExitCode } = await this.client.request('GET', `/exec/${execId}/json`);
    return {
      exitCode: ExitCode,
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
    };
  }

  // ── Archive (base do File Manager por container) ──────────────────────
  /** Baixa um arquivo ou pasta do container como tar cru — quem chamar faz o parse. */
  async getArchive(id, pathInContainer) {
    const res = await this.client.requestStream('GET', `/containers/${id}/archive`, {
      query: { path: pathInContainer },
    });
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  /** Extrai um tar dentro do container, na pasta de destino indicada. */
  async putArchive(id, destDirPath, tarBuffer) {
    return this.client.request('PUT', `/containers/${id}/archive`, {
      query: { path: destDirPath },
      rawBody: tarBuffer,
      headers: { 'Content-Type': 'application/x-tar' },
    });
  }

  // ── Imagens ─────────────────────────────────────────────────────────
  async listImages() { return this.client.request('GET', '/images/json'); }
  async pullImage(fromImage, onProgress) {
    const res = await this.client.requestStream('POST', '/images/create', { query: { fromImage } });
    return new Promise((resolve, reject) => {
      parseNDJSON(res, (obj) => onProgress && onProgress(obj), () => {});
      res.on('end', resolve);
      res.on('error', reject);
    });
  }
  async removeImage(id, { force = false } = {}) {
    return this.client.request('DELETE', `/images/${id}`, { query: { force: force ? 1 : 0 } });
  }

  // ── Volumes ─────────────────────────────────────────────────────────
  async listVolumes() { return this.client.request('GET', '/volumes'); }
  async createVolume({ name, driver = 'local' } = {}) {
    return this.client.request('POST', '/volumes/create', { body: { Name: name, Driver: driver } });
  }
  async removeVolume(name, { force = false } = {}) {
    return this.client.request('DELETE', `/volumes/${name}`, { query: { force: force ? 1 : 0 } });
  }

  // ── Redes ───────────────────────────────────────────────────────────
  async listNetworks() { return this.client.request('GET', '/networks'); }
  async createNetwork({ name, driver = 'bridge' } = {}) {
    return this.client.request('POST', '/networks/create', { body: { Name: name, Driver: driver } });
  }
  async removeNetwork(id) { return this.client.request('DELETE', `/networks/${id}`); }
  async connectNetwork(networkId, containerId) {
    return this.client.request('POST', `/networks/${networkId}/connect`, { body: { Container: containerId } });
  }
  async disconnectNetwork(networkId, containerId) {
    return this.client.request('POST', `/networks/${networkId}/disconnect`, { body: { Container: containerId } });
  }
}

module.exports = { DockerEngine, DockerEngineError, parseDockerHost, demuxDockerStream, parseNDJSON };
