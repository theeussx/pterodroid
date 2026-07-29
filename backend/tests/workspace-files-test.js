'use strict';
/**
 * Testes de unidade do workspaceManager + fileManager.
 *
 * Foco em duas coisas que precisam ser inquestionáveis:
 *  1. resolução de caminho — nada pode escapar da raiz, por nenhuma via;
 *  2. operações de arquivo — criar pastas sob demanda, escrita atômica e
 *     resolução de conflito de nome.
 *
 * Não precisa de servidor nem de rede: `node tests/workspace-files-test.js`
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-ws-'));
process.env.DATA_ROOT = path.join(TMP, 'data');
process.env.WORKSPACES_ROOT = path.join(TMP, 'workspaces');
process.env.FILES_ROOT = path.join(TMP, 'workspaces');
process.env.JWT_SECRET = 'test';

const workspaces = require('../src/services/workspaceManager');
const { createFileManager, PathError } = require('../src/services/fileManager');
const { parseCommand } = require('../src/services/commandParser');

let pass = 0;
let fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
};
/** Espera que `fn` lance; devolve a mensagem para inspeção. */
const throws = (fn) => {
  try { fn(); return null; } catch (e) { return e.message; }
};

console.log('workspaceManager — nomes e caminhos:');
ok('slug remove acentos e espaços', workspaces.slugify('Meu Bot do Discord') === 'meu-bot-do-discord');
ok('slug normaliza cedilha/acento', workspaces.slugify('Ação Robô') === 'acao-robo');
ok('slug vazio tem fallback', workspaces.slugify('!!!') === 'app');
ok('slug limita o tamanho', workspaces.slugify('x'.repeat(200)).length <= 60);

const w1 = workspaces.createForService('API de Teste');
const w2 = workspaces.createForService('API de Teste'); // mesmo nome
ok('workspace criado no disco', fs.existsSync(w1));
ok('nome repetido não colide', w1 !== w2 && fs.existsSync(w2), `${w1} vs ${w2}`);
ok('segundo recebe sufixo', path.basename(w2) === 'api-de-teste-2', path.basename(w2));

console.log('\nworkspaceManager — normalização:');
ok('vazio devolve null', workspaces.normalize('') === null);
ok('relativo resolve a partir da raiz',
  workspaces.normalize('meu-app') === path.join(workspaces.workspacesRoot(), 'meu-app'));
ok('caminho legado /home/appuser/projects é remapeado',
  workspaces.normalize('/home/appuser/projects/bot') === path.join(workspaces.workspacesRoot(), 'bot'));
ok('absoluto externo é preservado', workspaces.normalize('/tmp/meus-projetos') === '/tmp/meus-projetos');

console.log('\nworkspaceManager — remoção protegida:');
const externo = path.join(TMP, 'fora-da-raiz');
fs.mkdirSync(externo, { recursive: true });
ok('não remove pasta fora da raiz', workspaces.remove(externo) === false && fs.existsSync(externo));
ok('não remove a própria raiz',
  workspaces.remove(workspaces.workspacesRoot()) === false && fs.existsSync(workspaces.workspacesRoot()));
ok('remove workspace interno', workspaces.remove(w2) === true && !fs.existsSync(w2));

console.log('\nfileManager — proteção de caminho:');
const fm = createFileManager(w1);
const escapes = [
  ['..', '../../../etc/passwd'],
  ['absoluto', '/etc/passwd'],
  ['no meio', 'src/../../../../etc'],
  ['barra dupla', '//etc/passwd'],
  ['nulo', 'arquivo\0.txt'],
];
for (const [label, attempt] of escapes) {
  const target = throws(() => fm.resolveSafePath(attempt)) ? null : fm.resolveSafePath(attempt);
  const contained = target === null || target === fm.root() || target.startsWith(fm.root() + path.sep);
  ok(`bloqueia ou contém: ${label}`, contained, target || '');
}

// Symlink apontando pra fora precisa ser recusado mesmo estando "dentro".
fs.symlinkSync('/etc', path.join(w1, 'fuga'));
ok('recusa symlink que sai da raiz', throws(() => fm.resolveSafePath('fuga')) !== null);
ok('recusa leitura através do symlink', throws(() => fm.read('fuga/passwd')) !== null);
fs.unlinkSync(path.join(w1, 'fuga'));

console.log('\nfileManager — operações:');
fm.write('a/b/c/notas.txt', 'ola mundo');
ok('write cria diretórios ausentes', fs.existsSync(path.join(w1, 'a/b/c/notas.txt')));
ok('read devolve o conteúdo', fm.read('a/b/c/notas.txt').content === 'ola mundo');
ok('write não deixa arquivo temporário',
  fs.readdirSync(path.join(w1, 'a/b/c')).every((f) => !f.endsWith('.tmp')));

fm.createDir('', 'src');
fm.createFile('src', 'app.js');
ok('createFile duplicado dá 409', throws(() => fm.createFile('src', 'app.js')) !== null);
ok('copy resolve conflito', fm.copy('src/app.js', 'src').name === 'app (2).js');
ok('rename funciona', fm.rename('src/app.js', 'main.js').name === 'main.js');
ok('move funciona', fm.move('src/main.js', '').name === 'main.js');
ok('busca encontra por trecho', fm.search('', 'main').some((r) => r.name === 'main.js'));

ok('não move pasta pra dentro de si mesma', throws(() => fm.move('src', 'src')) !== null);
ok('não exclui a raiz', throws(() => fm.remove('')) !== null);

console.log('\nfileManager — nomes:');
ok('recusa separador no nome', throws(() => fm.validateName('a/b')) !== null);
ok('recusa ".."', throws(() => fm.validateName('..')) !== null);
ok('sanitiza nome vindo de upload', fm.sanitizeName('../../etc/passwd') === 'etc_passwd',
  fm.sanitizeName('../../etc/passwd'));
ok('sanitiza nome só com pontos', fm.sanitizeName('...') === 'arquivo', fm.sanitizeName('...'));
ok('preserva acentos no nome', fm.sanitizeName('relatório final.txt') === 'relatório final.txt');

console.log('\nfileManager — raiz recriada sob demanda:');
fs.rmSync(w1, { recursive: true, force: true });
ok('listar recria a raiz apagada', Array.isArray(fm.list('').entries) && fs.existsSync(w1));

console.log('\ncommandParser:');
ok('comando simples', JSON.stringify(parseCommand('node index.js')) === JSON.stringify({ cmd: 'node', args: ['index.js'], viaShell: false }));
ok('respeita aspas', parseCommand('node "meu arquivo.js"').args[0] === 'meu arquivo.js');
ok('encadeamento usa shell', parseCommand('cd app && node index.js').viaShell === true);
ok('redirecionamento usa shell', parseCommand('node app.js > saida.log').viaShell === true);
ok('pipe usa shell', parseCommand('cat x | grep y').viaShell === true);
ok('comando vazio devolve cmd nulo', parseCommand('   ').cmd === null);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
