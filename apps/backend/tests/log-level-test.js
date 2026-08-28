'use strict';
const assert = require('assert');
const { classifyLogLevel } = require('../src/services/logLevel');

const cases = [
  ['stdout', 'Servidor ouvindo na porta 3000', 'info'],
  ['stderr', '[Warning] Using insecure default configuration', 'warn'],
  ['stderr', 'WARNING: deprecated option', 'warn'],
  ['stderr', '[Note] InnoDB initialization completed', 'info'],
  ['stderr', 'ready for connections', 'error'],
  ['stderr', 'Error: cannot bind port', 'error'],
  ['stdout', 'INFO service started', 'info'],
];

for (const [stream, message, expected] of cases) {
  const actual = classifyLogLevel(stream, message);
  assert.strictEqual(actual, expected, `${stream} ${message}: esperado ${expected}, recebido ${actual}`);
}

console.log(`${cases.length} classificações de log passaram`);
