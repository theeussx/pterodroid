const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load backend/.env if present. Explicit path so this works regardless of
// the cwd the process was launched from (panelctl.sh always cds into
// backend/ first, but this makes `node src/server.js` from anywhere safe too).
require('dotenv').config({ path: path.join(__dirname, '../.env') });

function toAbsolute(value, fallback) {
  const raw = (value || '').trim();
  if (!raw) return fallback;
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(raw);
}

const DATA_ROOT = toAbsolute(process.env.DATA_ROOT, path.join(__dirname, '../../data'));

/**
 * WORKSPACES_ROOT — a ÚNICA raiz de onde todo caminho de projeto é
 * resolvido (Etapa 2 do plano de estabilização). Cada serviço ganha um
 * subdiretório exclusivo aqui dentro:
 *
 *   workspaces/
 *     node-api/
 *     discord-bot/
 *     minecraft/
 *
 * Nada no código deve montar caminho de projeto de outro jeito — quem
 * precisa de um caminho pede pro workspaceManager.js.
 *
 * PROJECTS_ROOT continua aceito como alias pra não quebrar instalações
 * que já configuraram essa variável.
 */
const WORKSPACES_ROOT = toAbsolute(
  process.env.WORKSPACES_ROOT || process.env.PROJECTS_ROOT,
  path.join(DATA_ROOT, 'workspaces'),
);

/**
 * FILES_ROOT — raiz do gerenciador de arquivos global. O padrão é a
 * própria raiz de workspaces: assim a aba "Arquivos" mostra exatamente os
 * mesmos arquivos que a aba de arquivos de cada serviço, em vez de duas
 * árvores desconexas (era um dos bugs mais confusos da versão anterior).
 * Quem quiser navegar o $HOME inteiro pode apontar FILES_ROOT pra lá.
 */
const FILES_ROOT = toAbsolute(process.env.FILES_ROOT, WORKSPACES_ROOT);

/**
 * HOST_WORKSPACES_ROOT — só importa quando o PAINEL roda dentro de um
 * container e cria outros containers via /var/run/docker.sock. Nesse caso
 * um bind mount precisa do caminho como o DAEMON o enxerga (host), não
 * como o painel enxerga (dentro do container). Sem isso o Docker cria uma
 * pasta vazia no host e o container sobe sem os arquivos do projeto.
 */
const HOST_WORKSPACES_ROOT = (process.env.HOST_WORKSPACES_ROOT || '').trim() || null;

/**
 * BACKUPS_ROOT — onde os .zip de backup de cada serviço ficam guardados.
 * Fica FORA de WORKSPACES_ROOT de propósito: um backup nunca pode acabar
 * incluído dentro de si mesmo, nem ser varrido/apagado junto quando se
 * limpa a pasta de um serviço.
 */
const BACKUPS_ROOT = toAbsolute(process.env.BACKUPS_ROOT, path.join(DATA_ROOT, 'backups'));

// Diretórios que o painel precisa que existam pra funcionar. Criar aqui
// (e não sob demanda em cada módulo) evita o clássico "ENOENT na primeira
// vez que alguém abre a tela de arquivos num install limpo".
for (const dir of [DATA_ROOT, WORKSPACES_ROOT, FILES_ROOT, BACKUPS_ROOT]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`[config] não foi possível criar ${dir}: ${err.message}`);
  }
}

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
  BACKUPS_ROOT,
  MAX_BACKUPS_PER_SERVICE: parseInt(process.env.MAX_BACKUPS_PER_SERVICE || '10', 10),
  WORKSPACES_ROOT,
  HOST_WORKSPACES_ROOT,
  // Alias histórico — vários módulos/instalações ainda falam "projects".
  PROJECTS_ROOT: WORKSPACES_ROOT,
  CLOUDFLARED_DIR: path.join(DATA_ROOT, 'cloudflared'),
  FILES_ROOT,
  UPLOAD_MAX_BYTES: parseInt(process.env.UPLOAD_MAX_BYTES || String(2 * 1024 * 1024 * 1024), 10), // 2GB
  EDITOR_MAX_BYTES: parseInt(process.env.EDITOR_MAX_BYTES || String(2 * 1024 * 1024), 10), // 2MB
  // Corpo JSON: precisa caber um arquivo do tamanho máximo do editor + folga
  // pro overhead de escapes do JSON, senão salvar um arquivo grande no
  // editor devolve 413/500 (era o caso: limite default de 100kb do Express).
  JSON_BODY_LIMIT: process.env.JSON_BODY_LIMIT || '8mb',
  LOG_MAX_MEMORY: parseInt(process.env.LOG_MAX_MEMORY || '500', 10),
  LOG_MAX_DB: parseInt(process.env.LOG_MAX_DB || '1000', 10),
  LOG_PRUNE_INTERVAL_MS: parseInt(process.env.LOG_PRUNE_INTERVAL_MS || String(30 * 60 * 1000), 10),
  RESTART_MAX: 10,         // consecutive auto-restarts before giving up
  RESTART_DELAY: 3,        // seconds before auto-restart
  // Tempo que um serviço precisa ficar de pé pra ser considerado estável e
  // ter o contador de reinícios zerado — sem isso um serviço que reinicia
  // uma vez por semana acaba esgotando max_restarts meses depois.
  RESTART_STABLE_MS: parseInt(process.env.RESTART_STABLE_MS || '60000', 10),
  SIGTERM_WAIT: 5000,      // ms to wait after SIGTERM before SIGKILL
  DB_FLUSH_DEBOUNCE: 1000, // ms — how often panel.db is written to disk
  CLOUDFLARED_BIN: process.env.CLOUDFLARED_BIN || 'cloudflared',
  // Atalho pra um único host Docker via env, no mesmo formato que a CLI do
  // Docker usa (DOCKER_HOST) — útil pra quem só tem uma máquina Docker e
  // não quer cadastrar nada pela UI. Hosts adicionais sempre passam pela
  // tabela docker_hosts (ver dockerHostManager.js), não por aqui.
  DOCKER_DEFAULT_HOST: process.env.DOCKER_HOST || null,
  DOCKER_API_VERSION: process.env.DOCKER_API_VERSION || 'v1.43',
};
