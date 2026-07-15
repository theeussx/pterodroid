/**
 * Thin sync-style wrapper around sql.js (SQLite compiled to WASM).
 *
 * WHY sql.js instead of better-sqlite3:
 * better-sqlite3 ships a native addon that must be compiled with node-gyp
 * on install. Termux (and Ubuntu-proot on Android) frequently lacks a
 * working native toolchain, so that install step fails. sql.js is SQLite
 * compiled to WebAssembly — it runs anywhere Node's V8 runs, no compiler
 * needed. The tradeoff: sql.js keeps the whole DB in memory and we persist
 * it to disk ourselves. For a personal panel (services, db instances,
 * settings, a bounded log table) the data volume is small, so this is a
 * good trade. Writes are debounced so we're not serializing the full DB
 * file on every single query.
 *
 * This wrapper exposes the same shape the rest of the codebase uses:
 *   db.prepare(sql).get(...params)
 *   db.prepare(sql).all(...params)
 *   db.prepare(sql).run(...params)  -> { lastInsertRowid, changes }
 *   db.exec(sqlScript)
 *   db.pragma(pragmaBody)
 *   db.flush() / db.close()
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

class Statement {
  constructor(rawDb, sql, scheduleFlush) {
    this.rawDb = rawDb;
    this.sql = sql;
    this.scheduleFlush = scheduleFlush;
  }

  get(...params) {
    const stmt = this.rawDb.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params);
      return stmt.step() ? stmt.getAsObject() : undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params) {
    const stmt = this.rawDb.prepare(this.sql);
    const rows = [];
    try {
      if (params.length) stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return rows;
  }

  run(...params) {
    const stmt = this.rawDb.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }

    let lastInsertRowid;
    const idRes = this.rawDb.exec('SELECT last_insert_rowid() AS id');
    if (idRes.length) lastInsertRowid = idRes[0].values[0][0];

    const changes = this.rawDb.getRowsModified();
    this.scheduleFlush();
    return { lastInsertRowid, changes };
  }
}

class CompatDB {
  constructor(rawDb, filePath) {
    this.raw = rawDb;
    this.filePath = filePath;
    this._dirty = false;
    this._timer = null;
  }

  prepare(sql) {
    return new Statement(this.raw, sql, () => this._scheduleFlush());
  }

  /** Run a (possibly multi-statement) SQL script with no return value. */
  exec(sqlScript) {
    this.raw.run(sqlScript);
    this._scheduleFlush();
  }

  /** No-op-safe pragma passthrough (kept for API familiarity). */
  pragma(body) {
    try { this.raw.run(`PRAGMA ${body}`); } catch { /* not all pragmas apply under WASM */ }
  }

  _scheduleFlush() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => this.flush(), require('../config').DB_FLUSH_DEBOUNCE);
  }

  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (!this._dirty) return;
    const bytes = this.raw.export();
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(bytes));
    fs.renameSync(tmp, this.filePath); // atomic-ish swap, avoids truncated file on crash
    this._dirty = false;
  }

  close() {
    this.flush();
    this.raw.close();
  }
}

async function openDatabase(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs({
    // Force resolution to the wasm file shipped inside node_modules,
    // rather than relying on sql.js's default (browser-oriented) lookup.
    locateFile: (file) => path.join(__dirname, '../../node_modules/sql.js/dist', file),
  });

  const rawDb = fs.existsSync(filePath)
    ? new SQL.Database(fs.readFileSync(filePath))
    : new SQL.Database();

  return new CompatDB(rawDb, filePath);
}

module.exports = { openDatabase };
