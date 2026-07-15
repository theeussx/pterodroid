/**
 * PostgreSQL driver.
 * Confirmed available as an official Termux package (`pkg install postgresql`)
 * and via `apt install postgresql` on Ubuntu-proot. This is the more
 * battle-tested of the two engines in this environment.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { findBinary } = require('./common');

module.exports = {
  type: 'postgresql',
  label: 'PostgreSQL',
  defaultPort: 5432,

  checkAvailable() {
    const server = findBinary(['postgres']);
    const init = findBinary(['initdb']);
    if (!server || !init) {
      return {
        ok: false,
        message:
          "PostgreSQL not found. Install with 'pkg install postgresql' (Termux) or " +
          "'apt install postgresql' (Ubuntu proot).",
      };
    }
    return { ok: true, server, init };
  },

  /** One-time setup: create the data directory and a password-auth superuser. */
  async provision({ dataDirectory, dbUsername, dbPassword }) {
    const check = this.checkAvailable();
    if (!check.ok) throw new Error(check.message);

    if (process.getuid && process.getuid() === 0) {
      throw new Error(
        'PostgreSQL refuses to run as root. In Ubuntu-proot, create a regular ' +
        'non-root user and run the panel as that user.'
      );
    }

    // initdb creates the leaf data directory itself and insists it be empty
    // or not exist yet — only ensure the *parent* is there.
    const parentDir = path.dirname(dataDirectory);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    // The one-time password file must live OUTSIDE the data directory —
    // even a dot-prefixed file inside it makes initdb see a "non-empty"
    // target and refuse to run.
    const pwFile = path.join(require('os').tmpdir(), `pg-initpw-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(pwFile, `${dbPassword}\n`, { mode: 0o600 });

    try {
      execSync(
        `${check.init} -D "${dataDirectory}" -U "${dbUsername}" --auth=scram-sha-256 --pwfile="${pwFile}"`,
        { encoding: 'utf8', timeout: 60000 }
      );
    } catch (err) {
      throw new Error(`initdb failed: ${err.stderr || err.message}`);
    } finally {
      fs.rmSync(pwFile, { force: true });
    }
  },

  buildStartCommand({ dataDirectory, port }) {
    const check = this.checkAvailable();
    if (!check.ok) throw new Error(check.message);
    // -k points the unix socket at the instance's own data dir, so multiple
    // instances never collide on the default socket path.
    return { cmd: check.server, args: ['-D', dataDirectory, '-p', String(port), '-k', dataDirectory] };
  },

  // SIGINT = pg_ctl "fast" shutdown: rolls back open transactions and exits
  // promptly. SIGTERM ("smart") waits indefinitely for clients to disconnect
  // on their own, which can hang a Stop button — not what we want here.
  stopSignal: 'SIGINT',
};
