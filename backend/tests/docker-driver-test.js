'use strict';
/**
 * Testa o dockerServiceDriver contra um Docker Engine simulado.
 *
 * Motivação: os bugs mais caros do driver não são de rede, e sim de
 * MONTAGEM do pedido — em especial o caminho do bind mount quando o painel
 * roda dentro de um container (o Docker aceita feliz um caminho que não
 * existe no host, cria uma pasta vazia e o serviço sobe sem os arquivos,
 * sem erro nenhum). Um mock deixa inspecionar exatamente o JSON enviado.
 *
 * Roda sem Docker instalado: `node tests/docker-driver-test.js`
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-docker-'));
process.env.DATA_ROOT = path.join(TMP, 'data');
process.env.WORKSPACES_ROOT = path.join(TMP, 'data', 'workspaces');
process.env.DB_PATH = path.join(TMP, 'data', 'panel.db');
process.env.JWT_SECRET = 'test';

let pass = 0;
let fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
};

/** Docker Engine falso: registra tudo que recebe pra inspeção posterior. */
function startMockEngine() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      calls.push({ method: req.method, url: req.url, body });

      const send = (code, payload) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(payload === undefined ? '' : JSON.stringify(payload));
      };

      if (req.url.includes('/containers/create')) return send(201, { Id: 'container-abc123', Warnings: [] });
      if (/\/containers\/[^/]+\/start/.test(req.url)) return send(204);
      if (/\/containers\/[^/]+\/stop/.test(req.url)) return send(204);
      if (/\/containers\/[^/]+\/restart/.test(req.url)) return send(204);
      if (/\/containers\/[^/]+\/json/.test(req.url)) {
        return send(200, {
          Id: 'container-abc123',
          State: { Running: true, Pid: 4242, Status: 'running', StartedAt: new Date().toISOString() },
          Config: { Tty: false },
          RestartCount: 0,
        });
      }
      if (/\/containers\/[^/]+\/stats/.test(req.url)) {
        return send(200, {
          cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 2 },
          precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
          memory_stats: { usage: 52428800, limit: 268435456 },
        });
      }
      if (/\/containers\/[^/]+\/logs/.test(req.url)) {
        res.writeHead(200);
        return res.end();
      }
      if (req.url.includes('/version')) return send(200, { Version: '24.0.0', ApiVersion: '1.43' });
      return send(200, {});
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port }));
  });
}

