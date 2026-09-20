'use strict';
/**
 * JobQueue — fila persistente de operações longas (Fase 1).
 *
 * POR QUE
 * ───────
 * Operações como "criar backup", "restaurar backup" ou "baixar imagem
 * Docker" eram executadas dentro do request HTTP: se o painel reiniciasse
 * no meio, ninguém sabia o que aconteceu — a linha de backup ficava em
 * 'creating' pra sempre, a UI não mostrava nada e o arquivinho temporário
 * ficava órfão em disco. Esta fila resolve as duas metades do problema:
 *
 *   1. PERSISTÊNCIA: cada operação vira uma linha na tabela `jobs`
 *      ANTES de começar, então o estado sobrevive a processo.
 *   2. RECONCILIAÇÃO: no boot, jobs que ficaram 'queued'/'running' viram
 *      'failed' com explicação — e os status zumbis DERIVADOS (backup em
 *      'creating'/'restoring', setup em 'running') são limpos no mesmo
 *      passe, porque não têm como continuar sozinhos.
 *
 * MODELO
 * ──────
 * Uma fila global, FIFO, UM job por vez. Um painel pessoal sofre mais com
 * contenção (dois zips grandes + um pull de imagem disputando disco/rede)
 * do que com espera — e "por que minha coisa ainda não rodou?" fica
 * trivial de explicar olhando a tabela. Handlers rodam em processo único;
 * nada aqui é distribuído de propósito.
 *
 * CANCELAR: só jobs 'queued'. O trabalho de um handler em andamento é
 * atômico na prática (escreve um .part e renomeia); "cancelar e continuar
 * de onde parou" exigiria checkpoints por etapa dentro dos handlers —
 * fora do escopo desta fatia.
 */
const crypto = require('crypto');
const { getDB } = require('../db');
const io = require('../sockets/lazyIo');

const MAX_KEPT = 200; // retenção da fila: além disso, apaga os done/failed/cancelled mais antigos

const handlers = new Map(); // type → async (job) => result
let workerRunning = false;

/** Timestamp no formato do SQLite (UTC), igual ao CURRENT_TIMESTAMP. */
function tsNow() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** Registra o executor de um tipo de job. Sobrescreve o anterior. */
function registerHandler(type, fn) {
  handlers.set(type, fn);
}

