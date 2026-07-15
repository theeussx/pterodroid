const path = require('path');

const DATA_ROOT = process.env.DATA_ROOT || path.join(__dirname, '../../data');

module.exports = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  JWT_SECRET: process.env.JWT_SECRET
  JWT_EXPIRES: '7d',
  DATA_ROOT,
  DB_PATH: process.env.DB_PATH || path.join(DATA_ROOT, 'panel.db'),
  DATABASES_ROOT: path.join(DATA_ROOT, 'databases'),
  LOG_MAX_MEMORY: 500,     // lines per service kept in RAM (ring buffer)
  LOG_MAX_DB: 1000,        // rows per service kept in SQLite
  RESTART_MAX: 10,         // consecutive auto-restarts before giving up
  RESTART_DELAY: 3,        // seconds before auto-restart
  SIGTERM_WAIT: 5000,      // ms to wait after SIGTERM before SIGKILL
  DB_FLUSH_DEBOUNCE: 1000, // ms — how often panel.db is written to disk
};
