/**
 * Auto-scaffolds a dedicated project folder for a new service when the
 * admin doesn't point it at an existing directory themselves — the
 * "container" for a service's own files, living under PROJECTS_ROOT
 * (default: ~/pterodroid-projects) instead of scattered loose in $HOME.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

function slugify(name) {
  const slug = String(name)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents (ó, ã, ç...)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'projeto';
}

/** Creates and returns a unique, empty directory under PROJECTS_ROOT for `name`. */
function scaffoldProjectDir(name) {
  if (!fs.existsSync(config.PROJECTS_ROOT)) fs.mkdirSync(config.PROJECTS_ROOT, { recursive: true });

  const base = slugify(name);
  let dir = path.join(config.PROJECTS_ROOT, base);
  let n = 1;
  while (fs.existsSync(dir)) {
    n += 1;
    dir = path.join(config.PROJECTS_ROOT, `${base}-${n}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Only ever removes a directory the panel itself created — never a
 * user-supplied working_directory, even if asked to. */
function removeScaffoldedDir(dir) {
  if (!dir) return;
  const resolved = path.resolve(dir);
  const root = path.resolve(config.PROJECTS_ROOT);
  if (resolved !== root && resolved.startsWith(root + path.sep)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

module.exports = { scaffoldProjectDir, removeScaffoldedDir, slugify };
