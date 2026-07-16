const bcrypt = require('bcryptjs');
const config = require('../config');
const { openDatabase } = require('./sqliteCompat');

let db;

function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

/**
 * CREATE TABLE IF NOT EXISTS only helps on a brand-new database — it does
 * nothing to a table that already exists but predates a newer column. This
 * adds that column if it's missing, so panel.db from an older version of
 * the app upgrades in place instead of needing to be deleted.
 */
function ensureColumn(database, table, column, definition) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  ↳ migração: adicionada coluna ${table}.${column}`);
  }
}

async function initDB() {
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

    CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_db      ON logs(db_instance_id, timestamp DESC);
  `);

  // ── Migrations (safe on both a fresh DB and an existing one) ────────────
  ensureColumn(db, 'services', 'port', 'INTEGER');
  ensureColumn(db, 'services', 'public_url', 'TEXT');
  ensureColumn(db, 'services', 'scaffolded_directory', 'INTEGER DEFAULT 0');
  ensureColumn(db, 'db_instances', 'port', 'INTEGER');
  ensureColumn(db, 'db_instances', 'public_url', 'TEXT');

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
  ];
  const upsert = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) upsert.run(k, v);

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

module.exports = { initDB, getDB };
