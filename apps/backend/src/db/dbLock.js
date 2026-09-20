'use strict';
/**
 * dbLock — lock exclusivo do panel.db.
 *
 * POR QUE ISTO EXISTE
 * ───────────────────
 * O sql.js mantém o banco inteiro em memória e, em vez de coordenar
 * escritores como o SQLite nativo faria (arquivo travado via WAL/journal),
 * cada processo simplesmente reserializa o arquivo inteiro a cada flush.
 * Dois painéis abertos sobre o mesmo panel.db NÃO ganham um erro do SQLite
 * — eles sobrescrevem os dados um do outro silenciosamente (a última flush
 * vence). Em Termux isso acontece de verdade: painel rodando em background
 * + `panelctl start` de novo por engano.
 *
 * COMO FUNCIONA
 * ─────────────
 * Lockfile `<db>.lock` criado com O_EXCL contendo `<pid>:<timestamp>`.
 * Se já existe e o PID está vivo, o boot falha com mensagem clara. Se o
 * PID morreu (painel anterior caiu de SIGKILL/pânico), o lock é considerado
 * obsoleto e recuperado. Funciona em qualquer FS local, inclusive proot.
 *
 * LIMITAÇÕES CONHECIDAS (aceitáveis para um painel pessoal)
 * ─────────────────────────────────────────────────────────
 *  - Reuso de PID pode, em tese, fazer um lock obsoleto parecer vivo;
 *    nesse caso basta remover o arquivo .lock manualmente.
 *  - DATA_ROOT em NFS/rede fica de fora (O_EXCL não é confiável lá) — o
 *    painel nunca suportou banco em rede mesmo.
 */
const fs = require('fs');

/** true se o PID existe neste host (EPERM = existe, mas não é nosso). */
function pidAlive(pid) {
  const n = Number(String(pid).trim());
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Adquire o lock exclusivo do banco. Lança Error com mensagem acionável se
 * outro processo vivo o detém. Retorna uma função release() idempotente
 * (também chamada automaticamente no 'exit' do processo).
 */
function acquireDbLock(dbPath) {
  const lockPath = `${dbPath}.lock`;

  // Duas tentativas cobrem a corrida "lock obsoleto removido enquanto outro
  // boot criava o dele".
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd;
    try {
      fd = fs.openSync(lockPath, 'wx'); // O_CREAT | O_EXCL | O_WRONLY
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      const [pidStr] = safeRead(lockPath).split(':');
      if (pidAlive(pidStr)) {
        throw new Error(
          `Este panel.db já está em uso por outro processo (pid ${String(pidStr).trim()}, lock em ${lockPath}).\n` +
            'Dois painéis sobre o mesmo banco sobrescrevem os dados um do outro.\n' +
            'Pare o outro processo (./panelctl.sh stop) ou aponte DB_PATH para outro arquivo.',
        );
      }

      // Lock obsoleto: o dono morreu sem liberar (SIGKILL, reboot).
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* corrida com outro boot — a próxima iteração decide */
      }
      continue;
    }

    fs.writeSync(fd, `${process.pid}:${new Date().toISOString()}\n`);
    fs.closeSync(fd);

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      try {
        // Só remove se o lock ainda é nosso — nunca apaga o lock de outro.
        if (safeRead(lockPath).startsWith(`${process.pid}:`)) {
          fs.unlinkSync(lockPath);
        }
      } catch {
        /* diretório removido, permissão — nada a fazer no desligamento */
      }
    };
    // 'exit' é síncrono e roda mesmo em process.exit() do shutdown gracioso.
    // Em SIGKILL sobra lock com PID morto, que o próximo boot recupera.
    process.on('exit', release);
    return release;
  }

  throw new Error(
    `Não foi possível obter o lock exclusivo do banco (${dbPath}.lock) após duas tentativas. ` +
      'Se nenhum painel estiver rodando, remova o arquivo .lock e tente de novo.',
  );
}

module.exports = { acquireDbLock, pidAlive };
