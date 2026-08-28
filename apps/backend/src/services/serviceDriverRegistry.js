'use strict';
/**
 * serviceDriverRegistry — escolhe, por serviço, entre processManager
 * (runtime_type='process', child_process local — o único caminho possível
 * dentro do próprio Termux) e dockerServiceDriver (runtime_type='docker',
 * container local ou em host remoto). Rotas e sockets falam só com este
 * módulo; nenhum dos dois lugares precisa de um `if (runtime_type)`.
 *
 * runtime_type é decidido na criação do serviço e não muda depois — trocar
 * de "processo" pra "container" na prática é recriar o serviço do zero,
 * não uma edição.
 */
const { getDB } = require('../db');
const pm = require('./processManager');
const dockerDriver = require('./dockerServiceDriver');

function driverFor(serviceId) {
  const db = getDB();
  const row = db.prepare('SELECT runtime_type FROM services WHERE id = ?').get(serviceId);
  return row?.runtime_type === 'docker' ? dockerDriver : pm;
}

module.exports = {
  startService: (id) => driverFor(id).startService(id),
  stopService: (id) => driverFor(id).stopService(id),
  restartService: (id) => driverFor(id).restartService(id),
  sendInput: (id, text) => driverFor(id).sendInput(id, text),
  getLogs: (id, limit) => driverFor(id).getLogs(id, limit),
  getRuntimeInfo: (id) => driverFor(id).getRuntimeInfo(id),

  async restoreAll() {
    await pm.restoreAll();
    await dockerDriver.restoreAll();
  },

  async stopAll() {
    await pm.stopAll();
    await dockerDriver.stopAll();
  },

  // Expostos pra quem precisar dos emitters diretamente (ver sockets/index.js)
  // sem importar os dois módulos separadamente.
  pm,
  dockerDriver,
};
