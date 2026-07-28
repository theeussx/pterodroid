'use strict';

const http = require('http');
const https = require('https');

/**
 * Distingue "Docker respondeu que não" (tem statusCode) de "nem consegui
 * falar com o Docker" (erro de rede/conexão) — os dois viram erro pro
 * caller, mas o tratamento costuma ser diferente (mostrar a mensagem do
 * Docker vs. sugerir checar se o host está configurado certo).
 */
class DockerEngineError extends Error {
  constructor(message, { statusCode = null, cause = null } = {}) {
    super(message);
    this.name = 'DockerEngineError';
    this.statusCode = statusCode;
    if (cause) this.cause = cause;
  }
}

/**
 * Cliente HTTP cru pra Docker Engine API.
 *
 * Construído em cima de http/https do próprio Node, e não de um client
 * pronto (dockerode etc.) de propósito: o painel precisa continuar
 * rodando em Termux, onde não tem node-gyp pra módulos nativos. O
 * `http.request` já cobre tudo que a API do Docker precisa — falar com
 * um socket Unix via `socketPath`, ou com um host remoto via TCP puro ou
 * TLS — então uma dependência não compraria nada aqui.
 *
 * Uma instância = um endpoint de Docker Engine (um socket local, ou um
 * host remoto). Suporte a múltiplos hosts mora no dockerHostManager.js,
 * que mantém um destes por host cadastrado.
 */
class DockerEngineClient {
  constructor({ socketPath, host, port = 2375, tls = null, apiVersion = 'v1.43', timeoutMs = 15000 } = {}) {
    if (!socketPath && !host) throw new Error('DockerEngineClient precisa de socketPath ou host');
    this.socketPath = socketPath || null;
    this.host = host || null;
    this.port = port;
    this.tls = tls; // { ca, cert, key } em PEM — presença disso liga TLS
    this.apiVersion = apiVersion;
    this.timeoutMs = timeoutMs;
  }

  get label() {
    if (this.socketPath) return this.socketPath;
    return `${this.tls ? 'tcp+tls' : 'tcp'}://${this.host}:${this.port}`;
  }

  _transport() {
    return this.tls && !this.socketPath ? https : http;
  }

  _buildQuery(query) {
    if (!query) return '';
    const parts = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)}`);
    return parts.length ? `?${parts.join('&')}` : '';
  }

  _baseOptions(method, apiPath, query, headers) {
    const options = {
      method,
      path: `/${this.apiVersion}${apiPath}${this._buildQuery(query)}`,
      timeout: this.timeoutMs,
      headers: { Accept: 'application/json', ...headers },
    };
    if (this.socketPath) {
      options.socketPath = this.socketPath;
    } else {
      options.host = this.host;
      options.port = this.port;
      if (this.tls) Object.assign(options, { ca: this.tls.ca, cert: this.tls.cert, key: this.tls.key });
    }
    return options;
  }

  /** Ciclo completo de request — resolve com a response crua assim que os headers chegam; quem chamou lê o corpo. */
  _send(method, apiPath, { query, body, rawBody, headers = {} } = {}) {
    const options = this._baseOptions(method, apiPath, query, headers);
    let payload = null;
    if (rawBody !== undefined) {
      // Corpo binário pronto (ex.: tar pro /archive) — vai direto, sem
      // passar por JSON.stringify. Quem chamou já deve ter setado o
      // Content-Type certo em headers.
      payload = rawBody;
      options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/octet-stream';
      options.headers['Content-Length'] = payload.length;
    } else if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = payload.length;
    }
    return new Promise((resolve, reject) => {
      const req = this._transport().request(options, (res) => resolve(res));
      req.on('error', (err) => reject(new DockerEngineError(
        `Não foi possível falar com o Docker Engine (${this.label}): ${err.message}`,
        { cause: err },
      )));
      req.on('timeout', () => req.destroy(new Error('Docker Engine demorou demais pra responder')));
      if (payload) req.write(payload);
      req.end();
    });
  }

  async _readBody(res) {
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  /** Chamada com buffer: lê o corpo inteiro, faz parse de JSON, lança DockerEngineError se não for 2xx. */
  async request(method, apiPath, opts = {}) {
    const res = await this._send(method, apiPath, opts);
    const buf = await this._readBody(res);
    const text = buf.toString('utf8');
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const msg = (parsed && parsed.message) ? parsed.message : (text || `HTTP ${res.statusCode}`);
      throw new DockerEngineError(msg, { statusCode: res.statusCode });
    }
    return parsed;
  }

  /** Chamada em stream: valida o status e devolve a response crua (ainda fluindo) pra quem chamou consumir. */
  async requestStream(method, apiPath, opts = {}) {
    const res = await this._send(method, apiPath, opts);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const buf = await this._readBody(res);
      const text = buf.toString('utf8');
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch { /* corpo não era JSON, mantém texto puro */ }
      throw new DockerEngineError(msg || `HTTP ${res.statusCode}`, { statusCode: res.statusCode });
    }
    return res;
  }

  /**
   * Pro /exec/{id}/start (e pro attach de container): quando o Docker aceita
   * o pedido, ele para de falar HTTP e a conexão vira um pipe cru de bytes
   * de stdin/stdout. Precisamos do socket bruto, gravável, antes do corpo
   * começar a chegar — `_send`/`request` fecham o request na hora, o que é
   * errado aqui. Essa variante deixa o request aberto e devolve tanto o
   * request (pra escrever stdin) quanto o socket final (pra ler stdout).
   */
  hijack(method, apiPath, { body } = {}) {
    const options = this._baseOptions(method, apiPath, null, { Connection: 'Upgrade', Upgrade: 'tcp' });
    let payload = null;
    if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = payload.length;
    }
    return new Promise((resolve, reject) => {
      const req = this._transport().request(options);
      req.on('error', (err) => reject(new DockerEngineError(`Falha ao anexar ao Docker Engine (${this.label}): ${err.message}`, { cause: err })));
      // O Docker responde um exec/attach bem-sucedido com um 101 (upgrade
      // de verdade) ou com um 200 cujo socket ele "sequestra" em seguida —
      // os dois casos deixam um socket cru pra ler/escrever daqui pra frente.
      req.on('upgrade', (res, socket) => resolve({ socket, req, statusCode: res.statusCode }));
      req.on('response', (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.socket) {
          resolve({ socket: res.socket, req, statusCode: res.statusCode });
        } else {
          this._readBody(res).then((buf) => {
            reject(new DockerEngineError(buf.toString('utf8') || `HTTP ${res.statusCode}`, { statusCode: res.statusCode }));
          });
        }
      });
      if (payload) req.write(payload);
      // Sem req.end() de propósito — deixar o request aberto é o que
      // permite a conexão virar stream cru em vez de o Node fechá-la.
    });
  }
}

module.exports = { DockerEngineClient, DockerEngineError };
