const fs = require('fs');
const { execSync } = require('child_process');

// Debian/Ubuntu's postgresql package (including inside Ubuntu-proot) installs
// versioned, off-PATH binaries at /usr/lib/postgresql/<version>/bin/ so
// multiple server versions can coexist. Termux's package puts them straight
// on PATH, so this fallback only ever fires on the Debian/Ubuntu side.
const VERSIONED_DIRS = ['/usr/lib/postgresql'];

/**
 * Returns the first binary from `candidates` that can be found — either a
 * bare name resolvable on PATH, or a full path discovered under a known
 * versioned-install directory. Returns null if nothing matches.
 */
function findBinary(candidates) {
  for (const name of candidates) {
    try {
      const out = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (out) return name;
    } catch {
      // not found on PATH, keep looking
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
