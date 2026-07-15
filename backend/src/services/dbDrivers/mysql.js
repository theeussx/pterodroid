/**
 * MySQL/MariaDB driver.
 * MariaDB is available via `pkg install mariadb` on Termux, but its
 * first-run auth bootstrap is known to be finicky there (the Android app
 * user doesn't map to a Unix account MariaDB recognizes, so
 * mysql_secure_installation can't run normally). The workaround used below
 * — start once with --skip-grant-tables, set credentials over the client,
 * stop, then start normally — is the same fix documented by Termux users
 * hitting this. Treat this driver as best-effort; PostgreSQL is steadier
 * on this platform.
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { findBinary, escapeSqlLiteral, waitForFile } = require('./common');

module.exports = {
  type: 'mysql',
  label: 'MySQL / MariaDB',
  defaultPort: 3306,

  checkAvailable() {
    const server = findBinary(['mariadbd', 'mysqld']);
    const init = findBinary(['mariadb-install-db', 'mysql_install_db']);
    const client = findBinary(['mariadb', 'mysql']);
    if (!server || !init || !client) {
      return {
        ok: false,
        message:
          "MySQL/MariaDB not found. Install with 'pkg install mariadb' (Termux) or " +
          "'apt install mariadb-server' (Ubuntu proot).",
      };
    }
    return { ok: true, server, init, client };
  },

  async provision({ dataDirectory, dbUsername, dbPassword, port }) {
    const check = this.checkAvailable();
    if (!check.ok) throw new Error(check.message);

    if (process.getuid && process.getuid() === 0) {
      throw new Error(
        'MariaDB refuses to run as root. In Ubuntu-proot, create a regular ' +
        'non-root user and run the panel as that user.'
      );
    }

    if (!fs.existsSync(dataDirectory)) fs.mkdirSync(dataDirectory, { recursive: true });

    // Phase 1 — create system tables.
    try {
      execSync(`${check.init} --datadir="${dataDirectory}"`, { encoding: 'utf8', timeout: 90000 });
    } catch (err) {
      throw new Error(`${check.init} failed: ${err.stderr || err.message}`);
    }

    // Phase 2 — bootstrap: start with grant tables disabled, set real
    // credentials over the socket, then shut the bootstrap instance down.
    const socket = path.join(dataDirectory, 'mysql.sock');
    const pidFile = path.join(dataDirectory, 'mysqld.pid');
    let boot;
    let bootErrOutput = '';

    try {
      boot = spawn(check.server, [
        '--datadir', dataDirectory,
        '--socket', socket,
        '--pid-file', pidFile,
        '--skip-grant-tables',
        '--skip-networking',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      boot.stdout.on('data', (d) => { bootErrOutput += d.toString(); });
      boot.stderr.on('data', (d) => { bootErrOutput += d.toString(); });
      boot.once('exit', (code) => {
        if (code !== 0 && code !== null) {
          bootErrOutput += `\n(bootstrap process exited early with code ${code})`;
        }
      });

      try {
        await waitForFile(socket, 15000);
      } catch (timeoutErr) {
        throw new Error(bootErrOutput.trim() || timeoutErr.message);
      }

      const userClause = dbUsername && dbUsername !== 'root'
        ? `CREATE USER IF NOT EXISTS '${escapeSqlLiteral(dbUsername)}'@'%' IDENTIFIED BY '${escapeSqlLiteral(dbPassword)}'; ` +
          `GRANT ALL PRIVILEGES ON *.* TO '${escapeSqlLiteral(dbUsername)}'@'%'; `
        : '';
      const sql =
        // Under --skip-grant-tables, MariaDB blocks ALTER/CREATE USER
        // statements until you FLUSH PRIVILEGES once first — the documented
        // recovery-mode dance. This flush does NOT turn auth checks back
        // on for the current session, it only lifts that specific block.
        'FLUSH PRIVILEGES; ' +
        // mariadb-install-db also creates anonymous ''@'localhost' (and
        // ''@<hostname>) users by default. Because MariaDB's auth matching
        // sorts by host specificity first, that anonymous row shadows ANY
        // real user — including the one we're about to create — when
        // connecting from localhost or a unix socket. Remove it, same as
        // mysql_secure_installation does.
        "DELETE FROM mysql.user WHERE User=''; " +
        `ALTER USER 'root'@'localhost' IDENTIFIED BY '${escapeSqlLiteral(dbPassword)}'; ` +
        userClause +
        'FLUSH PRIVILEGES;';

      execSync(`${check.client} --socket="${socket}" -u root -e "${sql}"`, {
        encoding: 'utf8', timeout: 15000,
      });
    } catch (err) {
      throw new Error(`MariaDB credential bootstrap failed: ${err.stderr || err.message}`);
    } finally {
      if (boot && !boot.killed) {
        boot.kill('SIGTERM');
        await new Promise((resolve) => {
          const t = setTimeout(resolve, 5000);
          boot.once('exit', () => { clearTimeout(t); resolve(); });
        });
      }
    }
  },

  buildStartCommand({ dataDirectory, port }) {
    const check = this.checkAvailable();
    if (!check.ok) throw new Error(check.message);
    return {
      cmd: check.server,
      args: [
        '--datadir', dataDirectory,
        '--socket', path.join(dataDirectory, 'mysql.sock'),
        '--pid-file', path.join(dataDirectory, 'mysqld.pid'),
        '--port', String(port),
      ],
    };
  },

  // Unlike postgres, mysqld/mariadbd's default SIGTERM handler already
  // performs a prompt, clean shutdown — no special-casing needed.
  stopSignal: 'SIGTERM',
};
