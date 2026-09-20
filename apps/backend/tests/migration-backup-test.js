'use strict';
/**
 * Testa o backup pré-migração do panel.db (src/db/index.js):
 *  1. um banco "antigo" (sem as colunas migradas) é copiado ANTES de
 *     qualquer ALTER TABLE;
 *  2. o backup contém o schema PRÉ-migração e o banco vivo segue completo;
 *  3. os dados existentes atravessam a migração intactos;
 *  4. boot seguinte sem nada pendente NÃO gera backup;
 *  5. a retenção mantém só os 3 backups mais recentes.
 *
 * Roda num DATA_ROOT temporário: nunca toca no painel real.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ptero-migbak-'));
const DB_PATH = path.join(ROOT, 'panel.db');

process.env.DATA_ROOT = ROOT;
process.env.DB_PATH = DB_PATH;
process.env.WORKSPACES_ROOT = path.join(ROOT, 'workspaces');
process.env.FILES_ROOT = path.join(ROOT, 'workspaces');
process.env.JWT_SECRET = 'migration-backup-test';

const backupFiles = () =>
  fs.readdirSync(ROOT).filter((f) => f.startsWith('panel.db.mig-backup-')).sort();

function freshDbModule() {
  // O módulo de banco é singleton por require; cada "boot" do painel no
  // teste precisa de uma instância limpa (o lock é liberado via closeDB).
  delete require.cache[require.resolve('../src/db')];
  return require('../src/db');
}

async function main() {
  // ── Banco legado: schema da v1 do painel (pré-migrações), sem as ────────
  // colunas adicionadas depois (port, recipe, desired_state, docker...). ──
  const { openDatabase } = require('../src/db/sqliteCompat');
  const legacy = await openDatabase(DB_PATH);
  legacy.exec(`
    CREATE TABLE services (
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
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  legacy.prepare('INSERT INTO services(name, command) VALUES (?, ?)').run('legado', 'node app.js');
  legacy.close();
  assert.ok(fs.existsSync(DB_PATH), 'banco legado deveria estar no disco');

  // ── Boot 1: migrações pendentes → backup obrigatório ANTES de migrar ───
  const boot1 = freshDbModule();
  await boot1.initDB();
  const afterFirst = backupFiles();
  assert.strictEqual(afterFirst.length, 1, `esperava 1 backup pré-migração, achei ${afterFirst.length}`);
  console.log('  PASS: backup criado antes de migrar banco legado');

  // O backup é o estado PRÉ-migração: sem a coluna 'port'.
  const backup = await openDatabase(path.join(ROOT, afterFirst[0]));
  const backupCols = backup.prepare('PRAGMA table_info(services)').all().map((c) => c.name);
  assert.ok(!backupCols.includes('port'), "backup deveria ser pré-migração (sem coluna 'port')");
  backup.close();
  console.log('  PASS: backup contém o schema anterior à migração');

  // Banco vivo: schema completo + dados preservados.
  const db = boot1.getDB();
  const liveCols = db.prepare('PRAGMA table_info(services)').all().map((c) => c.name);
  assert.ok(liveCols.includes('port'), "banco vivo deveria ter a coluna 'port'");
  const row = db.prepare('SELECT name, command, type FROM services WHERE name = ?').get('legado');
  assert.deepStrictEqual(
    { name: row.name, command: row.command, type: row.type },
    { name: 'legado', command: 'node app.js', type: 'node' },
    'dados existentes devem atravessar a migração intactos (defaults aplicados)',
  );
  console.log('  PASS: dados preservados através da migração');
  boot1.closeDB();

  // ── Boot 2: nada pendente → nenhum backup novo ─────────────────────────
  const boot2 = freshDbModule();
  await boot2.initDB();
  assert.strictEqual(backupFiles().length, 1, 'boot limpo não deve gerar backup pré-migração');
  console.log('  PASS: boot sem migrações pendentes não gera backup');
  boot2.closeDB();

  // ── Retenção: só os 3 mais recentes ficam no disco ─────────────────────
  for (let i = 1; i <= 4; i += 1) {
    fs.writeFileSync(path.join(ROOT, `panel.db.mig-backup-2026-01-0${i}T00-00-00-000Z`), 'x');
  }
  const { _internal } = require('../src/db');
  _internal.backupDatabaseBeforeMigration(1); // cria mais um (data atual) e poda
  const kept = backupFiles();
  assert.strictEqual(kept.length, 3, `retenção deveria manter 3 backups, manteve ${kept.length}`);
  assert.ok(kept.every((f) => !f.includes('2026-01-01') && !f.includes('2026-01-02')),
    'os backups mais antigos deveriam ter sido podados primeiro');
  console.log('  PASS: retenção mantém apenas os 3 backups mais recentes');

  console.log('backup pré-migração: proteção, preservação, idempotência e retenção passaram');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
