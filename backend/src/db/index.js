const bcrypt = require('bcryptjs');
const config = require('../config');
const { openDatabase } = require('./sqliteCompat');

let db;

function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
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
