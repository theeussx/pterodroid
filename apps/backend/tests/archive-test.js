#!/usr/bin/env node
'use strict';
/**
 * Compactar / descompactar — teste de integração e de segurança.
 *
 * A extração de arquivos compactados é uma das operações mais perigosas
 * que um painel pode expor. O ataque clássico é o **Zip Slip**: uma
 * entrada chamada `../../../.ssh/authorized_keys` faz uma extração
 * ingênua escrever FORA da pasta de destino.
 *
 * Este teste monta pacotes maliciosos à mão (sem depender de nenhuma
 * biblioteca) e confirma que nada escapa da raiz. Também cobre zip bomb,
 * links simbólicos e o caminho feliz de ida e volta.
 *
 *   node tests/archive-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-zip-'));
process.env.DATA_ROOT = path.join(TMP, 'data');
process.env.WORKSPACES_ROOT = path.join(TMP, 'raiz');
process.env.FILES_ROOT = path.join(TMP, 'raiz');
process.env.JWT_SECRET = 'test';

const { createFileManager } = require('../src/services/fileManager');
const archives = require('../src/services/archiveManager');

let pass = 0;
let fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
};

const ROOT = path.join(TMP, 'raiz');
fs.mkdirSync(ROOT, { recursive: true });
const fm = createFileManager(ROOT);

// ── Montagem manual de .zip, para forjar entradas maliciosas ────────────
const CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return (buf) => {
    let crc = -1;
    for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xff];
    return (crc ^ -1) >>> 0;
  };
})();

/** Monta um .zip com as entradas dadas: [{ name, content, symlink?, deflate? }] */
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const content = Buffer.from(e.content ?? '');
    const crc = CRC(content);
    let method = 0;
    let payload = content;
    if (e.deflate) { method = 8; payload = zlib.deflateRawSync(content, { level: 9 }); }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    // 0xA000 no modo Unix = link simbólico
    central.writeUInt32LE(e.symlink ? (0o120777 << 16) >>> 0 : (0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// Canários FORA da raiz: se algum for criado/sobrescrito, escapou.
const CANARY = path.join(TMP, 'ESCAPOU.txt');
const CANARY_DEEP = path.join(TMP, 'data', 'ESCAPOU_FUNDO.txt');

console.log('Zip Slip — entradas tentando escapar da raiz:');
const ataques = [
  ['../ simples', '../ESCAPOU.txt'],
  ['../ múltiplo', '../../../../../../ESCAPOU.txt'],
  ['pasta + ../', 'ok/../../ESCAPOU.txt'],
  ['caminho absoluto', `${TMP}/ESCAPOU.txt`],
  ['barra invertida', '..\\..\\ESCAPOU.txt'],
  ['drive do Windows', 'C:\\ESCAPOU.txt'],
  ['fundo da árvore', '../data/ESCAPOU_FUNDO.txt'],
];
for (const [label, nome] of ataques) {
  const zip = buildZip([{ name: nome, content: 'invadido' }]);
  const r = archives.extractZip(fm, zip, 'destino');
  const escapou = fs.existsSync(CANARY) || fs.existsSync(CANARY_DEEP);
  ok(`bloqueia ${label}`, !escapou && r.extracted === 0,
    escapou ? 'ARQUIVO CRIADO FORA DA RAIZ' : `extraiu ${r.extracted}`);
  if (escapou) { fs.rmSync(CANARY, { force: true }); fs.rmSync(CANARY_DEEP, { force: true }); }
}
ok('nenhum canário existe ao fim dos ataques', !fs.existsSync(CANARY) && !fs.existsSync(CANARY_DEEP));

console.log('\nLink simbólico dentro do pacote:');
const zipLink = buildZip([
  { name: 'atalho', content: '/etc/passwd', symlink: true },
  { name: 'normal.txt', content: 'conteudo ok' },
]);
const rLink = archives.extractZip(fm, zipLink, 'comlink');
ok('symlink é ignorado', rLink.skipped.some((s) => /link simbólico/i.test(s.reason)));
ok('arquivo normal do mesmo pacote é extraído', rLink.extracted === 1, `extraiu ${rLink.extracted}`);
const atalho = path.join(ROOT, 'comlink', 'atalho');
ok('symlink não foi criado no disco', !fs.existsSync(atalho));

console.log('\nZip bomb (taxa de compressão absurda):');
const bomba = buildZip([{ name: 'bomba.txt', content: 'A'.repeat(60 * 1024 * 1024), deflate: true }]);
const rBomba = archives.extractZip(fm, bomba, 'bomba');
ok('recusa entrada com taxa suspeita',
  rBomba.extracted === 0 && rBomba.skipped.some((s) => /taxa de compress/i.test(s.reason)),
  JSON.stringify(rBomba.skipped[0] || {}));

console.log('\nIda e volta (compactar → extrair):');
fs.mkdirSync(path.join(ROOT, 'projeto', 'src'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'projeto', 'index.js'), 'console.log("oi");\n');
fs.writeFileSync(path.join(ROOT, 'projeto', 'src', 'app.js'), 'export default 42;\n');
fs.writeFileSync(path.join(ROOT, 'projeto', 'acentuação.txt'), 'coração\n');

const zipCriado = archives.createZip(fm, ['projeto']);
ok('gera um .zip não vazio', zipCriado.length > 0);
ok('começa com a assinatura PK', zipCriado[0] === 0x50 && zipCriado[1] === 0x4b);

const conteudo = archives.inspectZip(zipCriado);
ok('lista as entradas sem extrair', conteudo.count >= 3, `${conteudo.count} entradas`);
ok('preserva a estrutura de pastas', conteudo.entries.some((e) => e.name === 'projeto/src/app.js'));
ok('preserva acentos no nome', conteudo.entries.some((e) => e.name.includes('acentuação')));

const rVolta = archives.extractZip(fm, zipCriado, 'restaurado');
ok('extrai todos os arquivos', rVolta.extracted === 3, `extraiu ${rVolta.extracted}`);
ok('conteúdo idêntico ao original',
  fs.readFileSync(path.join(ROOT, 'restaurado', 'projeto', 'index.js'), 'utf8') === 'console.log("oi");\n');
ok('subpasta restaurada',
  fs.existsSync(path.join(ROOT, 'restaurado', 'projeto', 'src', 'app.js')));
ok('acento restaurado corretamente',
  fs.readFileSync(path.join(ROOT, 'restaurado', 'projeto', 'acentuação.txt'), 'utf8') === 'coração\n');

console.log('\nCompatibilidade com o unzip do sistema:');
const zipPath = path.join(TMP, 'compat.zip');
fs.writeFileSync(zipPath, zipCriado);
try {
  const { execFileSync } = require('child_process');
  execFileSync('unzip', ['-tq', zipPath], { encoding: 'utf8' });
  ok('o `unzip` do sistema valida o pacote gerado', true);
} catch (err) {
  const msg = String(err.message || '');
  if (/ENOENT/.test(msg)) ok('unzip não instalado — verificação pulada', true);
  else ok('o `unzip` do sistema valida o pacote gerado', false, msg.slice(0, 120));
}

console.log('\nNão sobrescreve sem permissão:');
const r1 = archives.extractZip(fm, zipCriado, 'restaurado');
ok('pula arquivos existentes por padrão',
  r1.extracted === 0 && r1.skipped.some((s) => /já existe/i.test(s.reason)));
const r2 = archives.extractZip(fm, zipCriado, 'restaurado', { overwrite: true });
ok('sobrescreve quando pedido explicitamente', r2.extracted === 3, `extraiu ${r2.extracted}`);

console.log('\nArquivo inválido:');
try {
  archives.inspectZip(Buffer.from('isto não é um zip, é texto puro'));
  ok('recusa arquivo que não é .zip', false, 'não lançou erro');
} catch (err) {
  ok('recusa arquivo que não é .zip', /inválido|corrompido/i.test(err.message), err.message);
}

console.log('\nCompactar não segue symlink para fora da raiz:');
fs.symlinkSync('/etc', path.join(ROOT, 'fuga'));
const zipComFuga = archives.createZip(fm, ['projeto']);
const listaFuga = archives.inspectZip(zipComFuga);
ok('nenhuma entrada de fora entrou no pacote',
  listaFuga.entries.every((e) => !e.name.includes('passwd')));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);