const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const cipher = require('../services/secretCipher');
const { openDatabase } = require('./sqliteCompat');
const { acquireDbLock } = require('./dbLock');

let db;
let releaseDbLock = null;

function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

/**
 * CREATE TABLE IF NOT EXISTS only helps on a brand-new database — it does
 * nothing to a table that already exists but predates a newer column. The
 * MIGRATIONS list below adds those missing columns, so panel.db from an
 * older version of the app upgrades in place instead of needing to be
 * deleted. Keeping the list declarative (instead of a series of imperative
 * calls) is what lets us detect "migrations pending" and back the file up
 * BEFORE touching anything.
 */
const MIGRATIONS = [
  // services — campos originais adicionados após a primeira versão
  ['services', 'port', 'INTEGER'],
  ['services', 'public_url', 'TEXT'],
  ['services', 'scaffolded_directory', 'INTEGER DEFAULT 0'],
  ['services', 'tunnel_hostname', 'TEXT'],
  // Receita dedicada do serviço (ver services/serviceRecipes.js). Nulo para
  // serviços antigos — o rótulo/ícone é então derivado do campo `type`.
  ['services', 'recipe', 'TEXT'],
  // Healthcheck por serviço: quando habilitado, o watchdog também confere se
  // o serviço está respondendo (e não apenas se o processo está vivo).
  ['services', 'healthcheck_url', 'TEXT'],
  ['services', 'healthcheck_interval', 'INTEGER DEFAULT 30'],
  ['services', 'healthcheck_timeout', 'INTEGER DEFAULT 5'],
  ['services', 'healthcheck_enabled', 'INTEGER DEFAULT 0'],
  // Limites de recurso aplicados também a PROCESSOS (não só a containers).
  // memory_limit em MB e cpu_limit em núcleos são best-effort no processo.
  ['services', 'process_memory_limit', 'INTEGER'],
  ['services', 'process_cpu_limit', 'REAL'],
  // Campos do driver Docker (ver serviceDriverRegistry.js) — todos
  // nulos/com default, então serviços existentes continuam intactos como
  // runtime_type='process' e nunca tocam nessas colunas.
  ['services', 'runtime_type', "TEXT DEFAULT 'process'"],
  ['services', 'docker_host_id', 'INTEGER'],
  ['services', 'image', 'TEXT'],
  ['services', 'container_id', 'TEXT'],
  ['services', 'volumes', "TEXT DEFAULT '[]'"],
  ['services', 'docker_networks', "TEXT DEFAULT '[]'"],
  ['services', 'docker_ports', "TEXT DEFAULT '[]'"],
  ['services', 'cpu_limit', 'REAL'],
  ['services', 'memory_limit', 'INTEGER'],
  // Initial config per-service: git, main file, node packages, args, auto-update, uploads
  ['services', 'git_repo', 'TEXT'],
  ['services', 'git_branch', 'TEXT'],
  ['services', 'git_username', 'TEXT'],
  ['services', 'git_token', 'TEXT'],
  ['services', 'main_file', 'TEXT'],
  ['services', 'node_packages', 'TEXT'],
  ['services', 'unnode_packages', 'TEXT'],
  ['services', 'node_args', 'TEXT'],
  ['services', 'auto_update', 'INTEGER DEFAULT 0'],
  ['services', 'allow_file_uploads', 'INTEGER DEFAULT 0'],
  /**
   * `desired_state` separa o que o usuário QUER ('running'/'stopped') do
   * que está acontecendo agora (`status`).
   *
   * Sem essa separação o auto-resume anunciado no README nunca funcionava:
   * o desligamento gracioso gravava status='stopped' em todos os serviços,
   * e o restoreAll() do boot seguinte procurava justamente por
   * status='running' — ou seja, não encontrava nada. Os serviços só
   * voltavam sozinhos quando o painel morria de forma abrupta (sem chance
   * de gravar 'stopped'), que é o oposto do comportamento esperado.
   *
   * Serviços já existentes herdam desired_state a partir do status atual.
   */
  ['services', 'desired_state', "TEXT DEFAULT 'stopped'"],
  // ── Setup bootstrap (Etapa 2+) ─────────────────────────────────────
  // Comando de inicialização explícito (sobrepõe inferência por main_file).
  ['services', 'startup_command', 'TEXT'],
  // Estado do último setup executado (para UI mostrar progresso/erro).
  ['services', 'setup_status', "TEXT DEFAULT 'idle'"],
  ['services', 'setup_step', "TEXT DEFAULT 'idle'"],
  ['services', 'setup_progress', 'INTEGER DEFAULT 0'],
  ['services', 'setup_error', "TEXT DEFAULT ''"],
  ['services', 'setup_started_at', 'DATETIME'],
  ['services', 'setup_finished_at', 'DATETIME'],
  // db_instances — adições posteriores
  ['db_instances', 'port', 'INTEGER'],
  ['db_instances', 'public_url', 'TEXT'],
  ['db_instances', 'tunnel_hostname', 'TEXT'],
  // Fase 1 — conta e segurança:
  // 2FA TOTP por usuário (segredo fica CIFRADO — secretCipher — mesmo em
  // repouso; os códigos de recuperação guardam apenas hashes SHA-256).
  ['users', 'totp_secret', 'TEXT'],
  ['users', 'totp_enabled', 'INTEGER DEFAULT 0'],
  ['users', 'recovery_codes', "TEXT DEFAULT '[]'"],
  // Auditoria central registra também o IP de origem da ação.
  ['audit_log', 'ip', "TEXT DEFAULT ''"],
];

