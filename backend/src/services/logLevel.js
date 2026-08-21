'use strict';

/**
 * Classifica uma mensagem para a UI. Alguns motores de banco enviam notas e
 * avisos pelo stderr, portanto stream === 'stderr' sozinho não significa erro.
 * Os níveis públicos usados pelo painel são: info, warn e error.
 */
function classifyLogLevel(stream, message) {
  const text = String(message || '');
  const upper = text.toUpperCase();

  if (/\b(WARN|WARNING)\b|\[WARNING\]|\bDEPRECATION\b/.test(upper)) return 'warn';
  if (/\[NOTE\]|\bNOTICE\b|\bINFO(?:RMATION)?\b/.test(upper)) return 'info';

  if (stream === 'stderr' || stream === 'error') return 'error';
  if (/\b(ERROR|FATAL|PANIC|EXCEPTION|TRACEBACK)\b|\bERR!\b/.test(upper)) return 'error';
  return 'info';
}

module.exports = { classifyLogLevel };
