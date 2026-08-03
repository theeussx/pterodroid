'use strict';
/**
 * Testes de integração para a consolidação da configuração inicial
 * de serviços (ServiceSetupManager, Etapas 1 a 6).
 *
 * Valida:
 * - Prioridade absoluta do Startup Command sobre inferência
 * - Inferência automática a partir do projeto (package.json, tsconfig, dist/index.js)
 * - Bootstrap inteligente com detecção de package manager
 * - Compilação TypeScript automática com verificação de falha
 * - Segurança do git_token (encriptação, mascaramento na API e logs)
 * - Estados de setup e proteção contra execução simultânea (409)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-setup-test-'));
process.env.DATA_ROOT = path.join(TMP, 'data');
process.env.WORKSPACES_ROOT = path.join(TMP, 'data', 'workspaces');
process.env.DB_PATH = path.join(TMP, 'data', 'panel.db');
process.env.JWT_SECRET = 'test_jwt_secret_pterodroid';

let pass = 0;
let fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${label}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

async function main() {
  console.log('--- Iniciando bateria de testes do ServiceSetupManager ---\n');

  const { initDB, getDB } = require('../src/db');
  await initDB();
  const db = getDB();

  const workspaces = require('../src/services/workspaceManager');
  const setupManager = require('../src/services/serviceSetupManager');
  const secretCrypto = require('../src/services/secretCrypto');

  // ────────────────────────────────────────────────────────────
  // ETAPA 5: SEGURANÇA (ENCRIPTAÇÃO DE TOKEN E MASCARAMENTO)
  // ────────────────────────────────────────────────────────────
  console.log('Testando Segurança (Etapa 5):');
  const tokenPlain = 'ghp_super_secret_token_123456';
  const enc = secretCrypto.encryptSecret(tokenPlain);
  ok('encryptSecret encripta o token com prefixo enc:v1:', enc.startsWith('enc:v1:'));
  ok('decryptSecret recupera o token original', secretCrypto.decryptSecret(enc) === tokenPlain);

  const maskedLog = secretCrypto.maskSecrets(
    `git clone https://username:${tokenPlain}@github.com/org/repo.git .`,
    [tokenPlain, 'username']
  );
  ok('maskSecrets ofusca URLs autenticadas e tokens nos logs',
     !maskedLog.includes(tokenPlain) && maskedLog.includes('https://***@github.com/org/repo.git'));

  // ────────────────────────────────────────────────────────────
  // ETAPA 2: PRIORIDADE ABSOLUTA DO STARTUP COMMAND
  // ────────────────────────────────────────────────────────────
  console.log('\nTestando Prioridade do Startup Command (Etapa 2):');
  const dummyService = {
    id: 999,
    name: 'test-priority',
    startup_command: 'npm run production',
    command: 'node index.js',
    main_file: 'src/index.ts',
  };
  const resolvedCmd1 = setupManager.resolveEffectiveCommand(dummyService, '/tmp/dummy');
  ok('Startup Command tem prioridade sobre main_file e auto-inferência', resolvedCmd1 === 'npm run production');

  const dummyService2 = {
    id: 998,
    name: 'test-main-file',
    startup_command: '',
    command: '',
    main_file: 'src/bot.ts',
    node_args: '--inspect',
  };
  const resolvedCmd2 = setupManager.resolveEffectiveCommand(dummyService2, '/tmp/dummy');
  ok('Inferência usa main_file e estende argumentos quando Startup Command está vazio',
     resolvedCmd2 === 'ts-node --esm "src/bot.ts" --inspect');

  // ────────────────────────────────────────────────────────────
  // ETAPA 3: BOOTSTRAP INTELIGENTE & COMPILAÇÃO TYPESCRIPT
  // ────────────────────────────────────────────────────────────
  console.log('\nTestando Bootstrap Inteligente e Compilação TS (Etapa 3):');
  const tsWorkDir = workspaces.createForService('ts-demo');
  workspaces.ensureDir(tsWorkDir);

  // Cria um tsconfig.json e um código TypeScript válido
  fs.writeFileSync(path.join(tsWorkDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { outDir: 'dist', rootDir: 'src', module: 'commonjs', target: 'es2020' },
    include: ['src/**/*.ts']
  }, null, 2));
  fs.mkdirSync(path.join(tsWorkDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tsWorkDir, 'src', 'index.ts'), "const saudacao: string = 'Olá Pterodroid';\nconsole.log(saudacao);\n");

  // Insere o serviço no banco
  db.prepare(`
    INSERT INTO services (name, type, command, startup_command, working_directory, runtime_type, setup_status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('ts-demo', 'node', '', '', tsWorkDir, 'process', 'Aguardando');
  const tsServiceId = db.prepare('SELECT id FROM services WHERE name = ?').get('ts-demo').id;

  // Executa o setup sem iniciar o processo
  const setupRes = await setupManager.runSetup(tsServiceId, { startService: false });
  ok('runSetup conclui compilação TypeScript com sucesso', setupRes.ok === true && setupRes.status === 'Concluído');
  ok('dist/index.js foi gerado pela compilação TS', fs.existsSync(path.join(tsWorkDir, 'dist', 'index.js')));
  const dbServiceAfterTS = db.prepare('SELECT command, setup_status, setup_progress FROM services WHERE id = ?').get(tsServiceId);
  ok('Comando resolvido automaticamente para node dist/index.js', dbServiceAfterTS.command === 'node dist/index.js');
  ok('Status de setup marcado como Concluído (100%) no banco', dbServiceAfterTS.setup_status === 'Concluído' && dbServiceAfterTS.setup_progress === 100);

  // ────────────────────────────────────────────────────────────
  // ETAPA 3 e 6: VERIFICAÇÃO DE FALHA NA COMPILAÇÃO TYPESCRIPT
  // ────────────────────────────────────────────────────────────
  console.log('\nTestando Validação e Robustez de Erros de Build (Etapa 3 e 6):');
  const badTsDir = workspaces.createForService('ts-broken');
  workspaces.ensureDir(badTsDir);
  fs.writeFileSync(path.join(badTsDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { outDir: 'dist', rootDir: 'src', module: 'commonjs' },
    include: ['src/**/*.ts']
  }));
  fs.mkdirSync(path.join(badTsDir, 'src'), { recursive: true });
  // Código com erro sintático grave
  fs.writeFileSync(path.join(badTsDir, 'src', 'bad.ts'), "import { naoExiste } from 'modulo-inexistente-xyz123987';\n");

  db.prepare(`
    INSERT INTO services (name, type, command, startup_command, working_directory, runtime_type, setup_status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('ts-broken', 'node', '', '', badTsDir, 'process', 'Aguardando');
  const badServiceId = db.prepare('SELECT id FROM services WHERE name = ?').get('ts-broken').id;

  let buildErrorCaught = false;
  try {
    await setupManager.runSetup(badServiceId, { startService: false });
  } catch (err) {
    buildErrorCaught = true;
  }
  ok('Setup é abortado com erro quando a compilação TS falha', buildErrorCaught);
  const badServiceStatus = setupManager.getStatus(badServiceId);
  ok('Serviço é marcado como Falhou e guarda logs do erro',
     badServiceStatus.status === 'Falhou' && badServiceStatus.error.length > 0 && badServiceStatus.logs.length > 0);

  // ────────────────────────────────────────────────────────────
  // ETAPA 4 e 6: PROTEÇÃO CONTRA EXECUÇÃO SIMULTÂNEA (409)
  // ────────────────────────────────────────────────────────────
  console.log('\nTestando Proteção Contra Setup Duplicado (Etapa 4 e 6):');
  const slowDir = workspaces.createForService('slow-demo');
  workspaces.ensureDir(slowDir);
  const localRepo = path.join(TMP, 'local-repo.git');
  require('child_process').execSync(`git -c init.defaultBranch=main init --bare "${localRepo}"`);

  db.prepare(`
    INSERT INTO services (name, type, command, working_directory, git_repo, runtime_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('slow-demo', 'node', 'node index.js', slowDir, localRepo, 'process');
  const slowId = db.prepare('SELECT id FROM services WHERE name = ?').get('slow-demo').id;

  // Inicia primeira execução (que aguarda o git clone assíncrono) e testa que chamada paralela é rejeitada
  const promise1 = setupManager.runSetup(slowId, { startService: false });
  let conflictCaught = false;
  try {
    await setupManager.runSetup(slowId, { startService: false });
  } catch (err) {
    if (err.status === 409) conflictCaught = true;
  }
  ok('Segunda chamada simultânea a runSetup devolve erro 409 Conflict', conflictCaught);
  await promise1.catch(() => {}); // Aguarda o término de promise1 para limpar

  // ────────────────────────────────────────────────────────────
  // LIMPEZA FINAL
  // ────────────────────────────────────────────────────────────
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n==============================================`);
  if (fail === 0) {
    console.log(`  ✅ Todas as verificações de setup passaram (${pass} testes)`);
  } else {
    console.log(`  ❌ ${fail} verificação(ões) falhou(ram) (${pass} passaram)`);
  }
  console.log(`==============================================\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Erro no teste de setup:', err);
  process.exit(1);
});
