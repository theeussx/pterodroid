'use strict';
/**
 * Terminal do serviço.
 *
 * A saída NÃO volta pela resposta HTTP: ela é transmitida por socket.io
 * (evento `terminal:data`), do mesmo jeito que os logs. Assim um comando
 * demorado como `npm install` vai imprimindo no painel enquanto roda, em
 * vez de a tela ficar parada até o fim.
 *
 * As rotas aqui só controlam a sessão: abrir, enviar comando, interromper,
 * ler o histórico e fechar.
 */
const router = require('express').Router({ mergeParams: true });
const { getDB } = require('../db');
const terminals = require('../services/terminalManager');
const workspaces = require('../services/workspaceManager');
const hosts = require('../services/dockerHostManager');
const { recordAudit } = require('../services/auditLog');

function loadService(req) {
  const serviceId = parseInt(req.params.id, 10);
  if (!Number.isFinite(serviceId)) {
    throw Object.assign(new Error('ID de serviço inválido'), { status: 400 });
  }
  const service = getDB().prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!service) throw Object.assign(new Error('Serviço não encontrado'), { status: 404 });
  return service;
}

/** Só devolve a sessão se ela pertencer ao serviço da URL. */
function loadSession(req, service) {
  const session = terminals.get(req.params.sessionId);
  if (!session || session.serviceId !== service.id) {
    throw Object.assign(new Error('Sessão não encontrada'), { status: 404 });
  }
  return session;
}

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    if (result !== undefined && !res.headersSent) res.json(result);
  } catch (err) {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[terminal] erro inesperado:', err);
    if (!res.headersSent) res.status(status).json({ error: err.message || 'Erro interno' });
  }
};

// GET /api/services/:id/terminal — sessões abertas deste serviço
router.get('/', handle((req) => ({ sessions: terminals.listFor(loadService(req).id) })));

// POST /api/services/:id/terminal — abre uma sessão
router.post('/', handle(async (req) => {
  const service = loadService(req);

  if (service.runtime_type === 'docker') {
    if (!service.container_id) {
      throw Object.assign(
        new Error('O container ainda não foi criado — inicie o serviço uma vez antes de abrir o terminal.'),
        { status: 409 },
      );
    }
    const engine = hosts.engineFor(service.docker_host_id);

    // `docker exec` só funciona em container RODANDO. Sem esta checagem a
    // sessão abria normalmente e só quebrava quando a pessoa digitava o
    // primeiro comando — com um erro cru do Docker, que não explica que o
    // problema é o serviço estar parado.
    let info;
    try {
      info = await engine.inspectContainer(service.container_id);
    } catch (err) {
      if (err.statusCode === 404) {
        throw Object.assign(
          new Error('O container deste serviço não existe mais no host. Inicie o serviço para recriá-lo.'),
          { status: 409 },
        );
      }
      throw Object.assign(
        new Error(`Não foi possível falar com o host Docker: ${err.message}`),
        { status: 502 },
      );
    }

    if (!info.State?.Running) {
      throw Object.assign(
        new Error('O container está parado — inicie o serviço para abrir o terminal.'),
        { status: 409 },
      );
    }

    const session = terminals.create({
      serviceId: service.id,
      serviceName: service.name,
      engine,
      containerId: service.container_id,
    });
    recordAudit(getDB(), {
      action: 'terminal', target: `[${service.name}] sessão aberta`, username: req.user?.username,
    });
    return terminals.describe(session);
  }

  // Processo local: a sessão começa no workspace do serviço, criando-o se
  // necessário (o usuário pode tê-lo apagado pelo gerenciador de arquivos).
  const cwd = workspaces.normalize(service.working_directory)
    || workspaces.createForService(service.name);

  const session = terminals.create({ serviceId: service.id, serviceName: service.name, cwd });
  recordAudit(getDB(), {
    action: 'terminal', target: `[${service.name}] sessão aberta`, username: req.user?.username,
  });
  return terminals.describe(session);
}));

// GET /api/services/:id/terminal/:sessionId — estado + histórico
router.get('/:sessionId', handle((req) => {
  const service = loadService(req);
  const session = loadSession(req, service);
  return { ...terminals.describe(session), scrollback: session.scrollback };
}));

// POST /api/services/:id/terminal/:sessionId/exec  { command }
router.post('/:sessionId/exec', handle((req) => {
  const service = loadService(req);
  const session = loadSession(req, service);
  const command = req.body?.command;

  const started = session.run(command);
  recordAudit(getDB(), {
    action: 'exec',
    target: `[${service.name}] ${String(command).slice(0, 200)}`,
    username: req.user?.username,
  });
  return { ok: true, ...terminals.describe(session), pid: started?.pid ?? null };
}));

// POST /api/services/:id/terminal/:sessionId/interrupt — Ctrl+C
router.post('/:sessionId/interrupt', handle((req) => {
  const service = loadService(req);
  const session = loadSession(req, service);
  return { ok: session.interrupt() };
}));

// DELETE /api/services/:id/terminal/:sessionId
router.delete('/:sessionId', handle((req) => {
  const service = loadService(req);
  loadSession(req, service);
  return { ok: terminals.close(req.params.sessionId) };
}));

module.exports = router;
