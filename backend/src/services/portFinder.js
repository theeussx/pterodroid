const net = require('net');

/**
 * Procura a próxima porta disponível a partir de uma porta base.
 * @param {number} basePort Porta inicial para busca.
 * @returns {Promise<number>} Uma porta disponível.
 */
async function findAvailablePort(basePort) {
  let port = basePort;
  while (true) {
    const available = await isPortAvailable(port);
    if (available) return port;
    port++;
    if (port > 65535) throw new Error('Nenhuma porta disponível encontrada no intervalo permitido.');
  }
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false); // Tratar outros erros como indisponível por segurança
      }
    });
    server.once('listen', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

module.exports = { findAvailablePort, isPortAvailable };