async function main() {
  const { server, calls, port } = await startMockEngine();
  console.log(`Docker Engine simulado em 127.0.0.1:${port}\n`);

  const { initDB, getDB } = require('../src/db');
  await initDB();
  const db = getDB();

  const hosts = require('../src/services/dockerHostManager');
  db.prepare('INSERT INTO docker_hosts (name, connection, is_default) VALUES (?,?,1)')
    .run('Mock', `tcp://127.0.0.1:${port}`);
  const hostId = db.prepare('SELECT id FROM docker_hosts LIMIT 1').get().id;

  const workspaces = require('../src/services/workspaceManager');
  const { resolveServiceWorkspace } = require('../src/services/serviceWorkspace');
  const driver = require('../src/services/dockerServiceDriver');

  console.log('Workspace do serviço Docker:');
  const ws = resolveServiceWorkspace({
    name: 'Meu Bot', runtime_type: 'docker', working_directory: '', volumes: '[]', image: 'node:20-alpine', command: '',
  });
  ok('workspace criado dentro da raiz', workspaces.isInsideRoot(ws.finalWorkingDir), ws.finalWorkingDir);
  ok('pasta existe no disco', fs.existsSync(ws.finalWorkingDir));
  ok('bind /app adicionado automaticamente', ws.volumes.includes('"target":"/app"'), ws.volumes);
  ok('projeto Node semeado (index.js)', fs.existsSync(path.join(ws.finalWorkingDir, 'index.js')));
  ok('comando inferido NÃO roda npm install no boot', !ws.command.includes('npm install'), ws.command);

  db.prepare(`
    INSERT INTO services (name, type, command, working_directory, runtime_type, docker_host_id, image, volumes,
                          docker_ports, environment, auto_restart, max_restarts, port, scaffolded_directory)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run('Meu Bot', 'node', ws.command, ws.finalWorkingDir, 'docker', hostId, 'node:20-alpine',
    ws.volumes, '[]', '{"TOKEN":"abc"}', 1, 5, 8080, 1);
  const serviceId = db.prepare('SELECT id FROM services LIMIT 1').get().id;

  console.log('\nCriação do container:');
  await driver.startService(serviceId);
  const create = calls.find((c) => c.url.includes('/containers/create'));
  ok('POST /containers/create enviado', !!create);
  ok('imagem correta', create.body.Image === 'node:20-alpine');
  ok('env repassado', create.body.Env.includes('TOKEN=abc'));
  ok('porta mapeada 1:1', JSON.stringify(create.body.HostConfig.PortBindings).includes('8080'));
  ok('bind mount presente', create.body.HostConfig.Binds.some((b) => b.endsWith(':/app')),
    JSON.stringify(create.body.HostConfig.Binds));
  ok('RestartPolicy on-failure com teto', create.body.HostConfig.RestartPolicy.Name === 'on-failure'
    && create.body.HostConfig.RestartPolicy.MaximumRetryCount === 5);
  ok('labels de rastreio do painel', create.body.Labels['pterodroid.managed'] === 'true');
  ok('container_id salvo no banco',
    db.prepare('SELECT container_id FROM services WHERE id=?').get(serviceId).container_id === 'container-abc123');
  ok('desired_state = running',
    db.prepare('SELECT desired_state FROM services WHERE id=?').get(serviceId).desired_state === 'running');

  console.log('\nTradução de caminho para o host (painel dentro de container):');
  // Simula o painel rodando em container: a raiz que ELE vê é diferente da
  // que o daemon do Docker enxerga no host.
  const hostRoot = '/home/usuario/pterodroid/data/workspaces';
  const originalHostRoot = require('../src/config').HOST_WORKSPACES_ROOT;
  require('../src/config').HOST_WORKSPACES_ROOT = hostRoot;
  const translated = workspaces.toHostPath(ws.finalWorkingDir);
  ok('caminho traduzido para a raiz do host', translated.startsWith(hostRoot), translated);
  ok('subpasta preservada na tradução', translated.endsWith(path.basename(ws.finalWorkingDir)), translated);
  ok('volume nomeado não é traduzido', workspaces.toHostPath('meu-volume') === 'meu-volume');
  require('../src/config').HOST_WORKSPACES_ROOT = originalHostRoot;

  console.log('\nEstado observado (poll):');
  await driver._pollOne({ id: serviceId, docker_host_id: hostId, container_id: 'container-abc123' });
  const info = driver.getRuntimeInfo(serviceId);
  ok('runtime info em cache', !!info);
  ok('marcado como vivo', info.alive === true);
  ok('CPU calculada', info.cpuPercent === 20, `obtido: ${info.cpuPercent}`);
  ok('memória em MB', info.memUsageMB === 50, `obtido: ${info.memUsageMB}`);

  console.log('\nParada:');
  await driver.stopService(serviceId);
  ok('POST /stop enviado', calls.some((c) => /\/containers\/[^/]+\/stop/.test(c.url)));
  const stopped = db.prepare('SELECT status, desired_state FROM services WHERE id=?').get(serviceId);
  ok('status = stopped', stopped.status === 'stopped');
  ok('desired_state = stopped (não ressuscita no boot)', stopped.desired_state === 'stopped');

  console.log('\nWorkspace apagado por fora é recriado:');
  fs.rmSync(ws.finalWorkingDir, { recursive: true, force: true });
  db.prepare('UPDATE services SET container_id = NULL WHERE id = ?').run(serviceId);
  await driver.startService(serviceId);
  ok('pasta recriada automaticamente', fs.existsSync(ws.finalWorkingDir));

  await driver.stopAll();
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Erro no teste:', err);
  process.exit(1);
});