function collectPendingMigrations(database) {
  const pending = [];
  for (const [table, column, definition] of MIGRATIONS) {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      pending.push([table, column, definition]);
    }
  }
  return pending;
}

/**
 * Copia o arquivo do banco ANTES de aplicar migrações num banco que já
 * existia. Um ADD COLUMN é seguro na prática, mas é exatamente a hora em
 * que um bug vira perda de dados sem volta — e o arquivo é pequeno, então
 * o custo é irrisório. Mantém só os 3 backups mais recentes.
 * (Banco recém-criado não tem arquivo nem nada a perder: nada a copiar.)
 */
function backupDatabaseBeforeMigration(pendingCount) {
  const src = config.DB_PATH;
  if (!fs.existsSync(src)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${src}.mig-backup-${stamp}`;
  fs.copyFileSync(src, dest);
  console.log(`  🛟 backup pré-migração em ${dest} (${pendingCount} coluna(s) a adicionar)`);

  const prefix = `${path.basename(src)}.mig-backup-`;
  const backups = fs
    .readdirSync(path.dirname(src))
    .filter((f) => f.startsWith(prefix))
    .sort();
  while (backups.length > 3) {
    const oldest = backups.shift();
    try {
      fs.unlinkSync(path.join(path.dirname(src), oldest));
    } catch {
      /* sem permissão/arquivo sumiu — retenção é best-effort */
    }
  }
  return dest;
}

function applyMigrations(database, pending) {
  for (const [table, column, definition] of pending) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  ↳ migração: adicionada coluna ${table}.${column}`);
  }
}

/** Cifra in-place uma coluna de segredo que possa estar em texto claro. */
function encryptLegacyColumn(database, table, column) {
  try {
    const rows = database
      .prepare(`SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`)
      .all();
    const update = database.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
    for (const row of rows) {
      if (!cipher.isEncrypted(row.value)) {
        update.run(cipher.encrypt(row.value), row.id);
      }
    }
  } catch {
    // Coluna ainda não existe neste banco legado — as migrações do boot
    // correm DEPOIS do CREATE TABLE mas este helper é chamado só então;
    // qualquer ausência inesperada não pode derrubar a inicialização.
  }
}

