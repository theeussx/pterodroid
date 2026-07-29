'use strict';
/**
 * fileRoutesFactory — monta o conjunto COMPLETO de rotas de arquivo em
 * cima de um file manager qualquer.
 *
 * Antes existiam dois arquivos (files.js e serviceFiles.js) com ~150
 * linhas praticamente idênticas, que já tinham divergido: as rotas por
 * serviço nunca ganharam `copy` nem `search`. Com uma fábrica única, o
 * escopo global e o escopo por serviço expõem exatamente a mesma API e
 * qualquer correção vale automaticamente para os dois (DRY, Etapa 6).
 *
 * Quem usa passa apenas:
 *   - resolveContext(req) → { fm, scope } — de onde vem o file manager
 *   - onAudit(req, action, target, detail) → como registrar a auditoria
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');

const UPLOAD_TMP_DIR = '.pterodroid-tmp';

/** Uma única forma de responder erro em todas as rotas de arquivo (Etapa 6). */
function sendError(res, err, label) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[${label}] erro inesperado:`, err);
  res.status(status).json({ error: err.message || 'Erro interno' });
}

/**
 * Nome de arquivo vindo do navegador chega em latin1 quando tem acento —
 * reinterpretar como utf8 evita "relatório.txt" virar "relatÃ³rio.txt".
 */
function decodeOriginalName(originalname) {
  const decoded = Buffer.from(originalname, 'latin1').toString('utf8');
  // Se a reinterpretação gerou caractere de substituição, o nome já era
  // utf8 válido — mantém o original.
  return decoded.includes('\uFFFD') ? originalname : decoded;
}

function createFileRoutes({ resolveContext, onAudit, label = 'files' }) {
  const router = express.Router({ mergeParams: true });

  const audit = (req, action, target, detail = '') => {
    try {
      onAudit?.(req, action, target, detail);
    } catch (err) {
      console.error(`[${label}] falha ao registrar auditoria:`, err.message);
    }
  };

  /** Envolve um handler: resolve o contexto, trata erro e serializa a resposta. */
  const handle = (fn) => async (req, res) => {
    let ctx;
    try {
      ctx = await resolveContext(req);
    } catch (err) {
      return sendError(res, err, label);
    }
    try {
      const result = await fn(req, res, ctx.fm, ctx);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (err) {
      if (!res.headersSent) sendError(res, err, label);
    }
  };

  // ── Leitura ─────────────────────────────────────────────────────────
  router.get('/list', handle((req, res, fm) => fm.list(req.query.path || '')));
  router.get('/read', handle((req, res, fm) => fm.read(req.query.path || '')));

  router.get('/search', handle((req, res, fm) => ({
    results: fm.search(req.query.path || '', (req.query.q || '').trim()),
  })));

  // ── Escrita ─────────────────────────────────────────────────────────
  router.put('/write', handle((req, res, fm) => {
    const result = fm.write(req.body.path, req.body.content);
    audit(req, 'write', req.body.path);
    return result;
  }));

  router.post('/mkdir', handle((req, res, fm) => {
    const result = fm.createDir(req.body.path || '', req.body.name);
    audit(req, 'mkdir', path.posix.join(req.body.path || '', req.body.name || ''));
    return result;
  }));

  router.post('/touch', handle((req, res, fm) => {
    const result = fm.createFile(req.body.path || '', req.body.name);
    audit(req, 'touch', path.posix.join(req.body.path || '', req.body.name || ''));
    return result;
  }));

  router.post('/rename', handle((req, res, fm) => {
    const result = fm.rename(req.body.path, req.body.name);
    audit(req, 'rename', req.body.path, `→ ${req.body.name}`);
    return result;
  }));

  router.post('/move', handle((req, res, fm) => {
    const result = fm.move(req.body.source, req.body.destDir ?? '');
    audit(req, 'move', req.body.source, `→ ${req.body.destDir || '/'}`);
    return result;
  }));

  router.post('/copy', handle((req, res, fm) => {
    const result = fm.copy(req.body.source, req.body.destDir ?? '');
    audit(req, 'copy', req.body.source, `→ ${req.body.destDir || '/'}`);
    return result;
  }));

  // DELETE aceita um caminho ou uma lista — o resultado diz o que foi e o
  // que não foi apagado, em vez de abortar tudo no primeiro erro.
  router.delete('/', handle((req, res, fm) => {
    const body = req.body || {};
    const targets = Array.isArray(body.paths) ? body.paths : [body.path].filter(Boolean);
    if (targets.length === 0) {
      const err = new Error('Nada para excluir');
      err.status = 400;
      throw err;
    }
    const errors = [];
    for (const target of targets) {
      try {
        fm.remove(target);
        audit(req, 'delete', target);
      } catch (err) {
        errors.push({ path: target, error: err.message });
      }
    }
    return { ok: errors.length === 0, deleted: targets.length - errors.length, errors };
  }));

  // ── Download ────────────────────────────────────────────────────────
  router.get('/download', handle((req, res, fm) => {
    const target = fm.resolveSafePath(req.query.path || '', { mustExist: true });
    const st = fm.statOrNotFound(target);
    if (st.isDirectory()) {
      const err = new Error('Não é possível baixar uma pasta — baixe os arquivos individualmente');
      err.status = 400;
      throw err;
    }
    audit(req, 'download', req.query.path);
    return new Promise((resolve, reject) => {
      res.download(target, path.basename(target), (err) => (err && !res.headersSent ? reject(err) : resolve()));
    });
  }));

  // ── Upload ──────────────────────────────────────────────────────────
  /**
   * Fluxo em duas fases, de propósito:
   *
   *  1. multer grava num diretório temporário DENTRO da mesma raiz (mesmo
   *     filesystem, então o rename da fase 2 é atômico e não dá EXDEV);
   *  2. terminado o upload, cada arquivo é renomeado pro destino final com
   *     resolução de conflito.
   *
   * Assim um upload interrompido nunca deixa arquivo pela metade no lugar
   * do bom, e um arquivo já existente não é sobrescrito em silêncio — vira
   * "nome (2).ext" (Etapa 5).
   */
  router.post('/upload', async (req, res) => {
    let ctx;
    try {
      ctx = await resolveContext(req);
    } catch (err) {
      return sendError(res, err, label);
    }
    const { fm } = ctx;

    let destDir;
    let tmpDir;
    try {
      destDir = fm.resolveSafePath(req.query.path || '');
      fs.mkdirSync(destDir, { recursive: true }); // pasta de destino criada sob demanda
      tmpDir = path.join(fm.root(), UPLOAD_TMP_DIR);
      fs.mkdirSync(tmpDir, { recursive: true });
    } catch (err) {
      return sendError(res, err, label);
    }

    const upload = multer({
      storage: multer.diskStorage({
        destination: (r, file, cb) => cb(null, tmpDir),
        filename: (r, file, cb) => cb(null, `${crypto.randomBytes(8).toString('hex')}.part`),
      }),
      limits: { fileSize: config.UPLOAD_MAX_BYTES },
    });

    upload.array('files', 50)(req, res, (uploadErr) => {
      const staged = req.files || [];

      const cleanup = () => {
        for (const file of staged) {
          try { fs.rmSync(file.path, { force: true }); } catch { /* já removido */ }
        }
      };

      if (uploadErr) {
        cleanup();
        const friendly = uploadErr.code === 'LIMIT_FILE_SIZE'
          ? `Arquivo maior que o limite de ${Math.round(config.UPLOAD_MAX_BYTES / 1024 / 1024)}MB`
          : uploadErr.message;
        const status = uploadErr instanceof multer.MulterError ? 400 : (uploadErr.status || 500);
        return res.status(status).json({ error: friendly });
      }

      if (staged.length === 0) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      }

      const saved = [];
      const errors = [];
      for (const file of staged) {
        const requested = fm.sanitizeName(decodeOriginalName(file.originalname));
        try {
          const finalName = fm.uniqueName(destDir, requested);
          fs.renameSync(file.path, path.join(destDir, finalName));
          saved.push({ name: finalName, size: file.size, renamed: finalName !== requested });
          audit(req, 'upload', path.posix.join(req.query.path || '', finalName), `${file.size} bytes`);
        } catch (err) {
          try { fs.rmSync(file.path, { force: true }); } catch { /* já removido */ }
          errors.push({ name: requested, error: err.message });
        }
      }

      try { fs.rmdirSync(tmpDir); } catch { /* outros uploads em andamento */ }

      return res.json({ ok: errors.length === 0, files: saved, errors });
    });
  });

  return router;
}

module.exports = { createFileRoutes, sendError };
