'use strict';
/**
 * backupManager — backups por serviço, no espírito da aba "Backups" do
 * Pterodactyl: compacta o workspace inteiro num .zip, guarda numa pasta
 * separada (fora de WORKSPACES_ROOT, pra nunca acabar incluído dentro de
 * si mesmo) e permite baixar, restaurar ou apagar depois.
 *
 * Reaproveita o que já existia e já era testado, em vez de reinventar:
 *   - fileManager.createFileManager  → mesma validação de caminho seguro
 *     usada pela aba "Arquivos" (sem symlink escapando da raiz, etc.)
 *   - archiveManager.createZip/extractZip → mesmos limites de tamanho e
 *     as mesmas proteções contra zip bomb / zip slip do compactador de
 *     arquivos já usado no gerenciador de arquivos.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDB } = require('../db');
const { createFileManager } = require('./fileManager');
const { createZip, extractZip } = require('./archiveManager');
const workspaces = require('./workspaceManager');

function dirFor(serviceId) {
  return path.join(config.BACKUPS_ROOT, `service-${serviceId}`);
}

function safeLabel(name) {
  const trimmed = String(name || '').trim().slice(0, 80);
  return trimmed || `backup-${new Date().toISOString().slice(0, 19)}`;
}

function listForService(serviceId) {
  const db = getDB();
  return db.prepare('SELECT * FROM backups WHERE service_id = ? ORDER BY created_at DESC').all(serviceId);
}

function getOne(serviceId, backupId) {
  const db = getDB();
  const row = db.prepare('SELECT * FROM backups WHERE id = ? AND service_id = ?').get(backupId, serviceId);
  if (!row) {
    const err = new Error('Backup não encontrado');
    err.status = 404;
    throw err;
  }
  return row;
}

function absolutePath(serviceId, backup) {
  return path.join(dirFor(serviceId), backup.filename);
}

/**
 * Cria um backup síncrono do workspace do serviço. Segue o mesmo padrão já
 * aceito no resto do painel para compactação (usado por "selecionar tudo +
 * compactar" na aba Arquivos): é uma operação de CPU síncrona, então uma
 * pasta muito grande deixa a requisição demorada — mas os mesmos limites de
 * tamanho/quantidade de arquivos do archiveManager já protegem contra um
 * workspace absurdamente grande travar o processo por muito tempo.
 */
async function createBackup(service, { name } = {}) {
  const db = getDB();

  const existing = listForService(service.id);
  if (existing.some((b) => b.status === 'creating' || b.status === 'restoring')) {
    const err = new Error('Já existe uma operação de backup em andamento para este serviço.');
    err.status = 409;
    throw err;
  }
  if (existing.length >= config.MAX_BACKUPS_PER_SERVICE) {
    const err = new Error(
      `Limite de ${config.MAX_BACKUPS_PER_SERVICE} backups por serviço atingido. Apague um backup antigo antes de criar outro.`,
    );
    err.status = 409;
    throw err;
  }
  if (!service.working_directory) {
    const err = new Error('Este serviço não tem diretório de trabalho definido.');
    err.status = 400;
    throw err;
  }

  const label = safeLabel(name);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${stamp}-${workspaces.slugify(label, 'backup')}.zip`;

  const insert = db
    .prepare('INSERT INTO backups (service_id, name, filename, size_bytes, status) VALUES (?, ?, ?, 0, ?)')
    .run(service.id, label, filename, 'creating');
  const backupId = insert.lastInsertRowid;

  try {
    const fm = createFileManager(service.working_directory);
    const top = fm.list('');
    const names = top.entries.map((e) => e.name);
    if (!names.length) {
      throw new Error('O workspace deste serviço está vazio — não há nada para colocar no backup.');
    }

    const buffer = createZip(fm, names, { level: 6 });

    const dir = dirFor(service.id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, filename);
    // Escrita atômica, mesmo padrão usado no resto do painel para arquivos.
    const tmp = `${dest}.${process.pid}.part`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, dest);

    db.prepare('UPDATE backups SET status = ?, size_bytes = ? WHERE id = ?').run('ready', buffer.length, backupId);
    return getOne(service.id, backupId);
  } catch (err) {
    db.prepare('UPDATE backups SET status = ?, error = ? WHERE id = ?')
      .run('failed', String(err.message || 'Falha desconhecida').slice(0, 500), backupId);
    throw err;
  }
}

/**
 * Restaura um backup no workspace atual do serviço. Por segurança NÃO apaga
 * arquivos criados depois do backup — só sobrescreve os que existem dentro
 * do .zip (mesma semântica do "extrair" da aba Arquivos, com overwrite
 * ligado). Isso cobre o caso de uso mais comum ("quebrei uma configuração,
 * quero voltar") sem o risco de um apagão silencioso de arquivos novos.
 */
async function restoreBackup(service, backupId) {
  const db = getDB();
  const backup = getOne(service.id, backupId);
  if (backup.status !== 'ready') {
    const err = new Error('Este backup não está pronto para ser restaurado.');
    err.status = 409;
    throw err;
  }
  if (!service.working_directory) {
    const err = new Error('Este serviço não tem diretório de trabalho definido.');
    err.status = 400;
    throw err;
  }

  const abs = absolutePath(service.id, backup);
  if (!fs.existsSync(abs)) {
    const err = new Error('O arquivo deste backup não foi encontrado no disco.');
    err.status = 404;
    throw err;
  }

  db.prepare('UPDATE backups SET status = ? WHERE id = ?').run('restoring', backup.id);
  try {
    const buffer = fs.readFileSync(abs);
    const fm = createFileManager(service.working_directory);
    const result = extractZip(fm, buffer, '', { overwrite: true });
    return result;
  } finally {
    // Sempre volta pra 'ready', com sucesso ou erro — nunca deixa o registro
    // preso em 'restoring' impedindo novos backups/restaurações.
    db.prepare('UPDATE backups SET status = ? WHERE id = ?').run('ready', backup.id);
  }
}

function deleteBackup(serviceId, backupId) {
  const backup = getOne(serviceId, backupId);
  const db = getDB();
  try {
    fs.unlinkSync(absolutePath(serviceId, backup));
  } catch {
    /* já não existia no disco — segue igual pra limpar o registro */
  }
  db.prepare('DELETE FROM backups WHERE id = ?').run(backup.id);
  return { ok: true };
}

/** Apaga todos os backups (arquivos + registros) de um serviço removido. */
function forgetService(serviceId) {
  const db = getDB();
  try {
    fs.rmSync(dirFor(serviceId), { recursive: true, force: true });
  } catch {
    /* nada a apagar */
  }
  db.prepare('DELETE FROM backups WHERE service_id = ?').run(serviceId);
}

module.exports = {
  listForService,
  getOne,
  createBackup,
  restoreBackup,
  deleteBackup,
  forgetService,
  absolutePath,
};
