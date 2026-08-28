'use strict';

/**
 * Sobe um servidor HTTP mínimo que responde como a Docker Engine API
 * responderia, e testa o DockerEngine contra ele. Isso valida a parte que
 * mais importa acertar de primeira — formação de request, parse de
 * resposta, demux de logs, buffering de NDJSON — sem depender de um
 * dockerd de verdade rodando (que não existe neste sandbox, e que em
 * produção pode estar numa máquina remota ainda não configurada).
 *
 * Roda com: node apps/backend/tests/docker-engine-smoke-test.js
 */

const http = require('http');
const { DockerEngine } = require('../src/services/dockerEngine');

let passed = 0;
let failed = 0;

function ok(desc, cond) {
  if (cond) { passed++; console.log(`  ✅ ${desc}`); }
  else { failed++; console.log(`  ❌ ${desc}`); }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve(raw ? JSON.parse(raw) : null);
    });
  });
}

/** Monta um frame de log no formato multiplexado do Docker: [streamType,0,0,0,tamanho BE32] + payload. */
function frame(streamType, text) {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

async function main() {
  const server = http.createServer(async (req, res) => {
    const [pathname] = req.url.split('?');

    if (pathname === '/v1.43/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ Version: '27.3.1', ApiVersion: '1.43', Os: 'linux', Arch: 'amd64' }));
    }

    if (pathname === '/v1.43/containers/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([{ Id: 'abc123', Names: ['/meu-redis'], Image: 'redis:7', State: 'running' }]));
    }

    if (pathname === '/v1.43/containers/create') {
      await readBody(req);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ Id: 'novoContainerId', Warnings: [] }));
    }

    if (pathname === '/v1.43/containers/mockid/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ Id: 'mockid', Config: { Tty: false }, State: { Status: 'running' } }));
    }

    if (pathname === '/v1.43/containers/mockid/start' || pathname === '/v1.43/containers/mockid/stop') {
      res.writeHead(204);
      return res.end();
    }

    if (pathname === '/v1.43/containers/mockid' && req.method === 'DELETE') {
      res.writeHead(204);
      return res.end();
    }

    if (pathname === '/v1.43/containers/mockid/logs') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.docker.multiplexed-stream' });
      const f1 = frame(1, 'linha stdout\n');
      const f2 = frame(2, 'linha stderr\n');
      // escreve o primeiro frame partido ao meio de propósito, pra provar
      // que o demux espera o resto chegar em vez de tentar ler cedo demais
      res.write(f1.subarray(0, 5));
      setImmediate(() => {
        res.write(Buffer.concat([f1.subarray(5), f2]));
        res.end();
      });
      return;
    }

    if (pathname === '/v1.43/containers/mockid/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // dois objetos NDJSON, o segundo partido no meio entre dois writes —
      // testa o buffering por linha do parseNDJSON
      res.write('{"cpu_stats":{"usage":1}}\n{"cpu_st');
      setImmediate(() => {
        res.write('ats":{"usage":2}}\n');
        res.end();
      });
      return;
    }

    if (pathname === '/v1.43/images/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([{ Id: 'sha256:img1', RepoTags: ['redis:7'] }]));
    }

    if (pathname === '/v1.43/volumes/create') {
      await readBody(req);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ Name: 'meu-volume', Driver: 'local' }));
    }

    if (pathname === '/v1.43/volumes') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ Volumes: [{ Name: 'meu-volume' }] }));
    }

    if (pathname === '/v1.43/networks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([{ Id: 'net1', Name: 'bridge' }]));
    }

    // rota não coberta pelo mock — deixa aparecer no output em vez de travar o teste em silêncio
    console.log(`  (mock) rota sem handler: ${req.method} ${pathname}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: `mock: sem handler pra ${pathname}` }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`Mock Docker Engine API em 127.0.0.1:${port}\n`);

  const engine = new DockerEngine({ host: '127.0.0.1', port });

  console.log('Host:');
  const version = await engine.version();
  ok('version() traz Version/ApiVersion', version.Version === '27.3.1' && version.ApiVersion === '1.43');

  console.log('Containers:');
  const containers = await engine.listContainers({ all: true });
  ok('listContainers() devolve array com o container mockado', Array.isArray(containers) && containers[0].Id === 'abc123');

  const created = await engine.createContainer({ Image: 'redis:7' }, { name: 'meu-redis' });
  ok('createContainer() devolve Id novo', created.Id === 'novoContainerId');

  await engine.startContainer('mockid'); // 204 — só não pode lançar
  ok('startContainer() aceita resposta 204 sem corpo', true);

  await engine.stopContainer('mockid');
  ok('stopContainer() aceita resposta 204 sem corpo', true);

  console.log('Logs (demux):');
  const logs = await engine.getLogs('mockid');
  const stdoutLine = logs.find((l) => l.stream === 'stdout');
  const stderrLine = logs.find((l) => l.stream === 'stderr');
  ok('getLogs() separa stdout corretamente mesmo com frame partido', stdoutLine?.text === 'linha stdout\n');
  ok('getLogs() separa stderr do stdout', stderrLine?.text === 'linha stderr\n');

  console.log('Stats (NDJSON):');
  const statsSeen = [];
  await new Promise((resolve, reject) => {
    engine.streamStats('mockid', (obj) => {
      statsSeen.push(obj);
      if (statsSeen.length === 2) resolve();
    }, reject);
    setTimeout(() => reject(new Error('timeout esperando stats')), 3000);
  });
  ok('streamStats() reconstrói o 1º objeto NDJSON', statsSeen[0]?.cpu_stats?.usage === 1);
  ok('streamStats() reconstrói o 2º objeto mesmo partido entre writes', statsSeen[1]?.cpu_stats?.usage === 2);

  await engine.removeContainer('mockid', { force: true });
  ok('removeContainer() aceita resposta 204', true);

  console.log('Imagens, volumes e redes:');
  const images = await engine.listImages();
  ok('listImages() devolve array', Array.isArray(images) && images[0].RepoTags.includes('redis:7'));

  const volume = await engine.createVolume({ name: 'meu-volume' });
  ok('createVolume() devolve o volume criado', volume.Name === 'meu-volume');

  const volumes = await engine.listVolumes();
  ok('listVolumes() devolve { Volumes: [...] }', volumes.Volumes[0].Name === 'meu-volume');

  const networks = await engine.listNetworks();
  ok('listNetworks() devolve array', Array.isArray(networks) && networks[0].Name === 'bridge');

  server.close();
  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Erro fatal no smoke test:', err);
  process.exit(1);
});
