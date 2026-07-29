'use strict';
/**
 * commandParser — transforma a string de comando do usuário em argv.
 *
 * Existia duplicado em processManager e dockerServiceDriver; unificado
 * aqui porque os dois precisam exatamente do mesmo comportamento e uma
 * correção num lugar tinha que ser lembrada no outro (DRY, Etapa 11).
 *
 * Além de unificar, resolve um problema real: comandos com sintaxe de
 * shell (`cd app && node index.js`, `node app.js > log.txt`) eram
 * tokenizados palavra por palavra, e o painel tentava executar um binário
 * literalmente chamado "cd". Quando detectamos metacaracteres de shell,
 * delegamos a linha inteira pro `sh -c`, que é quem sabe interpretá-los.
 */

/** Caracteres que só fazem sentido se um shell interpretar a linha. */
const SHELL_METACHARACTERS = /[|&;<>$`(){}[\]*?~\n]/;

/** Split estilo shell, respeitando aspas simples e duplas. */
function tokenize(cmd) {
  const parts = [];
  let current = '';
  let quote = null;

  for (const ch of String(cmd || '').trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) { parts.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** true se a linha precisa de um shell de verdade pra fazer sentido. */
function needsShell(cmd) {
  return SHELL_METACHARACTERS.test(String(cmd || ''));
}

/**
 * Devolve { cmd, args, viaShell } pronto pro spawn().
 * `shell` continua sendo `false` no spawn — quando precisa de shell, ele é
 * invocado explicitamente como argv, o que evita a diferença de
 * comportamento entre plataformas do `{ shell: true }` do Node.
 */
function parseCommand(command) {
  const raw = String(command || '').trim();
  if (!raw) return { cmd: null, args: [], viaShell: false };

  if (needsShell(raw)) {
    return { cmd: 'sh', args: ['-c', raw], viaShell: true };
  }

  const [cmd, ...args] = tokenize(raw);
  return { cmd: cmd || null, args, viaShell: false };
}

module.exports = { parseCommand, tokenize, needsShell };
