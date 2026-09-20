'use strict';
/**
 * jobHandlers — registra os executores da fila (jobQueue).
 *
 * Vive num módulo separado do jobQueue de propósito: os handlers conhecem
 * os managers de negócio (backups, hosts Docker...) e o jobQueue conhece
 * só o banco — no mesmo arquivo, formaria ciclo de require assim que um
 * manager resolvesse enfileirar algo ele mesmo.
 *
 * Carregado pelo server.js DEPOIS do initDB.
 */
const { getDB } = require('../db');
const jobs = require('./jobQueue');
const backups = require('./backupManager');
const hosts = require('./dockerHostManager');
const { recordAudit } = require('./auditLog');

/**
 * Auditoria da conclusão do job. A requisição HTTP que enfileirou já se foi,
 * então a identidade veio preservada no payload (by/ip) — sem isso a trilha
 * ficaria com "job feito por ninguém".
 */
function auditDone(job, { action, detail = '' }) {
  recordAudit(getDB(), {
    action,
    target: job.subject,
    detail,
    username: job.payload?.by || '',
    ip: job.payload?.ip || '',
  });
}

function serviceOrFail(serviceId) {
  const svc = getDB().prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!svc) {
    const err = new Error('O serviço ligado a este job não existe mais');
    err.status = 404;
    throw err;
  }
  return svc;
}

function registerAll() {
  jobs.registerHandler('backup.create', async (job) => {
    const svc = serviceOrFail(job.payload.serviceId);
    job.reportProgress(15);
    const created = await backups.createBackup(svc, { name: job.payload.name });
    job.reportProgress(90);
    auditDone(job, { action: 'backup_criado', detail: `${created.name} (${created.size_bytes} bytes)` });
    return { backupId: created.id, name: created.name, size_bytes: created.size_bytes };
  });

  jobs.registerHandler('backup.restore', async (job) => {
    const svc = serviceOrFail(job.payload.serviceId);
    job.reportProgress(15);
    const result = await backups.restoreBackup(svc, job.payload.backupId);
    job.reportProgress(90);
    auditDone(job, { action: 'backup_restaurado', detail: `${result.extracted} arquivo(s) restaurado(s)` });
    return result;
  });

  jobs.registerHandler('docker.image_pull', async (job) => {
    // engineFor lança 404 se o host foi removido depois do enfileiramento.
    const engine = hosts.engineFor(job.payload.hostId);
    let pct = 0;
    await engine.pullImage(job.payload.fromImage, () => {
      // O Docker reporta progresso por camada, sem total confiável — a
      // barra avança em rampa aproximada e trava em 95% até o final.
      pct = Math.min(95, pct + 3);
      job.reportProgress(pct);
    });
    auditDone(job, { action: 'docker_imagem_baixada' });
    return { image: job.payload.fromImage };
  });
}

module.exports = { registerAll };
