const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load backend/.env if present. Explicit path so this works regardless of
// the cwd the process was launched from (panelctl.sh always cds into
// backend/ first, but this makes `node src/server.js` from anywhere safe too).
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DATA_ROOT = process.env.DATA_ROOT || path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_ROOT)) fs.mkdirSync(DATA_ROOT, { recursive: true });

/**
 * JWT_SECRET: use the env var if the person set one. Otherwise, generate a
 * random secret once and persist it to disk so it survives restarts (a
 * secret that regenerated every boot would silently log everyone out every
 * time the panel restarts). This is safer than a hardcoded fallback shared
 * by every install of this codebase.
 */
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  const secretFile = path.join(DATA_ROOT, '.jwt-secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();

  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  console.log('🔑 Generated a new JWT secret and saved it to data/.jwt-secret');
  return generated;
}

module.exports = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  JWT_SECRET: resolveJwtSecret(),
  JWT_EXPIRES: '7d',
  DATA_ROOT,
  DB_PATH: process.env.DB_PATH || path.join(DATA_ROOT, 'panel.db'),
  DATABASES_ROOT: path.join(DATA_ROOT, 'databases'),
  PROJECTS_ROOT: process.env.PROJECTS_ROOT || path.join(process.env.HOME || DATA_ROOT, 'pterodroid-projects'),
  LOG_MAX_MEMORY: parseInt(process.env.LOG_MAX_MEMORY || '500', 10),
  LOG_MAX_DB: parseInt(process.env.LOG_MAX_DB || '1000', 10),
  RESTART_MAX: 10,         // consecutive auto-restarts before giving up
  RESTART_DELAY: 3,        // seconds before auto-restart
  SIGTERM_WAIT: 5000,      // ms to wait after SIGTERM before SIGKILL
  DB_FLUSH_DEBOUNCE: 1000, // ms — how often panel.db is written to disk
  CLOUDFLARED_BIN: process.env.CLOUDFLARED_BIN || 'cloudflared',
};
