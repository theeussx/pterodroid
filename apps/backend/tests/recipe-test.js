'use strict';
/**
 * recipe-test — valida o catálogo de receitas dedicadas e o scaffold.
 *
 * Não precisa de servidor HTTP nem de banco: testa puramente o módulo
 * serviceRecipes (catálogo, defaults por receita, mapeamento de tipos
 * legados e a gravação de templates num diretório temporário).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const recipes = require('../src/services/serviceRecipes');

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  PASS: ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL: ${name}`);
  }
}

// ── Catálogo ─────────────────────────────────────────────────────────────
const catalog = recipes.catalog();
check('catálogo expõe as receitas esperadas', catalog.some((r) => r.id === 'node-api'));
check('catálogo expõe receita de Minecraft', catalog.some((r) => r.id === 'minecraft'));
check('catálogo expõe receita de site estático', catalog.some((r) => r.id === 'static-site'));
check('catálogo não expõe funções (JSON-safe)', typeof catalog[0] !== 'function' && !('scaffold' in catalog[0]));

const mc = catalog.find((r) => r.id === 'minecraft');
check('Minecraft tem porta padrão 25565', mc && mc.defaultPort === 25565);
check('Minecraft tem template', mc && mc.hasTemplate === true);

const staticSite = catalog.find((r) => r.id === 'static-site');
check('Site estático tem porta padrão 8080', staticSite && staticSite.defaultPort === 8080);

// ── Defaults por receita (não sobrescrevem o que o usuário preencheu) ───
const mcDefaults = recipes.applyDefaults('minecraft', { name: 'survival' });
check('minecraft aplica porta 25565', mcDefaults.port === 25565);
check('minecraft aplica comando java', /java -Xmx/.test(mcDefaults.command || ''));
check('minecraft não sobrescreve porta informada', recipes.applyDefaults('minecraft', { port: 25599 }).port === undefined);

const staticDefaults = recipes.applyDefaults('static-site', {});
check('static-site aplica http.server', /http\.server/.test(staticDefaults.command || ''));

const dockerDefaults = recipes.applyDefaults('docker', {});
check('receita docker força runtime_type=docker', dockerDefaults.runtime_type === 'docker');

// ── Mapeamento de tipos legados ─────────────────────────────────────────
check('type=node mapeia para node-api', recipes.forType('node').id === 'node-api');
check('type=bot mapeia para node-bot', recipes.forType('bot').id === 'node-bot');
check('type=python mapeia para python-api', recipes.forType('python').id === 'python-api');
check('type desconhecido cai na genérica', recipes.forType('bogus').id === 'generic');

// ── describeRow (rótulo/ícone para serviços antigos) ────────────────────
const desc = recipes.describeRow({ type: 'bot' });
check('describeRow devolve rótulo dedicado para bot', desc && desc.label === 'Bot (Discord/Telegram)');
check('describeRow devolve ícone', desc && typeof desc.icon === 'string');

// ── Scaffold em diretório temporário ────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-recipe-'));
const nodeScaffold = recipes.scaffoldService('node-api', tmp, 'my-api');
check('node-api scaffold cria arquivos', nodeScaffold.created >= 2);
check('node-api gera package.json', fs.existsSync(path.join(tmp, 'package.json')));
check('node-api gera src/index.js', fs.existsSync(path.join(tmp, 'src', 'index.js')));

const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-recipe-'));
recipes.scaffoldService('static-site', tmp2, 'site');
check('static-site gera index.html', fs.existsSync(path.join(tmp2, 'index.html')));

const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-recipe-'));
recipes.scaffoldService('python-api', tmp3, 'api');
check('python-api gera app.py', fs.existsSync(path.join(tmp3, 'app.py')));
check('python-api gera requirements.txt', fs.existsSync(path.join(tmp3, 'requirements.txt')));

// ── validateRecipe ──────────────────────────────────────────────────────
check('receita docker sem host é inválida', typeof recipes.validateRecipe('docker', {}) === 'string');
check('receita node-api sem host é válida', recipes.validateRecipe('node-api', {}) === null);
check('receita desconhecida é inválida', typeof recipes.validateRecipe('bogus', {}) === 'string');

console.log(`\n${failures === 0 ? '✅' : '❌'} recipe-test: ${failures} falha(s)`);
process.exit(failures === 0 ? 0 : 1);
