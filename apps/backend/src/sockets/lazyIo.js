'use strict';
/**
 * Referência tardia ao socket.io server.
 *
 * setupManager é carregado ANTES de o servidor HTTP existir (as rotas
 * dependem dele na fase de registro de middlewares), então não podemos
 * fazer `require('../sockets').io` no topo do arquivo — isso criaria um
 * ciclo e retornaria `undefined`. Em vez disso, setamos o io aqui assim
 * que ele é criado em sockets/index.js.
 */
let io = null;

function setIo(instance) {
  io = instance;
}

function getIo() {
  return io;
}

// Proxy pra permitir `io.emit?.(...)` e `io.emit(...)` direto no import.
module.exports = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'setIo') return setIo;
    if (prop === 'getIo') return getIo;
    if (!io) return undefined;
    const v = io[prop];
    return typeof v === 'function' ? v.bind(io) : v;
  },
});
