const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const config = require('../config');
const throttle = require('../services/loginThrottle');
const { recordAudit } = require('../services/auditLog');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  const key = throttle.constructor.clientKey(req, username);
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
    if (result.locked) {
      console.warn(`[auth] login bloqueado temporariamente após tentativas repetidas (${key.split('|')[0]})`);
      recordAudit(db, {
        action: 'login_bloqueado',
        target: username,
        detail: `bloqueado por ${Math.ceil(result.lockedForSec / 60)} min`,
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

  throttle.registerSuccess(key);

  const token = jwt.sign(
    { id: user.id, username: user.username },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES },
  );

  return res.json({ token, username: user.username });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const db = getDB();
  const setup = db.prepare("SELECT value FROM settings WHERE key = 'setup_done'").get();
  return res.json({ username: req.user.username, setupDone: setup?.value === 'true' });
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

  // Trocar a senha é o passo que conclui a configuração inicial — é isso que
  // o aviso de "senha padrão" no topo do painel está esperando.
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('setup_done', 'true')
    ON CONFLICT(key) DO UPDATE SET value = 'true'
  `).run();

  recordAudit(db, { action: 'senha_alterada', target: user.username, username: user.username });
  return res.json({ ok: true });
});

module.exports = router;
