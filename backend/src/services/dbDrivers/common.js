const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Debian/Ubuntu's postgresql package (including inside Ubuntu-proot) installs
// versioned, off-PATH binaries at /usr/lib/postgresql/<version>/bin/ so
// multiple server versions can coexist. Termux's package puts them straight
// on PATH, so this fallback only ever fires on the Debian/Ubuntu side.
const VERSIONED_DIRS = ['/usr/lib/postgresql'];

/**
 * Returns the first binary from `candidates` that can be found. Tries three
 * strategies, each a fallback for the one before it:
 *   1. `command -v` — a POSIX *shell builtin*, not an external program.
 *      Unlike `which`, it can't be "not installed": every sh/bash has it.
 *      (Termux does NOT ship `which` by default, which is exactly why the
 *      old `which`-based check here reported postgres/mariadb as missing
 *      even after `pkg install` — command -v has no such gap.)
 *   2. A manual scan of $PATH directories, pure Node/fs, no shell at all —
 *      belt-and-suspenders in case `execSync`'s shell is unusual.
 *   3. Known versioned install dirs (Debian/Ubuntu postgresql layout).
 */
function findBinary(candidates) {
  for (const name of candidates) {
    try {
      const out = execSync(`command -v ${name} 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (out) return name;
    } catch {
      // not found via shell builtin, keep looking
    }
  }

  const pathDirs = (process.env.PATH || '').split(':').filter(Boolean);
  for (const name of candidates) {
    for (const dir of pathDirs) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // not here, keep looking
      }
    }
  }

  for (const baseDir of VERSIONED_DIRS) {
    if (!fs.existsSync(baseDir)) continue;
    let versions;
    try { versions = fs.readdirSync(baseDir).sort().reverse(); } catch { continue; }
    for (const version of versions) {
      for (const name of candidates) {
        const full = `${baseDir}/${version}/bin/${name}`;
        if (fs.existsSync(full)) return full;
      }
    }
  }

  return null;
}

function escapeSqlLiteral(str) {
  return String(str).replace(/'/g, "''");
}

function waitForFile(filePath, timeoutMs) {
  const fs = require('fs');
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (fs.existsSync(filePath)) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${filePath}`));
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

module.exports = { findBinary, escapeSqlLiteral, waitForFile };
