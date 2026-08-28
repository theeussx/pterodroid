'use strict';
/**
 * WorkspaceManager — a ÚNICA fonte de verdade para caminhos de projeto.
 *
 * Regra da Etapa 2: o backend conhece **um** diretório raiz configurável
 * (config.WORKSPACES_ROOT) e toda resolução de caminho parte dele. Nenhum
 * outro módulo deve montar caminho de workspace na mão, e nenhum caminho
 * fixo tipo `/home/appuser/projects` sobrevive aqui.
 *
 *   <WORKSPACES_ROOT>/
 *     node-api/
 *     discord-bot/
 *     postgres/
 *
 * Responsabilidades:
 *  - derivar um nome de pasta seguro a partir do nome do serviço;
 *  - garantir que a pasta exista (criando sob demanda, nunca falhando
 *    porque "o workspace sumiu");
 *  - traduzir caminho-do-painel ⇄ caminho-do-host pra bind mounts quando o
 *    próprio painel roda dentro de um container;
 *  - remover workspaces com segurança (só o que está sob a raiz).
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

/** Nome de pasta seguro: sem acento, sem espaço, sem separador de caminho. */
function slugify(name, fallback = 'app') {
  const slug = String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // ó, ã, ç → o, a, c
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

function workspacesRoot() {
  return path.resolve(config.WORKSPACES_ROOT);
}

/** Cria a raiz de workspaces se ainda não existir. Idempotente e barato. */
function ensureRoot() {
  const root = workspacesRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** true se `dir` está dentro da raiz de workspaces (a própria raiz não conta). */
function isInsideRoot(dir) {
  if (!dir) return false;
  const root = workspacesRoot();
  const resolved = path.resolve(dir);
  return resolved !== root && resolved.startsWith(root + path.sep);
}

/**
 * Caminho do workspace de um serviço a partir do nome, sem tocar no disco.
 * Determinístico: o mesmo nome sempre devolve a mesma pasta.
 */
function pathForName(name) {
  return path.join(workspacesRoot(), slugify(name));
}

/**
 * Reserva um caminho de workspace ainda não utilizado.
 * `node-api` já existe? devolve `node-api-2`, e assim por diante — dois
 * serviços com o mesmo nome nunca compartilham arquivos por acidente.
 */
function reservePath(name) {
  ensureRoot();
  const base = slugify(name);
  let candidate = path.join(workspacesRoot(), base);
  let n = 1;
  while (fs.existsSync(candidate)) {
    n += 1;
    candidate = path.join(workspacesRoot(), `${base}-${n}`);
  }
  return candidate;
}

/**
 * Garante que o diretório exista e devolve o caminho absoluto.
 * Chamado antes de iniciar qualquer serviço: se o usuário apagou a pasta
 * por fora, ela volta a existir em vez de o start explodir com ENOENT
 * (requisito explícito da Etapa 3).
 */
function ensureDir(dir) {
  const target = path.resolve(dir);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

/** Cria (se preciso) e devolve o workspace exclusivo de um serviço. */
function createForService(name) {
  return ensureDir(reservePath(name));
}

/**
 * Normaliza o `working_directory` vindo do banco ou do formulário.
 *  - vazio            → null (quem chama decide criar um)
 *  - relativo         → resolvido a partir da raiz de workspaces
 *  - absoluto legado  → remapeado pra raiz atual quando aponta pra um
 *                       layout antigo que não existe mais
 *  - absoluto válido  → mantido (usuário pode apontar pra onde quiser)
 */
const LEGACY_PREFIXES = [
  '/home/appuser/projects',
  '/workspaces/pterodroid/data/projects',
];

function normalize(dir) {
  const trimmed = (dir || '').trim();
  if (!trimmed) return null;

  const root = workspacesRoot();

  for (const legacy of LEGACY_PREFIXES) {
    if (trimmed === legacy) return root;
    if (trimmed.startsWith(`${legacy}/`)) {
      const suffix = trimmed.slice(legacy.length).replace(/^\/+/, '');
      return suffix ? path.join(root, suffix) : root;
    }
  }

  // Caminho relativo ("meu-projeto", "bots/discord") é sempre relativo à
  // raiz de workspaces — nunca ao cwd do processo, que varia conforme o
  // painel foi iniciado.
  if (!path.isAbsolute(trimmed)) return path.join(root, trimmed);

  return path.normalize(trimmed);
}

/**
 * Traduz um caminho visto pelo painel para o caminho equivalente no HOST.
 *
 * Só faz diferença quando o painel roda em container e pede pro daemon do
 * host criar outro container com bind mount: o daemon resolve o caminho no
 * filesystem DELE. Sem essa tradução o Docker cria uma pasta vazia no host
 * e o container sobe sem os arquivos do projeto — um dos bugs mais
 * confusos de diagnosticar, porque nada falha, só "some".
 */
function toHostPath(panelPath) {
  if (!panelPath) return panelPath;
  const hostRoot = config.HOST_WORKSPACES_ROOT;
  if (!hostRoot) return panelPath;

  const root = workspacesRoot();
  const resolved = path.resolve(panelPath);
  if (resolved === root) return hostRoot;
  if (resolved.startsWith(root + path.sep)) {
    const relative = resolved.slice(root.length + 1);
    return path.posix.join(hostRoot, relative.split(path.sep).join('/'));
  }
  return panelPath; // fora da raiz de workspaces: responsabilidade de quem configurou
}

/**
 * Remove um workspace — só se estiver dentro da raiz. Um
 * `working_directory` apontado manualmente pra fora (ex.: `~/meus-bots`)
 * nunca é apagado pelo painel, mesmo que o usuário peça.
 */
function remove(dir) {
  if (!isInsideRoot(dir)) return false;
  fs.rmSync(path.resolve(dir), { recursive: true, force: true });
  return true;
}

/** Tamanho aproximado em bytes, para exibir no painel. Limitado para não varrer árvores gigantes. */
function usage(dir, { maxEntries = 5000 } = {}) {
  let bytes = 0;
  let files = 0;
  const stack = [path.resolve(dir)];
  while (stack.length && files < maxEntries) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      try {
        bytes += fs.statSync(full).size;
        files += 1;
      } catch { /* arquivo sumiu no meio da varredura */ }
    }
  }
  return { bytes, files, truncated: files >= maxEntries };
}

module.exports = {
  slugify,
  workspacesRoot,
  ensureRoot,
  ensureDir,
  isInsideRoot,
  pathForName,
  reservePath,
  createForService,
  normalize,
  toHostPath,
  remove,
  usage,
};
