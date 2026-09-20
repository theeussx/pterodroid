const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const config = require('../config');
const throttle = require('../services/loginThrottle');
const { LoginThrottle } = throttle;
const { recordAudit } = require('../services/auditLog');
const cipher = require('../services/secretCipher');
const totp = require('../services/totp');
const sessions = require('../services/sessionManager');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clientIp(req) {
  // Sem trust proxy deliberado: atrás do Cloudflare Tunnel o IP real vem no
  // header CF-Connecting-IP; sem proxy, req.ip é o correto. O header só é
  // lido quando ele existe — spoof serve apenas para sujar a própria
  // auditoria do atacante, nunca para ganhar acesso.
  return (req.headers['cf-connecting-ip'] || req.ip || '').toString();
}

function issueToken(res, user, req) {
  const jti = sessions.createSession(user.id, {
    ip: clientIp(req),
    userAgent: req.headers['user-agent'],
  });
  const token = jwt.sign(
    { id: user.id, username: user.username, jti },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES },
  );
  return res.json({ token, username: user.username });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password, totp: totpCode } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  const key = LoginThrottle.clientKey(req, username);
  const state = throttle.check(key);

  if (!state.allowed) {
    res.setHeader('Retry-After', String(state.retryAfterSec));
    return res.status(429).json({
      error: `Muitas tentativas de login. Tente novamente em ${Math.ceil(state.retryAfterSec / 60)} minuto(s).`,
      retryAfterSec: state.retryAfterSec,
    });
  }

  // Atraso progressivo: quase imperceptível para quem errou a senha uma vez,
  // e devastador para quem está testando milhares por hora.
  if (state.delayMs) await sleep(state.delayMs);

  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  // Compara o hash mesmo quando o usuário não existe: sem isso, a resposta
  // volta na hora para usuário inexistente e devagar para existente, o que
  // permite descobrir nomes de usuário só medindo o tempo.
  const hash = user?.password_hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok) {
    const result = throttle.registerFailure(key);
    recordAudit(db, { action: 'login_falha', target: username, ip: clientIp(req) });
    if (result.locked) {
      console.warn(`[auth] login bloqueado temporariamente após tentativas repetidas (${key.split('|')[0]})`);
      recordAudit(db, {
        action: 'login_bloqueado',
        target: username,
        detail: `bloqueado por ${Math.ceil(result.lockedForSec / 60)} min`,
        ip: clientIp(req),
      });
      res.setHeader('Retry-After', String(result.lockedForSec));
      return res.status(429).json({
        error: `Muitas tentativas de login. Tente novamente em ${Math.ceil(result.lockedForSec / 60)} minuto(s).`,
        retryAfterSec: result.lockedForSec,
      });
    }
    // Mensagem genérica de propósito: não revela se o usuário existe.
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }

  // ── Segundo fator (TOTP + códigos de recuperação) ──────────────────────
  if (user.totp_enabled && user.totp_secret) {
    if (!totpCode) {
      // Não registra falha no throttle (a senha ESTAVA certa): pedir o
      // segundo fator não pode ser punido como erro de credencial.
      return res.status(401).json({
        error: 'Informe o código do aplicativo autenticador (ou um código de recuperação)',
        code: 'TOTP_REQUIRED',
      });
    }

    const secret = cipher.decrypt(user.totp_secret);
    let passed = totp.verify(secret, totpCode);

    // Código de recuperação de uso único (formato XXXX-XXXX, ignorando caixa).
    if (!passed) {
      const codes = JSON.parse(user.recovery_codes || '[]');
      const wanted = totp.hashRecoveryCode(totpCode);
      const idx = codes.indexOf(wanted);
      if (idx >= 0) {
        codes.splice(idx, 1);
        db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?')
          .run(JSON.stringify(codes), user.id);
        passed = true;
        recordAudit(db, {
          action: '2fa_recuperacao_usada',
          target: username,
          detail: `${codes.length} código(s) de recuperação restante(s)`,
          username,
          ip: clientIp(req),
        });
      }
    }

    if (!passed) {
      throttle.registerFailure(key);
      recordAudit(db, { action: '2fa_falha', target: username, ip: clientIp(req) });
      return res.status(401).json({ error: 'Código de verificação inválido' });
    }
  }

  throttle.registerSuccess(key);
  recordAudit(db, { action: 'login_sucesso', target: username, username, ip: clientIp(req) });
  return issueToken(res, user, req);
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const db = getDB();
  const setup = db.prepare("SELECT value FROM settings WHERE key = 'setup_done'").get();
  const user = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(req.user.id);
  return res.json({
    username: req.user.username,
    setupDone: setup?.value === 'true',
    totpEnabled: user?.totp_enabled === 1,
  });
});