async function initDB() {
  // Dois painéis sobre o mesmo panel.db sobrescrevem os dados um do outro
  // a cada flush (o sql.js reserializa o arquivo inteiro, sem coordenação
  // de escritores). O lock exclusivo torna esse erro latente explícito e
  // cedo, com a remediação na própria mensagem (dbLock.js).
  releaseDbLock = acquireDbLock(config.DB_PATH);
  db = await openDatabase(config.DB_PATH);
  db.pragma('foreign_keys = ON');

  // ── Schema ──────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    UNIQUE NOT NULL,
      password_hash TEXT    NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS services (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT    NOT NULL,
      description       TEXT    DEFAULT '',
      type              TEXT    NOT NULL DEFAULT 'node',
      command           TEXT    NOT NULL,
      working_directory TEXT    DEFAULT '',
      environment       TEXT    DEFAULT '{}',
      auto_restart      INTEGER DEFAULT 1,
      restart_delay     INTEGER DEFAULT 3,
      max_restarts      INTEGER DEFAULT 10,
      status            TEXT    DEFAULT 'stopped',
      pid               INTEGER,
      restart_count     INTEGER DEFAULT 0,
      last_started      DATETIME,
      last_stopped      DATETIME,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      port              INTEGER,
      public_url        TEXT
    );

    CREATE TABLE IF NOT EXISTS db_instances (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT    NOT NULL,
      type           TEXT    NOT NULL,
      port           INTEGER NOT NULL,
      data_directory TEXT    DEFAULT '',
      db_username    TEXT    DEFAULT '',
      db_password    TEXT    DEFAULT '',
      status         TEXT    DEFAULT 'stopped',
      pid            INTEGER,
      provisioned    INTEGER DEFAULT 0,
      public_url     TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id      INTEGER,
      db_instance_id  INTEGER,
      level           TEXT    DEFAULT 'info',
      message         TEXT    NOT NULL,
      timestamp       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      action     TEXT NOT NULL,
      target     TEXT NOT NULL,
      detail     TEXT DEFAULT '',
      username   TEXT DEFAULT '',
      timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS docker_hosts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      connection    TEXT    NOT NULL, -- ex: 'unix:///var/run/docker.sock' ou 'tcp://192.168.1.50:2376'
      tls_ca        TEXT    DEFAULT NULL,
      tls_cert      TEXT    DEFAULT NULL,
      tls_key       TEXT    DEFAULT NULL,
      is_default    INTEGER DEFAULT 0,
      last_ping_ok  INTEGER DEFAULT NULL,
      last_ping_at  DATETIME,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS backups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id  INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      filename    TEXT    NOT NULL,
      size_bytes  INTEGER DEFAULT 0,
      status      TEXT    DEFAULT 'creating', -- creating | ready | restoring | failed
      error       TEXT    DEFAULT '',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Sessões JWT revogáveis (Fase 1). Cada token emitido aponta via 'jti'
    -- para uma linha aqui; revogar a linha invalida o token na próxima
    -- requisição, sem esperar a expiração natural do JWT.
    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,          -- jti (uuid)
      user_id      INTEGER NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip           TEXT DEFAULT '',
      user_agent   TEXT DEFAULT '',
      revoked      INTEGER DEFAULT 0
    );

    -- Fila persistente de operacoes longas (Fase 1): backup, restore,
    -- pull de imagem. Estado sobrevive a processo; o boot reconcilia os
    -- zumbis para failed. Detalhes em services/jobQueue.js.
    CREATE TABLE IF NOT EXISTS jobs (
      id          TEXT PRIMARY KEY,   -- uuid
      type        TEXT NOT NULL,
      subject     TEXT DEFAULT '',
      payload     TEXT DEFAULT '{}',
      status      TEXT DEFAULT 'queued', -- queued | running | done | failed | cancelled
      progress    INTEGER DEFAULT 0,
      result      TEXT DEFAULT '',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at  DATETIME,
      finished_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_db      ON logs(db_instance_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_time    ON audit_log(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_backups_service ON backups(service_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status     ON jobs(status, created_at);
  `);

  // ── Migrations (safe on both a fresh DB and an existing one) ────────────
  // Lista declarativa em MIGRATIONS (topo do arquivo). Detectar o que falta
  // ANTES de tocar em qualquer coluna é o que permite copiar o arquivo do
  // banco como estava (backup pré-migração) — sem backup, um bug numa
  // migração futura vira perda de dados sem volta.
  const pendingMigrations = collectPendingMigrations(db);
  if (pendingMigrations.length > 0) {
    backupDatabaseBeforeMigration(pendingMigrations.length);
    applyMigrations(db, pendingMigrations);
  }

  // Serviços já existentes herdam desired_state a partir do status atual
  // (a justificativa completa está documentada na entrada da coluna em
  // MIGRATIONS: sem ela, o auto-resume após shutdown gracioso nunca achava
  // serviço nenhum para retomar).
  db.exec(`
    UPDATE services SET desired_state = CASE WHEN status = 'running' THEN 'running' ELSE 'stopped' END
    WHERE desired_state IS NULL OR desired_state = ''
  `);

  // Logs de setup por serviço (clone/install/build) — ficam persistidos
  // pra poder reabrir o serviço depois e ver o que aconteceu.
  db.exec(`
    CREATE TABLE IF NOT EXISTS setup_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL,
      stream     TEXT DEFAULT 'info',
      message    TEXT NOT NULL,
      timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_setup_logs_service ON setup_logs(service_id, id);
  `);

  // Tunnels don't survive a panel restart (cloudflared isn't running
  // anymore), so any public_url left over from before this boot is stale —
  // showing it would be actively misleading, not just outdated.
  db.exec("UPDATE services SET public_url = NULL WHERE public_url IS NOT NULL");
  db.exec("UPDATE db_instances SET public_url = NULL WHERE public_url IS NOT NULL");

  // Default settings
  const defaults = [
    ['panel_name', 'Pterodroid'],
    ['panel_color', '#4f8ef7'],
    ['log_retention_days', '7'],
    ['setup_done', 'false'],
    // Webhook de alerta de queda (Telegram/qualquer endpoint). Vazio = off.
    ['alert_webhook_url', ''],
  ];
  const upsert = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) upsert.run(k, v);

  // ── Cifra de segredos legados (não cifrados) ──────────────────────────
  // Um banco já existente pode ter segredos em texto claro. Cifrar aqui,
  // no boot, migra os valores sem exigir ação do usuário. Valores já
  // cifrados (com o prefixo enc:) são pulados.
  encryptLegacyColumn(db, 'services', 'git_token');
  // Fase 1: cobertura estendida a senhas de banco, chaves TLS do Docker e
  // token do Cloudflare Tunnel (achados D2 do plano de validação).
  encryptLegacyColumn(db, 'db_instances', 'db_password');
  encryptLegacyColumn(db, 'docker_hosts', 'tls_ca');
  encryptLegacyColumn(db, 'docker_hosts', 'tls_cert');
  encryptLegacyColumn(db, 'docker_hosts', 'tls_key');

  // O token do túnel nomeado mora na tabela settings (chave/valor).
  const legacyTunnel = db.prepare("SELECT value FROM settings WHERE key = 'named_tunnel_token'").get();
  if (legacyTunnel?.value && !cipher.isEncrypted(legacyTunnel.value)) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'named_tunnel_token'")
      .run(cipher.encrypt(legacyTunnel.value));
  }

  // default ao cadastrar novas variáveis de ambiente fica como está; a
  // cifra é aplicada nas rotas/services no ponto de escrita, e decifrada
  // no ponto de leitura (processManager/dbInstanceManager).

  // Default admin user if none exists
  const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!existing) {
    const hash = await bcrypt.hash('admin', 10);
    db.prepare('INSERT INTO users(username, password_hash) VALUES (?, ?)').run('admin', hash);
    console.log('🔐 Default user created → username: admin / password: admin  (change this!)');
  }

  db.flush();
  console.log('💾 Database ready:', config.DB_PATH);
  return db;
}

/**
 * Fecha o banco (com flush final) e libera o lock exclusivo. Usado pelos
 * testes de integração e pelo desligamento gracioso do servidor.
 */
function closeDB() {
  try {
    if (db) db.close();
  } finally {
    db = null;
    if (releaseDbLock) {
      releaseDbLock();
      releaseDbLock = null;
    }
  }
}

module.exports = {
  initDB,
  getDB,
  closeDB,
  // Exposto para os testes de migração (tests/migration-backup-test.js) —
  // não faz parte da API usada pelas rotas.
  _internal: { MIGRATIONS, collectPendingMigrations, backupDatabaseBeforeMigration },
};
