const jwt = require('jsonwebtoken');
const config = require('../config');
const sessions = require('../services/sessionManager');

/**
 * Verifica assinatura E revogação do token.
 * Retorna { ok, payload } ou { ok:false, status, body } pronto para resposta.
 *
 * Três motivos de rejeição além de assinatura/expiração:
 *  - `legacy`: token emitido antes das sessões revogáveis (sem jti) —
 *    pede um novo login em vez de aceitar um token impossível de revogar;
 *  - `revoked`: sessão revogada (logout, troca de senha, logout global);
 *  - `unknown`: jti que não existe na tabela (limpeza/backup restaurado).
 */
function checkToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch {
    return { ok: false, status: 401, body: { error: 'Token inválido ou expirado' } };
  }
  if (!payload.jti) {
    return {
      ok: false,
      status: 401,
      body: {
        error: 'Sessão anterior ao upgrade de segurança — faça login novamente',
        code: 'SESSION_UPGRADE_REQUIRED',
      },
    };
  }
  if (!sessions.isSessionActive(payload.jti)) {
    return {
      ok: false,
      status: 401,
      body: { error: 'Sessão revogada ou expirada — faça login novamente', code: 'SESSION_REVOKED' },
    };
  }
  return { ok: true, payload };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Token obrigatório' });

  const result = checkToken(token);
  if (!result.ok) return res.status(result.status).json(result.body);

  // last_seen barato (no máx. 1x/minuto — ver sessionManager).
  sessions.touchSession(result.payload.jti);
  req.user = result.payload;
  next();
}

/** Socket.io: mesma verificação, sem tocar o last_seen (conexão longa). */
function verifySocketToken(token) {
  const result = checkToken(token);
  return result.ok ? result.payload : null;
}

module.exports = { authMiddleware, verifySocketToken };