// POST /api/auth/logout — revoga a sessão atual (o token morre na hora).
router.post('/logout', authMiddleware, (req, res) => {
  sessions.revokeSession(req.user.jti);
  recordAudit(getDB(), {
    action: 'logout', target: req.user.username, username: req.user.username, ip: clientIp(req),
  });
  return res.json({ ok: true });
});

// GET /api/auth/sessions — sessões do usuário, com a atual marcada.
// Formato: { items: [{jti, ip, user_agent, created_at, last_seen_at, current}], count }
router.get('/sessions', authMiddleware, (req, res) => {
  const items = sessions.listSessions(req.user.id)
    .filter((s) => !s.revoked) // revogadas não interessam à tela "quem está conectado"
    .map((s) => ({
      jti: s.id,
      ip: s.ip,
      user_agent: s.user_agent,
      created_at: s.created_at,
      last_seen_at: s.last_seen_at,
      current: s.id === req.user.jti,
    }));
  return res.json({ items, count: items.length });
});

// DELETE /api/auth/sessions/:jti — revoga uma sessão específica do usuário.
router.delete('/sessions/:jti', authMiddleware, (req, res) => {
  const db = getDB();
  const row = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(req.params.jti);
  if (!row || row.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Sessão não encontrada' });
  }
  sessions.revokeSession(req.params.jti);
  recordAudit(db, {
    action: 'sessao_revogada', target: req.user.username,
    detail: req.params.jti.slice(0, 8), username: req.user.username, ip: clientIp(req),
  });
  return res.json({ ok: true });
});