function rowById(id) {
  return getDB().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

/** Serialização pública: payload chega ao consumidor como OBJETO pronto. */
function toPublic(row) {
  if (!row) return row;
  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { /* linha corrompida: expõe vazio */ }
  return { ...row, payload };
}

function emit(row) {
  io.emit?.('job:update', toPublic(row));
}

function touch(id, patch) {
  const cols = Object.keys(patch)
    .map((c) => `${c} = ?`)
    .join(', ');
  getDB().prepare(`UPDATE jobs SET ${cols} WHERE id = ?`).run(...Object.values(patch), id);
  const row = rowById(id);
  emit(row);
  return row;
}

/**
 * Enfileira um job e dispara o worker. Síncrono — a execução continua em
 * background; chamadores HTTP respondem imediatamente com a linha criada.
 */
function enqueue(type, { subject = '', payload = {} } = {}) {
  if (!handlers.has(type)) {
    const err = new Error(`Tipo de job desconhecido: ${type}`);
    err.status = 400;
    throw err;
  }
  const db = getDB();
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO jobs (id, type, subject, payload, status) VALUES (?, ?, ?, ?, ?)')
    .run(id, type, String(subject).slice(0, 200), JSON.stringify(payload || {}), 'queued');

  // Retenção best-effort: a fila é um log operacional, não um arquivo morto.
  const stale = db.prepare(`
    SELECT id FROM jobs WHERE status IN ('done','failed','cancelled')
    ORDER BY finished_at DESC LIMIT -1 OFFSET ?
  `).all(MAX_KEPT);
  if (stale.length) {
    const del = db.prepare('DELETE FROM jobs WHERE id = ?');
    for (const { id: sid } of stale) del.run(sid);
  }

  const row = rowById(id);
  emit(row);
  kick();
  return row;
}

/** Cancela um job AINDA em fila. Em execução responde 409. */
function cancel(id) {
  const job = rowById(id);
  if (!job) {
    const err = new Error('Job não encontrado');
    err.status = 404;
    throw err;
  }
  if (job.status !== 'queued') {
    const err = new Error(
      job.status === 'running'
        ? 'Este job já está executando — só é possível cancelar o que ainda está esperando na fila'
        : `Este job já terminou (${job.status})`,
    );
    err.status = 409;
    throw err;
  }
  return touch(id, { status: 'cancelled', finished_at: tsNow() });
}

/** Dispara o worker se ele estiver dormindo. */
function kick() {
  if (workerRunning) return;
  workerRunning = true;
  // Não-await deliberado: a fila é background por definição.
  void runWorker().finally(() => { workerRunning = false; });
}

async function runWorker() {
  const db = getDB();
  // Um por vez, estritamente em ordem de criação.
  for (;;) {
    const next = db.prepare(
      "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1",
    ).get();
    if (!next) break;

    const handler = handlers.get(next.type);
    touch(next.id, { status: 'running', started_at: tsNow() });
    let payload = {};
    try { payload = JSON.parse(next.payload || '{}'); } catch { /* payload corrompido cai no handler como {} */ }

    const job = {
      ...next,
      payload,
      /** Handler informa progresso 0-100 — aparece na UI ao vivo. */
      reportProgress: (progress, message) => {
        const p = Math.max(0, Math.min(100, Math.round(progress)));
        touch(next.id, { progress: p, ...(message ? { subject: String(message).slice(0, 200) } : {}) });
      },
    };

    try {
      const result = await handler(job);
      touch(next.id, {
        status: 'done',
        progress: 100,
        result: JSON.stringify(result ?? null).slice(0, 2000),
        finished_at: tsNow(),
      });
    } catch (err) {
      const message = String(err?.message || 'Falha desconhecida').slice(0, 500);
      console.error(`[jobs] ${next.type} (${next.subject}) falhou: ${message}`);
      touch(next.id, {
        status: 'failed',
        result: message,
        finished_at: tsNow(),
      });
    }
  }
}

/**
 * Roda UMA vez no boot. Tudo que ficou 'queued'/'running' pertence a um
 * processo morto — como os handlers não são reentrantes, a decisão honesta
 * é marcar failed com explicação (nunca "re-play" automático). No mesmo
 * passe limpa os estados ZUMBIS DERIVADOS que existiam antes da fila —
 * esses eram justamente os pontos cegos que motivaram este item.
 */
function reconcileBoot() {
  const db = getDB();
  const now = tsNow();
  const reason = 'Interrompido pelo reinício do painel — repita a operação.';

  const zombies = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')").get().n;
  if (zombies > 0) {
    db.prepare("UPDATE jobs SET status = 'failed', result = ?, finished_at = ? WHERE status IN ('queued','running')")
      .run(reason, now);
    console.warn(`[jobs] ${zombies} job(s) interrompido(s) pelo boot anterior marcados como falhos`);
  }

  // Backups presos em andamento (anteriores à fila, ou job que morreu no
  // meio de criar/restaurar): sem isso, a versão antiga dessas linhas ficava
  // 'creating' para sempre e BLOQUEAVA novos backups do serviço — o 409
  // "já existe uma operação em andamento" nunca liberava.
  db.prepare(`
    UPDATE backups SET status = 'failed', error = ?
    WHERE status IN ('creating','restoring')
  `).run(reason);

  // Setups interrompidos no meio: o runSetup já tolera re-disparo (verifica
  // staleness antes de começar), então aqui basta dar a resposta correta na
  // UI em vez de "rodando" eterno.
  db.prepare(`
    UPDATE services SET setup_status = 'failed', setup_error = ?
    WHERE setup_status = 'running'
  `).run(reason);
}

function listJobs({ status, type, limit = 50, offset = 0 } = {}) {
  const db = getDB();
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (type) { where.push('type = ?'); params.push(type); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const l = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const o = Math.max(0, parseInt(offset, 10) || 0);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM jobs ${whereSql}`).get(...params).n;
  const active = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')").get().n;
  const items = db.prepare(
    `SELECT * FROM jobs ${whereSql} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
  ).all(...params, l, o).map(toPublic);
  return { items, total, active, limit: l, offset: o };
}

module.exports = {
  registerHandler,
  enqueue,
  cancel,
  kick,
  reconcileBoot,
  listJobs,
  rowById,
  toPublic,
};
