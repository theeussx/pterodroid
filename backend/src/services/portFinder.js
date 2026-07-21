const net = require('net');

// Lista de portas de bancos de dados conhecidos para ignorar
const IGNORED_PORTS = [
  3306,		    // MySQL / MariaDB
  5432             // PostgreSQL
];

/**
 * Procura a próxima porta disponível a partir de uma porta base, ignorando bancos de dados.
 * @param {number} basePort Porta inicial para busca.
 * @returns {Promise<number>} Uma porta disponível.
 */
async function findAvailablePort(basePort) {
  let port = basePort;
  while (true) {
    // Se a porta estiver na lista de ignoradas, pula direto para a próxima
    if (IGNORED_PORTS.includes(port)) {
      port++;
      continue;
    }

    const available = await isPortAvailable(port);
    if (available) return port;
    port++;
    
    if (port > 65535) {
      throw new Error('Nenhuma porta disponível encontrada no intervalo permitido.');
    }
  }
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    // Configuração extra para liberar a porta da memória do sistema imediatamente após o fechamento
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    
    server.listen(port, '0.0.0.0');
  });
}

module.exports = { findAvailablePort, isPortAvailable };
