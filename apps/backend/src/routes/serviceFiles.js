/**
 * Arquivos escopados a UM serviço — enraizados no workspace dele.
 *
 * Mesma fábrica de rotas do gerenciador global (fileRoutesFactory), então
 * as duas telas expõem exatamente as mesmas operações: listar, ler,
 * escrever, criar, renomear, mover, copiar, buscar, excluir, enviar e
 * baixar. A única diferença é a raiz e o prefixo do registro de auditoria.
 *
 * O workspace é criado sob demanda: se a pasta do serviço foi apagada por
 * fora, ela volta a existir em vez de a tela quebrar (Etapa 2/4).
 */
const { getDB } = require('../db');
const { createFileManager } = require('../services/fileManager');
const workspaces = require('../services/workspaceManager');
const { createFileRoutes } = require('./fileRoutesFactory');
const { recordAudit } = require('../services/auditLog');

/** Cache de file managers por serviço — evita recriar closures a cada request. */
const managerCache = new Map();

function managerFor(serviceId, directory) {
  const cached = managerCache.get(serviceId);
  if (cached && cached.directory === directory) return cached.fm;
  const fm = createFileManager(directory);
  managerCache.set(serviceId, { directory, fm });
  return fm;
}

/** Chamado quando um serviço é removido, pra não segurar o manager em memória. */
function forgetService(serviceId) {
  managerCache.delete(Number(serviceId));
}

function resolveContext(req) {
  const db = getDB();
  const serviceId = parseInt(req.params.id, 10);
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!service) {
    const err = new Error('Serviço não encontrado');
    err.status = 404;
    throw err;
  }

  // Normaliza caminhos legados/relativos uma vez e persiste o resultado,
  // pra não repetir a tradução em toda requisição seguinte.
  const normalized = workspaces.normalize(service.working_directory)
    || workspaces.createForService(service.name);

  if (normalized !== service.working_directory) {
    db.prepare('UPDATE services SET working_directory = ? WHERE id = ?').run(normalized, serviceId);
    service.working_directory = normalized;
  }

  workspaces.ensureDir(normalized);

  // A fábrica de rotas não conhece "serviço"; guardar o nome no request é o
  // que permite a auditoria sair prefixada com ele.
  req._auditServiceName = service.name;

  return { fm: managerFor(serviceId, normalized), service, scope: 'service' };
}

const router = createFileRoutes({
  label: 'serviceFiles',
  resolveContext,
  onAudit: (req, action, target, detail) => {
    const name = req._auditServiceName;
    recordAudit(getDB(), {
      action,
      target: name ? `[${name}] ${target}` : target,
      detail,
      username: req.user?.username,
    });
  },
});

module.exports = router;
module.exports.resolveContext = resolveContext;
module.exports.forgetService = forgetService;
