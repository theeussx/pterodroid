const router = require('express').Router();
const { getDB } = require('../db');
const dbm = require('../services/dbInstanceManager');
const drivers = require('../services/dbDrivers');

const VALID_TYPES = Object.keys(drivers); // ['postgresql', 'mysql']

/**
 * O nome da instância vira o nome de uma PASTA em disco (ver
 * dbInstanceManager.dataDirFor), e esse caminho é entregue aos binários do
 * banco. Restringir o formato aqui evita, de uma vez: travessia de caminho
 * (`../`), nomes impossíveis de criar no filesystem, e caracteres que só
 * fazem sentido para um shell.
 *
 * Isto é a SEGUNDA camada de defesa. A primeira é os drivers não usarem
 * shell nenhum (ver runBinary em dbDrivers/common.js) — mesmo que algo
 * escape daqui, não há shell para interpretar.
 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,48}$/;

function validateName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'O nome é obrigatório';
  if (trimmed === '.' || trimmed === '..') return 'Nome inválido';
  if (!NAME_PATTERN.test(trimmed)) {
    return 'O nome deve começar com letra ou número e conter apenas letras, números, espaço, ponto, hífen e underscore (até 49 caracteres)';
  }
  return null;
}

function validatePort(port) {
  const num = parseInt(port, 10);
  if (!Number.isInteger(num)) return 'É necessário informar uma porta numérica';
  // Abaixo de 1024 exige privilégio de root, que o painel não tem (e os
  // próprios bancos recusam rodar como root).
  if (num < 1024 || num > 65535) return 'A porta deve estar entre 1024 e 65535';
  return null;
}

function validate(body) {
  const { name, type, port } = body;
  const nameError = validateName(name);
  if (nameError) return nameError;
  if (!type || !VALID_TYPES.includes(type)) return `O tipo deve ser um destes: ${VALID_TYPES.join(', ')}`;
  const portError = validatePort(port);
  if (portError) return portError;
  return null;
}

// GET /api/databases — includes an availability check per engine, so the
// UI can warn upfront if e.g. postgresql isn't installed yet.
router.get('/', (req, res) => {
  const db = getDB();
  const instances = db.prepare('SELECT * FROM db_instances ORDER BY created_at DESC').all();
  const enriched = instances.map((i) => {
    const { db_password, ...safe } = i;
    return { ...safe, hasPassword: !!db_password, runtime: dbm.getRuntimeInfo(i.id) };
  });
  return res.json(enriched);
});

// GET /api/databases/engines — which engines are actually usable right now
router.get('/engines', (req, res) => {
  const engines = VALID_TYPES.map((type) => ({
    type,
    label: drivers[type].label,
    defaultPort: drivers[type].defaultPort,
    ...dbm.checkAvailable(type),
  }));
  return res.json(engines);
});

// GET /api/databases/:id
router.get('/:id', (req, res) => {
  const db = getDB();
  const inst = db.prepare('SELECT * FROM db_instances WHERE id = ?').get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Database instance not found' });

  const { db_password, ...safe } = inst;
  const dbLogs = db
    .prepare('SELECT * FROM logs WHERE db_instance_id = ? ORDER BY timestamp DESC LIMIT 100')
    .all(inst.id);

  return res.json({
    ...safe,
    hasPassword: !!db_password,
    runtime: dbm.getRuntimeInfo(inst.id),
    recentLogs: dbm.getLogs(inst.id, 200),
    persistedLogs: dbLogs,
  });
});

// POST /api/databases
router.post('/', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });

  const db = getDB();
  const { name, type, port, db_username = 'root', db_password = '', tunnel_hostname = null } = req.body;
  const portNum = parseInt(port, 10);

  // O usuário do banco entra em comandos CREATE USER/ALTER USER e em
  // argumentos dos binários; manter o formato restrito evita surpresa.
  const username = String(db_username || 'root').trim() || 'root';
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(username)) {
    return res.status(400).json({
      error: 'O usuário do banco deve começar com letra e conter apenas letras, números e underscore (até 32 caracteres)',
    });
  }

  const conflict = db.prepare('SELECT name FROM db_instances WHERE port = ?').get(portNum);
  if (conflict) {
    return res.status(409).json({
      error: `A porta ${portNum} já está configurada para a instância "${conflict.name}". Escolha outra porta.`,
    });
  }

  // Math.random() não é criptograficamente seguro e era usado para gerar a
  // senha do banco — previsível o bastante para não servir como segredo.
  const password = db_password || require('crypto').randomBytes(18).toString('base64url');

  const result = db.prepare(`
    INSERT INTO db_instances (name, type, port, db_username, db_password, tunnel_hostname)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name.trim(), type, portNum, username, password, tunnel_hostname?.trim() || null);

  const created = db.prepare('SELECT * FROM db_instances WHERE id = ?').get(result.lastInsertRowid);
  const { db_password: _pw, ...safe } = created;
  return res.status(201).json({ ...safe, generatedPassword: db_password ? undefined : password });
});

// PUT /api/databases/:id — mainly for fixing a port conflict without
// losing the provisioned data directory. Blocked while running so the
// live process's actual bound port never disagrees with what's stored.
router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM db_instances WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Database instance not found' });
  if (existing.status === 'running' || dbm.getRuntimeInfo(existing.id)) {
    return res.status(409).json({ error: 'Pare a instância antes de editar.' });
  }

  const { name, port, db_username, tunnel_hostname } = req.body;

  if (name !== undefined) {
    const nameError = validateName(name);
    if (nameError) return res.status(400).json({ error: nameError });
  }

  if (port !== undefined) {
    const portNum = parseInt(port, 10);
    const portError = validatePort(port);
    if (portError) return res.status(400).json({ error: portError });
    const conflict = db.prepare('SELECT name FROM db_instances WHERE port = ? AND id != ?').get(portNum, existing.id);
    if (conflict) {
      return res.status(409).json({
        error: `A porta ${portNum} já está configurada para a instância "${conflict.name}". Escolha outra porta.`,
      });
    }
  }

  db.prepare(`
    UPDATE db_instances SET
      name=?, port=?, db_username=?, tunnel_hostname=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    (name ?? existing.name).trim(),
    port !== undefined ? parseInt(port, 10) : existing.port,
    (db_username ?? existing.db_username).trim() || existing.db_username,
    tunnel_hostname !== undefined ? (tunnel_hostname?.trim() || null) : existing.tunnel_hostname,
    existing.id,
  );

  const updated = db.prepare('SELECT * FROM db_instances WHERE id = ?').get(existing.id);
  const { db_password: _pw, ...safe } = updated;
  return res.json(safe);
});

// DELETE /api/databases/:id
router.delete('/:id', async (req, res) => {
  const db = getDB();
  const inst = db.prepare('SELECT * FROM db_instances WHERE id = ?').get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Database instance not found' });

  try { await dbm.stopInstance(inst.id); } catch { /* already stopped */ }

  db.prepare('DELETE FROM db_instances WHERE id = ?').run(inst.id);
  db.prepare('DELETE FROM logs WHERE db_instance_id = ?').run(inst.id);
  return res.json({ ok: true, note: 'Data directory on disk was left untouched — delete it manually if you want to reclaim space.' });
});

// POST /api/databases/:id/start — provisions on first start
router.post('/:id/start', async (req, res) => {
  try {
    const pid = await dbm.startInstance(parseInt(req.params.id, 10));
    return res.json({ ok: true, pid });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/databases/:id/stop
router.post('/:id/stop', async (req, res) => {
  try {
    await dbm.stopInstance(parseInt(req.params.id, 10));
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/databases/:id/restart
router.post('/:id/restart', async (req, res) => {
  try {
    const pid = await dbm.restartInstance(parseInt(req.params.id, 10));
    return res.json({ ok: true, pid });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/databases/:id/logs
router.get('/:id/logs', (req, res) => {
  const db = getDB();
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const logs = db
    .prepare('SELECT * FROM logs WHERE db_instance_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(req.params.id, limit);
  return res.json(logs.reverse());
});

module.exports = router;