// POST /api/auth/sessions/revoke-others — "sair de todos os outros dispositivos".
router.post('/sessions/revoke-others', authMiddleware, (req, res) => {
  const db = getDB();
  const count = sessions.revokeAllForUser(req.user.id, { exceptJti: req.user.jti });
  recordAudit(db, {
    action: 'sessoes_revogadas', target: req.user.username,
    detail: `${count} sessão(ões) encerrada(s)`, username: req.user.username, ip: clientIp(req),
  });
  return res.json({ ok: true, revoked: count });
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { current, next: newPass } = req.body || {};
  if (!current || !newPass) {
    return res.status(400).json({ error: 'A senha atual e a nova senha são obrigatórias' });
  }
  if (newPass.length < 8) {
    return res.status(400).json({ error: 'A nova senha precisa ter ao menos 8 caracteres' });
  }
  if (newPass === current) {
    return res.status(400).json({ error: 'A nova senha precisa ser diferente da atual' });
  }

  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Sessão inválida' });

  const ok = await bcrypt.compare(current, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Senha atual incorreta' });

  const hash = await bcrypt.hash(newPass, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);

  // Quem trocou a senha provou posse da conta — todas as OUTRAS sessões
  // caem (um invasor logado é despejado aqui), menos este dispositivo.
  sessions.revokeAllForUser(req.user.id, { exceptJti: req.user.jti });

  // Trocar a senha é o passo que conclui a configuração inicial — é isso que
  // o aviso de "senha padrão" no topo do painel está esperando.
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('setup_done', 'true')
    ON CONFLICT(key) DO UPDATE SET value = 'true'
  `).run();

  recordAudit(db, { action: 'senha_alterada', target: user.username, username: user.username, ip: clientIp(req) });
  return res.json({ ok: true });
});

// ── 2FA (TOTP) ────────────────────────────────────────────────────────────

// GET /api/auth/2fa/status
router.get('/2fa/status', authMiddleware, (req, res) => {
  const user = getDB().prepare('SELECT totp_enabled, recovery_codes FROM users WHERE id = ?').get(req.user.id);
  return res.json({
    enabled: user?.totp_enabled === 1,
    recoveryLeft: JSON.parse(user?.recovery_codes || '[]').length,
  });
});

// POST /api/auth/2fa/setup — gera um segredo novo (ainda NÃO ativo).
router.post('/2fa/setup', authMiddleware, (req, res) => {
  const db = getDB();
  const secret = totp.generateSecret();
  // Guardado CIFRADO e com totp_enabled=0: um segredo pendente não vale
  // para login até o código correto ser apresentado em /2fa/enable.
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?')
    .run(cipher.encrypt(secret), req.user.id);
  return res.json({
    secret,
    uri: totp.otpauthUri({ secret, account: req.user.username }),
  });
});

// POST /api/auth/2fa/enable { token } — confirma o segredo e ativa o 2FA.
router.post('/2fa/enable', authMiddleware, (req, res) => {
  const { token } = req.body || {};
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const secret = user?.totp_secret ? cipher.decrypt(user.totp_secret) : null;
  if (!secret) return res.status(400).json({ error: 'Gere um segredo primeiro (POST /2fa/setup)' });
  if (!totp.verify(secret, token)) {
    return res.status(400).json({ error: 'Código inválido — confira o relógio do celular e tente de novo' });
  }

  const codes = totp.generateRecoveryCodes();
  db.prepare('UPDATE users SET totp_enabled = 1, recovery_codes = ? WHERE id = ?')
    .run(JSON.stringify(codes.map(totp.hashRecoveryCode)), req.user.id);
  recordAudit(db, {
    action: '2fa_ativado', target: user.username, username: user.username, ip: clientIp(req),
  });
  // Os códigos em texto claro aparecem UMA vez, nesta resposta. No banco
  // ficam só os hashes.
  return res.json({ ok: true, recoveryCodes: codes });
});

// POST /api/auth/2fa/disable { current } — exige a senha atual (ação sensível).
router.post('/2fa/disable', authMiddleware, async (req, res) => {
  const { current } = req.body || {};
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!current || !(await bcrypt.compare(current, user.password_hash))) {
    return res.status(401).json({ error: 'Informe a senha atual para desativar o 2FA' });
  }
  db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery_codes = '[]' WHERE id = ?")
    .run(req.user.id);
  recordAudit(db, {
    action: '2fa_desativado', target: user.username, username: user.username, ip: clientIp(req),
  });
  return res.json({ ok: true });
});

// POST /api/auth/2fa/recovery-codes { current } — gera um lote novo (invalida o anterior).
router.post('/2fa/recovery-codes', authMiddleware, async (req, res) => {
  const { current } = req.body || {};
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user?.totp_enabled) return res.status(400).json({ error: 'O 2FA não está ativo' });
  if (!current || !(await bcrypt.compare(current, user.password_hash))) {
    return res.status(401).json({ error: 'Informe a senha atual para gerar novos códigos' });
  }
  const codes = totp.generateRecoveryCodes();
  db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?')
    .run(JSON.stringify(codes.map(totp.hashRecoveryCode)), req.user.id);
  recordAudit(db, {
    action: '2fa_codigos_regenerados', target: user.username, username: user.username, ip: clientIp(req),
  });
  return res.json({ ok: true, recoveryCodes: codes });
});

module.exports = router;
