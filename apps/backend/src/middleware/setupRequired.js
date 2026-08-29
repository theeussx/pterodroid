'use strict';
/**
 * setupRequired — trava o painel até a senha padrão ser trocada.
 *
 * O painel nasce com admin/admin e agora tem um terminal embutido: quem
 * alcançar o login antes de a senha ser trocada ganha execução remota de
 * comandos no dispositivo. O banner de aviso existia, mas era só um aviso —
 * dava para usar tudo normalmente com a senha padrão.
 *
 * Este middleware bloqueia TODAS as rotas de negócio (menos auth, me e
 * change-password) enquanto setup_done != 'true'. Assim o painel fica
 * inutilizável até o dono trocar a senha, o que elimina a janela de risco.
 */
const { getDB } = require('../db');

function setupRequired(req, res, next) {
  const db = getDB();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'setup_done'").get();
  if (row?.value === 'true') return next();
  return res.status(403).json({
    error: 'A senha padrão ainda está em uso. Troque a senha antes de usar o painel.',
    code: 'SETUP_REQUIRED',
  });
}

module.exports = { setupRequired };
